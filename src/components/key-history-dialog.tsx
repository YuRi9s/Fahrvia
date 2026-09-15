"use client";
import { useEffect, useRef, useState } from "react";
import { request, formatValue, type Row, type ListData } from "./api";
import { valueLabel } from "@/messages/de";
const actions: Record<string, string> = {
  CREATE: "Erfasst",
  TRANSFER: "Verwahrung geändert",
  RETIRE: "Ausgemustert",
  REPLACE: "Ersatz erfasst",
};
export function KeyHistoryDialog({
  id,
  onClose,
  onNavigate,
}: {
  id: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [data, setData] = useState<(ListData & { key: Row }) | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request<ListData & { key: Row }>(
      `/api/v1/keys/${encodeURIComponent(id)}/history?page=${page}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Verlauf konnte nicht geladen werden.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, page, retry]);
  function navigatePage(next: number) {
    setLoading(true);
    setPage(next);
  }
  return (
    <dialog
      ref={dialog}
      className="entity-dialog"
      aria-labelledby="key-history-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="key-history-title">Schlüsselverlauf</h2>
      </div>
      {data && (
        <p className="invitation-copy">
          <strong>
            {String(data.key.plate)} · Schlüssel {String(data.key.slot)}
          </strong>{" "}
          · {valueLabel(data.key.status)}
        </p>
      )}
      <div className="invitation-copy invitation-actions">
        {!!data?.key.replacesKeyId && (
          <button onClick={() => onNavigate(String(data.key.replacesKeyId))}>
            Vorherigen Schlüssel ansehen
          </button>
        )}
        {!!data?.key.replacementId && (
          <button onClick={() => onNavigate(String(data.key.replacementId))}>
            Ersatzschlüssel ansehen
          </button>
        )}
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setLoading(true);
              setRetry((v) => v + 1);
            }}
          >
            Erneut versuchen
          </button>
        </p>
      )}
      <div className="table-scroll" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Vorgang</th>
              <th>Verwahrung</th>
              <th>Bearbeiter / Grund</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={String(row.id)}>
                <td>{formatValue("createdAt", row.createdAt)}</td>
                <td>{actions[String(row.action)]}</td>
                <td>
                  {valueLabel(row.location)}
                  {row.driverName ? (
                    <>
                      <br />
                      {String(row.driverName)}
                    </>
                  ) : null}
                </td>
                <td>
                  {String(row.actorName)}
                  <br />
                  {String(row.reason || "Kein Grund im Altdatensatz")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !error && !data?.items.length && (
        <p className="invitation-copy">
          Keine protokollierten Vorgänge vorhanden.
        </p>
      )}
      <footer className="dialog-footer">
        <button
          disabled={loading || page <= 1}
          onClick={() => navigatePage(page - 1)}
        >
          Zurück
        </button>
        <span>
          Seite {page} · {data?.total ?? 0} Vorgänge
        </span>
        <button
          disabled={loading || page * 25 >= (data?.total ?? 0)}
          onClick={() => navigatePage(page + 1)}
        >
          Weiter
        </button>
        <button onClick={onClose}>Schließen</button>
      </footer>
    </dialog>
  );
}
