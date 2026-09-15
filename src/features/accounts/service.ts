import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
import type { Prisma } from "../../generated/prisma/client";
const inputSchema = z
  .object({
    id: z.string().min(1).max(200),
    version: z.number().int().positive(),
    role: z.enum(["ADMIN", "DISPATCHER", "DRIVER"]),
    active: z.boolean(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
async function liveActor(tx: Prisma.TransactionClient, p: Principal) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
  const actor = await tx.membership.findFirst({
    where: { userId: p.userId, organizationId: p.organizationId, active: true },
  });
  if (!actor || !["SUPER_ADMIN", "ADMIN"].includes(actor.role))
    throw new AppError(
      403,
      "Für diese Aktion fehlt ein aktiver berechtigter Administrator.",
    );
  return actor;
}
export async function listAccounts(
  p: Principal,
  params = new URLSearchParams(),
) {
  demand(p, "accounts", "read");
  const page = Math.max(
    1,
    Math.min(100000, Math.trunc(Number(params.get("page")) || 1)),
  );
  const q = (params.get("q") || "").trim().slice(0, 120);
  const status = params.get("status");
  return database().$transaction(async (tx) => {
    await liveActor(tx, p);
    const where: Prisma.MembershipWhereInput = {
      organizationId: p.organizationId,
      ...(status === "active"
        ? { active: true }
        : status === "disabled"
          ? { active: false }
          : {}),
      ...(q
        ? {
            user: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const items = await tx.membership.findMany({
      where,
      orderBy: { id: "asc" },
      skip: (page - 1) * 25,
      take: 25,
      select: {
        id: true,
        userId: true,
        role: true,
        active: true,
        version: true,
        user: { select: { name: true, email: true, twoFactorEnabled: true } },
        driver: { select: { id: true, status: true } },
      },
    });
    return {
      items: items.map(({ user, driver, ...row }) => ({
        ...row,
        ...user,
        driverId: driver?.id ?? null,
        driverStatus: driver?.status ?? null,
      })),
      total: await tx.membership.count({ where }),
      page,
      pageSize: 25,
    };
  });
}
export async function changeAccount(p: Principal, data: unknown) {
  demand(p, "accounts", "write");
  const input = parse(inputSchema, data);
  return database().$transaction(async (tx) => {
    // Lock the target user across organizations, then driver before membership (same order as archive).
    const target = await tx.membership.findFirst({
      where: { id: input.id, organizationId: p.organizationId },
    });
    if (!target) throw new AppError(404, "Benutzerkonto nicht gefunden.");
    if (target.role === "SUPER_ADMIN")
      throw new AppError(403, "Superadministratoren sind geschützt.");
    if (target.userId === p.userId)
      throw new AppError(
        403,
        "Das eigene Konto kann hier nicht geändert werden.",
      );
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE "membershipId"=${target.id} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    const actor = await liveActor(tx, p);
    await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${target.id} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    const old = await tx.membership.findUniqueOrThrow({
      where: { id: target.id },
      include: { driver: true },
    });
    if (
      old.role === "SUPER_ADMIN" ||
      (actor.role !== "SUPER_ADMIN" &&
        (old.role === "ADMIN" || input.role === "ADMIN"))
    )
      throw new AppError(
        403,
        "Administratorkonten dürfen nur vom Superadministrator verwaltet werden. Superadministratoren sind geschützt.",
      );
    if (old.version !== input.version)
      throw new AppError(
        409,
        "Das Konto wurde inzwischen geändert. Bitte neu laden und erneut prüfen.",
      );
    if (old.role === input.role && old.active === input.active)
      throw new AppError(422, "Keine Änderung ausgewählt.");
    if (
      input.active &&
      input.role === "DRIVER" &&
      old.driver?.status !== "ACTIVE"
    )
      throw new AppError(
        409,
        "Für den Fahrerzugang ist ein verknüpftes aktives Fahrerprofil erforderlich. Archivierte Fahrer müssen zuerst reaktiviert werden.",
      );
    if (input.role === "DRIVER" && !old.driver)
      throw new AppError(409, "Ein verknüpftes Fahrerprofil ist erforderlich.");
    if (
      input.active &&
      (await tx.membership.count({
        where: { userId: old.userId, active: true, id: { not: old.id } },
      }))
    )
      throw new AppError(
        409,
        "Dieses Konto ist bereits in einer anderen Organisation aktiv.",
      );
    // Protected super-administrators and forbidden self changes keep a live administrator in place.
    const updated = await tx.membership.update({
      where: { id: old.id },
      data: {
        role: input.role,
        active: input.active,
        version: { increment: 1 },
      },
    });
    const sessions = await tx.session.deleteMany({
      where: { userId: old.userId },
    });
    await tx.auditLog.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        action: "account-change",
        resourceType: "membership",
        resourceId: old.id,
        details: {
          before: { role: old.role, active: old.active, version: old.version },
          after: {
            role: updated.role,
            active: updated.active,
            version: updated.version,
          },
          reason: input.reason,
          revokedSessions: sessions.count,
        },
      },
    });
    await tx.securityEvent.create({
      data: {
        organizationId: p.organizationId,
        actorId: p.userId,
        kind: "account-access-changed",
        requestId: crypto.randomUUID(),
        resourceId: old.id,
        details: {
          before: { role: old.role, active: old.active },
          after: { role: updated.role, active: updated.active },
          revokedSessions: sessions.count,
        },
      },
    });
    return {
      id: updated.id,
      version: updated.version,
      role: updated.role,
      active: updated.active,
    };
  });
}
