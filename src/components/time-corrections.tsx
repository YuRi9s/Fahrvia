"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { IconHistory, IconArrowRight, IconRefresh } from "@tabler/icons-react";
import type { CorrectionList } from "@/features/work-time/corrections";
import { berlinCandidates, berlinInput, berlinToISO } from "@/lib/berlin-time";
import { formatValue, request } from "./api";
import { ModuleTable } from "./module-table";

type Times = {
  startAt: string;
  endAt: string | null;
  breakMilliseconds: number;
};
const stateLabels: Record<string, string> = {
  PENDING: "In Prüfung",
  APPROVED: "Übernommen",
  REJECTED: "Abgelehnt",
};
function exactTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        timeZoneName: "short",
      }).format(new Date(value))
    : "—";
}
function TimeSummary({ value }: { value: Times }) {
  return (
    <dl className="correction-times">
      <div>
        <dt>Beginn</dt>
        <dd>{exactTime(value.startAt)}</dd>
      </div>
      <div>
        <dt>Ende</dt>
        <dd>{exactTime(value.endAt)}</dd>
      </div>
      <div>
        <dt>Pause</dt>
        <dd>
          {(value.breakMilliseconds / 1000).toLocaleString("de-DE", {
            maximumFractionDigits: 3,
          })}{" "}
          Sek.
        </dd>
      </div>
    </dl>
  );
}
function useCommand(done: () => void) {
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function send(body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setPending(body);
    try {
      const res = await fetch("/api/v1/time-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) setPending(null);
        throw new Error(data.error || "Die Anfrage wurde nicht bestätigt.");
      }
      setPending(null);
      done();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Die Anfrage wurde nicht bestätigt.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, pending, error, setError, send };
}
function Retry({ command }: { command: ReturnType<typeof useCommand> }) {
  return (
    <>
      {command.error && (
        <p className="alert error" role="alert">
          {command.error}
        </p>
      )}
      {command.pending && !command.busy && (
        <div className="correction-retry">
          <p>
            Die Antwort ist unklar. Wiederhole dieselbe Anfrage oder prüfe nach
            dem Neuladen den Antragsstatus.
          </p>
          <button onClick={() => void command.send(command.pending!)}>
            <IconRefresh size={16} /> Bestätigung erneut anfordern
          </button>
        </div>
      )}
    </>
  );
}
function DateField({
  name,
  label,
  original,
}: {
  name: string;
  label: string;
  original: string;
}) {
  const [value, setValue] = useState(berlinInput(original));
  return (
    <div className="correction-field">
      <label>
        {label} · Berlin
        <input
          required
          type="datetime-local"
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {berlinCandidates(value).length > 1 && (
        <label>
          Zeitumstellung
          <select name={`${name}Occurrence`} defaultValue="">
            <option value="">Unverändert / Zeitpunkt wählen</option>
            <option value="earlier">Erstes Vorkommen</option>
            <option value="later">Zweites Vorkommen</option>
          </select>
        </label>
      )}
    </div>
  );
}
function Proposal({
  entry,
  documents,
  onDone,
}: {
  entry: CorrectionList["entries"][number];
  documents: CorrectionList["documents"];
  onDone: () => void;
}) {
  const command = useCommand(onDone);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (command.pending) return;
    const data = new FormData(e.currentTarget);
    try {
      void command.send({
        action: "request",
        requestId: crypto.randomUUID(),
        entryId: entry.id,
        expectedVersion: entry.version,
        startAt: berlinToISO(
          String(data.get("startAt")),
          String(data.get("startAtOccurrence") || ""),
          entry.startAt,
        ),
        endAt: berlinToISO(
          String(data.get("endAt")),
          String(data.get("endAtOccurrence") || ""),
          entry.endAt!,
        ),
        breakMilliseconds: Math.round(Number(data.get("breakSeconds")) * 1000),
        reason: String(data.get("reason")),
        evidenceDocumentId: String(data.get("evidence") || "") || null,
      });
    } catch (e) {
      command.setError(
        e instanceof Error ? e.message : "Bitte Eingaben prüfen.",
      );
    }
  }
  return (
    <form onSubmit={submit} className="correction-form">
      <p className="muted">Gespeichert</p>
      <TimeSummary value={entry} />
      <fieldset disabled={command.busy || !!command.pending}>
        <legend>Gewünschte Korrektur</legend>
        <div className="correction-fields">
          <DateField name="startAt" label="Beginn" original={entry.startAt} />
          <DateField name="endAt" label="Ende" original={entry.endAt!} />
          <label>
            Pause gesamt · Sekunden
            <input
              name="breakSeconds"
              type="number"
              min="0"
              step={entry.clock ? "0.001" : "60"}
              defaultValue={entry.breakMilliseconds / 1000}
              required
            />
          </label>
        </div>
        <label>
          Warum ist die Korrektur nötig?
          <textarea
            name="reason"
            minLength={10}
            maxLength={2000}
            required
            placeholder="Zum Beispiel: Die App war nicht erreichbar. Tatsächlicher Beginn war 08:00 Uhr."
          />
        </label>
        <label>
          Nachweis · optional
          <select name="evidence">
            <option value="">Kein Dokument beigefügt</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Die letzten 100 eigenen Dokumente stehen zur Auswahl. Neue Nachweise
          zuerst unter <Link href="/documents">Dokumente</Link> hochladen. Bitte
          nur relevante Unterlagen verwenden.
        </p>
        <button className="primary" type="submit">
          Korrektur beantragen <IconArrowRight size={17} />
        </button>
      </fieldset>
      <Retry command={command} />
      <p className="muted">
        Der Antrag ändert deine Arbeitszeit erst nach Prüfung durch die
        Administration.
      </p>
    </form>
  );
}
function Decision({
  item,
  onDone,
}: {
  item: CorrectionList["items"][number];
  onDone: () => void;
}) {
  const command = useCommand(onDone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (command.pending) return;
        const data = new FormData(e.currentTarget);
        void command.send({
          action: "decide",
          id: item.id,
          requestId: crypto.randomUUID(),
          decision: String(data.get("decision")),
          reason: String(data.get("reason")),
        });
      }}
    >
      <fieldset disabled={command.busy || !!command.pending}>
        <legend>Entscheidung dokumentieren</legend>
        {item.stale && (
          <p className="alert">
            Diese Schicht wurde inzwischen geändert. Eine Übernahme ist
            gesperrt. Bitte ablehnen und einen neuen Antrag anfordern.
          </p>
        )}
        <label>
          Entscheidung
          <select name="decision" defaultValue="" required>
            <option value="" disabled>
              Bitte wählen
            </option>
            {!item.stale && (
              <option value="APPROVED">Beantragte Zeiten übernehmen</option>
            )}
            <option value="REJECTED">Antrag ablehnen</option>
          </select>
        </label>
        <label>
          Prüfung und Begründung
          <textarea name="reason" required minLength={10} maxLength={2000} />
        </label>
        <p className="muted">
          Eine Übernahme setzt die Arbeitszeit auf „Eingereicht“ zurück. Eine
          vorherige Freigabe muss erneuert werden. Eigene Anträge benötigen eine
          andere Administration.
        </p>
        <button type="submit" className="primary">
          Entscheidung verbindlich speichern
        </button>
      </fieldset>
      <Retry command={command} />
    </form>
  );
}
export function CorrectionsPanel({
  isAdmin = false,
  onChanged = () => {},
}: {
  isAdmin?: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<CorrectionList | null>(null),
    [page, setPage] = useState(1),
    [entryPage, setEntryPage] = useState(1),
    [filter, setFilter] = useState(isAdmin ? "PENDING" : "ALL"),
    [entryId, setEntryId] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [nonce, setNonce] = useState(0);
  const serial = useRef(0);
  const load = useCallback(async () => {
    const n = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const value = await request<CorrectionList>(
        `/api/v1/time-corrections?page=${page}&entryPage=${entryPage}&status=${filter}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      if (n === serial.current) setData(value);
    } catch (e) {
      if (n === serial.current)
        setError(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
    } finally {
      if (n === serial.current) setLoading(false);
    }
  }, [page, entryPage, filter]);
  const invalidate = useCallback(() => {
    serial.current++;
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(id);
      invalidate();
    };
  }, [load, nonce, invalidate]);
  const done = () => {
    setEntryId("");
    setMessage("Gespeichert. Der aktuelle Status wird geladen.");
    setNonce((v) => v + 1);
    onChanged();
  };
  const entry = data?.entries.find((e) => e.id === entryId);
  return (
    <section
      className="panel corrections-panel"
      aria-label="Zeitkorrekturen"
      aria-busy={loading}
    >
      <div className="correction-heading">
        <div>
          <p className="eyebrow">ZEITEN NACHVOLLZIEHBAR KLÄREN</p>
          <h2>
            {isAdmin ? "Korrekturanträge prüfen" : "Eine Zeit stimmt nicht?"}
          </h2>
          <p>
            {isAdmin
              ? "Vergleiche Erfassung, Antrag und Nachweis. Jede Entscheidung bleibt dokumentiert."
              : "Melde eine Abweichung. Deine ursprünglichen Buchungen bleiben erhalten."}
          </p>
        </div>
        <IconHistory aria-hidden="true" size={28} />
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <button disabled={loading} onClick={() => void load()}>
        <IconRefresh size={16} /> Anträge aktualisieren
      </button>
      {data && !loading && !error && (
        <>
          {!isAdmin && (
            <details className="correction-compose">
              <summary>Korrektur für abgeschlossene Schicht beantragen</summary>
              <label>
                Schicht auswählen
                <select
                  value={entryId}
                  onChange={(e) => setEntryId(e.target.value)}
                >
                  <option value="">Bitte wählen</option>
                  {data.entries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {formatValue("startAt", e.startAt)} –{" "}
                      {formatValue("endAt", e.endAt)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="correction-pager">
                <button
                  disabled={entryPage <= 1}
                  onClick={() => {
                    setEntryId("");
                    setEntryPage((v) => v - 1);
                  }}
                >
                  Neuere Schichten
                </button>
                <span>Seite {entryPage}</span>
                <button
                  disabled={entryPage * 20 >= data.entryTotal}
                  onClick={() => {
                    setEntryId("");
                    setEntryPage((v) => v + 1);
                  }}
                >
                  Ältere Schichten
                </button>
              </div>
              {entry && (
                <Proposal
                  key={`${entry.id}:${entry.version}`}
                  entry={entry}
                  documents={data.documents}
                  onDone={done}
                />
              )}
            </details>
          )}
          <div className="correction-heading">
            <h3>{isAdmin ? "Anträge" : "Meine Anträge"}</h3>
            <label>
              Anzeige
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="PENDING">Offene Anträge</option>
                <option value="ALL">Alle Anträge</option>
              </select>
            </label>
          </div>
          {!data.items.length && (
            <p className="correction-empty">Keine Anträge in dieser Auswahl.</p>
          )}
          <div className="correction-list">
            {data.items.map((item) => (
              <article key={item.id} className="correction-card">
                <div className="correction-heading">
                  <div>
                    <strong>
                      {isAdmin ? item.driverName : "Dein Korrekturantrag"}
                    </strong>
                    <p className="muted">
                      {formatValue("createdAt", item.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`correction-status correction-${item.status.toLowerCase()}`}
                  >
                    {stateLabels[item.status]}
                  </span>
                </div>
                <p className="correction-reason">{item.reason}</p>
                <div className="correction-comparison">
                  <div>
                    <h4>Zum Zeitpunkt des Antrags</h4>
                    <TimeSummary value={item.before as Times} />
                  </div>
                  <div>
                    <h4>Beantragt</h4>
                    <TimeSummary value={item.proposal} />
                  </div>
                </div>
                {item.evidence && (
                  <a
                    className="button"
                    href={`/api/v1/files/${item.evidence.id}`}
                    download
                  >
                    Nachweis: {item.evidence.filename}
                  </a>
                )}
                {item.decisionReason && (
                  <div className="correction-decision">
                    <strong>
                      Entscheidung ·{" "}
                      {formatValue("reviewedAt", item.reviewedAt)}
                    </strong>
                    <p>{item.decisionReason}</p>
                  </div>
                )}
                {isAdmin && item.status === "PENDING" && (
                  <details>
                    <summary>Antrag prüfen und entscheiden</summary>
                    <Decision item={item} onDone={done} />
                  </details>
                )}
              </article>
            ))}
          </div>
          <div className="correction-pager">
            <button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
              Zurück
            </button>
            <span>
              Seite {page} · {data.total} Anträge
            </span>
            <button
              disabled={page * 20 >= data.total}
              onClick={() => setPage((v) => v + 1)}
            >
              Weiter
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function AdminWorkTimes({
  initialData,
  initialQuery,
}: {
  initialData?: unknown;
  initialQuery: string;
}) {
  const [revision, setRevision] = useState(0),
    [query, setQuery] = useState(initialQuery);
  return (
    <>
      <CorrectionsPanel
        isAdmin
        onChanged={() => {
          setQuery(window.location.search.slice(1));
          setRevision((v) => v + 1);
        }}
      />
      <ModuleTable
        key={revision}
        module="work-times"
        isAdmin
        isDriver={false}
        initialData={revision ? undefined : initialData}
        initialQuery={query}
      />
    </>
  );
}
