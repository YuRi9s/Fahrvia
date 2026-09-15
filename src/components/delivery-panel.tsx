"use client";
import { useEffect, useState, type FormEvent } from "react";
import { request } from "./api";

const text = {
  title: "Lieferdetails",
  phr: "PHR",
  concessions: "Concessions",
  add: "Eintrag erfassen",
  correct: "Korrigieren",
  date: "Datum",
  intended: "Wo zu liefern",
  actual: "Wo geliefert",
  category: "Beschwerdekategorie",
  notes: "Anmerkungen",
  source: "Quellenbeleg / Referenz",
  reason: "Grund der Korrektur",
  save: "Speichern",
  cancel: "Abbrechen",
  empty: "Keine Lieferdetails in dieser Kalenderwoche.",
  loading: "Lieferdetails werden geladen …",
  previous: "Zurück",
  next: "Weiter",
  manual: "Manuell aus Quellenbeleg erfasst",
  revision: "Version",
  error: "Die Lieferdetails konnten nicht geladen werden.",
};
type Detail = {
  id: string;
  driverId: string;
  week: string;
  kind: "PHR" | "CONCESSION";
  date: string;
  intendedLocation: string | null;
  actualLocation: string | null;
  category: string | null;
  notes: string | null;
  sourceReference: string;
  revision: number;
};
type Page = { items: Detail[]; total: number; page: number; pageSize: number };
/** Render separately from score rows so source details remain available without a score import. */
export function DeliveryPanel({
  driverId,
  driverName,
  week,
  canEdit = false,
  onSaved,
}: {
  driverId: string;
  driverName?: string;
  week: string;
  canEdit?: boolean;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [epoch, setEpoch] = useState(0);
  const [kind, setKind] = useState<Detail["kind"]>("PHR"),
    [editing, setEditing] = useState<Detail | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request<Page>(
      `/api/v1/delivery-details?${new URLSearchParams({ driverId, week, kind, page: String(page) })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : text.error);
      });
    return () => controller.abort();
  }, [driverId, week, kind, page, epoch]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      driverId,
      kind: editing?.kind || kind,
      date: String(form.get("date")),
      intendedLocation: String(form.get("intendedLocation") || ""),
      actualLocation: String(form.get("actualLocation") || ""),
      category: String(form.get("category") || ""),
      notes: String(form.get("notes") || ""),
      sourceReference: String(form.get("sourceReference") || ""),
      correctionReason: String(form.get("correctionReason") || ""),
    };
    try {
      await request("/api/v1/delivery-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editing ? "update" : "create",
          id: editing?.id,
          data: payload,
        }),
      });
      setEditing(undefined);
      setEpoch((n) => n + 1);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : text.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label={text.title}>
      <div className="section-heading">
        <div>
          <h2>{text.title}</h2>
          <p>
            {driverName} · {week}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="primary"
            onClick={() => setEditing(null)}
            disabled={busy}
          >
            {text.add}
          </button>
        )}
      </div>
      <div className="segmented" role="group" aria-label={text.title}>
        {(["PHR", "CONCESSION"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setPage(1);
              setEditing(undefined);
            }}
          >
            {value === "PHR" ? text.phr : text.concessions}
          </button>
        ))}
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {editing !== undefined && canEdit && (
        <form
          key={editing?.id || kind}
          onSubmit={save}
          className="form-grid"
          aria-label={editing ? text.correct : text.add}
        >
          <label>
            {text.date}
            <input
              name="date"
              type="date"
              required
              defaultValue={editing?.date.slice(0, 10)}
            />
          </label>
          {(editing?.kind || kind) === "PHR" ? (
            <>
              <label>
                {text.intended}
                <input
                  name="intendedLocation"
                  required
                  maxLength={500}
                  defaultValue={editing?.intendedLocation || ""}
                />
              </label>
              <label>
                {text.actual}
                <input
                  name="actualLocation"
                  required
                  maxLength={500}
                  defaultValue={editing?.actualLocation || ""}
                />
              </label>
            </>
          ) : (
            <label>
              {text.category}
              <input
                name="category"
                required
                maxLength={160}
                defaultValue={editing?.category || ""}
                placeholder="z. B. Paket nicht erhalten"
              />
            </label>
          )}
          <label>
            {text.source}
            <input
              name="sourceReference"
              required
              minLength={3}
              maxLength={500}
              defaultValue={editing?.sourceReference || ""}
            />
          </label>
          <label>
            {text.notes}
            <textarea
              name="notes"
              maxLength={4000}
              defaultValue={editing?.notes || ""}
            />
          </label>
          {editing && (
            <label>
              {text.reason}
              <textarea name="correctionReason" required maxLength={1000} />
            </label>
          )}
          <div>
            <p className="muted">
              Die Kalenderwoche wird aus dem Datum berechnet. {text.manual}.
            </p>
            <button className="primary" disabled={busy}>
              {text.save}
            </button>{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      )}
      {!data && !error && <p role="status">{text.loading}</p>}
      {data && (
        <div className="record-details">
          {data.items
            .filter((item) => item.kind === kind)
            .map((item) => (
              <article key={item.id}>
                <dl className="detail-list">
                  <div>
                    <dt>{text.date}</dt>
                    <dd>
                      {new Intl.DateTimeFormat("de-DE", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(item.date))}
                    </dd>
                  </div>
                  {kind === "PHR" ? (
                    <>
                      <div>
                        <dt>{text.intended}</dt>
                        <dd>{item.intendedLocation}</dd>
                      </div>
                      <div>
                        <dt>{text.actual}</dt>
                        <dd>{item.actualLocation}</dd>
                      </div>
                    </>
                  ) : (
                    <div>
                      <dt>{text.category}</dt>
                      <dd>{item.category}</dd>
                    </div>
                  )}
                  {item.notes && (
                    <div>
                      <dt>{text.notes}</dt>
                      <dd>{item.notes}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{text.source}</dt>
                    <dd>{item.sourceReference}</dd>
                  </div>
                  <div>
                    <dt>{text.revision}</dt>
                    <dd>{item.revision}</dd>
                  </div>
                </dl>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(item)}
                  >
                    {text.correct}
                  </button>
                )}
              </article>
            ))}
          {!data.items.some((item) => item.kind === kind) && (
            <p className="muted">{text.empty}</p>
          )}
        </div>
      )}
      {data && data.total > data.pageSize && (
        <nav aria-label="Lieferdetails-Seiten">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((n) => n - 1)}
          >
            {text.previous}
          </button>
          <span>
            {page} / {Math.ceil(data.total / data.pageSize)}
          </span>
          <button
            type="button"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((n) => n + 1)}
          >
            {text.next}
          </button>
        </nav>
      )}
    </section>
  );
}
