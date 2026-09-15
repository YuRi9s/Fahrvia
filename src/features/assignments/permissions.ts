import { AppError, type Principal } from "../../server/policy";
import type { Prisma } from "../../generated/prisma/client";
export async function assignmentWriter(
  tx: Prisma.TransactionClient,
  p: Principal,
) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
  const actor = await tx.membership.findFirst({
    where: { userId: p.userId, organizationId: p.organizationId, active: true },
  });
  if (!actor || !["ADMIN", "SUPER_ADMIN", "DISPATCHER"].includes(actor.role))
    throw new AppError(
      403,
      "Für diese Zuweisung fehlt die aktuelle Berechtigung.",
    );
}
