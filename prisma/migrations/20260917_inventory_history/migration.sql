CREATE INDEX "InventoryMovement_itemId_createdAt_id_idx" ON "InventoryMovement"("itemId","createdAt",id);
CREATE TRIGGER immutable_inventory_movement BEFORE UPDATE OR DELETE ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION protect_audit();
