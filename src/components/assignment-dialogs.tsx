"use client";
import { useEffect, useRef, useState } from "react";
import { RecordPicker } from "./record-picker";
import { request, mutate, formatValue } from "./api";
import type { AssignmentDetailData } from "@/features/assignments/board";
export function AssignNowDialog({
  vehicleId = "",
  onClose,
  onSaved,
}: {
  vehicleId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await mutate("assignments", "create", undefined, {
        vehicleId: String(form.get("vehicleId") || ""),
        driverId: String(form.get("driverId") || ""),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zuweisung fehlgeschlagen.");
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog"
      aria-labelledby="assign-now-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="assign-now-title">Jetzt zuweisen</h2>
        </div>
        <p className="invitation-copy">
          Die Zuweisung beginnt mit der Bestätigung. Die Auswahl zeigt aktuell
          aktive, nicht zugewiesene Fahrzeuge und Fahrer.
        </p>
        <fieldset disabled={busy} className="invitation-fields">
          <div className="form-grid">
            <RecordPicker
              name="vehicleId"
              kind="vehicle"
              label="Fahrzeug"
              availableForAssignment
              initialValue={vehicleId}
              required
            />
            <RecordPicker
              name="driverId"
              kind="driver"
              label="Fahrer"
              availableForAssignment
              required
            />
          </div>
        </fieldset>
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
            {busy ? "Wird zugewiesen …" : "Jetzt zuweisen"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
export function AssignmentHistoryDialog({
  vehicleId,
  week,
  date,
  onClose,
  onChanged,
}: {
  vehicleId: string;
  week: string;
  date?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1),
    [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: AssignmentDetailData;
    error?: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    driverName: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = JSON.stringify([vehicleId, week, date, page, epoch]);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ vehicleId, week, page: String(page) });
    if (date) params.set("date", date);
    request<AssignmentDetailData>(`/api/v1/assignment-board?${params}`, {
      signal: controller.signal,
    })
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
                : "Verlauf konnte nicht geladen werden.",
          });
      });
    return () => controller.abort();
  }, [vehicleId, week, date, page, epoch, key]);
  async function closeAssignment() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      await mutate("assignments", "close", confirm.id, {});
      setConfirm(null);
      setEpoch((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rückgabe fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  const data = current?.data;
  return (
    <dialog
      ref={dialog}
      className="entity-dialog assignment-history"
      aria-labelledby="assignment-history-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="assignment-history-title">Zuweisungsverlauf</h2>
      </div>
      <p className="invitation-copy">
        <strong>{data?.vehicle.plate || "Fahrzeug"}</strong> ·{" "}
        {date ? formatValue("date", date) : week} · Europe/Berlin
      </p>
      {!current && (
        <p className="invitation-copy" role="status">
          Verlauf wird geladen …
        </p>
      )}
      {(error || current?.error) && (
        <p className="alert error" role="alert">
          {error || current?.error}
          <button disabled={busy} onClick={() => setEpoch((v) => v + 1)}>
            Aktualisieren
          </button>
        </p>
      )}
      {data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fahrer</th>
                <th>Übernahme</th>
                <th>Rückgabe</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.driverName}</td>
                  <td>{formatValue("startAt", row.startAt)}</td>
                  <td>
                    {row.endAt ? formatValue("endAt", row.endAt) : "Laufend"}
                  </td>
                  <td>
                    {!row.endAt && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setConfirm({
                            id: row.id,
                            driverName: row.driverName,
                          });
                          setError("");
                        }}
                      >
                        Jetzt zurückgeben
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.total === 0 && (
        <p className="invitation-copy">Keine Zuweisungen in diesem Zeitraum.</p>
      )}
      {confirm && (
        <section
          className="invitation-copy assignment-confirm"
          aria-label="Rückgabe bestätigen"
        >
          <h3>Rückgabe jetzt bestätigen?</h3>
          <p>
            Die laufende Zuweisung für {confirm.driverName} endet mit der
            Bestätigung. Die Schlüsselverwahrung wird separat unter
            „Schlüsselmappe“ erfasst.
          </p>
          <div className="invitation-actions">
            <button disabled={busy} onClick={() => setConfirm(null)}>
              Abbrechen
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void closeAssignment()}
            >
              {busy ? "Wird gespeichert …" : "Rückgabe bestätigen"}
            </button>
          </div>
        </section>
      )}
      <footer className="dialog-footer">
        <button
          disabled={!current || busy || page <= 1}
          onClick={() => setPage((v) => v - 1)}
        >
          Zurück
        </button>
        <span>
          Seite {page} · {data?.total ?? 0} Zuweisungen
        </span>
        <button
          disabled={!data || busy || page * 25 >= data.total}
          onClick={() => setPage((v) => v + 1)}
        >
          Weiter
        </button>
        <button disabled={busy} onClick={onClose}>
          Schließen
        </button>
      </footer>
    </dialog>
  );
}
