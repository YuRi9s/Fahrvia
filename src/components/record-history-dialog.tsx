"use client";
import { useEffect, useRef, useState } from "react";
import { request, formatValue } from "./api";
import { fieldLabel, valueLabel } from "@/messages/de";
import type { RecordHistoryData } from "@/features/fleet/history";
const labels: Record<string, string> = {
  ASSIGNMENT: "Zuweisungen",
  DOCUMENT: "Dokumente",
  KEY: "Schlüsselverwahrung",
  LIFECYCLE: "Stammdaten",
  PHOTO: "Fotos & Schäden",
  ASSIGN: "Fahrzeug übernommen",
  RETURN: "Fahrzeug zurückgegeben",
  DOCUMENT_ADDED: "Dokument hinzugefügt",
  DOCUMENT_RENEWED: "Dokument erneuert",
  DAMAGE_REPORTED: "Schaden gemeldet",
  PHOTO_ADDED: "Fotobericht erstellt",
  DAMAGE_RESOLVED: "Schaden erledigt",
  create: "Angelegt",
  update: "Bearbeitet",
  archive: "Archiviert",
  reactivate: "Reaktiviert",
  TRANSFER: "Verwahrung geändert",
  CREATE: "Schlüssel erhalten",
  REPLACE: "Schlüssel ersetzt",
  RETIRE: "Schlüssel ausgemustert",
};
export function RecordHistoryDialog({
  module,
  id,
  isDriver,
  onClose,
}: {
  module: string;
  id: string;
  isDriver: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [week, setWeek] = useState(""),
    [type, setType] = useState(""),
    [page, setPage] = useState(1),
    [epoch, setEpoch] = useState(0);
  const key = JSON.stringify([module, id, week, type, page, epoch]);
  const [result, setResult] = useState<{
    key: string;
    data?: RecordHistoryData;
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
      module,
      id,
      week,
      type,
      page: String(page),
    });
    request<RecordHistoryData>(`/api/v1/record-history?${params}`, {
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
  }, [module, id, week, type, page, epoch, key]);
  return (
    <dialog
      ref={dialog}
      className="entity-dialog record-history"
      aria-labelledby="record-history-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="record-history-title">Details & Verlauf</h2>
        <button onClick={onClose} aria-label="Details schließen">
          Schließen
        </button>
      </div>
      {data && (
        <section className="record-summary">
          <h3>{data.record.title}</h3>
          <dl>
            {Object.entries(data.record.fields).map(([name, value]) => (
              <div key={name}>
                <dt>{fieldLabel(name)}</dt>
                <dd>
                  {["status", "ownership"].includes(name)
                    ? valueLabel(value)
                    : formatValue(name, value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <div className="table-toolbar">
        <label>
          Kalenderwoche{" "}
          <input
            type="week"
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Ereignisse{" "}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Alle Ereignisse</option>
            {(isDriver
              ? ["ASSIGNMENT"]
              : [
                  "ASSIGNMENT",
                  "DOCUMENT",
                  "KEY",
                  "LIFECYCLE",
                  ...(module === "vehicles" ? ["PHOTO"] : []),
                ]
            ).map((t) => (
              <option key={t} value={t}>
                {labels[t]}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setWeek("");
            setType("");
            setPage(1);
          }}
        >
          Filter zurücksetzen
        </button>
        <button onClick={() => setEpoch((v) => v + 1)}>Aktualisieren</button>
      </div>
      <p className="invitation-copy">
        Neueste Ereignisse zuerst · Europe/Berlin. Der Wochenfilter gilt für den
        Ereigniszeitpunkt. Die Zusammenfassung zeigt die heutigen Stammdaten.{" "}
        {isDriver
          ? "Hier sehen Sie Ihre eigenen Fahrzeugübernahmen und Rückgaben."
          : "Der Verlauf enthält gespeicherte Ereignisse; frühere Stammdatenwerte werden nicht rekonstruiert."}
      </p>
      {!current && (
        <p className="invitation-copy" role="status">
          Verlauf wird geladen …
        </p>
      )}
      {current?.error && (
        <p className="alert error" role="alert">
          {current.error}
        </p>
      )}
      {data && (
        <section
          key={`${week}-${type}-${page}`}
          className="record-events calendar-enter"
          aria-label="Betrieblicher Verlauf"
        >
          {data.items.length === 0 ? (
            <p>Keine Ereignisse für diese Filter.</p>
          ) : (
            <ol>
              {data.items.map((item) => (
                <li key={item.id}>
                  <time dateTime={String(item.at)}>
                    {formatValue("createdAt", item.at)}
                  </time>
                  <div>
                    <span className="muted">{labels[item.type]}</span>
                    <h4>{labels[item.action] || valueLabel(item.action)}</h4>
                    {item.detail && <p>{item.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
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
          Seite {page} · {data?.total ?? 0} Ereignisse
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
