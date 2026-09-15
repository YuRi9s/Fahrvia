import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import { parse } from "../../server/validation";
import type { Prisma } from "../../generated/prisma/client";
import { inventoryWriter } from "./permissions";
const roles = ["ADMIN", "SUPER_ADMIN", "DISPATCHER"];
/** Caller owns the inventory-item row lock; stock and alert state commit together. */
export async function evaluateStockAlert(
  tx: Prisma.TransactionClient,
  id: string,
  organizationId: string,
) {
  const item = await tx.inventoryItem.findFirst({
    where: { id, organizationId },
  });
  if (!item) return;
  const low = item.stock < item.minimumStock;
  let episode = item.lowStockEpisode;
  if (low !== item.lowStockActive) {
    if (low) episode++;
    await tx.inventoryItem.update({
      where: { id },
      data: { lowStockActive: low, lowStockEpisode: episode },
    });
  }
  if (!low) {
    await tx.notification.updateMany({
      where: { stockItemId: id, organizationId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    return;
  }
  if (!item.alertRecipientId) return;
  const recipient = await tx.membership.findFirst({
    where: {
      organizationId,
      userId: item.alertRecipientId,
      active: true,
      role: { in: roles },
    },
  });
  if (!recipient) return;
  const notificationId = createHash("sha256")
    .update(`stock:${organizationId}:${id}:${episode}:${recipient.userId}`)
    .digest("hex");
  await tx.notification.upsert({
    where: { id: notificationId },
    update: {},
    create: {
      id: notificationId,
      organizationId,
      stockItemId: id,
      recipientId: recipient.userId,
      title: "Mindestbestand unterschritten",
      body: `${item.name} (${item.sku}): beim Auslösen ${item.stock} verfügbar, Mindestbestand ${item.minimumStock}. Bitte Bestand prüfen.`,
    },
  });
}
const settings = z.object({
  expectedVersion: z.number().int().positive(),
  recipientId: z.string().min(1).max(200).nullable(),
  minimumStock: z.number().int().min(0).max(1000000),
});
export async function configureStockAlert(
  p: Principal,
  id: string,
  data: unknown,
) {
  demand(p, "inventory", "write");
  const v = parse(settings, data);
  const organizationId = p.organizationId;
  return database().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
      const item = await tx.inventoryItem.findFirst({
        where: { id, organizationId },
      });
      if (!item) throw new AppError(404, "Inventar nicht gefunden.");
      await inventoryWriter(tx, p);
      if (item.alertVersion !== v.expectedVersion)
        throw new AppError(
          409,
          "Die Warnungseinstellungen wurden geändert. Bitte schließen, aktualisieren und erneut öffnen.",
        );
      if (
        v.recipientId &&
        !(await tx.membership.findFirst({
          where: {
            organizationId,
            userId: v.recipientId,
            active: true,
            role: { in: roles },
          },
        }))
      )
        throw new AppError(
          422,
          "Bitte ein aktives Mitglied der Verwaltung oder Disposition auswählen.",
        );
      await tx.inventoryItem.update({
        where: { id },
        data: {
          alertRecipientId: v.recipientId,
          minimumStock: v.minimumStock,
          alertVersion: { increment: 1 },
        },
      });
      await evaluateStockAlert(tx, id, organizationId);
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: p.userId,
          resourceType: "inventory",
          resourceId: id,
          action: "stock-alert-settings",
          details: {
            from: {
              recipientId: item.alertRecipientId,
              minimumStock: item.minimumStock,
            },
            to: { recipientId: v.recipientId, minimumStock: v.minimumStock },
            version: item.alertVersion + 1,
          },
        },
      });
      return { id };
    },
    { timeout: 10000 },
  );
}
/** Run against deployment data only via an explicitly scheduled server job. */
export async function reconcileStockAlerts() {
  const db = database();
  let cursor = "";
  let processed = 0;
  for (;;) {
    const batch = await db.inventoryItem.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        OR: [
          { stock: { lt: db.inventoryItem.fields.minimumStock } },
          { lowStockActive: true },
        ],
      },
      select: { id: true, organizationId: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!batch.length) break;
    for (const item of batch) {
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${item.id} AND "organizationId"=${item.organizationId} FOR UPDATE`;
          await evaluateStockAlert(tx, item.id, item.organizationId);
        },
        { timeout: 10000 },
      );
      processed++;
    }
    cursor = batch[batch.length - 1].id;
  }
  return { processed };
}
