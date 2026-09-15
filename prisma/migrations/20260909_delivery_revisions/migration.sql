ALTER TABLE "DeliveryDetail"
  ADD COLUMN "sourceReference" TEXT NOT NULL DEFAULT 'Nicht dokumentiert (Altbestand)',
  ADD COLUMN "sourceMethod" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "previousId" TEXT,
  ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "correctionReason" TEXT;
CREATE UNIQUE INDEX "DeliveryDetail_previousId_key" ON "DeliveryDetail"("previousId");
CREATE UNIQUE INDEX "DeliveryDetail_id_org_key" ON "DeliveryDetail"("id", "organizationId");
ALTER TABLE "DeliveryDetail"
  ADD CONSTRAINT "DeliveryDetail_previous_tenant_fk" FOREIGN KEY ("previousId", "organizationId") REFERENCES "DeliveryDetail"("id", "organizationId") ON DELETE RESTRICT,
  ADD CONSTRAINT "DeliveryDetail_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "DeliveryDetail_kind_check" CHECK ("kind" IN ('PHR','CONCESSION')),
  ADD CONSTRAINT "DeliveryDetail_source_method_check" CHECK ("sourceMethod" = 'MANUAL');

-- Corrections append new rows. Historical payloads cannot be silently rewritten.
CREATE FUNCTION protect_delivery_revision() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Delivery detail revisions are immutable';
  END IF;
  IF (to_jsonb(NEW) - 'isCurrent') IS DISTINCT FROM (to_jsonb(OLD) - 'isCurrent')
     OR OLD."isCurrent" = false OR NEW."isCurrent" <> false THEN
    RAISE EXCEPTION 'Delivery detail revisions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "DeliveryDetail_immutable" BEFORE UPDATE OR DELETE ON "DeliveryDetail"
FOR EACH ROW EXECUTE FUNCTION protect_delivery_revision();
