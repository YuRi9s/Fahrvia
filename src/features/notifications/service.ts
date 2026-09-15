import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
import type { Prisma } from "../../generated/prisma/client";
const staff = ["ADMIN", "SUPER_ADMIN", "DISPATCHER"];
export function notificationScope(p: Principal): Prisma.NotificationWhereInput {
  return {
    organizationId: p.organizationId,
    OR: [{ recipientId: p.userId }, { actionOwnerId: p.userId }],
    ...(p.role === "DRIVER" ? { stockItemId: null, staffOnly: false } : {}),
  };
}
export async function notificationDetails(p: Principal, id: string) {
  demand(p, "notifications", "read");
  const row = await database().notification.findFirst({
    where: { id, ...notificationScope(p) },
    include: {
      actionOwner: { select: { user: { select: { name: true } } } },
      stockItem: { select: { sku: true } },
    },
  });
  if (!row) throw new AppError(404, "Benachrichtigung nicht gefunden.");
  const { actionOwner, stockItem, ...item } = row;
  return {
    ...item,
    ownerName: actionOwner?.user.name ?? p.name,
    stockSku: stockItem?.sku ?? null,
    isOwner: (row.actionOwnerId ?? row.recipientId) === p.userId,
    canAssign: staff.includes(p.role),
  };
}
export type NotificationDetails = Awaited<
  ReturnType<typeof notificationDetails>
