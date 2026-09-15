import { assignmentWriter } from "../assignments/permissions";
import { mutateKey } from "../keys/service";
import {
  lockCategories,
  mutateCategory,
  vehicleCategories,
} from "../categories/service";
import { reactivateDriver } from "./reactivate-driver";
import { database } from "../../server/db";
import type { Prisma } from "../../generated/prisma/client";
import { AppError, demand, type Principal } from "../../server/policy";
import {
  parse,
  vehicleInput,
  driverInput,
  assignmentInput,
} from "../../server/validation";
export type Tx = Prisma.TransactionClient;
/** Audit writes share the business transaction so failed mutations leave no false history. */
export async function audit(
  tx: Tx,
  p: Principal,
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await tx.auditLog.create({
    data: {
      organizationId: p.organizationId,
      actorId: p.userId,
      action,
      resourceType,
      resourceId,
    },
  });
}
export async function requireDriver(tx: Tx, p: Principal, id: string) {
  const row = await tx.driverProfile.findFirst({
    where: { id, organizationId: p.organizationId, status: "ACTIVE" },
  });
  if (!row) throw new AppError(422, "Der aktive Fahrer wurde nicht gefunden.");
  return row;
}
export async function requireVehicle(tx: Tx, p: Principal, id: string) {
  const row = await tx.vehicle.findFirst({
    where: { id, organizationId: p.organizationId },
  });
  if (!row) throw new AppError(404, "Das Fahrzeug wurde nicht gefunden.");
  return row;
}
/** Row locks and partial unique indexes jointly enforce one current vehicle per driver. */
export async function assignVehicle(p: Principal, data: unknown) {
  demand(p, "assignments", "write");
  const v = parse(assignmentInput, data);
  return database().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${v.vehicleId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${v.driverId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    const vehicle = await requireVehicle(tx, p, v.vehicleId);
    await requireDriver(tx, p, v.driverId);
    if (vehicle.status !== "ACTIVE")
      throw new AppError(409, "Das Fahrzeug ist inaktiv.");
    const occupied = await tx.vehicleAssignment.findFirst({
      where: {
        organizationId: p.organizationId,
        endAt: null,
        OR: [{ vehicleId: v.vehicleId }, { driverId: v.driverId }],
      },
    });
    if (occupied)
      throw new AppError(409, "Fahrzeug oder Fahrer ist bereits zugewiesen.");
    await assignmentWriter(tx, p);
    const item = await tx.vehicleAssignment.create({
      data: { ...v, organizationId: p.organizationId, createdBy: p.userId },
    });
    await audit(tx, p, "assign", "assignment", item.id);
    return { id: item.id };
  });
}
export async function mutateFleet(
  p: Principal,
  module: string,
  action: string,
  id: string | undefined,
  data: unknown,
) {
  demand(p, module, "write");
  if (
    p.role === "DISPATCHER" &&
    ["drivers", "vehicles"].includes(module) &&
    action !== "update"
  )
    throw new AppError(403, "Diese Aktion ist Administratoren vorbehalten.");
  if (module === "drivers" && action === "reactivate")
    return reactivateDriver(p, id, data);
  if (module === "keys") return mutateKey(p, action, id, data);
  if (module === "categories") return mutateCategory(p, action, id, data);
  const organizationId = p.organizationId;
  if (module === "assignments" && action === "create")
    return assignVehicle(p, data);
  return database().$transaction(async (tx) => {
    if (module === "vehicles") await lockCategories(tx, organizationId);
    let item: { id: string };
    if (module === "drivers") {
      if (action === "create") {
        const v = parse(driverInput, data);
        item = await tx.driverProfile.create({
          data: { ...v, organizationId },
        });
      } else {
        await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${id ?? ""} AND "organizationId"=${organizationId} FOR UPDATE`;
        const old = await tx.driverProfile.findFirst({
          where: { id: id ?? "", organizationId },
        });
        if (!old) throw new AppError(404, "Fahrer nicht gefunden.");
        if (action === "archive") {
          if (
            await tx.waveParticipant.count({
              where: {
                organizationId,
                driverId: old.id,
                wave: { status: "ACTIVE" },
              },
            })
          )
            throw new AppError(
              409,
              "Bitte zuerst die aktive Welle abschließen.",
            );
          if (
            await tx.vehicleKey.count({
              where: { driverId: old.id, location: "DRIVER" },
            })
          )
            throw new AppError(409, "Bitte zuerst die Schlüssel zurückgeben.");
          if (
            await tx.vehicleAssignment.count({
              where: { driverId: old.id, endAt: null },
            })
          )
            throw new AppError(
              409,
              "Bitte zuerst die Fahrzeugzuweisung beenden.",
            );
          item = await tx.driverProfile.update({
            where: { id: old.id },
            data: { status: "INACTIVE" },
          });
          if (old.membershipId) {
            // A historical driver link must not disable a promoted administrator.
            const m = await tx.membership.findUniqueOrThrow({
              where: { id: old.membershipId },
            });
            if (m.role === "DRIVER") {
              await tx.membership.update({
                where: { id: m.id },
                data: { active: false, version: { increment: 1 } },
              });
              await tx.session.deleteMany({ where: { userId: m.userId } });
            }
          }
        } else if (action === "update") {
          const v = parse(driverInput, data);
          if (
            p.role === "DISPATCHER" &&
            (v.firstName !== old.firstName ||
              v.lastName !== old.lastName ||
              v.email !== old.email ||
              v.transporterId !== old.transporterId)
          )
            throw new AppError(
              403,
              "Nur Administratoren können die Fahreridentität ändern.",
            );
          item = await tx.driverProfile.update({
            where: { id: old.id },
            data: v,
          });
        } else throw new AppError(422, "Unbekannte Aktion.");
      }
    } else if (module === "vehicles") {
      if (action === "create") {
        const { keyCount, ...v } = parse(vehicleInput, data);
        item = await tx.vehicle.create({
          data: {
            ...v,
            ...(await vehicleCategories(tx, organizationId, v)),
            organizationId,
            status: v.deFleet ? "INACTIVE" : "ACTIVE",
          },
        });
        await tx.vehicleKey.createMany({
          data: Array.from({ length: keyCount }, (_, i) => ({
            organizationId,
            vehicleId: item.id,
            slot: i + 1,
          })),
        });
        const initialKeys = await tx.vehicleKey.findMany({
          where: { vehicleId: item.id },
        });
        if (initialKeys.length)
          await tx.keyCustody.createMany({
            data: initialKeys.map((key) => ({
              organizationId,
              keyId: key.id,
              location: "OFFICE",
              actorId: p.userId,
              action: "CREATE",
              reason: "Bei Fahrzeuganlage erfasst",
            })),
          });
        await tx.vehicleServicePeriod.create({
          data: {
            organizationId,
            vehicleId: item.id,
            startAt: v.inFleet,
            endAt: v.deFleet,
          },
        });
      } else {
        await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id ?? ""} AND "organizationId"=${organizationId} FOR UPDATE`;
        const old = await requireVehicle(tx, p, id ?? "");
        if (["archive", "reactivate"].includes(action)) {
          if (p.role === "DISPATCHER")
            throw new AppError(
              403,
              "Nur Administratoren können den Flottenstatus ändern.",
            );
          if (action === "archive") {
            if (
              await tx.waveParticipant.count({
                where: {
                  organizationId,
                  vehicleId: old.id,
                  wave: { status: "ACTIVE" },
                },
              })
            )
              throw new AppError(
                409,
                "Bitte zuerst die aktive Welle abschließen.",
              );
            if (old.status !== "ACTIVE")
              throw new AppError(409, "Das Fahrzeug ist bereits inaktiv.");
            if (
              await tx.vehicleAssignment.count({
                where: { vehicleId: old.id, endAt: null },
              })
            )
              throw new AppError(409, "Bitte zuerst die Zuweisung beenden.");
            if (
              await tx.vehicleKey.count({
                where: { vehicleId: old.id, location: "DRIVER" },
              })
            )
              throw new AppError(
                409,
                "Bitte zuerst die Schlüssel zurücknehmen.",
              );
            const now = new Date();
            item = await tx.vehicle.update({
              where: { id: old.id },
              data: { status: "INACTIVE", deFleet: now },
            });
            await tx.vehicleServicePeriod.updateMany({
              where: { vehicleId: old.id, endAt: null },
              data: { endAt: now },
            });
          } else {
            if (old.status !== "INACTIVE")
              throw new AppError(409, "Das Fahrzeug ist bereits aktiv.");
            const now = new Date();
            item = await tx.vehicle.update({
              where: { id: old.id },
              data: { status: "ACTIVE", inFleet: now, deFleet: null },
            });
            await tx.vehicleServicePeriod.create({
              data: { vehicleId: old.id, organizationId, startAt: now },
            });
          }
        } else if (action === "update") {
          const { keyCount, ...v } = parse(vehicleInput, data);
          if (
            v.inFleet.toISOString().slice(0, 10) !==
            old.inFleet.toISOString().slice(0, 10)
          )
            throw new AppError(
              422,
              "Das Flotteneintrittsdatum kann hier nicht verändert werden.",
            );
          const existing = await tx.vehicleKey.count({
            where: { vehicleId: old.id, status: "ACTIVE" },
          });
          if (keyCount !== existing)
            throw new AppError(
              422,
              "Die Schlüsselanzahl wird über die Schlüsselverwaltung gepflegt.",
            );
          if (
            (v.deFleet?.toISOString().slice(0, 10) ?? null) !==
            (old.deFleet?.toISOString().slice(0, 10) ?? null)
          )
            throw new AppError(
              422,
              "Bitte den Flottenstatus über Inaktivieren oder Reaktivieren ändern.",
            );
          item = await tx.vehicle.update({
            where: { id: old.id },
            data: {
              ...v,
              ...(await vehicleCategories(tx, organizationId, v, old)),
            },
          });
        } else throw new AppError(422, "Unbekannte Aktion.");
      }
    } else if (module === "assignments" && action === "close") {
      const initial = await tx.vehicleAssignment.findFirst({
        where: { id: id ?? "", organizationId },
      });
      if (!initial) throw new AppError(404, "Zuweisung nicht gefunden.");
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.vehicleId} AND "organizationId"=${organizationId} FOR UPDATE`;
      await assignmentWriter(tx, p);
      const row = await tx.vehicleAssignment.findFirst({
        where: { id: initial.id, organizationId, endAt: null },
      });
      if (!row)
        throw new AppError(
          409,
          "Die Zuweisung wurde bereits beendet. Bitte neu laden.",
        );
      item = await tx.vehicleAssignment.update({
        where: { id: row.id },
        data: { endAt: new Date(), closedBy: p.userId },
      });
    } else throw new AppError(422, "Diese Aktion wird nicht unterstützt.");
    await audit(tx, p, action, module, item.id);
    return { id: item.id };
  });
}
