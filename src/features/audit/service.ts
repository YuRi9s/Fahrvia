import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { berlinDayRange } from "../../lib/berlin-time";

/** Avoid exposing credentials accidentally added to historical event metadata. */
export function safeDetails(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[gekürzt]";
  if (Array.isArray(value))
    return value.slice(0, 100).map((v) => safeDetails(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([k, v]) => [
          k,
          /password|secret|token|cookie|authorization|credential|recovery|email|phone/i.test(
            k,
          )
            ? "[geschützt]"
            : safeDetails(v, depth + 1),
        ]),
    );
  return typeof value === "string" ? value.slice(0, 2000) : value;
}
export async function investigate(p: Principal, params: URLSearchParams) {
  demand(p, "audit", "read");
  const db = database();
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
      const actor = await tx.membership.findFirst({
        where: {
          userId: p.userId,
          organizationId: p.organizationId,
          active: true,
        },
      });
      if (!actor || !["ADMIN", "SUPER_ADMIN"].includes(actor.role))
        throw new AppError(403, "Für diese Ansicht fehlt die Berechtigung.");
      const source = params.get("source") || "audit";
      if (!["audit", "security"].includes(source))
        throw new AppError(400, "Ungültige Ereignisquelle.");
      const text = (key: string) => {
        const v = (params.get(key) || "").trim();
        if (v.length > 200) throw new AppError(400, "Der Filter ist zu lang.");
        return v;
      };
      let start: Date | undefined, end: Date | undefined;
      try {
        if (text("from")) start = berlinDayRange(text("from")).start;
        if (text("to")) end = berlinDayRange(text("to")).end;
      } catch {
        throw new AppError(400, "Bitte ein gültiges Datum wählen.");
      }
      if (start && end && start >= end)
        throw new AppError(400, "Der Zeitraum ist ungültig.");
      const rawPage = params.get("page") || "1";
      if (!/^\d+$/.test(rawPage) || +rawPage < 1 || +rawPage > 100000)
        throw new AppError(400, "Ungültige Seite.");
      const page = +rawPage,
        pageSize = 25;
      const actorId = text("actor"),
        action = text("action"),
        resourceId = text("record"),
        requestId = text("request");
      const common = {
        organizationId: p.organizationId,
        ...(actorId ? { actorId } : {}),
        createdAt: {
          ...(start ? { gte: start } : {}),
          ...(end ? { lt: end } : {}),
        },
      };
      const auditWhere = {
        ...common,
        ...(action ? { action } : {}),
        ...(resourceId ? { resourceId } : {}),
      };
      const securityWhere = {
        ...common,
        ...(action ? { kind: action } : {}),
        ...(resourceId ? { resourceId } : {}),
        ...(requestId ? { requestId } : {}),
      };
      if (source === "audit" && requestId)
        throw new AppError(
          400,
          "Anfrage-ID ist nur für Sicherheitsereignisse verfügbar.",
        );
      const options = {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      };
      const total =
        source === "audit"
          ? await tx.auditLog.count({ where: auditWhere })
          : await tx.securityEvent.count({ where: securityWhere });
      const rows =
        source === "audit"
          ? await tx.auditLog.findMany({ where: auditWhere, ...options })
          : await tx.securityEvent.findMany({
              where: securityWhere,
              ...options,
            });
      const ids = [
        ...new Set(
          rows.map((r) => r.actorId).filter((id): id is string => !!id),
        ),
      ];
      const members = await tx.membership.findMany({
        where: { organizationId: p.organizationId, userId: { in: ids } },
        select: { userId: true, user: { select: { name: true } } },
      });
      const names = new Map(members.map((m) => [m.userId, m.user.name]));
      return {
        items: rows.map((r) => ({
          ...r,
          actorName:
            names.get(r.actorId || "") || "Unbekannt / ehemaliges Konto",
          details: safeDetails(r.details),
        })),
        total,
        page,
        pageSize,
        source,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