>;
export async function notificationAction(
  p: Principal,
  action: string,
  id: string,
  data: unknown,
) {
  demand(p, "notifications", "write");
  if (!["read", "acknowledge", "assign", "complete", "retry"].includes(action))
    throw new AppError(422, "Unbekannte Aktion.");
  return database().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Notification" WHERE id=${id} AND "organizationId"=${p.organizationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "userId"=${p.userId} AND "organizationId"=${p.organizationId} FOR SHARE`;
      const member = await tx.membership.findFirst({
        where: {
          userId: p.userId,
          organizationId: p.organizationId,
          active: true,
        },
      });
      if (!member || ![...staff, "DRIVER"].includes(member.role))
        throw new AppError(403, "Der Zugang ist nicht mehr aktiv.");
      if (
        member.role === "DRIVER" &&
        !(await tx.driverProfile.findFirst({
          where: { membershipId: member.id, status: "ACTIVE" },
        }))
      )
        throw new AppError(403, "Der Fahrerzugang ist nicht aktiv.");
      const row = await tx.notification.findFirst({
        where: {
          id,
          ...notificationScope({
            ...p,
            role: member.role as Principal["role"],
          }),
        },
      });
      if (!row) throw new AppError(404, "Benachrichtigung nicht gefunden.");
      if (action === "read") {
        if (!row.readAt)
          await tx.notification.update({
            where: { id },
            data: { readAt: new Date() },
          });
        return { id };
      }
      if (row.reminderOfId)
        throw new AppError(409, "Bitte die Ursprungsmeldung öffnen.");
      const isOwner = (row.actionOwnerId ?? row.recipientId) === p.userId;
      if (["acknowledge", "complete"].includes(action) && !isOwner)
        throw new AppError(
          403,
          "Diese Aktion ist der verantwortlichen Person vorbehalten.",
        );
      if (action === "acknowledge" && row.acknowledgedAt) return { id };
      if (row.resolvedAt)
        throw new AppError(409, "Diese Meldung ist bereits erledigt.");
      const expected = (data as Record<string, unknown>)?.expectedVersion;
      if (!Number.isSafeInteger(expected) || expected !== row.version)
        throw new AppError(
          409,
          "Die Meldung wurde geändert. Bitte aktualisieren.",
        );
      let change: Prisma.NotificationUpdateInput;
      if (action === "acknowledge")
        change = {
          acknowledgedAt: new Date(),
          acknowledgedBy: p.userId,
          readAt: row.readAt ?? new Date(),
          ...(!row.nextAction
            ? { nextReminderAt: null, deliveryStatus: "CANCELLED" }
            : {}),
        };
      else if (action === "assign") {
        if (!staff.includes(member.role))
          throw new AppError(
            403,
            "Nur Verwaltung und Disposition können Aufgaben zuordnen.",
          );
        const v = parse(
          z.object({
            ownerId: z.string().min(1).max(200),
            nextAction: z.string().trim().min(1).max(500),
            dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
          }),
          data,
        );
        if (
          !(await tx.membership.findFirst({
            where: {
              organizationId: p.organizationId,
              userId: v.ownerId,
              active: true,
              role: { in: staff },
            },
          }))
        )
          throw new AppError(
            422,
            "Bitte ein aktives Verwaltungsmitglied auswählen.",
          );
        change = {
          actionOwner: {
            connect: {
              userId_organizationId: {
                userId: v.ownerId,
                organizationId: p.organizationId,
              },
            },
          },
          staffOnly: true,
          readAt: null,
          nextAction: v.nextAction,
          dueAt: v.dueAt ? new Date(v.dueAt) : null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          deliveryStatus: "PENDING",
          deliveryAttempts: 0,
          lastDeliveryError: null,
          nextReminderAt: v.dueAt
            ? new Date(v.dueAt)
            : new Date(Date.now() + 86400000),
        };
      } else if (action === "complete") {
        if (row.stockItemId)
          throw new AppError(
            409,
            "Bestandswarnungen werden durch ausreichenden Bestand erledigt.",
          );
        if (!row.acknowledgedAt)
          throw new AppError(409, "Bitte die Meldung zuerst bestätigen.");
        const v = parse(
          z.object({ outcome: z.string().trim().min(1).max(500) }),
          data,
        );
        change = {
          resolvedAt: new Date(),
          outcome: v.outcome,
          nextReminderAt: null,
          deliveryStatus: "CANCELLED",
        };
        await tx.notification.updateMany({
          where: {
            reminderOfId: id,
            organizationId: p.organizationId,
            resolvedAt: null,
          },
          data: { resolvedAt: new Date(), nextReminderAt: null },
        });
      } else {
        if (!["RETRY", "FAILED"].includes(row.deliveryStatus))
          throw new AppError(
            409,
            "Für diese Meldung steht kein fehlgeschlagener Versuch aus.",
          );
        change = {
          deliveryAttempts: 0,
          nextReminderAt: new Date(),
          lastDeliveryError: null,
          deliveryStatus: "PENDING",
        };
      }
      await tx.notification.update({
        where: { id },
        data: { ...change, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: p.organizationId,
          actorId: p.userId,
          action: `notification-${action}`,
          resourceType: "notifications",
          resourceId: id,
          details: {
            version: row.version + 1,
            ...(action === "assign"
              ? {
                  ownerId: String((data as Record<string, unknown>).ownerId),
                  nextAction: String(
                    (data as Record<string, unknown>).nextAction,
                  ).trim(),
                }
              : {}),
            ...(action === "complete"
              ? {
                  outcome: String(
                    (data as Record<string, unknown>).outcome,
                  ).trim(),
                }
              : {}),
          },
        },
      });
      return { id };
    },
    { timeout: 10000 },
  );
}
export async function runNotificationReminders(now = new Date()) {
  const db = database();
  let cursor = "",
    processed = 0;
  for (;;) {
    const rows = await db.notification.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        reminderOfId: null,
        resolvedAt: null,
        nextReminderAt: { lte: now },
      },
      orderBy: { id: "asc" },
      take: 100,
      select: { id: true, organizationId: true },
    });
    if (!rows.length) break;
    for (const entry of rows) {
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Notification" WHERE id=${entry.id} AND "organizationId"=${entry.organizationId} FOR UPDATE`;
          const row = await tx.notification.findUnique({
            where: { id: entry.id },
          });
          if (
            !row ||
            row.resolvedAt ||
            !row.nextReminderAt ||
            row.nextReminderAt > now ||
            row.reminderOfId
          )
            return;
          if (row.acknowledgedAt && !row.nextAction) {
            await tx.notification.update({
              where: { id: row.id },
              data: { nextReminderAt: null, deliveryStatus: "CANCELLED" },
            });
            return;
          }
          const ownerId = row.actionOwnerId ?? row.recipientId;
          const member = await tx.membership.findFirst({
            where: {
              organizationId: row.organizationId,
              userId: ownerId,
              active: true,
            },
            include: { driver: { select: { status: true } } },
          });
          const eligible =
            member &&
            (staff.includes(member.role) ||
              (member.role === "DRIVER" &&
                !row.staffOnly &&
                !row.stockItemId &&
                member.driver?.status === "ACTIVE"));
          const attempts = row.deliveryAttempts + 1;
          if (!eligible) {
            await tx.notification.update({
              where: { id: row.id },
              data: {
                deliveryAttempts: attempts,
                deliveryStatus: attempts >= 5 ? "FAILED" : "RETRY",
                lastDeliveryError:
                  "Verantwortliche Person ist derzeit nicht erreichbar.",
                nextReminderAt:
                  attempts >= 5
                    ? null
                    : new Date(
                        now.getTime() +
                          Math.min(60, 5 * 2 ** (attempts - 1)) * 60000,
                      ),
              },
            });
            return;
          }
          const id = createHash("sha256")
            .update(`reminder:${row.id}:${row.version}:${attempts}`)
            .digest("hex");
          await tx.notification.create({
            data: {
              id,
              organizationId: row.organizationId,
              recipientId: ownerId,
              title: `Erinnerung: ${row.title}`,
              body: row.nextAction || row.body,
              staffOnly: row.staffOnly,
              stockItemId: row.stockItemId,
              reminderOfId: row.id,
              nextReminderAt: null,
              deliveryStatus: "NONE",
            },
          });
          await tx.notification.update({
            where: { id: row.id },
            data: {
              deliveryStatus: "CREATED",
              deliveryAttempts: attempts,
              lastDeliveryError: null,
              nextReminderAt: null,
            },
          });
        },
        { timeout: 10000 },
      );
      processed++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { processed };
}
