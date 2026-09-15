import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
import type { Prisma, VehicleKey } from "../../generated/prisma/client";
type Tx = Prisma.TransactionClient;
const reason = z.string().trim().min(3).max(500);
const version = z.number().int().positive();
const createInput = z
  .object({ vehicleId: z.string().min(1).max(200), reason })
  .strict();
const changeInput = z.object({ version, reason }).strict();
const transferInput = z
  .object({
    version,
    reason,
    location: z.enum(["OFFICE", "DRIVER", "MISSING"]),
    driverId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => v.location !== "DRIVER" || !!v.driverId);
async function event(
  tx: Tx,
  p: Principal,
  key: VehicleKey,
  action: string,
  reason: string,
) {
  await tx.keyCustody.create({
    data: {
      organizationId: p.organizationId,
      keyId: key.id,
      location: key.location,
      driverId: key.driverId,
      actorId: p.userId,
      action,
      reason,
    },
  });
}
export async function mutateKey(
  p: Principal,
  action: string,
  id: string | undefined,
  data: unknown,
) {
  demand(p, "keys", "write");
  if (!["create", "update", "retire", "replace"].includes(action))
    throw new AppError(422, "Unbekannte Schlüsselaktion.");
  if (action !== "update" && !["ADMIN", "SUPER_ADMIN"].includes(p.role))
    throw new AppError(403, "Diese Aktion ist Administratoren vorbehalten.");
  const input =
    action === "create"
      ? parse(createInput, data)
      : action === "update"
        ? parse(transferInput, data)
        : parse(changeInput, data);
  return database().$transaction(async (tx) => {
    const initial =
      action === "create"
        ? null
        : await tx.vehicleKey.findFirst({
            where: { id: id ?? "", organizationId: p.organizationId },
          });
    if (action !== "create" && !initial)
      throw new AppError(404, "Schlüssel nicht gefunden.");
    const vehicleId =
      initial?.vehicleId ?? (input as z.infer<typeof createInput>).vehicleId;
    // Same vehicle-first order as assignments, custody and vehicle archival.
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, organizationId: p.organizationId },
    });
    if (!vehicle) throw new AppError(404, "Fahrzeug nicht gefunden.");
    const transfer =
      action === "update" ? (input as z.infer<typeof transferInput>) : null;
    if (transfer?.location === "DRIVER") {
      await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${transfer.driverId!} AND "organizationId"=${p.organizationId} FOR UPDATE`;
      if (
        !(await tx.driverProfile.findFirst({
          where: {
            id: transfer.driverId!,
            organizationId: p.organizationId,
            status: "ACTIVE",
          },
        }))
      )
        throw new AppError(
          409,
          "Der Fahrer ist nicht aktiv oder nicht verfügbar.",
        );
    }
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
    const actor = await tx.membership.findFirst({
      where: {
        userId: p.userId,
        organizationId: p.organizationId,
        active: true,
      },
    });
    if (
      !actor ||
      !(
        action === "update"
          ? ["ADMIN", "SUPER_ADMIN", "DISPATCHER"]
          : ["ADMIN", "SUPER_ADMIN"]
      ).includes(actor.role)
    )
      throw new AppError(
        403,
        "Die aktuelle Berechtigung reicht für diese Aktion nicht aus.",
      );
    const old = initial
      ? await tx.vehicleKey.findUniqueOrThrow({ where: { id: initial.id } })
      : null;
    if (old && old.version !== (input as { version: number }).version)
      throw new AppError(
        409,
        "Der Schlüssel wurde inzwischen geändert. Bitte neu laden und erneut prüfen.",
      );
    if (old?.status === "RETIRED")
      throw new AppError(
        409,
        "Ausgemusterte Schlüssel können nicht mehr verändert werden.",
      );
    if (
      (["create", "replace"].includes(action) ||
        transfer?.location === "DRIVER") &&
      vehicle.status !== "ACTIVE"
    )
      throw new AppError(409, "Das Fahrzeug ist inaktiv.");
    if (["retire", "replace"].includes(action) && old?.location === "DRIVER")
      throw new AppError(
        409,
        "Bitte den Schlüssel zuerst zurücknehmen oder als vermisst melden.",
      );
    let result: VehicleKey;
    if (action === "create") {
      const keys = await tx.vehicleKey.findMany({
        where: { vehicleId, status: "ACTIVE" },
        select: { slot: true },
      });
      const slot = [1, 2, 3, 4].find(
        (slot) => !keys.some((key) => key.slot === slot),
      );
      if (!slot)
        throw new AppError(
          409,
          "Für dieses Fahrzeug bestehen bereits vier aktive Schlüssel.",
        );
      result = await tx.vehicleKey.create({
        data: { vehicleId, organizationId: p.organizationId, slot },
      });
      await event(tx, p, result, "CREATE", input.reason);
    } else if (transfer) {
      const driverId =
        transfer.location === "DRIVER" ? transfer.driverId! : null;
      if (old!.location === transfer.location && old!.driverId === driverId)
        throw new AppError(
          409,
          "Keine Änderung der Schlüsselverwahrung ausgewählt.",
        );
      result = await tx.vehicleKey.update({
        where: { id: old!.id },
        data: {
          location: transfer.location,
          driverId,
          version: { increment: 1 },
        },
      });
      await event(tx, p, result, "TRANSFER", input.reason);
    } else {
      result = await tx.vehicleKey.update({
        where: { id: old!.id },
        data: { status: "RETIRED", version: { increment: 1 } },
      });
      await event(tx, p, result, "RETIRE", input.reason);
      if (action === "replace") {
        result = await tx.vehicleKey.create({
          data: {
            vehicleId,
            organizationId: p.organizationId,
            slot: old!.slot,
            replacesKeyId: old!.id,
          },
        });
        await event(tx, p, result, "REPLACE", input.reason);
      }
    }
    await tx.auditLog.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: `key-${action}`,
        resourceType: "keys",
        resourceId: old?.id ?? result.id,
        details: {
          reason: input.reason,
          before: old
            ? {
                id: old.id,
                status: old.status,
                location: old.location,
                driverId: old.driverId,
                version: old.version,
              }
            : null,
          after: {
            id: result.id,
            status: result.status,
            location: result.location,
            driverId: result.driverId,
            version: result.version,
          },
          replacementId: action === "replace" ? result.id : null,
        },
      },
    });
    return { id: result.id };
  });
}
export async function keyHistory(
  p: Principal,
  id: string,
  params = new URLSearchParams(),
) {
  demand(p, "keys", "read");
  if (p.role === "DRIVER")
    throw new AppError(
      403,
      "Der vollständige Schlüsselverlauf ist der Verwaltung vorbehalten.",
    );
  const db = database();
  const key = await db.vehicleKey.findFirst({
    where: { id, organizationId: p.organizationId },
    include: { vehicle: { select: { plate: true } } },
  });
  if (!key) throw new AppError(404, "Schlüssel nicht gefunden.");
  const page = Math.max(
    1,
    Math.min(100000, Math.trunc(Number(params.get("page")) || 1)),
  );
  const where = { keyId: id, organizationId: p.organizationId };
  const [items, total, replacement] = await Promise.all([
    db.keyCustody.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 25,
      take: 25,
    }),
    db.keyCustody.count({ where }),
    db.vehicleKey.findFirst({
      where: { replacesKeyId: id, organizationId: p.organizationId },
      select: { id: true },
    }),
  ]);
  const [users, drivers] = await Promise.all([
    db.user.findMany({
      where: { id: { in: items.map((row) => row.actorId) } },
      select: { id: true, name: true },
    }),
    db.driverProfile.findMany({
      where: {
        organizationId: p.organizationId,
        id: {
          in: items.flatMap((row) => (row.driverId ? [row.driverId] : [])),
        },
      },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  return {
    key: {
      id: key.id,
      plate: key.vehicle.plate,
      slot: key.slot,
      status: key.status,
      replacesKeyId: key.replacesKeyId,
      replacementId: replacement?.id ?? null,
    },
    items: items.map((row) => {
      const driver = drivers.find((d) => d.id === row.driverId);
      return {
        id: row.id,
        action: row.action,
        location: row.location,
        reason: row.reason,
        createdAt: row.createdAt,
        actorName:
          users.find((u) => u.id === row.actorId)?.name ?? "Nicht verfügbar",
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
      };
    }),
    total,
    page,
    pageSize: 25,
  };
}
