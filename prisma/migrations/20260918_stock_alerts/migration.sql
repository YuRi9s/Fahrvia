ALTER TABLE "InventoryItem" ADD COLUMN "alertRecipientId" TEXT, ADD COLUMN "alertVersion" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "lowStockActive" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "lowStockEpisode" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_alertRecipient_fkey" FOREIGN KEY ("alertRecipientId","organizationId") REFERENCES "Membership"("userId","organizationId") ON DELETE RESTRICT;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_alert_versions" CHECK ("alertVersion">0 AND "lowStockEpisode">=0);
UPDATE "InventoryItem" SET "lowStockActive"=(stock<"minimumStock"),"lowStockEpisode"=CASE WHEN stock<"minimumStock" THEN 1 ELSE 0 END;
ALTER TABLE "Notification" ADD COLUMN "stockItemId" TEXT, ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_stockItem_fkey" FOREIGN KEY ("stockItemId","organizationId") REFERENCES "InventoryItem"(id,"organizationId") ON DELETE RESTRICT;
CREATE INDEX "Notification_stockItemId_resolvedAt_idx" ON "Notification"("stockItemId","resolvedAt");
