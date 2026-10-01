import { AppError, demand, type Principal } from "../../server/policy";
import { checkWeek, isoWeek } from "../../server/validation";
import { parseListOptions } from "../../server/list-options";
/** Shared by screen and export: user-supplied driver/organization parameters never widen scope. */
export function scoreQuery(p: Principal, params: URLSearchParams) {
  demand(p, "score", "read");
  const options = parseListOptions("score", params)!;
  const week = checkWeek(params.get("week") ?? isoWeek(new Date()));
  const q = (params.get("q") ?? "").slice(0, 120),
    status = params.get("status") || "";
  if (p.role === "DRIVER" && !p.driverId)
    throw new AppError(403, "Fahrerzuordnung fehlt.");
  const where = {
    organizationId: p.organizationId,
    week,
    ...(status ? { status } : {}),
    source: { status: "COMMITTED", organizationId: p.organizationId },
    ...(p.role === "DRIVER" ? { driverId: p.driverId! } : {}),
    ...(q
      ? {
          driver: {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
  return {
    where,
    orderBy: options.orderBy,
    filters: { week, q, status, sort: options.sort, dir: options.dir },
  };
}
