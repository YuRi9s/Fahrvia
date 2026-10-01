import { database } from "../../server/db";
import { AppError, type Principal } from "../../server/policy";
import { scoreQuery } from "./query";
import { scoreWorkbook } from "./xlsx";
export async function exportScores(p: Principal, params: URLSearchParams) {
  const query = scoreQuery(p, params);
  const db = database();
  const membership = await db.membership.findFirst({
    where: {
      organizationId: p.organizationId,
      userId: p.userId,
      active: true,
      role: p.role,
    },
    include: { driver: { select: { id: true } } },
  });
  if (
    !membership ||
    (p.role === "DRIVER" && membership.driver?.id !== p.driverId)
  )
    throw new AppError(403, "Der Zugang ist nicht mehr aktiv.");
  const rows = await db.driverScore.findMany({
    where: query.where,
    orderBy: query.orderBy,
    take: 5001,
    include: {
      driver: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          transporterId: true,
        },
      },
    },
  });
  return {
    filename: `fahriva-scores-${query.filters.week}.xlsx`,
    bytes: scoreWorkbook(
      rows.map((r) => ({
        driverName: `${r.driver.firstName} ${r.driver.lastName}`,
        transporterId: r.driver.transporterId,
        email: r.driver.email,
        week: r.week,
        totalScore: r.totalScore?.toNumber() ?? null,
        rank: r.rank,
        packages: r.packages,
        bonus: r.bonus?.toNumber() ?? null,
        status: r.status,
        focusArea: r.focusArea,
        metrics: r.metrics as Record<string, unknown>,
      })),
      query.filters,
    ),
  };
}
