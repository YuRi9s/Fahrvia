"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerStop,
  IconClock,
  IconRefresh,
} from "@tabler/icons-react";
import type {
  ClockAction,
  ClockCommand,
  ClockSnapshot,
} from "@/features/work-time/types";
import { VehicleInspections } from "./vehicle-inspections";
import { CorrectionsPanel } from "./time-corrections";
import { ModuleTable } from "./module-table";
import { formatValue } from "./api";
const labels: Record<ClockAction, string> = {
  start: "Arbeit beginnen",
  pause: "Pause beginnen",
  resume: "Arbeit fortsetzen",
  finish: "Arbeit beenden",
};
function duration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function DriverWorkTimes({
  userId,
  driverId,
  initialData,
  initialQuery,
}: {
  userId: string;
  driverId: string;
  initialData?: unknown;
  initialQuery: string;
}) {
  const [revision, setRevision] = useState(0);
  const [historyQuery, setHistoryQuery] = useState(initialQuery);
  return (
    <>
      <ShiftClock
        key={userId}
        userId={userId}
        onChanged={() => {
          setHistoryQuery(window.location.search.slice(1));
          setRevision((v) => v + 1);
        }}
      />
      <VehicleInspections driver refreshKey={revision} />
      <CorrectionsPanel key={`corrections:${revision}`} />
      <ModuleTable
        key={revision}
        module="work-times"
        isDriver
        isAdmin={false}
        ownDriverId={driverId}
        initialQuery={historyQuery}
        initialData={revision ? undefined : initialData}
      />
    </>
  );
}
function ShiftClock({
  userId,
  onChanged,
}: {
  userId: string;
  onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ClockSnapshot | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ClockCommand | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const requestBusy = useRef(false);
  const anchor = useRef(0);
  const sequence = useRef(0);
  const storageKey = `fahriva-clock-pending:${userId}`;
  function accept(value: ClockSnapshot) {
    anchor.current = performance.now();
    setElapsed(0);
    setSnapshot(value);
    setConfirmed(true);
  }
  const load = useCallback(async () => {
    if (requestBusy.current) return;
    const version = ++sequence.current;
    try {
      const response = await fetch("/api/v1/shift-clock", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error || "Die Schicht konnte nicht geladen werden.",
        );
      if (version !== sequence.current) return;
      anchor.current = performance.now();
      setElapsed(0);
      setSnapshot(value);
      setConfirmed(true);
    } catch (cause) {
      if (version !== sequence.current) return;
      setConfirmed(false);
      setError(
        cause instanceof Error ? cause.message : "Verbindung fehlgeschlagen.",
      );
    }
  }, []);
  const invalidate = useCallback(() => {
    sequence.current++;
  }, []);
  useEffect(() => {
    let disposed = false;
    const bootstrap = window.setTimeout(() => {
      void load().then(() => {
        if (disposed) return;
        try {
          const stored = sessionStorage.getItem(storageKey);
          if (stored) setPending(JSON.parse(stored));
        } catch {
          /* Commands are validated again by the server. */
        }
        setReady(true);
      });
    }, 0);
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const lostConnection = () => setConfirmed(false);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", lostConnection);
    document.addEventListener("visibilitychange", refresh);
    const poll = window.setInterval(refresh, 30000);
    const ticker = window.setInterval(
      () => setElapsed(Math.max(0, performance.now() - anchor.current)),
      1000,
    );
    return () => {
      disposed = true;
      clearTimeout(bootstrap);
      invalidate();
      clearInterval(poll);
      clearInterval(ticker);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", lostConnection);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, storageKey, invalidate]);
  async function send(command: ClockCommand) {
    if (requestBusy.current) return;
    requestBusy.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    setPending(command);
    setConfirmed(false);
    setConfirmFinish(false);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command));
    } catch {
      /* In-memory retry remains available. */
    }
    let settled = false;
    try {
      const response = await fetch("/api/v1/shift-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10000),
      });
      const value = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) settled = true;
        throw new Error(value.error || "Die Aktion wurde nicht bestätigt.");
      }
      accept(value);
      settled = true;
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Die Aktion wurde nicht bestätigt. Bitte dieselbe Anfrage erneut senden.",
      );
    } finally {
      if (settled) {
        setPending(null);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Storage may be disabled. */
        }
      }
      requestBusy.current = false;
      setBusy(false);
      if (settled) void load();
    }
  }
  function act(action: ClockAction) {
    if (!snapshot || pending || !confirmed) return;
    const entry = snapshot.entry;
    void send({
      action,
      requestId: crypto.randomUUID(),
      ...(action !== "start" && entry
        ? { entryId: entry.id, expectedVersion: entry.version }
        : {}),
    });
  }
  const entry = snapshot?.entry;
  const active = entry && entry.state !== "FINISHED";
  const now = snapshot ? new Date(snapshot.serverNow).getTime() + elapsed : 0;
  const breakTime = entry
    ? entry.breakMilliseconds +
      (entry.breakStartedAt
        ? Math.max(0, now - new Date(entry.breakStartedAt).getTime())
        : 0)
    : 0;
  const total = entry
    ? (entry.endAt ? new Date(entry.endAt).getTime() : now) -
      new Date(entry.startAt).getTime()
    : 0;
  const disabled = busy || !!pending || !confirmed || !ready;
  return (
    <section
      className={`shift-clock panel ${entry?.state === "PAUSED" ? "shift-paused" : ""}`}
      aria-labelledby="shift-title"
      aria-busy={busy}
    >
      <div className="shift-heading">
        <div>
          <p className="eyebrow">MEIN ARBEITSTAG</p>
          <h2 id="shift-title">
            {active ? "Deine Schicht" : "Bereit für den Arbeitstag?"}
          </h2>
        </div>
        <IconClock size={28} aria-hidden="true" />
      </div>
      <p className="shift-state" role="status">
        {busy
          ? "Wird bestätigt …"
          : pending
            ? "Aktion noch nicht bestätigt"
            : !confirmed
              ? "Verbindung wird geprüft"
              : entry?.state === "PAUSED"
                ? "Pause läuft"
                : active
                  ? "Arbeitszeit läuft"
                  : "Keine laufende Schicht"}
      </p>
      <div className="shift-metrics">
        <div>
          <span>
            {active
              ? "Arbeitszeit · diese Schicht"
              : "Letzte Schicht · Arbeitszeit"}
          </span>
          <strong
            className="shift-timer"
            aria-label={`Arbeitszeit ${duration(total - breakTime)}`}
          >
            {duration(total - breakTime)}
          </strong>
        </div>
        <div>
          <span>Pause gesamt</span>
          <strong>{duration(breakTime)}</strong>
        </div>
      </div>
      {entry && (
        <p className="muted">
          Beginn: {formatValue("startAt", entry.startAt)}
          {entry.endAt ? ` · Ende: ${formatValue("endAt", entry.endAt)}` : ""} ·
          Berliner Zeit
        </p>
      )}
      {!snapshot && <p>Deine gespeicherte Schicht wird geladen.</p>}
      {snapshot?.blockedByManualEntry && (
        <p role="alert" className="alert">
          Eine manuell angelegte Arbeitszeit ist noch offen. Bitte die
          Administration kontaktieren, bevor du eine neue Schicht beginnst.
        </p>
      )}
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {pending ? (
        <div className="shift-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void send(pending)}
          >
            <IconRefresh size={18} aria-hidden="true" />
            Bestätigung erneut anfordern
          </button>
          <p>
            Es wird dieselbe Anfrage wiederholt, keine zweite Buchung angelegt.
          </p>
        </div>
      ) : (
        <div className="shift-actions">
          {!active && (
            <button
              className="primary"
              disabled={disabled || snapshot?.blockedByManualEntry}
              onClick={() => act("start")}
            >
              <IconPlayerPlay size={20} aria-hidden="true" />
              {labels.start}
            </button>
          )}
          {active && (
            <>
              <button
                className="primary"
                disabled={disabled}
                onClick={() =>
                  act(entry.state === "PAUSED" ? "resume" : "pause")
                }
              >
                {entry.state === "PAUSED" ? (
                  <IconPlayerPlay size={20} aria-hidden="true" />
                ) : (
                  <IconPlayerPause size={20} aria-hidden="true" />
                )}
                {entry.state === "PAUSED" ? labels.resume : labels.pause}
              </button>
              <button
                disabled={disabled}
                onClick={() => setConfirmFinish(true)}
              >
                <IconPlayerStop size={18} aria-hidden="true" />
                Arbeit beenden
              </button>
            </>
          )}
          {!confirmed && (
            <button disabled={busy} onClick={() => void load()}>
              Verbindung erneut prüfen
            </button>
          )}
        </div>
      )}
      {confirmFinish && (
        <div
          className="shift-confirm"
          role="group"
          aria-label="Schichtende bestätigen"
        >
          <p>
            Schicht jetzt beenden? Eine laufende Pause wird ebenfalls beendet.
          </p>
          <button
            className="primary"
            disabled={disabled}
            onClick={() => act("finish")}
          >
            Jetzt beenden
          </button>
          <button onClick={() => setConfirmFinish(false)}>
            Weiterarbeiten
          </button>
        </div>
      )}
      <p className="shift-note">
        {active ? "Die Schicht bleibt beim Schließen der App aktiv. " : ""}
        Zeitpunkte werden vom Server erfasst. Nachträgliches Bearbeiten ist hier
        nicht möglich.
      </p>
      {!!entry?.events.length && (
        <details className="shift-timeline">
          <summary>
            {active
              ? "Schichtverlauf"
              : "Ursprüngliche Buchungen der letzten Schicht"}
          </summary>
          <p className="muted">
            Bis zu 100 ursprüngliche Buchungen dieser Schicht. Genehmigte
            Korrekturen ändern diese Ereignisse nicht; der Timer zeigt die
            aktuell gültigen Zeiten.
          </p>
          <ol>
            {entry.events.map((event) => (
              <li key={event.id}>
                <span>{labels[event.action]}</span>
                <time dateTime={event.occurredAt}>
                  {formatValue("occurredAt", event.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
