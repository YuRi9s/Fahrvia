import type { Wave } from "../../generated/prisma/client";
import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse, validWaveTransition } from "../../server/validation";
const integer = z.number().int().min(0).max(1000000);
const waveInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    startAt: z
      .union([z.date(), z.iso.datetime({ offset: true })])
      .pipe(z.coerce.date()),
    packages: integer,
    delivered: integer.default(0),
    participants: z
      .array(
        z.object({
          driverId: z.string().min(1).max(200),
          vehicleId: z.string().min(1).max(200),
        }),
      )
      .max(100),
  })
  .refine((v) => v.delivered <= v.packages)
  .refine(
    (v) =>
      new Set(v.participants.map((x) => x.driverId)).size ===
        v.participants.length &&
      new Set(v.participants.map((x) => x.vehicleId)).size ===
        v.participants.length,
  );
export async function mutateWave(
  p: Principal,
  action: string,
  id: string | undefined,
  data: unknown,
) {
  demand(p, "waves", "write");
  if (!["create", "update", "progress", "transition"].includes(action))
    throw new AppError(422, "Unbekannte Aktion.");
  const organizationId = p.organizationId;
  return database().$transaction(
    async (tx) => {
      if (action !== "create")
        await tx.$queryRaw`SELECT id FROM "Wave" WHERE id=${id ?? ""} AND "organizationId"=${organizationId} FOR UPDATE`;
      const old =
        action !== "create"
          ? await tx.wave.findFirst({
              where: { id: id ?? "", organizationId },
              include: { participants: true },
            })
          : null;
      if (action !== "create" && !old)
        throw new AppError(404, "Welle nicht gefunden.");
      if (old) {
        const expected = (data as Record<string, unknown>)?.expectedVersion;
        if (!Number.isSafeInteger(expected) || expected !== old.version)
          throw new AppError(
            409,
            "Die Welle wurde geändert. Bitte schließen, aktualisieren und erneut öffnen.",
          );
        if (old.status === "COMPLETED")
          throw new AppError(
            409,
            "Abgeschlossene Wellen können nicht geändert werden.",
          );
      }
      const input =
        action === "create" || action === "update"
          ? parse(waveInput, data)
          : null;
      if (action === "update" && old!.status !== "PLANNED")
        throw new AppError(
          409,
          "Teilnehmer und Planung können nur vor dem Start geändert werden.",
        );
      const status =
        action === "transition"
          ? String((data as Record<string, unknown>)?.status ?? "")
          : null;
      if (status && !validWaveTransition(old!.status, status))
        throw new AppError(409, "Dieser Statuswechsel ist nicht erlaubt.");
      if (action === "transition" && !status)
        throw new AppError(422, "Status fehlt.");
      const starting = status === "ACTIVE";
      const participants = input?.participants ?? old?.participants ?? [];
      if (
        starting &&
        (!participants.length ||
          participants.some((x) => !x.driverId || !x.vehicleId))
      )
        throw new AppError(
          409,
          "Vor dem Start mindestens ein vollständiges Fahrer-/Fahrzeugpaar zuordnen.",
        );
      if (input || starting) {
        const vehicles = [
          ...new Set(
            participants.flatMap((x) => (x.vehicleId ? [x.vehicleId] : [])),
          ),
        ].sort();
        const drivers = [
          ...new Set(
            participants.flatMap((x) => (x.driverId ? [x.driverId] : [])),
          ),
        ].sort();
        for (const vehicleId of vehicles)
          await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} AND "organizationId"=${organizationId} FOR UPDATE`;
        for (const driverId of drivers)
          await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${driverId} AND "organizationId"=${organizationId} FOR UPDATE`;
        if (
          (await tx.vehicle.count({
            where: { id: { in: vehicles }, organizationId, status: "ACTIVE" },
          })) !== vehicles.length ||
          (await tx.driverProfile.count({
            where: { id: { in: drivers }, organizationId, status: "ACTIVE" },
          })) !== drivers.length
        )
          throw new AppError(
            409,
            "Alle Teilnehmer müssen aktive Fahrer und Fahrzeuge dieser Organisation sein.",
          );
        if (
          starting &&
          (await tx.waveParticipant.findFirst({
            where: {
              organizationId,
              waveId: { not: old!.id },
              wave: { status: "ACTIVE" },
              OR: [
                { vehicleId: { in: vehicles } },
                { driverId: { in: drivers } },
              ],
            },
          }))
        )
          throw new AppError(
            409,
            "Ein Fahrer oder Fahrzeug gehört bereits zu einer aktiven Welle.",
          );
      }
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${organizationId} FOR SHARE`;
      const actor = await tx.membership.findFirst({
        where: {
          userId: p.userId,
          organizationId,
          active: true,
          role: { in: ["ADMIN", "SUPER_ADMIN", "DISPATCHER"] },
        },
      });
      if (!actor)
        throw new AppError(
          403,
          "Die aktuelle Berechtigung zum Bearbeiten von Wellen fehlt.",
        );
      let row: Wave;
      if (input) {
        const { participants, ...fields } = input;
        const legacy = {
          driverId: participants[0]?.driverId ?? null,
          vehicleId: participants[0]?.vehicleId ?? null,
        };
        if (old) {
          await tx.waveParticipant.deleteMany({
            where: { waveId: old.id, organizationId },
          });
          row = await tx.wave.update({
            where: { id: old.id },
            data: { ...fields, ...legacy, version: { increment: 1 } },
          });
        } else
          row = await tx.wave.create({
            data: { ...fields, ...legacy, organizationId },
          });
        if (participants.length)
          await tx.waveParticipant.createMany({
            data: participants.map((pair) => ({
              ...pair,
              waveId: row.id,
              organizationId,
            })),
          });
      } else if (action === "progress") {
        if (old!.status !== "ACTIVE")
          throw new AppError(
            409,
            "Fortschritt kann nur für aktive Wellen erfasst werden.",
          );
        const progress = parse(z.object({ delivered: integer }), data);
        if (progress.delivered > old!.packages)
          throw new AppError(
            422,
            "Zugestellte Pakete dürfen die Gesamtzahl nicht überschreiten.",
          );
        row = await tx.wave.update({
          where: { id: old!.id },
          data: { delivered: progress.delivered, version: { increment: 1 } },
        });
      } else {
        if (status === "COMPLETED" && old!.delivered !== old!.packages)
          throw new AppError(
            409,
            "Bitte zuerst alle Pakete als zugestellt erfassen.",
          );
        row = await tx.wave.update({
          where: { id: old!.id },
          data: { status: status!, version: { increment: 1 } },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: p.userId,
          action,
          resourceType: "waves",
          resourceId: row.id,
          details: {
            from: old?.status ?? null,
            to: row.status,
            version: row.version,
            participantCount: participants.length,
            delivered: row.delivered,
          },
        },
      });
      return { id: row.id, version: row.version };
    },
    { timeout: 15000 },
  );
}
