"use client";
import { useEffect, useRef, useState } from "react";
import { request, mutate, formatValue, type Row } from "./api";
import { RecordPicker } from "./record-picker";
import { BerlinDateField } from "./berlin-date-field";
import { berlinToISO } from "@/lib/berlin-time";
import type { NotificationDetails } from "@/features/notifications/service";
const statuses: Record<string, string> = {
  NONE: "Keine Erinnerung geplant",
  PENDING: "Erinnerung geplant",
  RETRY: "Automatischer Wiederholungsversuch geplant",
  FAILED: "Handlungsbedarf: Empfänger prüfen",
  CREATED: "Erinnerung im Postfach erstellt",
  CANCELLED: "Keine weitere Erinnerung",
};
export function NotificationDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [epoch, setEpoch] = useState(0),
    [mode, setMode] = useState<"assign" | "complete" | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = JSON.stringify([id, epoch]);
  const [result, setResult] = useState<{
    key: string;
    data?: NotificationDetails;
    error?: string;
  } | null>(null);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request<NotificationDetails>(
      `/api/v1/notification-details?id=${encodeURIComponent(id)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              e instanceof Error
                ? e.message
                : "Meldung konnte nicht geladen werden.",
          });
      });
    return () => controller.abort();
  }, [id, epoch, key]);
  async function act(action: string, extra: Row = {}) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await mutate("notifications", action, id, {
        expectedVersion: data.version,
        ...extra,
      });
      setMode(null);
      setEpoch((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "complete")
      void act("complete", { outcome: String(form.get("outcome") || "") });
    else {
      try {
        const local = String(form.get("dueAt") || "");
        void act("assign", {
          ownerId: String(form.get("ownerId") || ""),
          nextAction: String(form.get("nextAction") || ""),
          dueAt: local
            ? berlinToISO(
                local,
                String(form.get("dueAtOccurrence") || ""),
                String(data?.dueAt || ""),
              )
            : null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bitte Termin prüfen.");
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog notification-dialog"
      aria-labelledby="notification-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="notification-title">Meldung & nächste Schritte</h2>
      </div>
      {!current && (
        <p className="invitation-copy" role="status">
          Meldung wird geladen …
        </p>
      )}
      {(error || current?.error) && (
        <p className="alert error" role="alert">
          {error || current?.error}
        </p>
      )}
      {data && (
        <section className="notification-content">
          <h3>{data.title}</h3>
          <p className="notification-text">{data.body}</p>
          <dl className="detail-list">
            <div>
              <dt>Verantwortlich</dt>
              <dd>{data.ownerName}</dd>
            </div>
            <div>
              <dt>Bestätigt</dt>
              <dd>{formatValue("acknowledgedAt", data.acknowledgedAt)}</dd>
            </div>
            <div>
              <dt>Erledigt</dt>
              <dd>{formatValue("resolvedAt", data.resolvedAt)}</dd>
            </div>
            <div>
              <dt>Fällig</dt>
              <dd>{formatValue("dueAt", data.dueAt)}</dd>
            </div>
          </dl>
          {data.nextAction && (
            <p className="notification-text">
              <strong>Nächster Schritt:</strong> {data.nextAction}
            </p>
          )}
          {data.outcome && (
            <p className="notification-text">
              <strong>Ergebnis:</strong> {data.outcome}
            </p>
          )}
          <p className="muted">
            {data.resolvedAt
              ? "Erledigt — keine weitere Erinnerung"
              : statuses[data.deliveryStatus]}
            {data.nextReminderAt && !data.resolvedAt
              ? ` · ${formatValue("nextReminderAt", data.nextReminderAt)}`
              : ""}
          </p>
          {data.lastDeliveryError && !data.resolvedAt && (
            <p className="alert">{data.lastDeliveryError}</p>
          )}
          {data.stockItemId && (
            <p>
              Bestandswarnungen werden durch ausreichenden Bestand automatisch
              erledigt.{" "}
              <a
                href={`/inventory?q=${encodeURIComponent(data.stockSku || "")}`}
              >
                Inventar öffnen
              </a>
            </p>
          )}
          {!data.resolvedAt && !data.reminderOfId && (
            <div className="invitation-actions">
              {data.isOwner && !data.acknowledgedAt && (
                <button disabled={busy} onClick={() => void act("acknowledge")}>
                  Übernahme bestätigen
                </button>
              )}
              {data.canAssign && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMode("assign");
                    setError("");
                  }}
                >
                  Nächsten Schritt zuordnen
                </button>
              )}
              {data.isOwner && data.acknowledgedAt && !data.stockItemId && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMode("complete");
                    setError("");
                  }}
                >
                  Als erledigt abschließen
                </button>
              )}
              {["FAILED", "RETRY"].includes(data.deliveryStatus) && (
                <button disabled={busy} onClick={() => void act("retry")}>
                  Erinnerung erneut einplanen
                </button>
              )}
            </div>
          )}
          {mode && !data.resolvedAt && (
            <form
              key={`${mode}-${data.version}`}
              onSubmit={submit}
              className="notification-action-form"
            >
              <fieldset disabled={busy} className="invitation-fields">
                {mode === "assign" ? (
                  <>
                    <RecordPicker
                      kind="recipient"
                      name="ownerId"
                      label="Verantwortliche Person"
                      staffRecipient
                      required
                      initialValue={data.actionOwnerId || data.recipientId}
                    />
                    <label>
                      Nächster Schritt
                      <textarea
                        name="nextAction"
                        required
                        maxLength={500}
                        defaultValue={data.nextAction}
                      />
                    </label>
                    <BerlinDateField
                      name="dueAt"
                      label="Fällig (optional)"
                      original={String(data.dueAt || "")}
                    />
                    <p className="muted">
                      Eine Erinnerung wird zum Termin eingeplant, ohne Termin
                      nach 24 Stunden. Die Zuordnung fordert eine neue
                      Bestätigung an.
                    </p>
                  </>
                ) : (
                  <label>
                    Ergebnis
                    <textarea name="outcome" required maxLength={500} />
                  </label>
                )}
              </fieldset>
              <div className="invitation-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode(null)}
                >
                  Abbrechen
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Wird gespeichert …" : "Speichern"}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      <footer className="dialog-footer">
        <button
          disabled={busy}
          onClick={() => {
            setMode(null);
            setError("");
            setEpoch((v) => v + 1);
          }}
        >
          Aktualisieren
        </button>
        <button disabled={busy} onClick={onClose}>
          Schließen
        </button>
      </footer>
    </dialog>
  );
}
