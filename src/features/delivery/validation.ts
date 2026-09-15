import { z } from "zod";
import { AppError, type Principal } from "../../server/policy";
import { isoWeek, parse } from "../../server/validation";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
export const deliveryInput = z
  .object({
    driverId: z.string().min(1).max(100),
    kind: z.enum(["PHR", "CONCESSION"]),
    date: z.iso.date(),
    intendedLocation: optionalText(500),
    actualLocation: optionalText(500),
    category: optionalText(160),
    notes: optionalText(4000),
    sourceReference: z.string().trim().min(3).max(500),
    correctionReason: optionalText(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "PHR" && (!v.intendedLocation || !v.actualLocation))
      ctx.addIssue({
        code: "custom",
        path: ["intendedLocation"],
        message: "Beide Lieferorte sind erforderlich.",
      });
    if (v.kind === "CONCESSION" && !v.category)
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "Eine Beschwerdekategorie ist erforderlich.",
      });
  });
export function parseDelivery(data: unknown) {
  const v = parse(deliveryInput, data);
  const date = new Date(`${v.date}T00:00:00.000Z`);
  return { ...v, date, week: isoWeek(date) };
}
/** Detail access follows score permissions; a supplied driver id never widens driver scope. */
export function deliveryScope(p: Principal, requestedDriver?: string) {
  if (["ADMIN", "SUPER_ADMIN"].includes(p.role))
    return {
      organizationId: p.organizationId,
      ...(requestedDriver ? { driverId: requestedDriver } : {}),
    };
  if (p.role === "DRIVER" && p.driverId) {
    if (requestedDriver && requestedDriver !== p.driverId)
      throw new AppError(404, "Der Fahrer wurde nicht gefunden.");
    return { organizationId: p.organizationId, driverId: p.driverId };
  }
  throw new AppError(403, "Für diese Aktion fehlt die Berechtigung.");
}
