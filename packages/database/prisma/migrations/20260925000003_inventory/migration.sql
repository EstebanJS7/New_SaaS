-- Additive migration: EPIC-10 WU1 CAT-006 inventory data foundation.
--
-- Adds the tenant-scoped, ledger-based stock foundation of PRD §16:
--   * ONE column on the existing `catalog_item` table — `tracks_stock`, a
--     NOT NULL boolean with a database default, BACKFILLED BY KIND so no
--     existing row keeps an accidental value;
--   * the `stock_movement_type` enum, which this slice pins to `ADJUSTMENT`
--     only (PURCHASE/SALE/TRANSFER_*/reversals arrive additively with
--     EPIC-11/EPIC-12);
--   * the `stock_movement` ledger table and the `stock_balance` projection.
--
-- The migration is strictly additive and mutates NO business data beyond the
-- required by-kind backfill of the new column: it inserts no rows (no data
-- seed), drops nothing and redefines no existing constraint.
--
-- Foreign keys are RESTRICT everywhere. Tenant ownership is carried by the
-- composite shape `(tenant_id, catalog_item_id) -> catalog_item(tenant_id, id)`,
-- so PostgreSQL rejects any movement or balance whose tenant does not own the
-- referenced item. The compensating self-reference
-- `(tenant_id, reverses_movement_id) -> stock_movement(tenant_id, id)` keeps a
-- future reversal inside the same tenant; it is reserved now and populated
-- later.
--
-- The database enforces the ledger invariants the application layer must
-- respect:
--   * a movement quantity is signed but never zero (`quantity <> 0`), so a
--     movement always moves stock;
--   * a balance is never negative (`quantity >= 0`) — the fixed BLOCK policy;
--   * a confirmed movement can never be hard-deleted (DELETE raises
--     `restrict_violation`), and there is deliberately NO update semantics at
--     the schema level: a correction is a compensating movement.
--
-- Data classification: stock quantities and adjustment reasons are INTERNAL;
-- logs and audit carry stable IDs only.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- The single stock dimension on the catalog (PRD §15/§16): a manual,
-- staff-editable boolean. The database default covers rows inserted without an
-- explicit value; the write path (a later slice of this epic) sets it by kind.
ALTER TABLE "catalog_item" ADD COLUMN "tracks_stock" BOOLEAN NOT NULL DEFAULT true;

-- By-kind backfill: physical-item kinds track stock, services do not. Expressed
-- as one deterministic UPDATE over the existing rows, so the historical data is
-- correct before the column becomes authoritative for the ledger.
UPDATE "catalog_item" SET "tracks_stock" = ("kind" <> 'SERVICE');

CREATE TYPE "stock_movement_type" AS ENUM ('ADJUSTMENT');

CREATE TABLE "stock_movement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  "type" "stock_movement_type" NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "reason" TEXT NOT NULL,
  "reverses_movement_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id"),
  -- Signed quantity: positive is an input, negative an output. Zero is not a
  -- movement, so it is rejected at the database.
  CONSTRAINT "stock_movement_quantity_non_zero" CHECK ("quantity" <> 0)
);

CREATE TABLE "stock_balance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id"),
  -- The projection never goes negative: the fixed BLOCK negative-stock policy
  -- is enforced here as the last line of defence, not as the primary rule.
  CONSTRAINT "stock_balance_quantity_non_negative" CHECK ("quantity" >= 0)
);

-- Tenant-ownership key: target of the composite item FK and of the compensating
-- self-FK from `stock_movement`.
CREATE UNIQUE INDEX "stock_movement_tenant_id_id_key" ON "stock_movement"("tenant_id", "id");

-- Exactly one balance row per (tenant, item): the projection is keyed by the
-- pair, so an adjustment upserts a single row instead of accumulating them.
CREATE UNIQUE INDEX "stock_balance_tenant_id_catalog_item_id_key"
  ON "stock_balance"("tenant_id", "catalog_item_id");

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a movement can only reference an item of the
-- SAME tenant, and the item can never be hard-deleted out from under it.
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_catalog_item_id_fkey"
  FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Reserved compensating link (PRD §16, reversals): a future reversal points at
-- the movement it compensates. Composite, so the referenced movement is in the
-- same tenant. Nullable: this slice never populates it.
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_reverses_movement_id_fkey"
  FOREIGN KEY ("tenant_id", "reverses_movement_id") REFERENCES "stock_movement"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK, identical to the movement shape.
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_catalog_item_id_fkey"
  FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "stock_movement_tenant_id_catalog_item_id_idx"
  ON "stock_movement"("tenant_id", "catalog_item_id");
CREATE INDEX "stock_movement_tenant_id_reverses_movement_id_idx"
  ON "stock_movement"("tenant_id", "reverses_movement_id");
CREATE INDEX "stock_balance_tenant_id_idx" ON "stock_balance"("tenant_id");

-- Confirmed movements are immutable: a DELETE raises instead of silently
-- destroying ledger history. There is no UPDATE trigger because the ledger has
-- no update semantics at all — the application never issues one and a
-- correction is a compensating movement, never an edit.
CREATE OR REPLACE FUNCTION "stock_movement_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stock movements are immutable and cannot be hard-deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movement_no_delete_trigger"
  BEFORE DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION "stock_movement_no_delete"();
