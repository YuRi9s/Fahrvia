"use client";
import { useEffect, useRef, useState } from "react";
import { mutate, type Row } from "./api";
import { RecordPicker } from "./record-picker";
export function StockAlertDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [enabled, setEnabled] = useState(Boolean(row.alertRecipientId));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await mutate("inventory", "alert-settings", String(row.id), {
        expectedVersion: row.alertVersion,
        minimumStock: Number(form.get("minimumStock")),
        recipientId: enabled ? String(form.get("recipientId") || "") : null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Warnung konnte nicht gespeichert werden.",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog stock-alert-dialog"
      aria-labelledby="stock-alert-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="stock-alert-title">Mindestbestandswarnung</h2>
        </div>
        <p className="invitation-copy">
          <strong>{String(row.name)}</strong> · {String(row.sku)}
          <br />
          Jetzt verfügbar: {String(row.stock)} · {String(row.alertStatus || "")}
        </p>
        <fieldset disabled={busy} className="invitation-fields">
          <label>
            Mindestbestand
            <input
              name="minimumStock"
              type="number"
              required
              min={0}
              max={1000000}
              step={1}
              defaultValue={Number(row.minimumStock || 0)}
            />
          </label>
          <label className="stock-alert-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Verantwortliche Person benachrichtigen
          </label>
          {enabled && (
            <RecordPicker
              kind="recipient"
              name="recipientId"
              label="Verantwortliche Person"
              staffRecipient
              required
              initialValue={String(row.alertRecipientId || "")}
            />
          )}
        </fieldset>
        <p className="invitation-copy">
          Eine Meldung unter „Benachrichtigungen“, sobald der verfügbare Bestand
          unter dem Mindestbestand liegt. Bei ausreichendem Bestand wird sie als
          erledigt markiert. Erst eine erneute Unterschreitung löst eine neue
          Meldung aus. Mindestbestand 0 löst keine Warnung aus.
        </p>
        <p className="invitation-copy">
          Beim Wechsel der verantwortlichen Person erhält diese bei bestehendem
          Fehlbestand eine eigene Meldung. Frühere Meldungen bleiben erhalten.
          Inaktive Empfänger erhalten keine neuen Meldungen; der Status wird in
          der Inventarliste angezeigt.
        </p>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Wird gespeichert …" : "Einstellungen speichern"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
