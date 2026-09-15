import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { checkWeek } from "../../server/validation";
import { audit, requireDriver } from "../fleet/service";
import { parseDelivery, deliveryScope } from "./validation";

export async function listDelivery(p: Principal, params: URLSearchParams) {
  const scope = deliveryScope(p, params.get("driverId") || undefined);
  const week = checkWeek(params.get("week") || "");
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(params.get("page") || "1", 10) || 1),
  );
  const kind = params.get("kind");
  if (kind && kind !== "PHR" && kind !== "CONCESSION")
    throw new AppError(422, "Ungültige Detailart.");
  const where = { ...scope, week, isCurrent: true, ...(kind ? { kind } : {}) };
  const [items, total] = await Promise.all([
    database().deliveryDetail.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      skip: (page - 1) * 50,
      take: 50,
    }),
    database().deliveryDetail.count({ where }),
  ]);
  return {
    items: items.map((item) => ({ ...item, createdBy: undefined })),
    total,
    page,
    pageSize: 50,
  };
}

/** Lock the source revision before appending a correction; stale editors get a conflict. */
export async function saveDelivery(
  p: Principal,
  action: unknown,
  id: unknown,
  data: unknown,
) {
  demand(p, "score-imports", "write");
  if (action !== "create" && action !== "update")
    throw new AppError(422, "Ungültige Aktion.");
  if (action === "update" && (typeof id !== "string" || !id || id.length > 100))
    throw new AppError(422, "Ungültiger Eintrag.");
  const value = parseDelivery(data);
  if (action === "update" && !value.correctionReason)
    throw new AppError(422, "Bitte den Grund der Korrektur angeben.");
  return database().$transaction(async (tx) => {
    const memberships = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} AND active=true AND role IN ('ADMIN','SUPER_ADMIN') FOR SHARE`;
    if (!memberships.length)
      throw new AppError(
        403,
        "Der Administrationszugang ist nicht mehr aktiv.",
      );
    await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${value.driverId} AND "organizationId"=${p.organizationId} FOR SHARE`;
    await requireDriver(tx, p, value.driverId);
    let previousId: string | null = null;
    let revision = 1;
    if (action === "update") {
      const currentId = id as string;
      await tx.$queryRaw`SELECT id FROM "DeliveryDetail" WHERE id=${currentId} AND "organizationId"=${p.organizationId} FOR UPDATE`;
      const current = await tx.deliveryDetail.findFirst({
        where: { id: currentId, organizationId: p.organizationId },
      });
      if (!current)
        throw new AppError(404, "Der Eintrag wurde nicht gefunden.");
      if (!current.isCurrent)
        throw new AppError(
          409,
          "Der Eintrag wurde bereits korrigiert. Bitte neu laden.",
        );
      if (current.driverId !== value.driverId || current.kind !== value.kind)
        throw new AppError(
          422,
          "Fahrer und Detailart können bei einer Korrektur nicht geändert werden.",
        );
      await tx.deliveryDetail.update({
        where: { id: currentId },
        data: { isCurrent: false },
      });
      previousId = current.id;
      revision = current.revision + 1;
    }
    const item = await tx.deliveryDetail.create({
      data: {
        ...value,
        organizationId: p.organizationId,
        sourceMethod: "MANUAL",
        createdBy: p.userId,
        previousId,
        revision,
      },
    });
    await audit(
      tx,
      p,
      action === "create" ? "create" : "correct",
      "delivery-detail",
      item.id,
    );
    return {
      ok: true,
      item: { id: item.id, revision: item.revision, week: item.week },
    };
  });
}
