/** Calendar arithmetic uses local dates; persisted operational timestamps remain UTC instants. */
export const BUSINESS_TIME_ZONE = "Europe/Berlin";
const DAY = 86400000;
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function berlinInput(date: Date | string): string {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return "";
  const p = Object.fromEntries(
    formatter.formatToParts(value).map(({ type, value }) => [type, value]),
  );
  return `${p.year.padStart(4, "0")}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Round-trip candidate offsets so gaps are rejected and repeated times remain explicit. */
export function berlinCandidates(local: string): Date[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return [];
  const wall = new Date(`${local}:00Z`).getTime();
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== local
  )
    return [];
  const offsets = new Set(
    [-DAY, 0, DAY].map((delta) => {
      const sample = wall + delta;
      return (
        new Date(`${berlinInput(new Date(sample))}:00Z`).getTime() - sample
      );
    }),
  );
  return [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter((date) => berlinInput(date) === local)
    .sort((a, b) => a.getTime() - b.getTime());
}
export function berlinToISO(
  local: string,
  occurrence = "",
  original = "",
): string {
  // Preserve original precision and the original DST occurrence on unrelated edits.
  if (!occurrence && original && berlinInput(original) === local)
    return new Date(original).toISOString();
  const candidates = berlinCandidates(local);
  if (!candidates.length)
    throw new Error(
      "Diese Uhrzeit existiert in Berlin nicht. Bitte Datum und Zeitumstellung prüfen.",
    );
  if (candidates.length > 1 && !["earlier", "later"].includes(occurrence))
    throw new Error(
      "Diese Uhrzeit kommt zweimal vor. Bitte erste oder zweite Uhrzeit auswählen.",
    );
  return candidates[
    occurrence === "later" ? candidates.length - 1 : 0
  ].toISOString();
}
export function shiftLocalDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function berlinDayRange(date: string) {
  return {
    start: new Date(berlinToISO(`${date}T00:00`)),
    end: new Date(berlinToISO(`${shiftLocalDate(date, 1)}T00:00`)),
  };
}
export function berlinWeek(date: Date): string {
  const d = new Date(`${berlinInput(date).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const start = new Date(`${year}-01-01T12:00:00Z`);
  return `${year}-W${String(Math.ceil(((d.getTime() - start.getTime()) / DAY + 1) / 7)).padStart(2, "0")}`;
}
export function weekMonday(week: string): string {
  const jan4 = `${week.slice(0, 4)}-01-04`;
  const day = new Date(`${jan4}T12:00:00Z`).getUTCDay();
  return shiftLocalDate(
    jan4,
    (Number(week.slice(6)) - 1) * 7 - ((day + 6) % 7),
  );
}
export function shiftWeek(week: string, direction: number): string {
  return berlinWeek(
    new Date(`${shiftLocalDate(weekMonday(week), direction * 7)}T12:00:00Z`),
  );
}
