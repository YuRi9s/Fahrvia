CREATE UNIQUE INDEX "InventoryItem_id_organizationId_key" ON "InventoryItem"(id,"organizationId");
CREATE TABLE "InventoryCustody" (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "itemId" TEXT NOT NULL,
 "driverId" TEXT,
 "vehicleId" TEXT,
 quantity INTEGER NOT NULL,
 returned INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,
 "requestId" TEXT NOT NULL,
 reason TEXT NOT NULL,
 "issuedBy" TEXT NOT NULL,
 "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "InventoryCustody_item_fkey" FOREIGN KEY ("itemId","organizationId") REFERENCES "InventoryItem"(id,"organizationId"),
 CONSTRAINT "InventoryCustody_driver_fkey" FOREIGN KEY ("driverId","organizationId") REFERENCES "DriverProfile"(id,"organizationId"),
 CONSTRAINT "InventoryCustody_vehicle_fkey" FOREIGN KEY ("vehicleId","organizationId") REFERENCES "Vehicle"(id,"organizationId"),
 CONSTRAINT "InventoryCustody_holder" CHECK (("driverId" IS NOT NULL)::int + ("vehicleId" IS NOT NULL)::int = 1),
 CONSTRAINT "InventoryCustody_quantity" CHECK (quantity>0 AND returned>=0 AND returned<=quantity AND version>0)
);
CREATE UNIQUE INDEX "InventoryCustody_organizationId_requestId_key" ON "InventoryCustody"("organizationId","requestId");
CREATE UNIQUE INDEX "InventoryCustody_id_itemId_key" ON "InventoryCustody"(id,"itemId");
CREATE INDEX "InventoryCustody_organizationId_itemId_issuedAt_idx" ON "InventoryCustody"("organizationId","itemId","issuedAt");
ALTER TABLE "InventoryMovement" ADD COLUMN type TEXT NOT NULL DEFAULT 'ADJUST', ADD COLUMN "custodyId" TEXT;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_custody_fkey" FOREIGN KEY ("custodyId","itemId") REFERENCES "InventoryCustody"(id,"itemId");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_custody_type" CHECK ((type='ADJUST' AND "custodyId" IS NULL) OR (type='ISSUE' AND "custodyId" IS NOT NULL AND quantity<0) OR (type='RETURN' AND "custodyId" IS NOT NULL AND quantity>0));
