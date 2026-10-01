"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "./api";
import { fieldLabel, valueLabel } from "@/messages/de";
import type { ParsedScore } from "@/features/score/isolated-parser";
type Preview = ParsedScore & {
  id: string;
  driverNames: Record<string, string>;
  replaces: { id: string; filename: string; count: number } | null;
};
type History = {
  id: string;
  week: string;
  filename: string;
  status: string;
  mapping: Record<string, string>;
  selection: { sheet?: string; headerRow?: number } | null;
};
const fields = [
  "email",
  "transporterId",
  "week",
  "totalScore",
  "rank",
  "packages",
  "bonus",
  "focusArea",
  "status",
];
export function ScoreImport({ onSaved }: { onSaved: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [book, setBook] = useState<Preview | null>(null),
    [draft, setDraft] = useState<Preview | null>(null);
  const [history, setHistory] = useState<History[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState(""),
    [headerRow, setHeaderRow] = useState(1),
    [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  async function loadHistory() {
    const r = await request<{ items: History[] }>("/api/v1/score-imports");
    setHistory(r.items);
  }
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    request<{ items: History[] }>("/api/v1/score-imports", {
      signal: abort.signal,
    })
      .then((r) => setHistory(r.items))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [open]);
  function invalidate() {
    setDraft(null);
    setConfirmed(false);
    setNotice("");
  }
  async function preview(inspect: boolean) {
    if (!form.current?.reportValidity()) return;
    setBusy(true);
    setError("");
    invalidate();
    try {
      const data = new FormData(form.current);
      data.set("sheet", sheet);
      data.set("headerRow", String(headerRow));
      data.set("mapping", JSON.stringify(mapping));
      data.set("inspect", String(inspect));
      const result = await request<Preview>("/api/v1/score-imports", {
        method: "POST",
        body: data,
      });
      setBook(result);
      setSheet(result.sheet);
      setMapping(result.mapping);
      if (!inspect) {
        setDraft(result);
        await loadHistory();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  async function act(id: string, action: string) {
    if (
      action === "revert" &&
      !window.confirm(
        "Aktive Wochenrevision zurücknehmen und die vorherige Revision wiederherstellen?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/v1/score-imports/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmReplacement: confirmed }),
      });
      invalidate();
      setNotice(
        action === "commit"
          ? "Score-Daten übernommen."
          : "Revision zurückgenommen.",
      );
      onSaved();
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  const metrics = [
    ...new Set(draft?.rows.flatMap((r) => Object.keys(r.metrics)) ?? []),
  ];
  return (
    <section className="score-import">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        Score-Datei importieren {open ? "−" : "+"}
      </button>
      {open && (
        <div className="panel">
          <h2>Score-Import</h2>
          <p className="muted">
            1. Datei auswählen · 2. Spalten zuordnen · 3. Vorschau bestätigen
          </p>
          <p>
            CSV oder XLSX, bis 5 MB und 5000 Datenzeilen. Werte werden
            übernommen, nicht neu berechnet.
          </p>
          <form
            ref={form}
            onSubmit={(e) => {
              e.preventDefault();
              void preview(true);
            }}
          >
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <div className="form-grid">
                <label>
                  Datei
                  <input
                    name="file"
                    type="file"
                    accept=".xlsx,.csv"
                    required
                    onChange={() => {
                      invalidate();
                      setBook(null);
                      setSheet("");
                      setHeaderRow(1);
                      setMapping({});
                    }}
                  />
                </label>
                <label>
                  Berichtswoche
                  <input
                    name="week"
                    type="week"
                    required
                    onChange={invalidate}
                  />
                </label>
                <label>
                  Kopfzeile
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={headerRow}
                    onChange={(e) => {
                      setHeaderRow(Number(e.target.value));
                      setBook(null);
                      setMapping({});
                      invalidate();
                    }}
                  />
                </label>
                {book && (
                  <label>
                    Tabellenblatt
                    <select
                      value={sheet}
                      onChange={(e) => {
                        setSheet(e.target.value);
                        setMapping({});
                        invalidate();
                      }}
                    >
                      {book.sheets.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <button type="submit">
                {busy ? "Datei wird geprüft …" : "Datei / Tabellenblatt prüfen"}
              </button>
            </fieldset>
          </form>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {book?.inspectionWarning && (
            <p role="alert">
              {book.inspectionWarning} Bitte ein anderes Tabellenblatt
              auswählen.
            </p>
          )}
          {book && book.sheet === sheet && book.columns.length > 0 && (
            <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
              <h3>Spaltenzuordnung</h3>
              <p>
                Transporter-ID oder E-Mail muss einen Fahrer eindeutig erkennen.
                Namen werden nicht zum Zuordnen verwendet. Leere optionale Werte
                bleiben leer.
              </p>
              <label>
                Gespeicherte Zuordnung verwenden
                <select
                  value=""
                  onChange={(e) => {
                    const saved = history.find((h) => h.id === e.target.value);
                    if (saved) {
                      setMapping(
                        Object.fromEntries(
                          book.columns.map((c) => [
                            c,
                            saved.mapping[c] ?? book.mapping[c],
                          ]),
                        ),
                      );
                      invalidate();
                    }
                  }}
                >
                  <option value="">Aus Importverlauf auswählen …</option>
                  {history.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.week} · {h.filename} · {valueLabel(h.status)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Die geprüfte Zuordnung wird mit jeder Vorschau im Importverlauf
                gespeichert.
              </p>
              <div className="form-grid">
                {book.columns.map((c, i) => (
                  <label key={`${c}:${i}`}>
                    {c || `Leere Spalte ${i + 1}`}
                    <select
                      value={mapping[c] ?? book.mapping[c]}
                      onChange={(e) => {
                        setMapping({ ...mapping, [c]: e.target.value });
                        invalidate();
                      }}
                    >
                      {[
                        ...new Set([
                          ...fields,
                          "ignore",
                          book.mapping[c],
                          `metric:${c}`,
                          mapping[c],
                        ]),
                      ]
                        .filter(Boolean)
                        .map((k) => (
                          <option key={k} value={k}>
                            {k === "ignore"
                              ? "Nicht importieren"
                              : k.startsWith("metric:")
                                ? `Kennzahl: ${k.slice(7)}`
                                : fieldLabel(k)}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
              <details>
                <summary>Quelldaten ansehen (erste 5 Zeilen)</summary>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        {book.columns.map((c, i) => (
                          <th key={i}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {book.sample.map((r, i) => (
                        <tr key={i}>
                          {book.columns.map((_, j) => (
                            <td key={j}>{r[j] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <button onClick={() => void preview(false)}>
                Zuordnung speichern und Vorschau erstellen
              </button>
            </fieldset>
          )}
          {draft && (
            <div aria-live="polite">
              <h3>
                Vorschau · {draft.rows.length} gültige Zeilen ·{" "}
                {draft.errors.length} Fehler
              </h3>
              {draft.errors.length > 0 && (
                <ul role="alert">
                  {draft.errors.map((e, i) => (
                    <li key={i}>
                      Zeile {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              <p>
                „—“ bedeutet: kein Wert geliefert. Alle Fehler müssen vor der
                Übernahme behoben werden.
              </p>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Fahrer",
                        "Woche",
                        "Total Score",
                        "Pos.",
                        "Pakete",
                        "Bonus",
                        "Status",
                        "Fokus",
                        ...metrics,
                      ].map((c, i) => (
                        <th key={i}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.rows.slice(0, 100).map((r) => (
                      <tr key={r.driverId}>
                        {[
                          draft.driverNames[r.driverId] || r.driverId,
                          r.week,
                          r.totalScore,
                          r.rank,
                          r.packages,
                          r.bonus,
                          r.status,
                          r.focusArea,
                          ...metrics.map((m) => r.metrics[m]),
                        ].map((v, i) => (
                          <td key={i}>{v ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draft.rows.length > 100 && (
                <p>
                  Erste 100 von {draft.rows.length} Zeilen angezeigt. Die
                  Übernahme umfasst alle geprüften Zeilen.
                </p>
              )}
              {draft.replaces && (
                <label className="alert">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  Ich bestätige: Die gesamte aktive Wochenrevision „
                  {draft.replaces.filename}“ ({draft.replaces.count} Zeilen)
                  wird ersetzt. Fahrer ohne Zeile in dieser Datei sind danach
                  nicht mehr in der aktiven Wochenwertung enthalten. Die
                  bisherige Revision bleibt im Verlauf.
                </label>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  !draft.rows.length ||
                  !!draft.errors.length ||
                  (!!draft.replaces && !confirmed)
                }
                onClick={() => void act(draft.id, "commit")}
              >
                Score-Daten verbindlich übernehmen
              </button>
            </div>
          )}
          <h3>Importverlauf</h3>
          {!history.length && <p className="muted">Noch keine Importe.</p>}
          {history.map((h) => (
            <div className="history-row" key={h.id}>
              <span>
                {h.week} · {h.filename}
              </span>
              <span>{valueLabel(h.status)}</span>
              <a
                download
                href={`/api/v1/score-imports/${encodeURIComponent(h.id)}/source`}
              >
                Quelldatei
              </a>
              {h.status === "COMMITTED" && (
                <button
                  disabled={busy}
                  onClick={() => void act(h.id, "revert")}
                >
                  Zurücknehmen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export function ScoreExport({ query }: { query: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/score/export?${query}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Export fehlgeschlagen.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `fahriva-scores-${new URLSearchParams(query).get("week") || "export"}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button disabled={busy} onClick={() => void download()}>
        {busy ? "Export wird erstellt …" : "Excel exportieren"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
