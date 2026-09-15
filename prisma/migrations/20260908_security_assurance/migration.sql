ALTER TABLE "Session" ADD COLUMN "mfaVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TwoFactor" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "driverVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkTimeEntry" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "work_time_positive_version" CHECK ("version" >= 1);
