"use client";
import { useState } from "react";
import { isoWeek } from "@/server/validation";
import {
  berlinDayRange,
  shiftLocalDate,
  weekMonday,
  BUSINESS_TIME_ZONE,
} from "@/lib/berlin-time";
import { Row, formatValue } from "./api";
export function PlanningCalendar({
  items,
  week,
  onEdit,
  editable,
}: {
  items: Row[];
  week: string;
  onEdit: (row: Row) => void;
  editable: boolean;
}) {
  const [day, setDay] = useState<number | null>(null);
  const monday = weekMonday(week || isoWeek(new Date()));
  return (
    <section aria-label="Wochenkalender">
      <div className="tabs">
        <button onClick={() => setDay(null)}>Ganze Woche</button>
        {Array.from({ length: 7 }, (_, i) => {
          const date = berlinDayRange(shiftLocalDate(monday, i)).start;
          return (
            <button key={i} aria-pressed={day === i} onClick={() => setDay(i)}>
              {new Intl.DateTimeFormat("de-DE", {
                weekday: "short",
                day: "numeric",
                month: "numeric",
                timeZone: BUSINESS_TIME_ZONE,
              }).format(date)}
            </button>
          );
        })}
      </div>
      <p className="muted">Alle Zeiten: Europe/Berlin</p>
      <div
        key={`${monday}-${day}`}
        className={
          day === null
            ? "calendar-grid calendar-enter"
            : "calendar-focus calendar-enter"
        }
      >
        {Array.from({ length: 7 }, (_, i) => i)
          .filter((i) => day === null || day === i)
          .map((i) => {
            const { start: date, end } = berlinDayRange(
              shiftLocalDate(monday, i),
            );
            const events = items.filter(
              (r) =>
                new Date(String(r.startAt)).getTime() < end.getTime() &&
                new Date(String(r.endAt)).getTime() > date.getTime(),
            );
            return (
              <section className="calendar-day" key={i}>
                <h2>
                  {new Intl.DateTimeFormat("de-DE", {
                    weekday: "long",
                    day: "numeric",
                    timeZone: BUSINESS_TIME_ZONE,
                  }).format(date)}
                </h2>
                {events.length ? (
                  events.map((row) => (
                    <button
                      className="calendar-event"
                      disabled={!editable}
                      key={String(row.id)}
                      onClick={() => onEdit(row)}
                    >
                      <strong>{String(row.title)}</strong>
                      <span>{formatValue("startAt", row.startAt)}</span>
                      <span>{String(row.notes || "")}</span>
                    </button>
                  ))
                ) : (
                  <p className="muted">Keine Termine</p>
                )}
              </section>
            );
          })}
      </div>
    </section>
  );
}
