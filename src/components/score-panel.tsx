"use client";
import { useState, useEffect, useRef } from "react";
import { de, fieldLabel, valueLabel } from "@/messages/de";
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
export function ScoreImport({ onSaved }: { onSaved: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const loadHistory = () =>
    request<Row[] | { items: Row[] }>("/api/v1/score-imports")
      .then((r) => setHistory(Array.isArray(r) ? r : r.items || []))
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (open) loadHistory();
  }, [open]);
  async function upload(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    form.set("mapping", JSON.stringify(mapping));
    setBusy(true);
    setError("");
    try {
      setDraft(
        await request<Row>("/api/v1/score-imports", {
          method: "POST",
          body: form,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
    } finally {
      setBusy(false);
    }
  }
  async function act(id: string, action: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/score-imports/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setDraft(null);
      await loadHistory();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : de.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="score-import">
      <button onClick={() => setOpen(!open)}>
        {de.import} {open ? "−" : "+"}
      </button>
      {open && (
        <div className="panel">
          <form ref={formRef} onSubmit={upload} className="import-form">
            <label>
              {de.files}
              <input name="file" type="file" accept=".csv,.xlsx" required />
            </label>
            <label>
              {de.week}
              <input type="week" name="week" required />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? de.importing : de.preview}
            </button>
          </form>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {draft && (
            <div>
              <h3>{de.preview}</h3>
              {Array.isArray(draft.errors) && draft.errors.length > 0 && (
                <p className="alert error">{de.importErrors}</p>
              )}
              <div className="form-grid">
                {Array.isArray(draft.columns) &&
                  draft.columns.map((column) => {
                    const c = String(column);
                    return (
                      <label key={c}>
                        {c}
                        <select
                          value={
                            mapping[c] ||
                            String((draft.mapping as Row)?.[c] || `metric:${c}`)
                          }
                          onChange={(e) =>
                            setMapping({ ...mapping, [c]: e.target.value })
                          }
                        >
                          {[
                            "email",
                            "transporterId",
                            "week",
                            "totalScore",
                            "rank",
                            "packages",
                            "bonus",
                            "focusArea",
                            "status",
                            `metric:${c}`,
                          ].map((key) => (
                            <option key={key} value={key}>
                              {key.startsWith("metric:")
                                ? `Kennzahl: ${c}`
                                : fieldLabel(key)}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
              </div>
              <button disabled={busy} onClick={() => upload()}>
                Zuordnung prüfen
              </button>
              {Array.isArray(draft.errors) && draft.errors.length > 0 && (
                <ul role="alert">
                  {(draft.errors as Row[]).map((item, i) => (
                    <li key={i}>
                      Zeile {String(item.row)}: {String(item.message)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      {[
                        "driverId",
                        "week",
                        "totalScore",
                        "rank",
                        "packages",
                        "bonus",
                      ].map((key) => (
                        <th key={key}>{fieldLabel(key)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(draft.rows) &&
                      (draft.rows as Row[]).map((row, i) => (
                        <tr key={i}>
                          {[
                            "driverId",
                            "week",
                            "totalScore",
                            "rank",
                            "packages",
                            "bonus",
                          ].map((key) => (
                            <td key={key}>
                              {key === "driverId"
                                ? String(
                                    (draft.driverNames as Row)?.[
                                      String(row.driverId)
                                    ] || row.driverId,
                                  )
                                : String(row[key] ?? "—")}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <button
                className="primary"
                disabled={
                  busy ||
                  (Array.isArray(draft.errors) && draft.errors.length > 0)
                }
                onClick={() => act(String(draft.id), "commit")}
              >
                {de.commit}
              </button>
            </div>
          )}
          <h3>{de.history}</h3>
          {history.length === 0 ? (
            <p className="muted">{de.empty}</p>
          ) : (
            history.map((item) => (
              <div className="history-row" key={String(item.id)}>
                <span>{String(item.week || item.id)}</span>
                <span>{valueLabel(item.status)}</span>
                <a
                  download
                  href={`/api/v1/score-imports/${encodeURIComponent(String(item.id))}/source`}
                >
                  Quelldatei
                </a>
                {item.status === "COMMITTED" && (
                  <button
                    disabled={busy}
                    onClick={() => act(String(item.id), "revert")}
                  >
                    {de.revert}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
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
