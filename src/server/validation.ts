import {
  berlinWeek,
  berlinDayRange,
  weekMonday,
  shiftLocalDate,
} from "../lib/berlin-time";
import { z } from "zod";
import { AppError } from "./policy";
const text = (max = 200) => z.string().trim().min(1).max(max);
const optionalText = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().trim().max(500).optional(),
);
export const date = z.coerce.date();
// Operational instants must carry an explicit offset; date-only fleet/document fields keep their own semantics.
const instant = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .pipe(z.coerce.date());
const optionalInstant = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  instant.optional(),
);
const optionalDate = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  date.optional(),
);
export const vehicleInput = z
  .object({
    plate: text(20).transform((s) => s.toUpperCase()),
    vin: text(32).transform((s) => s.toUpperCase()),
    brand: text(80),
    brandCategoryId: optionalText,
    providerCategoryId: optionalText,
    model: text(100),
    year: z.coerce
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 2),
    ownership: z.enum(["OWNED", "RENTED", "LEASED"]),
    provider: optionalText,
    inFleet: date,
    deFleet: optionalDate,
    keyCount: z.coerce.number().int().min(0).max(4).default(2),
  })
  .refine((v) => v.ownership !== "RENTED" || !!v.provider, {
    message: "Bitte einen Vermieter angeben.",
    path: ["provider"],
  })
  .refine((v) => !v.deFleet || v.deFleet >= v.inFleet, {
    message: "De-Fleet muss nach In-Fleet liegen.",
    path: ["deFleet"],
  });
export const driverInput = z.object({
  firstName: text(80),
  lastName: text(80),
  email: z.email().max(200),
  phone: z.string().trim().max(40).default(""),
  transporterId: optionalText,
});
export const assignmentInput = z.object({
  vehicleId: text(),
  driverId: text(),
});
export const planInput = z
  .object({
    title: text(160),
    startAt: instant,
    endAt: instant,
    driverId: optionalText,
    vehicleId: optionalText,
    notes: z.string().max(2000).default(""),
  })
  .refine((v) => v.endAt > v.startAt);
export const waveInput = z
  .object({
    driverId: optionalText,
    vehicleId: optionalText,
    name: text(120),
    startAt: instant,
    packages: z.coerce.number().int().min(0).max(1000000),
    delivered: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .refine((v) => v.delivered <= v.packages);
export const timeInput = z
  .object({
    driverId: text(),
    startAt: instant,
    endAt: optionalInstant,
    breakMinutes: z.coerce.number().int().min(0).max(1440).default(0),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      !v.endAt ||
      (v.endAt > v.startAt &&
        v.breakMinutes < (v.endAt.getTime() - v.startAt.getTime()) / 60000),
  );
export const inventoryInput = z.object({
  name: text(120),
  sku: text(80),
  category: z.string().max(80).default(""),
  stock: z.coerce.number().int().min(0).max(1000000).default(0),
  minimumStock: z.coerce.number().int().min(0).max(1000000).default(0),
  location: z.string().max(100).default(""),
});
export const movementInput = z.object({
  quantity: z.coerce
    .number()
    .int()
    .min(-1000000)
    .max(1000000)
    .refine((v) => v !== 0),
  reason: text(500),
});
export const messageInput = z.object({
  threadId: optionalText,
  subject: text(160),
  body: text(10000),
  recipientId: text(),
});
export const categoryInput = z.object({
  type: z.enum(["BRAND", "PROVIDER", "STATION", "GROUP"]),
  name: text(100),
});
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new AppError(
      422,
      "Bitte die Eingaben prüfen: " +
        r.error.issues
          .map((i) => i.path.join("."))
          .filter(Boolean)
          .join(", "),
    );
  return r.data;
}
export function validWaveTransition(from: string, to: string) {
  return (
    (from === "PLANNED" && to === "ACTIVE") ||
    (from === "ACTIVE" && to === "COMPLETED")
  );
}
/** ISO week-year is intentionally calculated separately from the calendar year. */
export const isoWeek = berlinWeek;
export function checkWeek(week: string) {
  if (!/^\d{4}-W\d{2}$/.test(week))
    throw new AppError(422, "Bitte eine gültige Kalenderwoche auswählen.");
  const y = Number(week.slice(0, 4)),
    w = Number(week.slice(6));
  const last = Number(isoWeek(new Date(Date.UTC(y, 11, 28))).slice(6));
  if (w < 1 || w > last)
    throw new AppError(422, "Diese Kalenderwoche existiert nicht.");
  return week;
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

/** Berlin Monday midnight to the next Monday, returned as UTC instants. */
export function weekRange(week: string) {
  checkWeek(week);
  const monday = weekMonday(week);
  return {
    start: berlinDayRange(monday).start,
    end: berlinDayRange(shiftLocalDate(monday, 7)).start,
  };
}
