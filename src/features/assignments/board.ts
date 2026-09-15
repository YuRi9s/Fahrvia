import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { isoWeek, checkWeek, weekRange } from "../../server/validation";
import {
  berlinDayRange,
  shiftLocalDate,
  weekMonday,
} from "../../lib/berlin-time";
import type { Prisma } from "../../generated/prisma/client";
function staff(p: Principal) {
  demand(p, "assignments", "read");
  if (!["ADMIN", "SUPER_ADMIN", "DISPATCHER"].includes(p.role))
    throw new AppError(
      403,
      "Die Zuweisungsübersicht ist der Verwaltung vorbehalten.",
    );
}
function context(params: URLSearchParams) {
  const week = params.get("week") || isoWeek(new Date());
  checkWeek(week);
  const monday = weekMonday(week);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftLocalDate(monday, i);
    const { start, end } = berlinDayRange(date);
    return { date, start: start.toISOString(), end: end.toISOString() };
  });
  const page = Math.max(
    1,
    Math.min(100000, Math.trunc(Number(params.get("page")) || 1)),
  );
  return { week, days, page };
}
const overlap = (
  start: Date,
  end: Date,
): Prisma.VehicleAssignmentWhereInput => ({
  startAt: { lt: end },
  OR: [{ endAt: null }, { endAt: { gt: start } }],
});
export async function assignmentBoard(
  p: Principal,
  params = new URLSearchParams(),
) {
  staff(p);
  const { week, days, page } = context(params);
  const q = (params.get("q") || "").trim().slice(0, 120);
  const availability = params.get("availability") || "";
  if (!["", "AVAILABLE", "ASSIGNED", "INACTIVE"].includes(availability))
    throw new AppError(422, "Ungültiger Verfügbarkeitsfilter.");
  return database().$transaction(
    async (tx) => {
      const where: Prisma.VehicleWhereInput = {
        organizationId: p.organizationId,
        ...(q ? { plate: { contains: q, mode: "insensitive" } } : {}),
        ...(availability === "AVAILABLE"
          ? { status: "ACTIVE", assignments: { none: { endAt: null } } }
          : availability === "ASSIGNED"
            ? { assignments: { some: { endAt: null } } }
            : availability === "INACTIVE"
              ? { status: "INACTIVE" }
              : {}),
      };
      const rows = await tx.vehicle.findMany({
        where,
        orderBy: [{ plate: "asc" }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 25,
        select: {
          id: true,
          plate: true,
          status: true,
          assignments: {
            where: { endAt: null },
            take: 1,
            select: {
              id: true,
              driver: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });
      const ids = rows.map((row) => row.id);
      const counts = await Promise.all(
        days.map((day) =>
          ids.length
            ? tx.vehicleAssignment.groupBy({
                by: ["vehicleId"],
                where: {
                  organizationId: p.organizationId,
                  vehicleId: { in: ids },
                  ...overlap(new Date(day.start), new Date(day.end)),
                },
                _count: { _all: true },
              })
            : Promise.resolve([]),
        ),
      );
      const [total, availableVehicles, availableDrivers] = await Promise.all([
        tx.vehicle.count({ where }),
        tx.vehicle.count({
          where: {
            organizationId: p.organizationId,
            status: "ACTIVE",
            assignments: { none: { endAt: null } },
          },
        }),
        tx.driverProfile.count({
          where: {
            organizationId: p.organizationId,
            status: "ACTIVE",
            assignments: { none: { endAt: null } },
          },
        }),
      ]);
      return {
        week,
        days,
        page,
        pageSize: 25,
        total,
        asOf: new Date().toISOString(),
        availableVehicles,
        availableDrivers,
        items: rows.map((row) => ({
          id: row.id,
          plate: row.plate,
          status: row.status,
          availableNow: row.status === "ACTIVE" && !row.assignments.length,
          currentAssignmentId: row.assignments[0]?.id ?? null,
          currentDriverName: row.assignments[0]
            ? `${row.assignments[0].driver.firstName} ${row.assignments[0].driver.lastName}`
            : null,
          days: days.map((day, i) => ({
            date: day.date,
            count:
              counts[i].find((count) => count.vehicleId === row.id)?._count
                ._all ?? 0,
          })),
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000 },
  );
}
export type AssignmentBoardData = Awaited<ReturnType<typeof assignmentBoard>>;
export async function assignmentDetails(p: Principal, params: URLSearchParams) {
  staff(p);
  const { week, days, page } = context(params);
  const vehicleId = (params.get("vehicleId") || "").slice(0, 200);
  const vehicle = await database().vehicle.findFirst({
    where: { id: vehicleId, organizationId: p.organizationId },
    select: { id: true, plate: true },
  });
  if (!vehicle) throw new AppError(404, "Fahrzeug nicht gefunden.");
  const date = params.get("date");
  if (date && !days.some((day) => day.date === date))
    throw new AppError(
      422,
      "Der Tag gehört nicht zur ausgewählten Kalenderwoche.",
    );
  const range = date ? berlinDayRange(date) : weekRange(week);
  const where = {
    organizationId: p.organizationId,
    vehicleId,
    ...overlap(range.start, range.end),
  };
  return database().$transaction(
    async (tx) => {
      const items = await tx.vehicleAssignment.findMany({
        where,
        orderBy: [{ startAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 25,
        take: 25,
        select: {
          id: true,
          startAt: true,
          endAt: true,
          driver: { select: { firstName: true, lastName: true } },
        },
      });
      return {
        vehicle,
        week,
        date,
        page,
        pageSize: 25,
        total: await tx.vehicleAssignment.count({ where }),
        items: items.map(({ driver, ...row }) => ({
          ...row,
          driverName: `${driver.firstName} ${driver.lastName}`,
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export type AssignmentDetailData = Awaited<
  ReturnType<typeof assignmentDetails>
>;
