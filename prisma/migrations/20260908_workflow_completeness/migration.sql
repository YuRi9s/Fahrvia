ALTER TABLE "Wave" ADD COLUMN "driverId" TEXT, ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "Wave" ADD CONSTRAINT "wave_driver_tenant" FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId");
ALTER TABLE "Wave" ADD CONSTRAINT "wave_vehicle_tenant" FOREIGN KEY ("vehicleId","organizationId") REFERENCES "Vehicle"(id,"organizationId");
ALTER TABLE "ScoreImport" ADD COLUMN "sourceKey" TEXT, ADD COLUMN "sourceHash" TEXT;
ALTER TABLE "Message" ADD COLUMN "threadId" TEXT;
UPDATE "Message" SET "threadId"=id;
CREATE INDEX "message_thread" ON "Message"("organizationId","threadId","createdAt");
