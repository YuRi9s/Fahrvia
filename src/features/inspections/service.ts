import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "../../server/db";
import { AppError, type Principal } from "../../server/policy";
import type { Prisma } from "../../generated/prisma/client";
import { audit } from "../fleet/service";
import { validateUpload } from "../uploads/policy";
import { normalizeImage } from "../uploads/image";
import { storeBytes, removeBytes } from "../uploads/storage";
const check = z.enum(["OK", "ISSUE"]);
const input = z
  .object({
    requestId: z.uuid(),
    entryId: z.string().min(1).max(100),
    assignmentId: z.string().min(1).max(100),
    odometerKm: z.number().int().min(0).max(9999999),
    tyres: check,
    lights: check,
    mirrors: check,
    warnings: check,
    damage: z.boolean(),
    notes: z.string().trim().max(2000),
  })
  .strict();
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
async function member(tx: Prisma.TransactionClient, p: Principal) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${p.organizationId} AND "userId"=${p.userId} FOR SHARE`;
  const m = await tx.membership.findFirst({
    where: {
      organizationId: p.organizationId,
      userId: p.userId,
      active: true,
      role: p.role,
    },
  });
  if (!m || !["DRIVER", "DISPATCHER", "ADMIN", "SUPER_ADMIN"].includes(p.role))
    throw new AppError(403, "Der Organisationszugang wurde geändert.");
  if (
    p.role === "DRIVER" &&
    (!p.driverId ||
      !(await tx.driverProfile.count({
        where: {
          id: p.driverId,
          organizationId: p.organizationId,
          membershipId: m.id,
          status: "ACTIVE",
        },
      })))
  )
    throw new AppError(403, "Der Fahrerzugang ist nicht aktiv.");
}
const receipt = (r: { id: string; createdAt: Date }) => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
});
export async function submitInspection(p: Principal, form: FormData) {
  if (p.role !== "DRIVER" || !p.driverId)
    throw new AppError(
      403,
      "Fahrzeugprüfungen werden vom zugewiesenen Fahrer eingereicht.",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("metadata")));
  } catch {
    throw new AppError(422, "Ungültige Prüfdaten.");
  }
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    throw new AppError(422, "Bitte alle Prüffelder vollständig ausfüllen.");
  const v = parsed.data;
  if (
    (v.damage ||
      [v.tyres, v.lights, v.mirrors, v.warnings].includes("ISSUE")) &&
    v.notes.length < 10
  )
    throw new AppError(
      422,
      "Bitte Schaden oder Auffälligkeit mit mindestens 10 Zeichen beschreiben.",
    );
  const slots = [
    "front",
    "rear",
    "left",
    "right",
    ...(v.damage ? ["damage"] : []),
  ];
  const allowed = new Set(["metadata", ...slots]);
  for (const k of form.keys())
    if (!allowed.has(k) || form.getAll(k).length !== 1)
      throw new AppError(422, "Unerwartete oder doppelte Upload-Felder.");
  let size = 0;
  const sources = [];
  for (const position of slots) {
    const file = form.get(position);
    if (!file || typeof file === "string" || !file.size)
      throw new AppError(
        422,
        "Bitte alle benötigten Fotoansichten hinzufügen.",
      );
    size += file.size;
    if (size > 24 * 1024 * 1024)
      throw new AppError(
        413,
        "Alle Fotos zusammen dürfen höchstens 24 MB groß sein.",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (validateUpload(file.name, file.type, bytes) !== "image")
      throw new AppError(422, "Prüfungen benötigen JPG- oder PNG-Fotos.");
    sources.push({ position, bytes, digest: hash(bytes) });
  }
  if (new Set(sources.map((x) => x.digest)).size !== sources.length)
    throw new AppError(
      422,
      "Für jede Ansicht bitte ein eigenes Foto verwenden.",
    );
  const fingerprint = hash(
    JSON.stringify({
      v,
      images: sources.map((x) => ({ position: x.position, digest: x.digest })),
    }),
  );
  const db = database();
  // Reject inaccessible/stale requests before expensive decoding/storage, then recheck under locks.
  async function validate(tx: Prisma.TransactionClient, locks: boolean) {
    const assignment = await tx.vehicleAssignment.findFirst({
      where: {
        id: v.assignmentId,
        organizationId: p.organizationId,
        driverId: p.driverId!,
      },
    });
    if (locks) {
      await tx.$queryRaw`SELECT id FROM "WorkTimeEntry" WHERE id=${v.entryId} AND "organizationId"=${p.organizationId} AND "driverId"=${p.driverId!} FOR UPDATE`;
      if (assignment)
        await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${assignment.vehicleId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${p.driverId!} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    }
    await member(tx, p);
    const previous = await tx.vehicleInspection.findUnique({
      where: { id: v.requestId },
    });
    if (previous) {
      if (
        previous.organizationId !== p.organizationId ||
        previous.driverId !== p.driverId ||
        previous.reporterId !== p.userId ||
        previous.fingerprint !== fingerprint
      )
        throw new AppError(
          409,
          "Diese Anfragekennung wurde bereits anders verwendet.",
        );
      return { previous };
    }
    const entry = await tx.workTimeEntry.findFirst({
      where: {
        id: v.entryId,
        organizationId: p.organizationId,
        driverId: p.driverId!,
      },
    });
    if (!entry || !assignment)
      throw new AppError(404, "Schicht oder Fahrzeugzuweisung nicht gefunden.");
    const current = await tx.vehicleAssignment.findUnique({
      where: { id: assignment.id },
      include: { vehicle: true },
    });
    if (
      entry.endAt ||
      entry.clockState !== "RUNNING" ||
      !current ||
      current.endAt ||
      current.startAt > new Date() ||
      current.vehicle.status !== "ACTIVE"
    )
      throw new AppError(
        409,
        "Eine laufende Schicht und eine aktuelle aktive Fahrzeugzuweisung sind erforderlich. Bitte neu laden.",
      );
    if (
      await tx.vehicleInspection.count({
        where: { entryId: entry.id, assignmentId: current.id },
      })
    )
      throw new AppError(
        409,
        "Für diese Schicht und Zuweisung wurde bereits eine Prüfung eingereicht.",
      );
    return { assignment: current };
  }
  const pre = await db.$transaction((tx) => validate(tx, false));
  if (pre.previous) return receipt(pre.previous);
  const objects: {
    key: string;
    position: string;
    size: number;
    digest: string;
  }[] = [];
  let transactionStarted = false;
  let callbackFailed = false;
  try {
    for (const s of sources) {
      const bytes = await normalizeImage(s.bytes);
      const digest = hash(bytes);
      if (objects.some((x) => x.digest === digest))
        throw new AppError(
          422,
          "Für jede Ansicht bitte ein eigenes Foto verwenden.",
        );
      objects.push({
        position: s.position,
        size: bytes.length,
        digest,
        key: await storeBytes(bytes, "image/jpeg"),
      });
    }
    transactionStarted = true;
    const result = await db.$transaction(async (tx) => {
      try {
        const state = await validate(tx, true);
        if (state.previous)
          return { value: receipt(state.previous), replayed: true };
        const a = state.assignment!;
        const stored = [];
        for (const o of objects)
          stored.push(
            await tx.storedObject.create({
              data: {
                key: o.key,
                size: o.size,
                filename: o.position + ".jpg",
                mime: "image/jpeg",
                organizationId: p.organizationId,
                vehicleId: a.vehicleId,
                driverId: p.driverId,
                createdBy: p.userId,
                status: "READY",
              },
            }),
          );
        const report = await tx.vehiclePhotoReport.create({
          data: {
            organizationId: p.organizationId,
            vehicleId: a.vehicleId,
            reporterId: p.userId,
            reporterName: p.name,
            notes: v.notes,
            damage: v.damage,
            files: {
              create: stored.map((o, i) => ({
                objectId: o.id,
                position: objects[i].position,
              })),
            },
          },
        });
        const row = await tx.vehicleInspection.create({
          data: {
            id: v.requestId,
            organizationId: p.organizationId,
            driverId: p.driverId!,
            reporterId: p.userId,
            vehicleId: a.vehicleId,
            entryId: v.entryId,
            assignmentId: a.id,
            reportId: report.id,
            fingerprint,
            odometerKm: v.odometerKm,
            tyres: v.tyres,
            lights: v.lights,
            mirrors: v.mirrors,
            warnings: v.warnings,
          },
        });
        await audit(tx, p, "inspection-submit", "photos", report.id);
        return { value: receipt(row), replayed: false };
      } catch (error) {
        callbackFailed = true;
        throw error;
      }
    });
    if (result.replayed)
      await Promise.allSettled(objects.map((o) => removeBytes(o.key)));
    return result.value;
  } catch (e) {
    // Never infer rollback from a later read: an in-flight commit may not yet be visible.
    if (!transactionStarted || callbackFailed) {
      const removed = await Promise.allSettled(
        objects.map((o) => removeBytes(o.key)),
      );
      if (removed.some((r) => r.status === "rejected"))
        console.error(
          JSON.stringify({ event: "inspection_upload_cleanup_deferred" }),
        );
    } else {
      console.error(
        JSON.stringify({ event: "inspection_upload_cleanup_deferred" }),
      );
    }
    throw e;
  }
}
export async function inspectionList(p: Principal, page = 1) {
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new AppError(400, "Ungültige Seite.");
  return database().$transaction(async (tx) => {
    await member(tx, p);
    const own = p.role === "DRIVER";
    const where = {
      organizationId: p.organizationId,
      ...(own ? { driverId: p.driverId!, reporterId: p.userId } : {}),
    };
    const rows = await tx.vehicleInspection.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 20,
      take: 21,
      select: {
        id: true,
        createdAt: true,
        odometerKm: true,
        tyres: true,
        lights: true,
        mirrors: true,
        warnings: true,
        report: {
          select: {
            reporterName: true,
            notes: true,
            damage: true,
            vehicle: { select: { plate: true } },
            files: { select: { objectId: true, position: true } },
          },
        },
      },
    });
    const shift = own
      ? await tx.workTimeEntry.findFirst({
          where: {
            organizationId: p.organizationId,
            driverId: p.driverId!,
            endAt: null,
            clockState: { not: null },
          },
          select: { id: true, clockState: true },
        })
      : null;
    const assignment = own
      ? await tx.vehicleAssignment.findFirst({
          where: {
            organizationId: p.organizationId,
            driverId: p.driverId!,
            endAt: null,
            startAt: { lte: new Date() },
            vehicle: { status: "ACTIVE" },
          },
          select: { id: true, vehicle: { select: { plate: true } } },
        })
      : null;
    const completed =
      shift && assignment
        ? await tx.vehicleInspection.findFirst({
            where: { entryId: shift.id, assignmentId: assignment.id },
            select: { id: true },
          })
        : null;
    return {
      items: rows
        .slice(0, 20)
        .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      hasMore: rows.length > 20,
      page,
      context: own
        ? {
            actorId: p.userId,
            shift,
            assignment,
            completedId: completed?.id ?? null,
          }
        : null,
    };
  });
}
export type InspectionList = Awaited<ReturnType<typeof inspectionList>>;
