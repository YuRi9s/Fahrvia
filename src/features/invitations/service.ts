import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
import type { Invitation, Prisma } from "../../generated/prisma/client";
import { deliverInvitation, invitationTransport } from "./transport";
type Tx = Prisma.TransactionClient;
const invalid = () =>
  new AppError(
    410,
    "Diese Einladung ist ungültig, abgelaufen oder nicht mehr verfügbar. Bitte eine neue Einladung anfordern.",
  );
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const tokenInput = z.string().regex(/^[a-f0-9]{64}$/);
const createInput = z.object({
  role: z.enum(["ADMIN", "DISPATCHER", "DRIVER"]),
  driverId: z.string().min(1).max(200).optional(),
  email: z.email().max(200).optional(),
  name: z.string().trim().min(1).max(160).optional(),
});
function publicRow(row: Invitation) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    driverId: row.driverId,
    status:
      row.status === "PENDING" && row.expiresAt <= new Date()
        ? "EXPIRED"
        : row.status,
    delivery: row.delivery,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastSentAt: row.lastSentAt,
  };
}
async function liveAdmin(
  tx: Tx,
  userId: string,
  organizationId: string,
  targetRole: string,
) {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${userId} AND "organizationId"=${organizationId} FOR SHARE`;
  const membership = await tx.membership.findFirst({
    where: { userId, organizationId, active: true },
  });
  if (
    !membership ||
    !["ADMIN", "SUPER_ADMIN"].includes(membership.role) ||
    (targetRole === "ADMIN" && membership.role !== "SUPER_ADMIN")
  )
    throw new AppError(
      403,
      "Für diese Einladung fehlt ein aktiver berechtigter Administrator.",
    );
  return membership;
}
async function checkDriver(
  tx: Tx,
  invitation: {
    role: string;
    driverId: string | null;
    organizationId: string;
    email: string;
  },
) {
  if (invitation.role !== "DRIVER") return;
  const id = invitation.driverId!;
  await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${id} AND "organizationId"=${invitation.organizationId} FOR UPDATE`;
  const driver = await tx.driverProfile.findFirst({
    where: {
      id,
      organizationId: invitation.organizationId,
      status: "ACTIVE",
      membershipId: null,
    },
  });
  if (!driver || driver.email.toLowerCase() !== invitation.email)
    throw new AppError(
      409,
      "Der Fahrer ist nicht mehr aktiv, bereits verknüpft oder seine E-Mail hat sich geändert.",
    );
}
async function audit(tx: Tx, row: Invitation, action: string, actorId: string) {
  await tx.auditLog.create({
    data: {
      organizationId: row.organizationId,
      actorId,
      action,
      resourceType: "invitation",
      resourceId: row.id,
    },
  });
}
async function send(
  row: Invitation,
  token: string,
  config: ReturnType<typeof invitationTransport>,
  organization: string,
) {
  const result = await deliverInvitation(config, token, row, organization);
  // A slow transport response must not overwrite a newer resend or an accepted invitation.
  await database().invitation.updateMany({
    where: { id: row.id, tokenHash: row.tokenHash, status: "PENDING" },
    data: { delivery: result.delivery },
  });
  return {
    invitation: { ...publicRow(row), delivery: result.delivery },
    ...("localLink" in result ? { localLink: result.localLink } : {}),
    notice:
      result.delivery === "FAILED"
        ? "Der E-Mail-Dienst hat den Versand nicht bestätigt. Bitte später erneut senden; die Einladung wurde gespeichert."
        : undefined,
  };
}
export async function listInvitations(
  p: Principal,
  params = new URLSearchParams(),
) {
  demand(p, "invitations", "read");
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const q = (params.get("q") || "").trim().slice(0, 120);
  const where = {
    organizationId: p.organizationId,
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    database().invitation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (Math.trunc(page) - 1) * 25,
      take: 25,
    }),
    database().invitation.count({ where }),
  ]);
  const issuers = await database().membership.findMany({
    where: {
      organizationId: p.organizationId,
      userId: { in: items.map((row) => row.createdBy) },
    },
    select: { userId: true, version: true, active: true, role: true },
  });
  return {
    items: items.map((row) => {
      const issuer = issuers.find((m) => m.userId === row.createdBy);
      const invalidated =
        !issuer?.active ||
        issuer.version !== row.issuerVersion ||
        !["ADMIN", "SUPER_ADMIN"].includes(issuer.role) ||
        (row.role === "ADMIN" && issuer.role !== "SUPER_ADMIN");
      return {
        ...publicRow(row),
        ...(row.status === "PENDING" && invalidated
          ? { status: "INVALIDATED" }
          : {}),
      };
    }),
    total,
    page: Math.trunc(page),
    pageSize: 25,
  };
}
export async function createInvitation(p: Principal, data: unknown) {
  demand(p, "invitations", "write");
  const input = parse(createInput, data);
  const config = invitationTransport();
  const token = randomBytes(32).toString("hex");
  const row = await database().$transaction(async (tx) => {
    const issuer = await liveAdmin(tx, p.userId, p.organizationId, input.role);
    let email = input.email?.toLowerCase(),
      name = input.name;
    if (input.role === "DRIVER") {
      const driver = await tx.driverProfile.findFirst({
        where: {
          id: input.driverId || "",
          organizationId: p.organizationId,
          status: "ACTIVE",
          membershipId: null,
        },
      });
      if (!driver)
        throw new AppError(
          422,
          "Bitte einen aktiven Fahrer ohne Benutzerkonto auswählen.",
        );
      email = driver.email.toLowerCase();
      name = `${driver.firstName} ${driver.lastName}`;
    } else if (input.driverId)
      throw new AppError(
        422,
        "Nur Fahrereinladungen dürfen mit einem Fahrer verknüpft sein.",
      );
    if (!email || !name)
      throw new AppError(422, "Name und E-Mail sind erforderlich.");
    if (
      await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      })
    )
      throw new AppError(
        409,
        "Für diese E-Mail besteht bereits ein Konto. Eine Einladung setzt kein bestehendes Passwort zurück.",
      );
    if (
      await tx.invitation.findFirst({
        where: { organizationId: p.organizationId, email, status: "PENDING" },
      })
    )
      throw new AppError(
        409,
        "Eine offene Einladung besteht bereits. Bitte erneut senden oder widerrufen.",
      );
    const row = await tx.invitation.create({
      data: {
        organizationId: p.organizationId,
        email,
        name,
        role: input.role,
        driverId: input.role === "DRIVER" ? input.driverId : null,
        tokenHash: digest(token),
        mode: config.mode,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        lastSentAt: new Date(),
        createdBy: p.userId,
        issuerVersion: issuer.version,
      },
    });
    await audit(tx, row, "invite-create", p.userId);
    return row;
  });
  return send(row, token, config, p.organizationName);
}
export async function changeInvitation(
  p: Principal,
  id: string,
  action: "resend" | "revoke",
) {
  demand(p, "invitations", "write");
  const config = action === "resend" ? invitationTransport() : null;
  const token = randomBytes(32).toString("hex");
  const row = await database().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${id} AND "organizationId"=${p.organizationId} FOR UPDATE`;
    const old = await tx.invitation.findFirst({
      where: { id, organizationId: p.organizationId },
    });
    if (!old) throw new AppError(404, "Einladung nicht gefunden.");
    const issuer = await liveAdmin(tx, p.userId, p.organizationId, old.role);
    if (old.status !== "PENDING")
      throw new AppError(409, "Diese Einladung ist bereits abgeschlossen.");
    if (action === "resend" && Date.now() - old.lastSentAt.getTime() < 60000)
      throw new AppError(429, "Bitte vor erneutem Versand eine Minute warten.");
    if (action === "resend") await checkDriver(tx, old);
    const row = await tx.invitation.update({
      where: { id },
      data:
        action === "revoke"
          ? { status: "REVOKED" }
          : {
              tokenHash: digest(token),
              mode: config!.mode,
              delivery: "PENDING",
              lastSentAt: new Date(),
              createdBy: p.userId,
              issuerVersion: issuer.version,
              expiresAt: new Date(Date.now() + 72 * 3600000),
            },
    });
    await audit(tx, row, `invite-${action}`, p.userId);
    return row;
  });
  return action === "resend"
    ? send(row, token, config!, p.organizationName)
    : { invitation: publicRow(row) };
}
async function usable(tx: Tx, token: string, lock = false) {
  if (!tokenInput.safeParse(token).success) throw invalid();
  const hash = digest(token);
  if (lock)
    await tx.$queryRaw`SELECT id FROM "Invitation" WHERE "tokenHash"=${hash} FOR UPDATE`;
  const row = await tx.invitation.findUnique({ where: { tokenHash: hash } });
  if (
    !row ||
    row.status !== "PENDING" ||
    row.expiresAt <= new Date() ||
    (process.env.NODE_ENV === "production" && row.mode === "MANUAL")
  )
    throw invalid();
  try {
    const issuer = await liveAdmin(
      tx,
      row.createdBy,
      row.organizationId,
      row.role,
    );
    if (issuer.version !== row.issuerVersion) throw invalid();
  } catch {
    throw invalid();
  }
  return row;
}
export async function previewInvitation(token: string) {
  const row = await usable(database(), token);
  const org = await database().organization.findUniqueOrThrow({
    where: { id: row.organizationId },
  });
  return {
    name: row.name,
    email: row.email,
    role: row.role,
    organization: org.name,
    expiresAt: row.expiresAt,
  };
}
export async function acceptInvitation(data: unknown) {
  const input = parse(
    z
      .object({ token: tokenInput, password: z.string().min(12).max(128) })
      .strict(),
    data,
  );
  // Check the bearer token before spending CPU hashing a password; lock and recheck afterward.
  await usable(database(), input.token);
  const password = await hashPassword(input.password);
  return database().$transaction(
    async (tx) => {
      const row = await usable(tx, input.token, true);
      await checkDriver(tx, row);
      if (
        await tx.user.findFirst({
          where: { email: { equals: row.email, mode: "insensitive" } },
        })
      )
        throw new AppError(
          409,
          "Dieses Konto besteht bereits. Bitte anmelden oder den Administrator kontaktieren.",
        );
      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          name: row.name,
          email: row.email,
          emailVerified: row.mode === "EMAIL",
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId,
          accountId: userId,
          providerId: "credential",
          password,
        },
      });
      const membership = await tx.membership.create({
        data: { userId, organizationId: row.organizationId, role: row.role },
      });
      if (row.driverId)
        await tx.driverProfile.update({
          where: { id: row.driverId },
          data: { membershipId: membership.id },
        });
      await tx.invitation.update({
        where: { id: row.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedUserId: userId,
        },
      });
      await audit(tx, row, "invite-accept", userId);
      return { email: row.email, requiresMfa: row.role === "ADMIN" };
    },
    { timeout: 10000 },
  );
}
/** Global and per-token budgets avoid trusting spoofable forwarded IP headers. */
export async function publicInvitationLimit(
  action: "preview" | "accept",
  token: string,
) {
  if (!tokenInput.safeParse(token).success) throw invalid();
  for (const [bucket, max] of [
    ["global", action === "accept" ? 30 : 300],
    [digest(token), 15],
  ] as const) {
    const key = `invitation:${action}:${bucket}:${Math.floor(Date.now() / 60000)}`;
    const row = await database().rateLimit.upsert({
      where: { key },
      create: {
        id: randomUUID(),
        key,
        count: 1,
        lastRequest: BigInt(Date.now()),
      },
      update: { count: { increment: 1 }, lastRequest: BigInt(Date.now()) },
    });
    if (row.count > max)
      throw new AppError(429, "Zu viele Anfragen. Bitte eine Minute warten.");
  }
}
