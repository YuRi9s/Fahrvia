CREATE UNIQUE INDEX "VehicleAssignment_id_organizationId_driverId_vehicleId_key" ON "VehicleAssignment"(id,"organizationId","driverId","vehicleId");
CREATE UNIQUE INDEX "VehiclePhotoReport_id_organizationId_vehicleId_reporterId_key" ON "VehiclePhotoReport"(id,"organizationId","vehicleId","reporterId");
ALTER TABLE "VehiclePhoto" ADD COLUMN position TEXT CHECK(position IN ('front','rear','left','right','damage'));
CREATE UNIQUE INDEX "VehiclePhoto_reportId_position_key" ON "VehiclePhoto"("reportId",position);
CREATE TABLE "VehicleInspection" (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "driverId" TEXT NOT NULL,
 "reporterId" TEXT NOT NULL,
 "vehicleId" TEXT NOT NULL,
 "entryId" TEXT NOT NULL,
 "assignmentId" TEXT NOT NULL,
 "reportId" TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 "odometerKm" INTEGER NOT NULL CHECK("odometerKm" BETWEEN 0 AND 9999999),
 tyres TEXT NOT NULL CHECK(tyres IN ('OK','ISSUE')),
 lights TEXT NOT NULL CHECK(lights IN ('OK','ISSUE')),
 mirrors TEXT NOT NULL CHECK(mirrors IN ('OK','ISSUE')),
 warnings TEXT NOT NULL CHECK(warnings IN ('OK','ISSUE')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("entryId","organizationId","driverId") REFERENCES "WorkTimeEntry"(id,"organizationId","driverId") ON DELETE RESTRICT,
 FOREIGN KEY("assignmentId","organizationId","driverId","vehicleId") REFERENCES "VehicleAssignment"(id,"organizationId","driverId","vehicleId") ON DELETE RESTRICT,
 FOREIGN KEY("reportId","organizationId","vehicleId","reporterId") REFERENCES "VehiclePhotoReport"(id,"organizationId","vehicleId","reporterId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "VehicleInspection_entryId_assignmentId_key" ON "VehicleInspection"("entryId","assignmentId");
CREATE INDEX "VehicleInspection_organizationId_driverId_createdAt_idx" ON "VehicleInspection"("organizationId","driverId","createdAt");
CREATE TRIGGER immutable_vehicle_inspection BEFORE UPDATE OR DELETE ON "VehicleInspection" FOR EACH ROW EXECUTE FUNCTION protect_audit();
CREATE FUNCTION protect_inspection_photos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND EXISTS(SELECT 1 FROM "VehicleInspection" WHERE "reportId"=OLD."reportId") THEN
  RAISE EXCEPTION 'Inspection photo evidence is immutable';
 END IF;
 IF TG_OP <> 'DELETE' AND EXISTS(SELECT 1 FROM "VehicleInspection" WHERE "reportId"=NEW."reportId") THEN
  RAISE EXCEPTION 'Inspection photo evidence is immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_inspection_photos BEFORE INSERT OR UPDATE OR DELETE ON "VehiclePhoto" FOR EACH ROW EXECUTE FUNCTION protect_inspection_photos();
CREATE FUNCTION protect_inspection_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "VehicleInspection" WHERE "reportId"=OLD.id) AND
 (to_jsonb(OLD)-'resolvedAt') IS DISTINCT FROM (to_jsonb(NEW)-'resolvedAt') THEN
  RAISE EXCEPTION 'Inspection report content is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_inspection_report BEFORE UPDATE ON "VehiclePhotoReport" FOR EACH ROW EXECUTE FUNCTION protect_inspection_report();
CREATE FUNCTION validate_inspection_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "VehiclePhotoReport"; n INTEGER;
BEGIN
 SELECT * INTO r FROM "VehiclePhotoReport" WHERE id=NEW."reportId";
 SELECT count(*) INTO n FROM "VehiclePhoto" p JOIN "StoredObject" o ON o.id=p."objectId"
 WHERE p."reportId"=r.id AND p.position IN ('front','rear','left','right') AND o.status='READY' AND o.mime='image/jpeg'
 AND o."organizationId"=NEW."organizationId" AND o."vehicleId"=NEW."vehicleId" AND o."createdBy"=NEW."reporterId";
 IF n<>4 OR (r.damage AND NOT EXISTS(SELECT 1 FROM "VehiclePhoto" p JOIN "StoredObject" o ON o.id=p."objectId" WHERE p."reportId"=r.id AND p.position='damage' AND o.status='READY' AND o.mime='image/jpeg' AND o."organizationId"=NEW."organizationId" AND o."vehicleId"=NEW."vehicleId" AND o."createdBy"=NEW."reporterId")) THEN
  RAISE EXCEPTION 'Inspection requires complete private photo evidence';
 END IF;
 IF (r.damage OR NEW.tyres='ISSUE' OR NEW.lights='ISSUE' OR NEW.mirrors='ISSUE' OR NEW.warnings='ISSUE') AND length(trim(r.notes))<10 THEN
  RAISE EXCEPTION 'Inspection issues require descriptive notes';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER complete_inspection BEFORE INSERT ON "VehicleInspection" FOR EACH ROW EXECUTE FUNCTION validate_inspection_evidence();

CREATE UNIQUE INDEX "VehicleInspection_reportId_organizationId_vehicleId_reporterId_key" ON "VehicleInspection"("reportId","organizationId","vehicleId","reporterId");
-- Pin the database pointer as well as the photo link; external object storage needs its own backup policy.
CREATE FUNCTION protect_inspection_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "VehiclePhoto" p JOIN "VehicleInspection" i ON i."reportId"=p."reportId" WHERE p."objectId"=OLD.id) THEN
  RAISE EXCEPTION 'Inspection stored-object evidence is immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_inspection_object BEFORE UPDATE OR DELETE ON "StoredObject" FOR EACH ROW EXECUTE FUNCTION protect_inspection_object();
