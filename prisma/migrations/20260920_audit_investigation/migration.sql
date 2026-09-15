ALTER TABLE "SecurityEvent" ADD COLUMN "organizationId" TEXT,
ADD COLUMN "resourceId" TEXT,
ADD COLUMN "details" JSONB;
CREATE INDEX "SecurityEvent_organizationId_createdAt_idx" ON "SecurityEvent"("organizationId", "createdAt");
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_organization_fk" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id);
CREATE TRIGGER immutable_security_event BEFORE UPDATE OR DELETE ON "SecurityEvent" FOR EACH ROW EXECUTE FUNCTION protect_audit();
