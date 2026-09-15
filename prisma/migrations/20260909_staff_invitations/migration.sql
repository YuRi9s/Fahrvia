CREATE TABLE "Invitation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('ADMIN','DISPATCHER','DRIVER')),
  "driverId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','ACCEPTED','REVOKED')),
  "delivery" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("delivery" IN ('PENDING','SENT','FAILED','MANUAL')),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('EMAIL','MANUAL')),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSentAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "Invitation_driver_tenant_fk" FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"("id","organizationId") ON DELETE RESTRICT,
  CONSTRAINT "Invitation_driver_role_check" CHECK (("role" = 'DRIVER') = ("driverId" IS NOT NULL))
);
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_organizationId_createdAt_idx" ON "Invitation"("organizationId","createdAt");
-- An expired pending invitation is renewed via resend, not a duplicate invitation.
CREATE UNIQUE INDEX "Invitation_pending_email_key" ON "Invitation"("organizationId","email") WHERE "status" = 'PENDING';
