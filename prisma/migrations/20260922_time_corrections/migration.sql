CREATE UNIQUE INDEX "WorkTimeEntry_id_organizationId_driverId_key" ON "WorkTimeEntry"(id,"organizationId","driverId");
CREATE TABLE "WorkTimeCorrection" (
 id TEXT PRIMARY KEY,
 "entryId" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL,
 "driverId" TEXT NOT NULL,
 "requestedBy" TEXT NOT NULL,
 "expectedVersion" INTEGER NOT NULL CHECK("expectedVersion">0),
 fingerprint TEXT NOT NULL,
 before JSONB NOT NULL,
 "startAt" TIMESTAMP(3) NOT NULL,
 "endAt" TIMESTAMP(3) NOT NULL,
 "breakMilliseconds" BIGINT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 2000),
 "evidenceDocumentId" TEXT,
 "evidenceObjectId" TEXT REFERENCES "StoredObject"(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'PENDING',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewedBy" TEXT,
 "reviewedAt" TIMESTAMP(3),
 "decisionReason" TEXT,
 "decisionId" TEXT,
 after JSONB,
 CONSTRAINT correction_entry_scope FOREIGN KEY("entryId","organizationId","driverId") REFERENCES "WorkTimeEntry"(id,"organizationId","driverId") ON DELETE RESTRICT,
 CONSTRAINT correction_duration CHECK("endAt">"startAt" AND "breakMilliseconds">=0 AND "breakMilliseconds"<EXTRACT(EPOCH FROM ("endAt"-"startAt"))*1000),
 CONSTRAINT correction_review CHECK(COALESCE(
  (status='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "decisionReason" IS NULL AND "decisionId" IS NULL AND after IS NULL) OR
  (status IN ('APPROVED','REJECTED') AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND length(trim("decisionReason")) BETWEEN 10 AND 2000 AND "decisionId" IS NOT NULL AND ((status='APPROVED' AND after IS NOT NULL) OR (status='REJECTED' AND after IS NULL))),false))
);
CREATE UNIQUE INDEX one_pending_time_correction ON "WorkTimeCorrection"("entryId") WHERE status='PENDING';
CREATE UNIQUE INDEX "WorkTimeCorrection_reviewedBy_decisionId_key" ON "WorkTimeCorrection"("reviewedBy","decisionId");
CREATE INDEX "WorkTimeCorrection_organizationId_driverId_createdAt_idx" ON "WorkTimeCorrection"("organizationId","driverId","createdAt");
CREATE INDEX "WorkTimeCorrection_organizationId_status_createdAt_idx" ON "WorkTimeCorrection"("organizationId",status,"createdAt");
CREATE FUNCTION protect_time_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Correction history is immutable'; END IF;
 IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED') OR
 (to_jsonb(OLD)-ARRAY['status','reviewedBy','reviewedAt','decisionReason','decisionId','after']) IS DISTINCT FROM
 (to_jsonb(NEW)-ARRAY['status','reviewedBy','reviewedAt','decisionReason','decisionId','after']) THEN
  RAISE EXCEPTION 'Correction proposals are immutable and decisions are final';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_time_correction BEFORE UPDATE OR DELETE ON "WorkTimeCorrection" FOR EACH ROW EXECUTE FUNCTION protect_time_correction();
