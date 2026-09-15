ALTER TABLE "Wave" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "Wave_id_organizationId_key" ON "Wave"(id,"organizationId");
CREATE TABLE "WaveParticipant" (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "waveId" TEXT NOT NULL,
  "driverId" TEXT,
  "vehicleId" TEXT,
  CONSTRAINT "WaveParticipant_wave_fkey" FOREIGN KEY ("waveId","organizationId") REFERENCES "Wave"(id,"organizationId") ON DELETE CASCADE,
  CONSTRAINT "WaveParticipant_driver_fkey" FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId"),
  CONSTRAINT "WaveParticipant_vehicle_fkey" FOREIGN KEY ("vehicleId","organizationId") REFERENCES "Vehicle"(id,"organizationId"),
  CONSTRAINT "WaveParticipant_nonempty" CHECK ("driverId" IS NOT NULL OR "vehicleId" IS NOT NULL)
);
CREATE UNIQUE INDEX "WaveParticipant_waveId_driverId_key" ON "WaveParticipant"("waveId","driverId");
CREATE UNIQUE INDEX "WaveParticipant_waveId_vehicleId_key" ON "WaveParticipant"("waveId","vehicleId");
CREATE INDEX "WaveParticipant_organizationId_driverId_idx" ON "WaveParticipant"("organizationId","driverId");
CREATE INDEX "WaveParticipant_organizationId_vehicleId_idx" ON "WaveParticipant"("organizationId","vehicleId");
-- Preserve existing full and partial participants; planned partial pairs must be completed before activation.
INSERT INTO "WaveParticipant" (id,"organizationId","waveId","driverId","vehicleId")
SELECT 'legacy:' || id,"organizationId",id,"driverId","vehicleId" FROM "Wave" WHERE "driverId" IS NOT NULL OR "vehicleId" IS NOT NULL;
