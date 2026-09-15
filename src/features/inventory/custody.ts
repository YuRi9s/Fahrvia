import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
import { inventoryWriter } from "./permissions";
import { evaluateStockAlert } from "./alerts";
const quantity = z.number().int().min(1).max(1000000);
const reason = z.string().trim().min(1).max(500);
const issueInput = z
  .object({
    requestId: z.uuid(),
    quantity,
    reason,
    driverId: z.string().min(1).max(200).optional(),
    vehicleId: z.string().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.driverId) !== Boolean(v.vehicleId));
const returnInput = z.object({
  quantity,
  reason,
  expectedVersion: z.number().int().positive(),
});
export async function issueInventory(
  p: Principal,
  itemId: string,
  data: unknown,
) {
  demand(p, "inventory", "write");
  const v = parse(issueInput, data);
  const organizationId = p.organizationId;
  return database().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${itemId} AND "organizationId"=${organizationId} FOR UPDATE`;
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, organizationId },
      });
      if (!item) throw new AppError(404, "Inventar nicht gefunden.");
      if (v.vehicleId)
        await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${v.vehicleId} AND "organizationId"=${organizationId} FOR UPDATE`;
      if (v.driverId)
        await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${v.driverId} AND "organizationId"=${organizationId} FOR UPDATE`;
      await inventoryWriter(tx, p);
      const replay = await tx.inventoryCustody.findUnique({
        where: {
          organizationId_requestId: { organizationId, requestId: v.requestId },
        },
      });
      if (replay) {
        if (
          replay.itemId !== itemId ||
          replay.driverId !== (v.driverId ?? null) ||
          replay.vehicleId !== (v.vehicleId ?? null) ||
          replay.quantity !== v.quantity ||
          replay.reason !== v.reason ||
          replay.issuedBy !== p.userId
        )
          throw new AppError(
            409,
            "Diese Anfrage wurde bereits mit anderen Angaben gespeichert. Bitte den Bestand aktualisieren.",
          );
        return { id: replay.id };
      }
      const holder = v.driverId
        ? await tx.driverProfile.findFirst({
            where: { id: v.driverId, organizationId, status: "ACTIVE" },
          })
        : await tx.vehicle.findFirst({
            where: { id: v.vehicleId!, organizationId, status: "ACTIVE" },
          });
      if (!holder)
        throw new AppError(
          409,
          "Empfänger muss ein aktiver Fahrer oder ein aktives Fahrzeug dieser Organisation sein.",
        );
      if (item.stock < v.quantity)
        throw new AppError(409, "Der verfügbare Bestand reicht nicht aus.");
      const loan = await tx.inventoryCustody.create({
        data: { ...v, itemId, organizationId, issuedBy: p.userId },
      });
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { stock: { decrement: v.quantity } },
      });
      await tx.inventoryMovement.create({
        data: {
          itemId,
          custodyId: loan.id,
          type: "ISSUE",
          quantity: -v.quantity,
          reason: v.reason,
          actorId: p.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: p.userId,
          action: "issue",
          resourceType: "inventory",
          resourceId: itemId,
          details: {
            custodyId: loan.id,
            quantity: v.quantity,
            driverId: v.driverId ?? null,
            vehicleId: v.vehicleId ?? null,
          },
        },
      });
      await evaluateStockAlert(tx, itemId, organizationId);
      return { id: loan.id };
    },
    { timeout: 10000 },
  );
}
export async function returnInventory(p: Principal, id: string, data: unknown) {
  demand(p, "inventory", "write");
  const v = parse(returnInput, data);
  const organizationId = p.organizationId;
  return database().$transaction(
    async (tx) => {
      const initial = await tx.inventoryCustody.findFirst({
        where: { id, organizationId },
        select: { itemId: true },
      });
      if (!initial) throw new AppError(404, "Ausgabe nicht gefunden.");
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${initial.itemId} AND "organizationId"=${organizationId} FOR UPDATE`;
      await inventoryWriter(tx, p);
      const loan = await tx.inventoryCustody.findFirstOrThrow({
        where: { id, organizationId },
      });
      if (loan.version !== v.expectedVersion)
        throw new AppError(
          409,
          "Diese Ausgabe wurde geändert. Bitte aktualisieren und erneut prüfen.",
        );
      if (v.quantity > loan.quantity - loan.returned)
        throw new AppError(
          409,
          "Die Rückgabe übersteigt die noch ausgegebene Menge.",
        );
      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: loan.itemId },
      });
      if (item.stock + v.quantity > 2147483647)
        throw new AppError(
          409,
          "Der Bestand würde den unterstützten Höchstwert überschreiten.",
        );
      await tx.inventoryCustody.update({
        where: { id },
        data: {
          returned: { increment: v.quantity },
          version: { increment: 1 },
        },
      });
      await tx.inventoryItem.update({
        where: { id: loan.itemId },
        data: { stock: { increment: v.quantity } },
      });
      await tx.inventoryMovement.create({
        data: {
          itemId: loan.itemId,
          custodyId: id,
          type: "RETURN",
          quantity: v.quantity,
          reason: v.reason,
          actorId: p.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: p.userId,
          action: "return",
          resourceType: "inventory",
          resourceId: loan.itemId,
          details: {
            custodyId: id,
            quantity: v.quantity,
            version: loan.version + 1,
          },
        },
      });
      await evaluateStockAlert(tx, loan.itemId, organizationId);
      return { id };
    },
    { timeout: 10000 },
  );
}
export async function inventoryCustody(p: Principal, params: URLSearchParams) {
  demand(p, "inventory", "read");
  const organizationId = p.organizationId;
  const itemId = params.get("itemId") || "";
  const status = params.get("status") || "OPEN";
  if (!["OPEN", "CLOSED", "ALL"].includes(status))
    throw new AppError(422, "Ungültiger Filter.");
  const page = Math.max(
    1,
    Math.min(100000, Math.trunc(Number(params.get("page")) || 1)),
  );
  return database().$transaction(
    async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, organizationId },
        select: { id: true, name: true, sku: true, stock: true },
      });
      if (!item) throw new AppError(404, "Inventar nicht gefunden.");
      const where = {
        itemId,
        organizationId,
        ...(status === "OPEN"
          ? { returned: { lt: tx.inventoryCustody.fields.quantity } }
          : status === "CLOSED"
            ? { returned: { equals: tx.inventoryCustody.fields.quantity } }
            : {}),
      };
      const items = await tx.inventoryCustody.findMany({
        where,
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 25,
        take: 25,
        include: {
          driver: { select: { firstName: true, lastName: true } },
          vehicle: { select: { plate: true } },
        },
      });
      const totals = await tx.inventoryCustody.aggregate({
        where: { itemId, organizationId },
        _sum: { quantity: true, returned: true },
      });
      return {
        item,
        issued: (totals._sum.quantity ?? 0) - (totals._sum.returned ?? 0),
        page,
        pageSize: 25,
        total: await tx.inventoryCustody.count({ where }),
        items: items.map((row) => ({
          id: row.id,
          holder: row.driver
            ? `${row.driver.firstName} ${row.driver.lastName}`
            : row.vehicle!.plate,
          holderType: row.driverId ? "DRIVER" : "VEHICLE",
          quantity: row.quantity,
          returned: row.returned,
          remaining: row.quantity - row.returned,
          version: row.version,
          issuedAt: row.issuedAt.toISOString(),
          reason: row.reason,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000 },
  );
}
export type InventoryCustodyData = Awaited<ReturnType<typeof inventoryCustody>>;
