import { z } from "zod";
import { database } from "../../server/db";
import { AppError, type Principal } from "../../server/policy";
import { audit } from "../fleet/service";
import type { Prisma } from "../../generated/prisma/client";
import type { ClockAction, ClockSnapshot } from "./types";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), requestId: z.uuid() }).strict(),
  z
    .object({
      action: z.enum(["pause", "resume", "finish"]),
      requestId: z.uuid(),
      entryId: z.string().min(1).max(100),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
]);
async function lockDriver(tx: Prisma.TransactionClient, p: Principal) {
  if (p.role !== "DRIVER" || !p.driverId)
    throw new AppError(
      403,
      "Diese Zeiterfassung ist nur für Fahrer verfügbar.",
    );
  // Same entry -> driver ordering as the existing administrative correction path.
  await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${p.driverId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
  const member = await tx.membership.findFirst({
    where: {
      userId: p.userId,
      organizationId: p.organizationId,
      active: true,
      role: "DRIVER",
    },
  });
  const driver =
    member &&
    (await tx.driverProfile.findFirst({
      where: {
        id: p.driverId,
        organizationId: p.organizationId,
        membershipId: member.id,
        status: "ACTIVE",
      },
    }));
  if (!driver)
    throw new AppError(403, "Der Fahrerzugang ist nicht mehr aktiv.");
}
async function snapshot(
  tx: Prisma.TransactionClient,
  p: Principal,
): Promise<ClockSnapshot> {
  const where = { organizationId: p.organizationId, driverId: p.driverId! };
  const active = await tx.workTimeEntry.findFirst({
    where: { ...where, endAt: null },
    orderBy: [{ startAt: "desc" }, { id: "desc" }],
    include: {
      clockEvents: {
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 100,
      },
    },
  });
  const row = active?.clockState
    ? active
    : await tx.workTimeEntry.findFirst({
        where: { ...where, clockState: { not: null } },
        orderBy: [{ startAt: "desc" }, { id: "desc" }],
        include: {
          clockEvents: {
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 100,
          },
        },
      });
  return {
    serverNow: new Date().toISOString(),
    blockedByManualEntry: !!active && !active.clockState,
    entry: row
      ? {
          id: row.id,
          state: row.clockState as "RUNNING" | "PAUSED" | "FINISHED",
          startAt: row.startAt.toISOString(),
          endAt: row.endAt?.toISOString() ?? null,
          breakStartedAt: row.breakStartedAt?.toISOString() ?? null,
          breakMilliseconds: Number(row.breakMilliseconds),
          version: row.version,
          events: row.clockEvents.reverse().map((e) => ({
            id: e.id,
            action: e.action as ClockAction,
            occurredAt: e.occurredAt.toISOString(),
          })),
        }
      : null,
  };
}
export async function clockSnapshot(p: Principal) {
  return database().$transaction(async (tx) => {
    await lockDriver(tx, p);
    return snapshot(tx, p);
  });
}
export async function clockCommand(p: Principal, raw: unknown) {
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    throw new AppError(400, "Ungültige Zeiterfassungsaktion.");
  const v = parsed.data;
  return database().$transaction(async (tx) => {
    if (v.action !== "start")
      await tx.$queryRaw`SELECT id FROM "WorkTimeEntry" WHERE id=${v.entryId} AND "organizationId"=${p.organizationId} AND "driverId"=${p.driverId ?? ""} FOR UPDATE`;
    await lockDriver(tx, p);
    const previous = await tx.workTimeClockEvent.findUnique({
      where: {
        actorId_requestId: { actorId: p.userId, requestId: v.requestId },
      },
    });
    if (previous) {
      const originalEntry = await tx.workTimeEntry.findFirst({
        where: {
          id: previous.entryId,
          organizationId: p.organizationId,
          driverId: p.driverId!,
        },
      });
      if (!originalEntry)
        throw new AppError(
          409,
          "Die Anfrage gehört nicht zu diesem Fahrerzugang.",
        );
      if (
        previous.action !== v.action ||
        previous.requestedEntryId !==
          (v.action === "start" ? null : v.entryId) ||
        previous.expectedVersion !==
          (v.action === "start" ? null : v.expectedVersion)
      )
        throw new AppError(
          409,
          "Diese Anfragekennung wurde bereits für eine andere Aktion verwendet.",
        );
      return snapshot(tx, p);
    }
    const now = new Date();
    let entry;
    if (v.action === "start") {
      const overlap = await tx.workTimeEntry.findFirst({
        where: {
          organizationId: p.organizationId,
          driverId: p.driverId!,
          OR: [{ endAt: null }, { endAt: { gt: now } }],
        },
      });
      if (overlap)
        throw new AppError(
          409,
          "Es besteht bereits eine offene oder überlappende Arbeitszeit. Bitte neu laden oder die Administration kontaktieren.",
        );
      entry = await tx.workTimeEntry.create({
        data: {
          organizationId: p.organizationId,
          driverId: p.driverId!,
          startAt: now,
          clockState: "RUNNING",
        },
      });
    } else {
      const old = await tx.workTimeEntry.findFirst({
        where: {
          id: v.entryId,
          organizationId: p.organizationId,
          driverId: p.driverId!,
        },
      });
      if (!old) throw new AppError(404, "Arbeitszeit nicht gefunden.");
      if (!old.clockState || old.endAt || old.version !== v.expectedVersion)
        throw new AppError(
          409,
          "Die Arbeitszeit wurde bereits geändert. Bitte neu laden.",
        );
      if (
        (v.action === "pause" && old.clockState !== "RUNNING") ||
        (v.action === "resume" && old.clockState !== "PAUSED")
      )
        throw new AppError(
          409,
          "Diese Aktion passt nicht zum aktuellen Schichtstatus.",
        );
      const last = await tx.workTimeClockEvent.findFirst({
        where: { entryId: old.id },
        orderBy: { occurredAt: "desc" },
      });
      if (now.getTime() <= (last?.occurredAt ?? old.startAt).getTime())
        throw new AppError(
          409,
          "Der Zeitstempel konnte nicht bestätigt werden. Bitte erneut versuchen.",
        );
      const accumulated =
        old.breakMilliseconds +
        (old.breakStartedAt
          ? BigInt(now.getTime() - old.breakStartedAt.getTime())
          : 0n);
      entry = await tx.workTimeEntry.update({
        where: { id: old.id },
        data: {
          clockState:
            v.action === "finish"
              ? "FINISHED"
              : v.action === "pause"
                ? "PAUSED"
                : "RUNNING",
          breakStartedAt: v.action === "pause" ? now : null,
          breakMilliseconds: accumulated,
          breakMinutes: Number(accumulated / 60000n),
          ...(v.action === "finish" ? { endAt: now, status: "SUBMITTED" } : {}),
          version: { increment: 1 },
        },
      });
    }
    await tx.workTimeClockEvent.create({
      data: {
        entryId: entry.id,
        actorId: p.userId,
        requestId: v.requestId,
        action: v.action,
        requestedEntryId: v.action === "start" ? null : v.entryId,
        expectedVersion: v.action === "start" ? null : v.expectedVersion,
        occurredAt: now,
      },
    });
    await audit(tx, p, `clock-${v.action}`, "work-times", entry.id);
    return snapshot(tx, p);
  });
}
