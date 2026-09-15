"use client";
import { useEffect, useRef, useState } from "react";
import { request, formatValue } from "./api";
import type { InventoryMovementData } from "@/features/inventory/history";
const labels: Record<string, string> = {
  ADJUST: "Lagerbewegung / Korrektur",
  ISSUE: "Ausgabe",
  RETURN: "Rückgabe",
};
export function InventoryHistoryDialog({
  itemId = "",
  onClose,
  onCustody,
}: {
  itemId?: string;
  onClose: () => void;
  onCustody: (itemId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [week, setWeek] = useState(""),
    [page, setPage] = useState(1),
    [epoch, setEpoch] = useState(0);
  const key = JSON.stringify([itemId, query, type, week, page, epoch]);
  const [result, setResult] = useState<{
    key: string;
    data?: InventoryMovementData;
    error?: string;
  } | null>(null);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      itemId,
      q: query,
      type,
      week,
      page: String(page),
    });
    const timer = setTimeout(() => {
      request<InventoryMovementData>(`/api/v1/inventory-movements?${params}`, {
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
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [itemId, query, type, week, page, epoch, key]);
  return (
    <dialog
      ref={dialog}
      className="entity-dialog inventory-history-dialog"
      aria-labelledby="inventory-history-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="inventory-history-title">Bestandsverlauf</h2>
        <button onClick={onClose}>Schließen</button>
      </div>
      <p className="invitation-copy">
        {data?.item ? (
          <>
            <strong>{data.item.name}</strong> · {data.item.sku} · Jetzt
            verfügbar: {data.item.stock}
          </>
        ) : itemId ? (
          "Artikel wird geladen …"
        ) : (
          "Alle Inventarartikel"
        )}
      </p>
      <div className="table-toolbar">
        <label>
          Suche
          <input
            type="search"
            value={query}
            placeholder="Artikel, SKU, Grund oder Name …"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Bewegung
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Alle Bewegungen</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kalenderwoche
          <input
            type="week"
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          onClick={() => {
            setQuery("");
            setType("");
            setWeek("");
            setPage(1);
          }}
        >
          Filter zurücksetzen
        </button>
        <button onClick={() => setEpoch((v) => v + 1)}>Aktualisieren</button>
      </div>
      <p className="invitation-copy">
        Neueste Bewegungen zuerst · Europe/Berlin. Gespeicherte Bewegungen
        bleiben erhalten; Korrekturen erfolgen als neue Lagerbewegung. Namen und
        Artikelangaben entsprechen den aktuellen Stammdaten.
      </p>
      {data && (
        <p className="movement-totals" role="status">
          <strong>{data.total}</strong> Bewegungen im Filter · Zugang: +
          {data.increase} · Abgang: −{data.decrease} · Mengenänderung:{" "}
          {data.net.startsWith("-") ? data.net : `+${data.net}`}
          <br />
          <span className="muted">
            Summen gelten für alle Treffer, nicht nur diese Seite. Sie sind kein
            historischer Lagerbestand.
          </span>
        </p>
      )}
      {!current && (
        <p className="invitation-copy" role="status">
          Bewegungen werden geladen …
        </p>
      )}
      {current?.error && (
        <p className="alert error" role="alert">
          {current.error}
        </p>
      )}
      {data && (
        <section key={`${page}-${type}-${week}`} className="calendar-enter">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Artikel</th>
                  <th>Bewegung</th>
                  <th>Menge</th>
                  <th>Grund</th>
                  <th>Empfänger</th>
                  <th>Erfasst von</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{formatValue("createdAt", row.createdAt)}</td>
                    <td>
                      <strong>{row.itemName}</strong>
                      <br />
                      {row.sku}
                    </td>
                    <td>{labels[row.type] || row.type}</td>
                    <td className="movement-quantity">
                      {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                    </td>
                    <td className="movement-reason">{row.reason}</td>
                    <td>{row.recipient || "—"}</td>
                    <td>{row.actor}</td>
                    <td>
                      {row.custodyId && (
                        <button onClick={() => onCustody(row.itemId)}>
                          Ausgaben öffnen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.items.length && (
            <p className="invitation-copy">
              Keine Bewegungen für diese Filter.
            </p>
          )}
        </section>
      )}
      <footer className="dialog-footer">
        <button
          disabled={!data || page <= 1}
          onClick={() => setPage((v) => v - 1)}
        >
          Zurück
        </button>
        <span>
          Seite {page} · {data?.total ?? 0} Bewegungen
        </span>
        <button
          disabled={!data || page * 25 >= data.total}
          onClick={() => setPage((v) => v + 1)}
        >
          Weiter
        </button>
      </footer>
    </dialog>
  );
}
