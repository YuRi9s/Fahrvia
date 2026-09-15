import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
const input = z
  .object({
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export async function reactivateDriver(
  p: Principal,
  id: string | undefined,
  data: unknown,
) {
  demand(p, "drivers", "write");
  if (!["ADMIN", "SUPER_ADMIN"].includes(p.role))
    throw new AppError(403, "Diese Aktion ist Administratoren vorbehalten.");
  const values = parse(input, data);
  return database().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${id ?? ""} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    const old = await tx.driverProfile.findFirst({
      where: { id: id ?? "", organizationId: p.organizationId },
    });
    if (!old) throw new AppError(404, "Fahrer nicht gefunden.");
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
    const actor = await tx.membership.findFirst({
      where: {
        userId: p.userId,
        organizationId: p.organizationId,
        active: true,
      },
    });
    if (!actor || !["ADMIN", "SUPER_ADMIN"].includes(actor.role))
      throw new AppError(
        403,
        "Ein aktiver berechtigter Administrator ist erforderlich.",
      );
    if (
      old.updatedAt.getTime() !== new Date(values.expectedUpdatedAt).getTime()
    )
      throw new AppError(
        409,
        "Das Fahrerprofil wurde inzwischen geändert. Bitte neu laden und erneut prüfen.",
      );
    if (old.status !== "INACTIVE")
      throw new AppError(
        409,
        "Nur archivierte Fahrer können reaktiviert werden.",
      );
    // Preserve the record and all relationships. Account restoration is a separate audited operation.
    await tx.driverProfile.update({
      where: { id: old.id },
      data: { status: "ACTIVE" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: "reactivate",
        resourceType: "drivers",
        resourceId: old.id,
        details: {
          before: old.status,
          after: "ACTIVE",
          reason: values.reason,
          accountAccessChanged: false,
        },
      },
    });
    return { id: old.id };
  });
}
