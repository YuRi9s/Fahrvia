"use client";
import { useEffect, useState } from "react";
import { request, formatValue } from "./api";
import { isoWeek } from "@/server/validation";
import { shiftWeek, berlinInput } from "@/lib/berlin-time";
import type { AssignmentBoardData } from "@/features/assignments/board";
import { AssignNowDialog, AssignmentHistoryDialog } from "./assignment-dialogs";
export function AssignmentBoard({
  initialData,
  initialQuery = "",
}: {
  initialData?: unknown;
  initialQuery?: string;
}) {
  const params = new URLSearchParams(initialQuery);
  const initial = initialData as AssignmentBoardData | undefined;
  const [week, setWeek] = useState(initial?.week || isoWeek(new Date()));
  const [query, setQuery] = useState(params.get("q") || "");
  const [availability, setAvailability] = useState(
    params.get("availability") || "",
  );
  const [page, setPage] = useState(initial?.page || 1),
    [epoch, setEpoch] = useState(0);
  const [day, setDay] = useState<number | null>(null);
  const [assign, setAssign] = useState<{ vehicleId?: string } | null>(null);
  const [history, setHistory] = useState<{
    vehicleId: string;
    week: string;
    date?: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const key = JSON.stringify([week, query, availability, page, epoch]);
  const [result, setResult] = useState<{
    key: string;
    data?: AssignmentBoardData;
    error?: string;
  } | null>(initial ? { key, data: initial } : null);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      week,
      q: query,
      availability,
      page: String(page),
    });
    const timer = setTimeout(() => {
      request<AssignmentBoardData>(`/api/v1/assignment-board?${params}`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult({ key, data });
            window.history.replaceState(
              null,
              "",
              `${window.location.pathname}?${params}`,
            );
          }
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              key,
              error:
                e instanceof Error
                  ? e.message
                  : "Übersicht konnte nicht geladen werden.",
            });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [week, query, availability, page, epoch, key]);
  function changeWeek(next: string) {
    setWeek(next);
    setPage(1);
  }
  function refresh(message?: string) {
    if (message) setNotice(message);
    setEpoch((v) => v + 1);
  }
  const days = data?.days.filter((_, i) => day === null || i === day) ?? [];
  return (
    <>
      <div className="table-toolbar">
        <div className="filters">
          <button
            aria-label="Vorherige Woche"
            onClick={() => changeWeek(shiftWeek(week, -1))}
          >
            ← Woche
          </button>
          <input
            type="week"
            aria-label="Kalenderwoche"
            value={week}
            onChange={(e) => {
              if (e.target.value) changeWeek(e.target.value);
            }}
          />
          <button
            aria-label="Nächste Woche"
            onClick={() => changeWeek(shiftWeek(week, 1))}
          >
            Woche →
          </button>
          <button
            onClick={() => {
              changeWeek(isoWeek(new Date()));
              setDay(null);
            }}
          >
            Diese Woche
          </button>
        </div>
        <button className="primary" onClick={() => setAssign({})}>
          Jetzt zuweisen
        </button>
      </div>
      <div className="table-toolbar">
        <input
          type="search"
          aria-label="Kennzeichen suchen"
          placeholder="Kennzeichen suchen …"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Aktuelle Verfügbarkeit filtern"
          value={availability}
          onChange={(e) => {
            setAvailability(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Alle Fahrzeuge</option>
          <option value="AVAILABLE">Jetzt verfügbar</option>
          <option value="ASSIGNED">Jetzt zugewiesen</option>
          <option value="INACTIVE">Aktuell inaktiv</option>
        </select>
        <button onClick={() => refresh()}>Aktualisieren</button>
      </div>
      <p className="muted">
        Die Tagesfelder zeigen Zuweisungen im ausgewählten Zeitraum.
        Verfügbarkeit gilt für jetzt. Laufende Zuweisungen werden bis zur
        Rückgabe weitergeführt; zukünftige Tage sind keine Reservierungszusage.
      </p>
      {data && (
        <p className="assignment-summary" role="status">
          <strong>{data.availableVehicles}</strong> Fahrzeuge und{" "}
          <strong>{data.availableDrivers}</strong> Fahrer sind in der
          Gesamtflotte jetzt verfügbar. Stand:{" "}
          {formatValue("asOfAt", data.asOf)} · Europe/Berlin
        </p>
      )}
      {notice && (
        <p className="alert account-notice" role="status">
          {notice}
        </p>
      )}
      {current?.error && (
        <p className="alert error" role="alert">
          {current.error}
        </p>
      )}
      {!current && <p role="status">Zuweisungen werden geladen …</p>}
      {data && (
        <>
          <div className="tabs assignment-days">
            <button aria-pressed={day === null} onClick={() => setDay(null)}>
              Ganze Woche
            </button>
            {data.days.map((item, i) => (
              <button
                key={item.date}
                aria-pressed={day === i}
                onClick={() => setDay(i)}
              >
                {new Intl.DateTimeFormat("de-DE", {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                  timeZone: "Europe/Berlin",
                }).format(new Date(item.start))}
              </button>
            ))}
          </div>
          <section
            className="panel calendar-enter"
            key={`${week}-${day}`}
            aria-label="Wochenübersicht der Fahrzeugzuweisungen"
          >
            <div className="table-scroll">
              <table
                className={`assignment-board${day === null ? "" : " assignment-board-day"}`}
              >
                <thead>
                  <tr>
                    <th>Fahrzeug / jetzt</th>
                    {days.map((item) => (
                      <th key={item.date}>
                        {new Intl.DateTimeFormat("de-DE", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                          timeZone: "Europe/Berlin",
                        }).format(new Date(item.start))}
                      </th>
                    ))}
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.plate}</strong>
                        <br />
                        <span
                          className={
                            row.availableNow ? "assignment-available" : "muted"
                          }
                        >
                          {row.availableNow
                            ? "Jetzt verfügbar"
                            : row.status === "INACTIVE"
                              ? "Aktuell inaktiv"
                              : row.currentDriverName || "Zugewiesen"}
                        </span>
                      </td>
                      {row.days
                        .filter((item) =>
                          days.some((d) => d.date === item.date),
                        )
                        .map((item) => (
                          <td
                            key={item.date}
                            className={
                              item.date ===
                              berlinInput(new Date(data.asOf)).slice(0, 10)
                                ? "assignment-today"
                                : undefined
                            }
                          >
                            <button
                              className="assignment-cell"
                              aria-label={`${row.plate}, ${formatValue("date", item.date)}: ${item.count} Zuweisungen`}
                              onClick={() =>
                                setHistory({
                                  vehicleId: row.id,
                                  week,
                                  date: item.date,
                                })
                              }
                            >
                              <strong>{item.count}</strong>
                              <span>
                                {item.count === 1 ? "Zuweisung" : "Zuweisungen"}
                              </span>
                            </button>
                          </td>
                        ))}
                      <td>
                        <div className="invitation-actions">
                          <button
                            onClick={() =>
                              setHistory({ vehicleId: row.id, week })
                            }
                          >
                            Wochenverlauf
                          </button>
                          {row.availableNow && (
                            <button
                              onClick={() => setAssign({ vehicleId: row.id })}
                            >
                              Jetzt zuweisen
                            </button>
                          )}
                          {row.currentAssignmentId && (
                            <button
                              onClick={() =>
                                setHistory({
                                  vehicleId: row.id,
                                  week: isoWeek(new Date()),
                                })
                              }
                            >
                              Rückgabe
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <p className="empty-state">
                Keine Fahrzeuge für diese Filter gefunden.
              </p>
            )}
          </section>
          <div className="pagination">
            <span>
              Seite {page} · {data.total} Fahrzeuge
            </span>
            <div>
              <button
                disabled={page <= 1}
                onClick={() => setPage((v) => v - 1)}
              >
                Zurück
              </button>
              <button
                disabled={page * 25 >= data.total}
                onClick={() => setPage((v) => v + 1)}
              >
                Weiter
              </button>
            </div>
          </div>
        </>
      )}
      {assign && (
        <AssignNowDialog
          {...assign}
          onClose={() => setAssign(null)}
          onSaved={() =>
            refresh(
              "Zuweisung gespeichert. Die Verfügbarkeit wurde aktualisiert.",
            )
          }
        />
      )}
      {history && (
        <AssignmentHistoryDialog
          {...history}
          onClose={() => setHistory(null)}
          onChanged={() =>
            refresh(
              "Rückgabe gespeichert. Die Verfügbarkeit wurde aktualisiert.",
            )
          }
        />
      )}
    </>
  );
}
