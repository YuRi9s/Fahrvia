CREATE UNIQUE INDEX one_open_vehicle_assignment ON "VehicleAssignment" ("vehicleId") WHERE "endAt" IS NULL;
CREATE UNIQUE INDEX one_open_driver_assignment ON "VehicleAssignment" ("driverId") WHERE "endAt" IS NULL;
CREATE UNIQUE INDEX one_open_service_period ON "VehicleServicePeriod" ("vehicleId") WHERE "endAt" IS NULL;
CREATE UNIQUE INDEX one_published_score_period ON "ScoreImport" ("organizationId",week) WHERE status='COMMITTED';
ALTER TABLE "Vehicle" ADD CONSTRAINT vehicle_dates CHECK ("deFleet" IS NULL OR "deFleet">="inFleet");
ALTER TABLE "Vehicle" ADD CONSTRAINT vehicle_ownership CHECK (ownership IN ('OWNED','RENTED','LEASED') AND (ownership<>'RENTED' OR length(trim(provider))>0));
ALTER TABLE "Vehicle" ADD CONSTRAINT vehicle_status CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "Membership" ADD CONSTRAINT member_role CHECK (role IN ('SUPER_ADMIN','ADMIN','DISPATCHER','DRIVER'));
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT assignment_dates CHECK ("endAt" IS NULL OR "endAt">="startAt");
ALTER TABLE "VehicleKey" ADD CONSTRAINT key_slot CHECK (slot BETWEEN 1 AND 4);
ALTER TABLE "VehicleKey" ADD CONSTRAINT key_holder CHECK ((location='DRIVER' AND "driverId" IS NOT NULL) OR (location IN ('OFFICE','MISSING') AND "driverId" IS NULL));
ALTER TABLE "InventoryItem" ADD CONSTRAINT stock_nonnegative CHECK (stock>=0 AND "minimumStock">=0);
ALTER TABLE "Wave" ADD CONSTRAINT wave_progress CHECK (packages>=0 AND delivered>=0 AND delivered<=packages AND status IN ('PLANNED','ACTIVE','COMPLETED'));
ALTER TABLE "PlanEvent" ADD CONSTRAINT plan_dates CHECK ("endAt">"startAt");
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT work_time_valid CHECK ("breakMinutes">=0 AND ("endAt" IS NULL OR ("endAt">"startAt" AND EXTRACT(EPOCH FROM ("endAt"-"startAt"))/60>"breakMinutes")));
ALTER TABLE "Document" ADD CONSTRAINT document_one_subject CHECK (("driverId" IS NOT NULL)::integer + ("vehicleId" IS NOT NULL)::integer = 1);
ALTER TABLE "VehicleKey" ADD CONSTRAINT key_driver_tenant FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId");
ALTER TABLE "Document" ADD CONSTRAINT document_driver_tenant FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId");
ALTER TABLE "Document" ADD CONSTRAINT document_vehicle_tenant FOREIGN KEY ("vehicleId","organizationId") REFERENCES "Vehicle"(id,"organizationId");
ALTER TABLE "PlanEvent" ADD CONSTRAINT plan_driver_tenant FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId");
ALTER TABLE "PlanEvent" ADD CONSTRAINT plan_vehicle_tenant FOREIGN KEY ("vehicleId","organizationId") REFERENCES "Vehicle"(id,"organizationId");
ALTER TABLE "DeliveryDetail" ADD CONSTRAINT detail_driver_tenant FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId");
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['DriverProfile','Category','Vehicle','VehicleServicePeriod','VehicleAssignment','VehicleKey','KeyCustody','StoredObject','VehiclePhotoReport','Document','ScoreImport','DriverScore','DeliveryDetail','PlanEvent','Wave','WorkTimeEntry','InventoryItem','Message','Notification','AuditLog'] LOOP
 EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)', t, t || '_organization_fk');
 END LOOP;
END $$;
CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION protect_audit();
