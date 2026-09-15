"use client";
import { useEffect, useRef, useState } from "react";
import { mutate, type Row } from "./api";
import { RecordPicker } from "./record-picker";
import { de, valueLabel } from "@/messages/de";
export function KeyDialog({
  row,
  action,
  onClose,
  onSaved,
}: {
  row?: Row;
  action: "create" | "update" | "retire" | "replace";
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [location, setLocation] = useState(String(row?.location || "OFFICE"));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const titles = {
    create: "Schlüssel hinzufügen",
    update: "Schlüsselverwahrung ändern",
    retire: "Schlüssel ausmustern",
    replace: "Schlüssel ersetzen",
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await mutate("keys", action, row ? String(row.id) : undefined, {
        reason: String(form.get("reason") || ""),
        ...(action === "create"
          ? { vehicleId: String(form.get("vehicleId") || "") }
          : { version: row?.version }),
        ...(action === "update"
          ? {
              location,
              ...(location === "DRIVER"
                ? { driverId: String(form.get("driverId") || "") }
                : {}),
            }
          : {}),
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
      aria-labelledby="key-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="key-dialog-title">{titles[action]}</h2>
        </div>
        {row && (
          <p className="invitation-copy">
            <strong>
              {String(row.plate)} · Schlüssel {String(row.slot)}
            </strong>
            <br />
            {valueLabel(String(row.location))}
          </p>
        )}
        <p className="invitation-copy">
          {action === "create"
            ? "Erfassen Sie einen tatsächlich vorhandenen Schlüssel. Er wird einem freien Platz zugeordnet und zunächst im Büro verwahrt. Pro Fahrzeug sind vier aktive Schlüssel möglich."
            : action === "replace"
              ? "Der alte Schlüssel wird ausgemustert. Der Ersatz erhält einen eigenen Eintrag am selben Platz und wird zunächst im Büro verwahrt. Der bisherige Verlauf bleibt erhalten."
              : action === "retire"
                ? "Dieser Schlüssel wird dauerhaft ausgemustert und kann nicht mehr ausgegeben werden. Sein Verlauf bleibt erhalten."
                : "Bitte den tatsächlichen Verwahrort angeben. Eine Änderung wird mit Zeit, Bearbeiter und Grund protokolliert."}
        </p>
        <fieldset className="invitation-fields" disabled={busy}>
          <div className="form-grid">
            {action === "create" && (
              <RecordPicker
                name="vehicleId"
                kind="vehicle"
                label="Fahrzeug"
                required
              />
            )}
            {action === "update" && (
              <label>
                Verwahrort
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  {["OFFICE", "DRIVER", "MISSING"].map((value) => (
                    <option key={value} value={value}>
                      {valueLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {action === "update" && location === "DRIVER" && (
              <RecordPicker
                name="driverId"
                kind="driver"
                label="Fahrer"
                required
                initialValue={String(row?.driverId || "")}
              />
            )}
            <label className="span-two">
              Grund
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button className="primary" disabled={busy}>
            {busy ? de.loading : "Änderung bestätigen"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
