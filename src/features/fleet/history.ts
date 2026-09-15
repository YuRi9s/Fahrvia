import { Prisma } from "../../generated/prisma/client";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { checkWeek, weekRange } from "../../server/validation";

export type HistoryEvent = {
  id: string;
  at: Date;
  type: string;
  action: string;
  detail: string;
};
export async function recordHistory(
  p: Principal,
  module: string,
  id: string,
  params = new URLSearchParams(),
) {
  if (!["drivers", "vehicles"].includes(module))
    throw new AppError(404, "Bereich nicht gefunden.");
  demand(p, module, "read");
  const own = p.role === "DRIVER";
  if (own && (module !== "drivers" || id !== p.driverId))
    throw new AppError(404, "Eintrag nicht gefunden.");
  const type = params.get("type") || "";
  const types = own
    ? ["ASSIGNMENT"]
    : [
        "ASSIGNMENT",
        "DOCUMENT",
        "KEY",
        "LIFECYCLE",
        ...(module === "vehicles" ? ["PHOTO"] : []),
      ];
  if (type && !types.includes(type))
    throw new AppError(422, "Ungültiger Verlaufstyp.");
  const week = params.get("week") || "";
  if (week) checkWeek(week);
  const range = week ? weekRange(week) : null;
  const page = Math.max(
    1,
    Math.min(100000, Math.trunc(Number(params.get("page")) || 1)),
  );
  return database().$transaction(
    async (tx) => {
      const where = { id, organizationId: p.organizationId };
      const vehicle =
        module === "vehicles"
          ? await tx.vehicle.findFirst({
              where,
              select: {
                plate: true,
                vin: true,
                brand: true,
                model: true,
                year: true,
                status: true,
                ownership: true,
                provider: true,
                inFleet: true,
                deFleet: true,
              },
            })
          : null;
      const driver =
        module === "drivers"
          ? await tx.driverProfile.findFirst({
              where,
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                status: true,
                transporterId: true,
              },
            })
          : null;
      if (!vehicle && !driver)
        throw new AppError(404, "Eintrag nicht gefunden.");
      const record = {
        title: vehicle?.plate || `${driver!.firstName} ${driver!.lastName}`,
        fields: vehicle || driver!,
      };
      const assignmentScope =
        module === "vehicles"
          ? Prisma.sql`a."vehicleId"=${id}`
          : Prisma.sql`a."driverId"=${id}`;
      const assignmentName =
        module === "vehicles"
          ? Prisma.sql`d."firstName" || ' ' || d."lastName"`
          : Prisma.sql`v.plate`;
      const assignmentFrom = Prisma.sql`FROM "VehicleAssignment" a JOIN "Vehicle" v ON v.id=a."vehicleId" AND v."organizationId"=a."organizationId" JOIN "DriverProfile" d ON d.id=a."driverId" AND d."organizationId"=a."organizationId" WHERE a."organizationId"=${p.organizationId} AND ${assignmentScope}`;
      const sources = [
        Prisma.sql`SELECT 'assign:' || a.id AS id, a."startAt" AS at, 'ASSIGNMENT'::text AS type, 'ASSIGN'::text AS action, ${assignmentName} AS detail ${assignmentFrom}`,
        Prisma.sql`SELECT 'return:' || a.id AS id, a."endAt" AS at, 'ASSIGNMENT'::text AS type, 'RETURN'::text AS action, ${assignmentName} AS detail ${assignmentFrom} AND a."endAt" IS NOT NULL`,
      ];
      if (!own) {
        const documentScope =
          module === "vehicles"
            ? Prisma.sql`d."vehicleId"=${id}`
            : Prisma.sql`d."driverId"=${id}`;
        sources.push(
          Prisma.sql`SELECT 'document:' || d.id, d."createdAt", 'DOCUMENT', CASE WHEN d."replacesId" IS NULL THEN 'DOCUMENT_ADDED' ELSE 'DOCUMENT_RENEWED' END, d.title FROM "Document" d WHERE d."organizationId"=${p.organizationId} AND ${documentScope}`,
        );
        const keyScope =
          module === "vehicles"
            ? Prisma.sql`k."vehicleId"=${id}`
            : Prisma.sql`c."driverId"=${id}`;
        sources.push(
          Prisma.sql`SELECT 'key:' || c.id, c."createdAt", 'KEY', c.action, 'Schlüssel ' || k.slot::text || ' · ' || v.plate || ' · ' || c.location || CASE WHEN c.reason='' THEN '' ELSE ' · ' || c.reason END FROM "KeyCustody" c JOIN "VehicleKey" k ON k.id=c."keyId" AND k."organizationId"=c."organizationId" JOIN "Vehicle" v ON v.id=k."vehicleId" AND v."organizationId"=k."organizationId" WHERE c."organizationId"=${p.organizationId} AND ${keyScope}`,
        );
        sources.push(
          Prisma.sql`SELECT 'lifecycle:' || id, "createdAt", 'LIFECYCLE', action, '' FROM "AuditLog" WHERE "organizationId"=${p.organizationId} AND "resourceType"=${module} AND "resourceId"=${id} AND action IN ('create','update','archive','reactivate')`,
        );
        if (module === "vehicles") {
          sources.push(
            Prisma.sql`SELECT 'photo:' || id, "createdAt", 'PHOTO', CASE WHEN damage THEN 'DAMAGE_REPORTED' ELSE 'PHOTO_ADDED' END, notes FROM "VehiclePhotoReport" WHERE "organizationId"=${p.organizationId} AND "vehicleId"=${id}`,
          );
          sources.push(
            Prisma.sql`SELECT 'resolved:' || id, "resolvedAt", 'PHOTO', 'DAMAGE_RESOLVED', notes FROM "VehiclePhotoReport" WHERE "organizationId"=${p.organizationId} AND "vehicleId"=${id} AND "resolvedAt" IS NOT NULL`,
          );
        }
      }
      const stream = Prisma.sql`WITH events AS (${Prisma.join(sources, " UNION ALL ")})`;
      const filter = Prisma.sql`WHERE ${type ? Prisma.sql`type=${type}` : Prisma.sql`TRUE`} ${range ? Prisma.sql`AND at>=${range.start} AND at<${range.end}` : Prisma.empty}`;
      const items = await tx.$queryRaw<HistoryEvent[]>(
        Prisma.sql`${stream} SELECT * FROM events ${filter} ORDER BY at DESC, id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      );
      const count = await tx.$queryRaw<{ total: number }[]>(
        Prisma.sql`${stream} SELECT COUNT(*)::int AS total FROM events ${filter}`,
      );
      return {
        record,
        types,
        items,
        total: count[0].total,
        page,
        pageSize: 25,
        week,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000 },
  );
}
export type RecordHistoryData = Awaited<ReturnType<typeof recordHistory>>;
