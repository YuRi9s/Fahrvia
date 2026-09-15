import { AppError, type Principal } from "../../server/policy";
import type { Prisma } from "../../generated/prisma/client";
export async function inventoryWriter(
  tx: Prisma.TransactionClient,
  p: Principal,
) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
  if (
    !(await tx.membership.findFirst({
      where: {
        userId: p.userId,
        organizationId: p.organizationId,
        active: true,
        role: { in: ["ADMIN", "SUPER_ADMIN", "DISPATCHER"] },
      },
    }))
  )
    throw new AppError(
      403,
      "Die aktuelle Berechtigung für Inventaränderungen fehlt.",
    );
}
