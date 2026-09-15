"use client";
import { useEffect, useRef, useState } from "react";
import { mutate, formatValue, type Row } from "./api";
import { RecordPicker } from "./record-picker";
import { BerlinDateField } from "./berlin-date-field";
import { berlinToISO } from "@/lib/berlin-time";
import { valueLabel } from "@/messages/de";
type Pair = {
  id: string;
  driverId?: string;
  vehicleId?: string;
  driverName?: string;
  plate?: string;
};
export function WaveDialog({
  row,
  action = "edit",
  onClose,
  onSaved,
}: {
  row?: Row;
  action?: "edit" | "view" | "transition";
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pairs, setPairs] = useState<Pair[]>(
    (row?.participants as Pair[]) || [],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const planned = !row || row.status === "PLANNED";
  const view = action === "view" || row?.status === "COMPLETED";
  const transition = action === "transition";
  const next = row?.status === "PLANNED" ? "ACTIVE" : "COMPLETED";
  const title = transition
    ? next === "ACTIVE"
      ? "Welle starten?"
      : "Welle abschließen?"
    : view
      ? "Welle & Teilnehmer"
      : planned
        ? row
          ? "Welle bearbeiten"
          : "Welle erstellen"
        : "Fortschritt erfassen";
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data: Row = { expectedVersion: row?.version };
      let operation: string;
      if (transition) {
        operation = "transition";
        data.status = next;
      } else if (!planned) {
        operation = "progress";
        data.delivered = Number(form.get("delivered"));
      } else {
        operation = row ? "update" : "create";
        Object.assign(data, {
          name: String(form.get("name") || ""),
          startAt: berlinToISO(
            String(form.get("startAt") || ""),
            String(form.get("startAtOccurrence") || ""),
            String(row?.startAt || ""),
          ),
          packages: Number(form.get("packages")),
          delivered: Number(form.get("delivered")),
          participants: pairs.map((pair) => ({
            driverId: String(form.get(`${pair.id}-driver`) || ""),
            vehicleId: String(form.get(`${pair.id}-vehicle`) || ""),
          })),
        });
      }
      await mutate("waves", operation, row ? String(row.id) : undefined, data);
      onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Welle konnte nicht gespeichert werden.",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog wave-dialog"
      aria-labelledby="wave-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="wave-dialog-title">{title}</h2>
        </div>
        <p className="invitation-copy">
          {transition
            ? "Bitte Teilnehmer und Paketstand vor dem Statuswechsel prüfen."
            : "Teilnehmer werden als Fahrer-/Fahrzeugpaare erfasst. Die Paketanzahl gilt für die gesamte Welle."}{" "}
          Der Start prüft aktive Teilnehmer und Konflikte mit anderen aktiven
          Wellen. Fahrzeugzuweisungen und Schlüsselverwahrung werden separat
          verwaltet.
        </p>
        <fieldset
          disabled={busy || view || transition}
          className="invitation-fields"
        >
          {planned && !view && !transition ? (
            <>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={String(row?.name || "")}
                  />
                </label>
                <BerlinDateField
                  name="startAt"
                  label="Start"
                  required
                  original={String(row?.startAt || "")}
                />
                <label>
                  Pakete gesamt
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    required
                    name="packages"
                    defaultValue={Number(row?.packages || 0)}
                  />
                </label>
                <label>
                  Zugestellt
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    step={1}
                    required
                    name="delivered"
                    defaultValue={Number(row?.delivered || 0)}
                  />
                </label>
              </div>
              <h3>Teilnehmer ({pairs.length}/100)</h3>
              {!pairs.length && (
                <p className="muted">
                  Ein Entwurf darf leer sein. Vor dem Start mindestens ein
                  vollständiges Paar ergänzen.
                </p>
              )}
              {pairs.map((pair, index) => (
                <section key={pair.id} className="wave-pair">
                  <h4>Paar {index + 1}</h4>
                  <div className="form-grid">
                    <RecordPicker
                      name={`${pair.id}-driver`}
                      kind="driver"
                      label="Fahrer"
                      initialValue={pair.driverId || ""}
                      required
                    />
                    <RecordPicker
                      name={`${pair.id}-vehicle`}
                      kind="vehicle"
                      label="Fahrzeug"
                      initialValue={pair.vehicleId || ""}
                      required
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPairs((current) =>
                        current.filter((x) => x.id !== pair.id),
                      )
                    }
                  >
                    Paar {index + 1} entfernen
                  </button>
                </section>
              ))}
              <button
                type="button"
                disabled={pairs.length >= 100}
                onClick={() =>
                  setPairs((current) => [
                    ...current,
                    { id: crypto.randomUUID() },
                  ])
                }
              >
                + Teilnehmerpaar
              </button>
            </>
          ) : (
            <>
              <p>
                <strong>{String(row?.name || "")}</strong> ·{" "}
                {formatValue("startAt", row?.startAt)} ·{" "}
                {valueLabel(row?.status)}
              </p>
              <p>
                {String(row?.delivered ?? 0)} / {String(row?.packages ?? 0)}{" "}
                Pakete zugestellt
              </p>
              <ul className="wave-participants">
                {pairs.map((pair) => (
                  <li key={pair.id}>
                    {pair.driverName || "Fahrer fehlt"} ·{" "}
                    {pair.plate || "Fahrzeug fehlt"}
                  </li>
                ))}
              </ul>
              {!pairs.length && <p>Keine Teilnehmer zugeordnet.</p>}
              {!view && !transition && (
                <label>
                  Zugestellt
                  <input
                    name="delivered"
                    type="number"
                    required
                    min={0}
                    max={Number(row?.packages || 0)}
                    step={1}
                    defaultValue={Number(row?.delivered || 0)}
                  />
                </label>
              )}
            </>
          )}
        </fieldset>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            {view ? "Schließen" : "Abbrechen"}
          </button>
          {!view && (
            <button className="primary" disabled={busy}>
              {busy
                ? "Wird gespeichert …"
                : transition
                  ? next === "ACTIVE"
                    ? "Start bestätigen"
                    : "Abschluss bestätigen"
                  : "Speichern"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
