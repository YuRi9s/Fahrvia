"use client";
import { useEffect, useRef, useState } from "react";
import { mutate, type Row } from "./api";
import { de } from "@/messages/de";
export function ReactivateDriverDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("drivers", "reactivate", String(row.id), {
        expectedUpdatedAt: row.updatedAt,
        reason,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog"
      aria-labelledby="restore-driver-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="dialog-heading">
          <h2 id="restore-driver-title">Fahrer reaktivieren?</h2>
        </div>
        <p className="invitation-copy">
          <strong>
            {String(row.firstName)} {String(row.lastName)}
          </strong>
          <br />
          {String(row.email)}
        </p>
        <p className="invitation-copy">
          Das bestehende Fahrerprofil wird wieder aktiv. Verlauf, Dokumente und
          frühere Zuordnungen bleiben erhalten. Frühere Fahrzeugzuweisungen
          werden nicht erneut geöffnet.
        </p>
        <p className="invitation-copy">
          Ein gesperrter Kontozugang bleibt gesperrt. Bei Bedarf anschließend
          unter „Konten &amp; Rollen“ freigeben. Ohne Benutzerkonto kann danach
          eine Einladung erstellt werden.
        </p>
        <div className="form-grid">
          <label className="span-two">
            Grund der Reaktivierung
            <textarea
              required
              minLength={3}
              maxLength={500}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="primary"
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? de.loading : "Reaktivierung bestätigen"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
