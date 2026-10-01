"use client";
import { useState, useEffect } from "react";
import { de, fieldLabel } from "@/messages/de";
import { DeliveryPanel } from "./delivery-panel";
import { request, Row } from "./api";
export function DriverScore({ items }: { items: Row[] }) {
  return (
    <div className="driver-scores">
      {items.map((row, i) => (
        <section className="panel" key={String(row.id || i)}>
          <div className="section-heading">
            <h2>{de.ownScore}</h2>
            <span>{String(row.week || "")}</span>
          </div>
          <div className="metric-grid">
            {["totalScore", "rank", "packages", "bonus"].map((key) => (
              <div key={key}>
                <span>{fieldLabel(key)}</span>
                <strong>{String(row[key] ?? "—")}</strong>
              </div>
            ))}
          </div>
          {row.focusArea != null && (
            <p>
              {fieldLabel("focusArea")}: {String(row.focusArea)}
            </p>
          )}
          {row.metrics && typeof row.metrics === "object" ? (
            <dl className="detail-list">
              {Object.entries(row.metrics as Row).map(([key, value]) => (
                <div key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>{String(value ?? "—")}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ))}
    </div>
  );
}
export { ScoreImport } from "./score-import";
/** Delivery records remain accessible even when a week has no score import. */
export function DeliveryBrowser({
  week,
  ownDriverId,
  isAdmin,
  onSaved,
}: {
  week: string;
  ownDriverId?: string;
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState(""),
    [drivers, setDrivers] = useState<Row[]>([]),
    [selected, setSelected] = useState(ownDriverId || "");
  useEffect(() => {
    if (ownDriverId) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      request<{ items: Row[] }>(
        `/api/v1/drivers?q=${encodeURIComponent(search)}&pageSize=20`,
        { signal: abort.signal },
      )
        .then((r) => setDrivers(r.items))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, ownDriverId]);
  return (
    <section className="panel">
      <h2>PHR / Concessions</h2>
      {!ownDriverId && (
        <div className="form-grid">
          <label>
            Fahrer suchen
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            Fahrer auswählen
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Bitte auswählen</option>
              {drivers.map((d) => (
                <option key={String(d.id)} value={String(d.id)}>
                  {String(d.firstName)} {String(d.lastName)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {selected && (
        <DeliveryPanel
          key={`${selected}:${week}`}
          driverId={selected}
          week={week}
          canEdit={isAdmin}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
