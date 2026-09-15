import { notificationAction } from "../notifications/service";
import { configureStockAlert, evaluateStockAlert } from "../inventory/alerts";
import { inventoryWriter } from "../inventory/permissions";
import { issueInventory, returnInventory } from "../inventory/custody";
import { mutateWave } from "../waves/service";
import { randomUUID } from "node:crypto";
import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
import {
  parse,
  planInput,
  timeInput,
  inventoryInput,
  movementInput,
  messageInput,
} from "../../server/validation";
import { audit, requireDriver, requireVehicle } from "../fleet/service";
import type { Prisma } from "../../generated/prisma/client";
/** All state transitions occur inside the same transaction as their audit event. */
export async function mutateOperations(
  p: Principal,
  module: string,
  action: string,
  id: string | undefined,
  data: unknown,
) {
  demand(p, module, "write");
  if (module === "inventory" && action === "issue")
    return issueInventory(p, id ?? "", data);
  if (module === "inventory" && action === "return")
    return returnInventory(p, id ?? "", data);
  if (module === "inventory" && action === "alert-settings")
    return configureStockAlert(p, id ?? "", data);
  if (module === "waves") return mutateWave(p, action, id, data);
  if (module === "notifications")
    return notificationAction(p, action, id ?? "", data);
  const organizationId = p.organizationId;
  return database().$transaction(async (tx) => {
    let item: { id: string };
    if (module === "planning") {
      if (action === "delete") {
        const row = await tx.planEvent.findFirst({
          where: { id: id ?? "", organizationId, deletedAt: null },
        });
        if (!row) throw new AppError(404, "Termin nicht gefunden.");
        item = await tx.planEvent.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        });
      } else {
        const v = parse(planInput, data);
        if (v.driverId) await requireDriver(tx, p, v.driverId);
        if (v.vehicleId) await requireVehicle(tx, p, v.vehicleId);
        if (action === "create")
          item = await tx.planEvent.create({ data: { ...v, organizationId } });
        else if (action === "update") {
          const row = await tx.planEvent.findFirst({
            where: { id: id ?? "", organizationId, deletedAt: null },
          });
          if (!row) throw new AppError(404, "Termin nicht gefunden.");
          item = await tx.planEvent.update({ where: { id: row.id }, data: v });
        } else throw new AppError(422, "Unbekannte Aktion.");
      }
    } else if (module === "work-times") {
      if (!["create", "update", "approve"].includes(action))
        throw new AppError(422, "Unbekannte Aktion.");
      // Updates and approvals serialize on the entry. Driver locks are ordered so a
      // reassignment cannot deadlock with a correction of another entry.
      let old = null;
      if (action !== "create") {
        await tx.$queryRaw`SELECT id FROM "WorkTimeEntry" WHERE id=${id ?? ""} AND "organizationId"=${organizationId} FOR UPDATE`;
        old = await tx.workTimeEntry.findFirst({
          where: { id: id ?? "", organizationId },
        });
        if (!old) throw new AppError(404, "Arbeitszeit nicht gefunden.");
      }
      if (action === "approve") {
        if (p.role !== "ADMIN" && p.role !== "SUPER_ADMIN")
          throw new AppError(
            403,
            "Nur Administratoren können Arbeitszeiten freigeben.",
          );
        const expectedVersion = (data as Record<string, unknown>)
          ?.expectedVersion;
        if (
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion !== old!.version
        )
          throw new AppError(
            409,
            "Der Eintrag wurde geändert. Bitte neu laden und erneut prüfen.",
          );
        if (!old!.endAt || old!.status !== "SUBMITTED")
          throw new AppError(
            409,
            "Dieser Eintrag kann nicht freigegeben werden.",
          );
        item = await tx.workTimeEntry.update({
          where: { id: old!.id },
          data: {
            status: "APPROVED",
            approvedBy: p.userId,
            approvedAt: new Date(),
            version: { increment: 1 },
          },
        });
      } else {
        const { reason, ...v } = parse(timeInput, data);
        for (const driverId of [
          ...new Set([v.driverId, ...(old ? [old.driverId] : [])]),
        ].sort())
          await tx.$queryRaw`SELECT id FROM "DriverProfile" WHERE id=${driverId} AND "organizationId"=${organizationId} FOR UPDATE`;
        await requireDriver(tx, p, v.driverId);
        const overlap = await tx.workTimeEntry.findFirst({
          where: {
            organizationId,
            driverId: v.driverId,
            id: { not: id ?? "" },
            startAt: { lt: v.endAt ?? new Date("9999-01-01") },
            OR: [{ endAt: null }, { endAt: { gt: v.startAt } }],
          },
        });
        if (overlap)
          throw new AppError(
            409,
            "Die Arbeitszeit überschneidet sich mit einem anderen Eintrag.",
          );
        if (action === "create")
          item = await tx.workTimeEntry.create({
            data: {
              ...v,
              organizationId,
              status: v.endAt ? "SUBMITTED" : "OPEN",
            },
          });
        else {
          if (!reason)
            throw new AppError(422, "Bitte einen Korrekturgrund angeben.");
          await tx.workTimeRevision.create({
            data: {
              entryId: old!.id,
              actorId: p.userId,
              reason,
              before: JSON.parse(JSON.stringify(old)) as Prisma.InputJsonValue,
            },
          });
          item = await tx.workTimeEntry.update({
            where: { id: old!.id },
            data: {
              ...v,
              endAt: v.endAt ?? null,
              status: v.endAt ? "SUBMITTED" : "OPEN",
              approvedBy: null,
              approvedAt: null,
              version: { increment: 1 },
            },
          });
        }
      }
    } else if (module === "inventory") {
      if (action === "create") {
        await inventoryWriter(tx, p);
        const v = parse(inventoryInput, data);
        item = await tx.inventoryItem.create({
          data: { ...v, organizationId },
        });
        if (v.stock)
          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              quantity: v.stock,
              reason: "Anfangsbestand",
              actorId: p.userId,
            },
          });
      } else {
        await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${id ?? ""} AND "organizationId"=${organizationId} FOR UPDATE`;
        const old = await tx.inventoryItem.findFirst({
          where: { id: id ?? "", organizationId },
        });
        if (!old) throw new AppError(404, "Inventar nicht gefunden.");
        await inventoryWriter(tx, p);
        if (action === "adjust") {
          const v = parse(movementInput, data);
          if (old.stock + v.quantity < 0)
            throw new AppError(409, "Der Bestand reicht nicht aus.");
          item = await tx.inventoryItem.update({
            where: { id: old.id },
            data: { stock: { increment: v.quantity } },
          });
          await tx.inventoryMovement.create({
            data: { ...v, itemId: old.id, actorId: p.userId },
          });
        } else if (action === "update") {
          const { stock, ...v } = parse(inventoryInput, data);
          if (stock !== old.stock)
            throw new AppError(
              422,
              "Bitte Bestandsänderungen über Zu-/Abgang erfassen.",
            );
          if (
            v.minimumStock !== old.minimumStock &&
            (data as Record<string, unknown>)?.expectedAlertVersion !==
              old.alertVersion
          )
            throw new AppError(
              409,
              "Die Warnschwelle wurde geändert. Bitte neu laden.",
            );
          item = await tx.inventoryItem.update({
            where: { id: old.id },
            data: {
              ...v,
              ...(v.minimumStock !== old.minimumStock
                ? { alertVersion: { increment: 1 } }
                : {}),
            },
          });
        } else throw new AppError(422, "Unbekannte Aktion.");
      }
      await evaluateStockAlert(tx, item.id, organizationId);
    } else if (module === "messages" && action === "create") {
      const v = parse(messageInput, data);
      const recipient = await tx.membership.findFirst({
        where: {
          organizationId,
          userId: v.recipientId,
          active: true,
          ...(p.role === "DRIVER" ? { role: { not: "DRIVER" } } : {}),
        },
      });
      if (!recipient || recipient.userId === p.userId)
        throw new AppError(422, "Empfänger nicht verfügbar.");
      if (v.threadId) {
        const root = await tx.message.findFirst({
          where: {
            organizationId,
            threadId: v.threadId,
            OR: [
              { senderId: p.userId, recipientId: v.recipientId },
              { senderId: v.recipientId, recipientId: p.userId },
            ],
          },
        });
        if (!root) throw new AppError(404, "Unterhaltung nicht gefunden.");
      }
      item = await tx.message.create({
        data: {
          ...v,
          threadId: v.threadId ?? randomUUID(),
          organizationId,
          senderId: p.userId,
        },
      });
      await tx.notification.create({
        data: {
          organizationId,
          recipientId: v.recipientId,
          title: "Neue Nachricht",
          body: v.subject,
        },
      });
    } else if (module === "messages" && action === "read") {
      const row = await tx.message.findFirst({
        where: { id: id ?? "", organizationId, recipientId: p.userId },
      });
      if (!row) throw new AppError(404, "Nachricht nicht gefunden.");
      item = await tx.message.update({
        where: { id: row.id },
        data: { readAt: new Date() },
      });
    } else if (module === "documents" && action === "archive") {
      const row = await tx.document.findFirst({
        where: { id: id ?? "", organizationId, archivedAt: null },
      });
      if (!row) throw new AppError(404, "Dokument nicht gefunden.");
      if (p.role === "DRIVER" && row.driverId !== p.driverId)
        throw new AppError(404, "Dokument nicht gefunden.");
      if (p.role === "DISPATCHER" && row.driverId)
        throw new AppError(403, "Keine Berechtigung.");
      item = await tx.document.update({
        where: { id: row.id },
        data: { archivedAt: new Date() },
      });
    } else if (module === "photos" && action === "resolve") {
      if (p.role === "DRIVER") throw new AppError(403, "Keine Berechtigung.");
      const row = await tx.vehiclePhotoReport.findFirst({
        where: { id: id ?? "", organizationId },
      });
      if (!row) throw new AppError(404, "Bericht nicht gefunden.");
      item = await tx.vehiclePhotoReport.update({
        where: { id: row.id },
        data: { resolvedAt: new Date() },
      });
    } else throw new AppError(422, "Diese Aktion wird nicht unterstützt.");
    await audit(tx, p, action, module, item.id);
    return { id: item.id };
  });
}
