ALTER TABLE "WorkTimeEntry"
  ADD COLUMN "clockState" TEXT,
  ADD COLUMN "breakStartedAt" TIMESTAMP(3),
  ADD COLUMN "breakMilliseconds" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "clock_state_valid" CHECK (
  "breakMilliseconds" >= 0 AND COALESCE((
    ("clockState" IS NULL AND "breakStartedAt" IS NULL AND "breakMilliseconds" = 0) OR
    ("clockState" = 'RUNNING' AND "endAt" IS NULL AND "breakStartedAt" IS NULL AND status = 'OPEN') OR
    ("clockState" = 'PAUSED' AND "endAt" IS NULL AND "breakStartedAt" IS NOT NULL AND "breakStartedAt" >= "startAt" AND status = 'OPEN') OR
    ("clockState" = 'FINISHED' AND "endAt" IS NOT NULL AND "breakStartedAt" IS NULL AND status IN ('SUBMITTED','APPROVED') AND "breakMilliseconds" < EXTRACT(EPOCH FROM ("endAt"-"startAt"))*1000)
  ), false)
);
-- Existing manual data is unchanged; active clock entries are unique per driver.
CREATE UNIQUE INDEX "one_active_clock_per_driver" ON "WorkTimeEntry" ("organizationId","driverId") WHERE "clockState" IN ('RUNNING','PAUSED');
CREATE TABLE "WorkTimeClockEvent" (
  id TEXT PRIMARY KEY,
  "entryId" TEXT NOT NULL REFERENCES "WorkTimeEntry"(id) ON DELETE RESTRICT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('start','pause','resume','finish')),
  "expectedVersion" INTEGER,
  "requestedEntryId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("actorId","requestId")
);
CREATE INDEX "WorkTimeClockEvent_entryId_occurredAt_idx" ON "WorkTimeClockEvent"("entryId","occurredAt");
CREATE TRIGGER immutable_clock_event BEFORE UPDATE OR DELETE ON "WorkTimeClockEvent" FOR EACH ROW EXECUTE FUNCTION protect_audit();
