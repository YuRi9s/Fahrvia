"use client";
import Link from "next/link";
import { formatValue, type ListData } from "./api";
export function AuditPanel({
  initialData,
  initialQuery,
}: {
  initialData?: unknown;
  initialQuery: string;
}) {
  const data = initialData as ListData & { error?: string };
  const params = new URLSearchParams(initialQuery);
  const source = params.get("source") || "audit";
  const pageLink = (page: number) => {
    const next = new URLSearchParams(initialQuery);
    next.set("page", String(page));
    return `/audit?${next}`;
  };
  return (
    <section className="panel audit-panel" aria-label="Audit und Sicherheit">
      <p>
        Änderungen und Sicherheitsereignisse Ihrer Organisation untersuchen.
        Zeiten und Datumsfilter gelten für Berlin.
      </p>
      <p className="muted">
        Sicherheitsereignisse erfassen Kontozugriffsänderungen ab Version
        0.1.17. Anmeldeversuche werden hier nicht erfasst. Namen entsprechen dem
        heutigen Kontostand.
      </p>
      <form action="/audit" method="get" className="audit-filters">
        <label>
          Quelle
          <select name="source" defaultValue={source}>
            <option value="audit">Änderungsprotokoll</option>
            <option value="security">Sicherheitsereignisse</option>
          </select>
        </label>
        <label>
          Von
          <input
            type="date"
            name="from"
            defaultValue={params.get("from") || ""}
          />
        </label>
        <label>
          Bis einschließlich
          <input type="date" name="to" defaultValue={params.get("to") || ""} />
        </label>
        {[
          ["actor", "Konto-ID"],
          ["action", "Aktion / Ereignis (exakt)"],
          ["record", "Datensatz-ID"],
          ["request", "Ereignisreferenz (nur Sicherheit)"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              name={key}
              maxLength={200}
              defaultValue={params.get(key) || ""}
            />
          </label>
        ))}
        <button type="submit" className="primary">
          Filter anwenden
        </button>
        <Link href="/audit">Zurücksetzen</Link>
      </form>
      {data.error && <p role="alert">{data.error}</p>}
      <p role="status">
        {data.total} Ereignisse · Seite {data.page} von{" "}
        {Math.max(1, Math.ceil(data.total / data.pageSize))}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Zeit (Berlin)</th>
              <th>Konto</th>
              <th>Aktion</th>
              <th>Datensatz</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={String(r.id)}>
                <td>{formatValue("createdAt", r.createdAt)}</td>
                <td>
                  {String(r.actorName)}
                  <small className="audit-id">{String(r.actorId || "—")}</small>
                </td>
                <td>{String(r.action || r.kind)}</td>
                <td>
                  {String(r.resourceType || "Konto")}
                  <small className="audit-id">
                    {String(r.resourceId || "—")}
                  </small>
                </td>
                <td>
                  <details>
                    <summary>Details anzeigen</summary>
                    <div className="audit-detail">
                      <p>Ereignis-ID: {String(r.id)}</p>
                      {!!r.requestId && (
                        <p>Ereignisreferenz: {String(r.requestId)}</p>
                      )}
                      <pre>
                        {r.details
                          ? JSON.stringify(r.details, null, 2)
                          : "Keine zusätzlichen Angaben."}
                      </pre>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.items.length && (
        <p>
          Keine Ereignisse für diese Filter. Zeitraum erweitern oder Filter
          zurücksetzen.
        </p>
      )}
      <nav className="audit-pages" aria-label="Ereignisseiten">
        {data.page > 1 && <Link href={pageLink(data.page - 1)}>Zurück</Link>}
        {data.page * data.pageSize < data.total && (
          <Link href={pageLink(data.page + 1)}>Weiter</Link>
        )}
      </nav>
    </section>
  );
}
