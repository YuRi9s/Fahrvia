"use client";
import { useEffect, useRef, useState } from "react";
import { request, mutate, formatValue } from "./api";
import { RecordPicker } from "./record-picker";
import type { InventoryCustodyData } from "@/features/inventory/custody";
type Entry = InventoryCustodyData["items"][number];
export function InventoryCustodyDialog({
  itemId,
  onClose,
  onChanged,
}: {
  itemId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1),
    [status, setStatus] = useState("OPEN"),
    [epoch, setEpoch] = useState(0);
  const [issueId, setIssueId] = useState<string | null>(null),
    [holderType, setHolderType] = useState("DRIVER");
  const [returning, setReturning] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const key = JSON.stringify([itemId, page, status, epoch]);
  const [result, setResult] = useState<{
    key: string;
    data?: InventoryCustodyData;
    error?: string;
  } | null>(null);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ itemId, page: String(page), status });
    request<InventoryCustodyData>(`/api/v1/inventory-custody?${params}`, {
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
                : "Ausgaben konnten nicht geladen werden.",
          });
      });
    return () => controller.abort();
  }, [itemId, page, status, epoch, key]);
  function refresh() {
    setReturning(null);
    setIssueId(null);
    setError("");
    setEpoch((v) => v + 1);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const quantity = Number(form.get("quantity")),
        reason = String(form.get("reason") || "");
      if (returning)
        await mutate("inventory", "return", returning.id, {
          quantity,
          reason,
          expectedVersion: returning.version,
        });
      else if (issueId)
        await mutate("inventory", "issue", itemId, {
          quantity,
          reason,
          requestId: issueId,
          [holderType === "DRIVER" ? "driverId" : "vehicleId"]: String(
            form.get("holder") || "",
          ),
        });
      else return;
      setNotice(returning ? "Rückgabe gespeichert." : "Ausgabe gespeichert.");
      refresh();
      onChanged();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Speichern fehlgeschlagen. Bitte den Bestand aktualisieren.",
      );
    } finally {
      setBusy(false);
    }
  }
  function changePage(next: number) {
    setPage(next);
    setReturning(null);
    setIssueId(null);
    setError("");
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog inventory-custody-dialog"
      aria-labelledby="custody-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="custody-title">Ausgabe & Rückgabe</h2>
      </div>
      {data && (
        <p className="invitation-copy">
          <strong>{data.item.name}</strong> · {data.item.sku}
          <br />
          <strong>{data.item.stock}</strong> verfügbar ·{" "}
          <strong>{data.issued}</strong> insgesamt ausgegeben
        </p>
      )}
      <p className="invitation-copy">
        Ausgaben verringern den verfügbaren Bestand. Teilrückgaben sind möglich.
        Direkte Lagerentnahmen und Bestandskorrekturen erfassen Sie über
        „Zu-/Abgang“.
      </p>
      <div className="table-toolbar">
        <label>
          Anzeigen{" "}
          <select
            value={status}
            disabled={busy}
            onChange={(e) => {
              setStatus(e.target.value);
              changePage(1);
            }}
          >
            <option value="OPEN">Noch ausgegeben</option>
            <option value="CLOSED">Vollständig zurückgegeben</option>
            <option value="ALL">Alle Ausgaben</option>
          </select>
        </label>
        <button disabled={busy} onClick={refresh}>
          Aktualisieren
        </button>
        <button
          className="primary"
          disabled={busy || !data || data.item.stock < 1}
          onClick={() => {
            setIssueId(crypto.randomUUID());
            setReturning(null);
            setError("");
          }}
        >
          Menge ausgeben
        </button>
      </div>
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {!current && (
        <p className="invitation-copy" role="status">
          Ausgaben werden geladen …
        </p>
      )}
      {(error || current?.error) && (
        <p className="alert error" role="alert">
          {error || current?.error}
        </p>
      )}
      {(issueId || returning) && (
        <form
          key={issueId || `${returning!.id}-${returning!.version}`}
          onSubmit={submit}
          className="custody-form"
        >
          <h3>
            {returning ? `Rückgabe von ${returning.holder}` : "Neue Ausgabe"}
          </h3>
          <fieldset disabled={busy} className="invitation-fields">
            {!returning && (
              <>
                <label>
                  Empfängerart
                  <select
                    value={holderType}
                    onChange={(e) => setHolderType(e.target.value)}
                  >
                    <option value="DRIVER">Fahrer</option>
                    <option value="VEHICLE">Fahrzeug</option>
                  </select>
                </label>
                <RecordPicker
                  key={holderType}
                  name="holder"
                  kind={holderType === "DRIVER" ? "driver" : "vehicle"}
                  label={holderType === "DRIVER" ? "Fahrer" : "Fahrzeug"}
                  required
                />
              </>
            )}
            <div className="form-grid">
              <label>
                Menge
                <input
                  name="quantity"
                  type="number"
                  required
                  min={1}
                  step={1}
                  max={
                    returning?.remaining ??
                    Math.min(data?.item.stock ?? 1000000, 1000000)
                  }
                  defaultValue={returning?.remaining ?? 1}
                />
              </label>
              <label>
                Grund
                <input name="reason" required maxLength={500} />
              </label>
            </div>
            <p className="muted">
              {returning
                ? `Noch ${returning.remaining} ausgegeben. Die bestätigte Rückgabemenge wird dem Bestand hinzugefügt.`
                : "Der Empfänger muss aktiv sein. Verfügbarkeit wird beim Speichern erneut geprüft."}
            </p>
          </fieldset>
          <div className="invitation-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setIssueId(null);
                setReturning(null);
                setError("");
              }}
            >
              Abbrechen
            </button>
            <button className="primary" disabled={busy}>
              {busy
                ? "Wird gespeichert …"
                : returning
                  ? "Rückgabe bestätigen"
                  : "Ausgabe bestätigen"}
            </button>
          </div>
        </form>
      )}
      {data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Empfänger</th>
                  <th>Ausgegeben am</th>
                  <th>Menge</th>
                  <th>Zurück</th>
                  <th>Noch ausgegeben</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.holder}</strong>
                      <br />
                      <span className="muted">
                        {row.holderType === "DRIVER" ? "Fahrer" : "Fahrzeug"}
                      </span>
                      <details>
                        <summary>Ausgabegrund</summary>
                        <p>{row.reason}</p>
                      </details>
                    </td>
                    <td>{formatValue("issuedAt", row.issuedAt)}</td>
                    <td>{row.quantity}</td>
                    <td>{row.returned}</td>
                    <td>{row.remaining}</td>
                    <td>
                      {row.remaining > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setReturning(row);
                            setIssueId(null);
                            setError("");
                          }}
                        >
                          Zurücknehmen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.items.length && (
            <p className="invitation-copy">Keine Ausgaben für diesen Filter.</p>
          )}
        </>
      )}
      <footer className="dialog-footer">
        <button
          disabled={busy || !data || page <= 1}
          onClick={() => changePage(page - 1)}
        >
          Zurück
        </button>
        <span>
          Seite {page} · {data?.total ?? 0} Ausgaben
        </span>
        <button
          disabled={busy || !data || page * 25 >= data.total}
          onClick={() => changePage(page + 1)}
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
