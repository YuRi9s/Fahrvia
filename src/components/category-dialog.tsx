"use client";
import { useEffect, useRef, useState } from "react";
import { mutate, type Row } from "./api";
import { valueLabel, de } from "@/messages/de";
export function CategoryDialog({
  row,
  action,
  onClose,
  onSaved,
}: {
  row: Row;
  action: "update" | "archive" | "reactivate";
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(String(row.name));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const title =
    action === "update"
      ? "Kategorie umbenennen"
      : action === "archive"
        ? "Kategorie archivieren"
        : "Kategorie reaktivieren";
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("categories", action, String(row.id), {
        version: row.version,
        reason,
        ...(action === "update" ? { name } : {}),
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
      aria-labelledby="category-title"
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
          <h2 id="category-title">{title}</h2>
        </div>
        <p className="invitation-copy">
          <strong>{String(row.name)}</strong> · {valueLabel(String(row.type))}
          <br />
          {String(row.usageCount ?? 0)} verknüpfte Fahrzeuge
        </p>
        <p className="invitation-copy">
          {action === "update"
            ? "Der neue Name wird bei verknüpften Fahrzeugen übernommen. Der Kategorietyp bleibt unverändert."
            : action === "archive"
              ? "Bestehende Verknüpfungen bleiben erhalten. Für neue Zuordnungen steht diese Kategorie nicht mehr zur Verfügung."
              : "Diese Kategorie steht wieder für neue Zuordnungen zur Verfügung."}
        </p>
        <div className="form-grid">
          {action === "update" && (
            <label className="span-two">
              Neuer Name
              <input
                required
                maxLength={row.type === "BRAND" ? 80 : 100}
                disabled={busy}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="span-two">
            Grund
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
            disabled={
              busy ||
              reason.trim().length < 3 ||
              (action === "update" &&
                (!name.trim() || name.trim() === row.name))
            }
          >
            {busy ? de.loading : "Änderung bestätigen"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
