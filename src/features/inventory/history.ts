import { Prisma } from "../../generated/prisma/client";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { checkWeek, weekRange } from "../../server/validation";
export type InventoryMovementRow = {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  type: string;
  quantity: number;
  reason: string;
  createdAt: Date;
  actor: string;
  recipient: string | null;
  custodyId: string | null;
};
export async function inventoryMovements(
  p: Principal,
  params = new URLSearchParams(),
) {
  demand(p, "inventory", "read");
  const itemId = params.get("itemId") || "";
  const type = params.get("type") || "";
  const week = params.get("week") || "";
  const q = (params.get("q") || "").trim().slice(0, 120);
  if (type && !["ADJUST", "ISSUE", "RETURN"].includes(type))
    throw new AppError(422, "Ungültiger Bewegungstyp.");
  if (week) checkWeek(week);
  const range = week ? weekRange(week) : null;
  const page = Math.max(
    1,
    Math.min(100000, Math.trunc(Number(params.get("page")) || 1)),
  );
  return database().$transaction(
    async (tx) => {
      const item = itemId
        ? await tx.inventoryItem.findFirst({
            where: { id: itemId, organizationId: p.organizationId },
            select: { id: true, name: true, sku: true, stock: true },
          })
        : null;
      if (itemId && !item) throw new AppError(404, "Inventar nicht gefunden.");
      const base = Prisma.sql`FROM "InventoryMovement" m JOIN "InventoryItem" i ON i.id=m."itemId"
   LEFT JOIN "InventoryCustody" c ON c.id=m."custodyId" AND c."itemId"=i.id AND c."organizationId"=i."organizationId"
   LEFT JOIN "DriverProfile" d ON d.id=c."driverId" AND d."organizationId"=i."organizationId"
   LEFT JOIN "Vehicle" v ON v.id=c."vehicleId" AND v."organizationId"=i."organizationId"
   LEFT JOIN "User" u ON u.id=m."actorId" AND EXISTS(SELECT 1 FROM "Membership" member WHERE member."userId"=u.id AND member."organizationId"=i."organizationId")`;
      const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const filter = Prisma.sql`WHERE i."organizationId"=${p.organizationId}
    ${itemId ? Prisma.sql`AND i.id=${itemId}` : Prisma.empty}
    ${type ? Prisma.sql`AND m.type=${type}` : Prisma.empty}
    ${range ? Prisma.sql`AND m."createdAt">=${range.start} AND m."createdAt"<${range.end}` : Prisma.empty}
    ${q ? Prisma.sql`AND (i.name ILIKE ${search} OR i.sku ILIKE ${search} OR m.reason ILIKE ${search} OR u.name ILIKE ${search} OR (d."firstName" || ' ' || d."lastName") ILIKE ${search} OR v.plate ILIKE ${search})` : Prisma.empty}`;
      const items = await tx.$queryRaw<InventoryMovementRow[]>(
        Prisma.sql`SELECT m.id,m."itemId",i.name AS "itemName",i.sku,m.type,m.quantity,m.reason,m."createdAt",COALESCE(u.name,'Nicht mehr verfügbar') AS actor,COALESCE(d."firstName" || ' ' || d."lastName",v.plate) AS recipient,m."custodyId" ${base} ${filter} ORDER BY m."createdAt" DESC,m.id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      );
      const totals = await tx.$queryRaw<
        { total: number; increase: string; decrease: string; net: string }[]
      >(
        Prisma.sql`SELECT COUNT(*)::int AS total,COALESCE(SUM(CASE WHEN m.quantity>0 THEN m.quantity::bigint ELSE 0 END),0)::text AS increase,COALESCE(SUM(CASE WHEN m.quantity<0 THEN -m.quantity::bigint ELSE 0 END),0)::text AS decrease,COALESCE(SUM(m.quantity::bigint),0)::text AS net ${base} ${filter}`,
      );
      return { item, items, ...totals[0], page, pageSize: 25 };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000 },
  );
}
export type InventoryMovementData = Awaited<
  ReturnType<typeof inventoryMovements>
>;
