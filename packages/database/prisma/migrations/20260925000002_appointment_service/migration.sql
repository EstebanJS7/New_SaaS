-- Additive migration: EPIC-09 WU4 CAT-005 appointment service association.
--
-- Adds ONE nullable column to the existing `appointment` table: `service_id`, an
-- OPTIONAL reference to a tenant-scoped `catalog_item` of kind SERVICE. The
-- migration is strictly additive and MUTATES NO DATA:
--   * the column is nullable with no default, so every existing appointment
--     (staff and portal alike) stays valid and no row is rewritten or backfilled;
--   * no other table is touched and no constraint is dropped or redefined.
--
-- The reference reuses the SAME composite tenant-ownership FK shape as the
-- Branch/Patient/professional-membership/booking-request anchors:
--   ("tenant_id", "service_id") -> "catalog_item"("tenant_id", "id")
-- so PostgreSQL rejects any appointment whose tenant does not own the referenced
-- item, and ON DELETE/UPDATE RESTRICT matches the neighbors. The referenced
-- unique key `catalog_item_tenant_id_id_key` already exists (created by
-- 20260925000001_catalog), so this migration declares no new unique target.
--
-- The database deliberately does NOT encode "kind = SERVICE" or "is_active".
-- Both are application rules — exactly like the VETERINARIAN role rule the
-- professional-membership anchor enforces in the service layer — and `is_active`
-- is mutable through catalog deactivation. The API resolves the anchor and
-- rejects an inactive or wrong-kind item with 400 VALIDATION_FAILED. The FK
-- carries tenant ownership only. No price, tax, rate or currency value crosses
-- this reference: it stores the item's identity, never a monetary value.
--
-- Data classification: appointment scheduling details remain CONFIDENTIAL; no
-- catalog value is copied onto the appointment.

ALTER TABLE "appointment" ADD COLUMN "service_id" UUID;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_service_id_fkey"
  FOREIGN KEY ("tenant_id", "service_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "appointment_tenant_id_service_id_idx"
  ON "appointment"("tenant_id", "service_id");
