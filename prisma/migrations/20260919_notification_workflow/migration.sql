ALTER TABLE "Notification" ADD COLUMN version INTEGER NOT NULL DEFAULT 1, ADD COLUMN "staffOnly" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "actionOwnerId" TEXT, ADD COLUMN "nextAction" TEXT NOT NULL DEFAULT '', ADD COLUMN "dueAt" TIMESTAMP(3), ADD COLUMN "acknowledgedAt" TIMESTAMP(3), ADD COLUMN "acknowledgedBy" TEXT, ADD COLUMN outcome TEXT NOT NULL DEFAULT '', ADD COLUMN "nextReminderAt" TIMESTAMP(3), ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING', ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "lastDeliveryError" TEXT, ADD COLUMN "reminderOfId" TEXT;
-- Historical notifications are not automatically enrolled in reminders.
UPDATE "Notification" SET "deliveryStatus"='NONE';
ALTER TABLE "Notification" ALTER COLUMN "nextReminderAt" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours');
CREATE UNIQUE INDEX "Notification_id_organizationId_key" ON "Notification"(id,"organizationId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_owner_fk" FOREIGN KEY ("actionOwnerId","organizationId") REFERENCES "Membership"("userId","organizationId") ON DELETE RESTRICT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reminder_fk" FOREIGN KEY ("reminderOfId","organizationId") REFERENCES "Notification"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workflow_checks" CHECK(version>0 AND "deliveryAttempts">=0 AND "deliveryStatus" IN ('NONE','PENDING','RETRY','FAILED','CREATED','CANCELLED'));
CREATE INDEX "Notification_organizationId_actionOwnerId_idx" ON "Notification"("organizationId","actionOwnerId");
CREATE INDEX "Notification_nextReminderAt_idx" ON "Notification"("nextReminderAt");
