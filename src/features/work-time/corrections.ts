import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "../../server/db";
import { AppError, type Principal } from "../../server/policy";
import { audit } from "../fleet/service";
import type { Prisma, WorkTimeEntry } from "../../generated/prisma/client";
const text = z.string().trim().min(10).max(2000);
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("request"),
      requestId: z.uuid(),
      entryId: z.string().min(1).max(100),
      expectedVersion: z.number().int().positive(),
      startAt: z.iso.datetime(),
      endAt: z.iso.datetime(),
      breakMilliseconds: z.number().int().min(0).max(31536000000),
      reason: text,
      evidenceDocumentId: z.string().min(1).max(100).nullable().default(null),
    })
    .strict(),
  z
    .object({
      action: z.literal("decide"),
      id: z.uuid(),
      requestId: z.uuid(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      reason: text,
    })
    .strict(),
]);
async function access(tx: Prisma.TransactionClient, p: Principal) {
  if (!["DRIVER", "ADMIN", "SUPER_ADMIN"].includes(p.role))
    throw new AppError(403, "Keine Berechtigung für Zeitkorrekturen.");
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
  const member = await tx.membership.findFirst({
    where: {
      userId: p.userId,
      organizationId: p.organizationId,
      active: true,
      role: p.role,
    },
  });
  if (!member)
    throw new AppError(403, "Der Organisationszugang wurde geändert.");
  if (
    p.role === "DRIVER" &&
    (!p.driverId ||
      !(await tx.driverProfile.count({
        where: {
          id: p.driverId,
          organizationId: p.organizationId,
          membershipId: member.id,
          status: "ACTIVE",
        },
      })))
  )
    throw new AppError(403, "Der Fahrerzugang ist nicht aktiv.");
}
function values(e: WorkTimeEntry) {
  return {
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    breakMilliseconds: Number(
      e.clockState ? e.breakMilliseconds : BigInt(e.breakMinutes) * 60000n,
    ),
    version: e.version,
    status: e.status,
    approvedBy: e.approvedBy,
    approvedAt: e.approvedAt?.toISOString() ?? null,
  };
}
export async function correctionCommand(p: Principal, raw: unknown) {
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      "Bitte alle Angaben und eine Begründung mit mindestens 10 Zeichen prüfen.",
    );
  const v = parsed.data;
  if (
    (v.action === "request" && p.role !== "DRIVER") ||
    (v.action === "decide" && !["ADMIN", "SUPER_ADMIN"].includes(p.role))
  )
    throw new AppError(403, "Diese Aktion ist für Ihre Rolle nicht erlaubt.");
  return database().$transaction(async (tx) => {
    // Find scope without exposing a record, then lock entry -> driver -> membership.
    const request =
      v.action === "decide"
        ? await tx.workTimeCorrection.findFirst({
            where: { id: v.id, organizationId: p.organizationId },
          })
        : null;
    const entryId =
      v.action === "request" ? v.entryId : (request?.entryId ?? "");
    const scope = {
      id: entryId,
      organizationId: p.organizationId,
      ...(p.role === "DRIVER" ? { driverId: p.driverId ?? "" } : {}),
    };
    await tx.$queryRaw`SELECT id FROM "WorkTimeEntry" WHERE id=${entryId} AND "organizationId"=${p.organizationId} AND (${p.role !== "DRIVER"} OR "driverId"=${p.driverId ?? ""}) FOR UPDATE`;
    const old = await tx.workTimeEntry.findFirst({ where: scope });
    if (old)
      await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${old.driverId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    await access(tx, p);
    if (!old) throw new AppError(404, "Arbeitszeit nicht gefunden.");
    if (v.action === "request") {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(v))
        .digest("hex");
      const previous = await tx.workTimeCorrection.findUnique({
        where: { id: v.requestId },
      });
      if (previous) {
        if (
          previous.requestedBy !== p.userId ||
          previous.organizationId !== p.organizationId ||
          previous.driverId !== p.driverId ||
          previous.fingerprint !== fingerprint
        )
          throw new AppError(
            409,
            "Diese Anfragekennung wurde bereits verwendet.",
          );
        return { id: previous.id };
      }
      if (!old.endAt || old.version !== v.expectedVersion)
        throw new AppError(
          409,
          "Die Schicht ist noch offen oder wurde geändert. Bitte neu laden.",
        );
      if (
        await tx.workTimeCorrection.count({
          where: { entryId: old.id, status: "PENDING" },
        })
      )
        throw new AppError(
          409,
          "Für diese Schicht ist bereits ein Antrag offen.",
        );
      const start = new Date(v.startAt),
        end = new Date(v.endAt);
      if (
        +end <= +start ||
        +end > Date.now() ||
        v.breakMilliseconds >= +end - +start ||
        (!old.clockState && v.breakMilliseconds % 60000 !== 0)
      )
        throw new AppError(
          422,
          "Zeitraum oder Pause ungültig. Manuelle Altbestände benötigen ganze Pausenminuten.",
        );
      const before = values(old);
      if (
        +start === +old.startAt &&
        +end === +old.endAt &&
        v.breakMilliseconds === before.breakMilliseconds
      )
        throw new AppError(422, "Der Antrag enthält keine Zeitänderung.");
      const doc = v.evidenceDocumentId
        ? await tx.document.findFirst({
            where: {
              id: v.evidenceDocumentId,
              organizationId: p.organizationId,
              driverId: old.driverId,
              archivedAt: null,
              object: {
                organizationId: p.organizationId,
                driverId: old.driverId,
                status: "READY",
              },
            },
          })
        : null;
      if (v.evidenceDocumentId && !doc)
        throw new AppError(
          404,
          "Eigener Nachweis nicht gefunden oder nicht verfügbar.",
        );
      await tx.workTimeCorrection.create({
        data: {
          id: v.requestId,
          entryId: old.id,
          organizationId: p.organizationId,
          driverId: old.driverId,
          requestedBy: p.userId,
          expectedVersion: old.version,
          fingerprint,
          before,
          startAt: start,
          endAt: end,
          breakMilliseconds: BigInt(v.breakMilliseconds),
          reason: v.reason,
          evidenceDocumentId: doc?.id,
          evidenceObjectId: doc?.objectId,
        },
      });
      await audit(tx, p, "correction-request", "work-times", old.id);
      return { id: v.requestId };
    }
    // Re-read after locking the entry: a concurrent decision may have committed.
    const r = await tx.workTimeCorrection.findFirst({
      where: { id: v.id, entryId: old.id, organizationId: p.organizationId },
    });
    if (!r) throw new AppError(404, "Antrag nicht gefunden.");
    if (r.status !== "PENDING") {
      if (
        r.reviewedBy === p.userId &&
        r.decisionId === v.requestId &&
        r.status === v.decision &&
        r.decisionReason === v.reason
      )
        return { id: r.id };
      throw new AppError(409, "Dieser Antrag wurde bereits entschieden.");
    }
    const profile = await tx.driverProfile.findUnique({
      where: { id: old.driverId },
      include: { membership: true },
    });
    if (r.requestedBy === p.userId || profile?.membership?.userId === p.userId)
      throw new AppError(
        403,
        "Eigene Zeitkorrekturen benötigen eine andere Administration.",
      );
    let after: Prisma.InputJsonValue | undefined;
    if (v.decision === "APPROVED") {
      if (
        !old.endAt ||
        old.driverId !== r.driverId ||
        old.version !== r.expectedVersion
      )
        throw new AppError(
          409,
          "Die Arbeitszeit wurde seit dem Antrag geändert. Bitte ablehnen und einen neuen Antrag anfordern.",
        );
      if (
        await tx.workTimeEntry.count({
          where: {
            organizationId: p.organizationId,
            driverId: old.driverId,
            id: { not: old.id },
            startAt: { lt: r.endAt },
            OR: [{ endAt: null }, { endAt: { gt: r.startAt } }],
          },
        })
      )
        throw new AppError(
          409,
          "Die beantragte Zeit überschneidet sich mit einer anderen Schicht.",
        );
      await tx.workTimeRevision.create({
        data: {
          entryId: old.id,
          actorId: p.userId,
          reason: `Antrag ${r.id}: ${v.reason}`,
          before: values(old),
        },
      });
      const updated = await tx.workTimeEntry.update({
        where: { id: old.id },
        data: {
          startAt: r.startAt,
          endAt: r.endAt,
          breakMilliseconds: old.clockState ? r.breakMilliseconds : 0n,
          breakMinutes: Number(r.breakMilliseconds / 60000n),
          status: "SUBMITTED",
          approvedBy: null,
          approvedAt: null,
          version: { increment: 1 },
        },
      });
      after = values(updated);
    }
    await tx.workTimeCorrection.update({
      where: { id: r.id },
      data: {
        status: v.decision,
        reviewedBy: p.userId,
        reviewedAt: new Date(),
        decisionReason: v.reason,
        decisionId: v.requestId,
        ...(after ? { after } : {}),
      },
    });
    await audit(
      tx,
      p,
      v.decision === "APPROVED" ? "correction-approved" : "correction-rejected",
      "work-times",
      old.id,
    );
    return { id: r.id };
  });
}
export async function corrections(p: Principal, params: URLSearchParams) {
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const entryPage = Math.max(
    1,
    Math.min(10000, Number(params.get("entryPage")) || 1),
  );
  if (!Number.isInteger(page) || !Number.isInteger(entryPage))
    throw new AppError(400, "Ungültige Seite.");
  return database().$transaction(async (tx) => {
    await access(tx, p);
    const own = p.role === "DRIVER";
    const scope = {
      organizationId: p.organizationId,
      ...(own ? { driverId: p.driverId! } : {}),
    };
    const where = {
      ...scope,
      ...(params.get("status") === "PENDING" ? { status: "PENDING" } : {}),
    };
    const rows = await tx.workTimeCorrection.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 20,
      take: 20,
      include: {
        entry: {
          include: { driver: { select: { firstName: true, lastName: true } } },
        },
        evidence: { select: { id: true, filename: true } },
      },
    });
    const entryWhere = { ...scope, endAt: { not: null } };
    const entries = own
      ? await tx.workTimeEntry.findMany({
          where: entryWhere,
          orderBy: [{ startAt: "desc" }, { id: "desc" }],
          skip: (entryPage - 1) * 20,
          take: 20,
        })
      : [];
    const docs = own
      ? await tx.document.findMany({
          where: {
            organizationId: p.organizationId,
            driverId: p.driverId!,
            archivedAt: null,
            object: {
              organizationId: p.organizationId,
              driverId: p.driverId!,
              status: "READY",
            },
          },
          select: { id: true, title: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [];
    return {
      page,
      entryPage,
      total: await tx.workTimeCorrection.count({ where }),
      entryTotal: own ? await tx.workTimeEntry.count({ where: entryWhere }) : 0,
      documents: docs,
      entries: entries.map((e) => ({
        id: e.id,
        ...values(e),
        clock: !!e.clockState,
      })),
      items: rows.map((r) => ({
        id: r.id,
        entryId: r.entryId,
        driverName: `${r.entry.driver.firstName} ${r.entry.driver.lastName}`,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        decisionReason: r.decisionReason,
        evidence: r.evidence,
        before: r.before,
        after: r.after,
        proposal: {
          startAt: r.startAt.toISOString(),
          endAt: r.endAt.toISOString(),
          breakMilliseconds: Number(r.breakMilliseconds),
        },
        stale: r.entry.version !== r.expectedVersion,
      })),
    };
  });
}

export type CorrectionList = Awaited<ReturnType<typeof corrections>>;
