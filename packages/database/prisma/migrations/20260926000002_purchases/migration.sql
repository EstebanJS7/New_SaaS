-- Additive migration: EPIC-11 PUR-001 purchase data foundation.
--
-- Adds the tenant-scoped `purchase` draft aggregate of the Core `purchases`
-- domain (PRD §17, DEC-012) and its `purchase_line` children, referenced by the
-- EPIC-11 receiving slice (PUR-002). This migration is strictly additive: it
-- creates one enum, two tables and their indexes/constraints/triggers, alters no
-- existing table and inserts no rows — a purchase is user data, not seed data.
--
-- There is deliberately NO human-readable identifier (DEC-018): no `number`, no
-- `code` and no sequence column exists, and no allocation step is implied. The
-- cost surface is equally deliberate (DEC-013): one OPTIONAL informational
-- `unit_cost`, with no tax rate, no computed line total, no purchase total and
-- no valuation derived from it.
--
-- Foreign keys are RESTRICT everywhere. Tenant ownership is carried by the
-- composite shape `(tenant_id, id)` on both tables, so a purchase can only
-- reference a supplier of the SAME tenant and a line can only reference a
-- purchase and a catalog item of the SAME tenant:
--   * `purchase(tenant_id, supplier_id) -> supplier(tenant_id, id)`
--   * `purchase_line(tenant_id, purchase_id) -> purchase(tenant_id, id)`
--   * `purchase_line(tenant_id, catalog_item_id) -> catalog_item(tenant_id, id)`
--
-- The database additionally enforces the aggregate invariants the application
-- layer must respect:
--   * a line quantity is STRICTLY POSITIVE (`quantity > 0`), so a saved line
--     always means something, and a unit cost, when present, is non-negative
--     (`>= 0`);
--   * a duplicate `catalog_item_id` inside one purchase is rejected by the
--     tenant-leading unique key, which is what makes receiving deterministic
--     (one line, one movement);
--   * immutability is CONDITIONAL on the purchase status (DEC-019, refining
--     DEC-015): a `BEFORE DELETE` trigger on each table raises
--     `restrict_violation` ONLY while the owning purchase is RECEIVED or
--     CANCELLED. A DRAFT stays fully editable — including dropping a line
--     entered by mistake — while a confirmed or cancelled purchase and its
--     lines stay immutable and readable. This is deliberately NOT the
--     unconditional trigger shape the catalog, supplier and inventory tables
--     use: that shape would forbid draft line removal and contradict DEC-019.
--
-- Data classification: the supplier reference and the purchase quantities are
-- INTERNAL, the optional informational unit cost is INTERNAL, and logs and audit
-- carry ids and field names only — never a payload.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Purchase lifecycle (PRD §17), pinned to exactly these three states. Receiving
-- validates DRAFT and marks RECEIVED; CANCELLED is reachable only from DRAFT
-- (DEC-015). Evolve additively only.
CREATE TYPE "purchase_status" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

CREATE TABLE "purchase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "status" "purchase_status" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  -- Optional informational unit cost (DEC-013): a line without one is valid.
  "unit_cost" DECIMAL(14,2),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_line_pkey" PRIMARY KEY ("id"),
  -- A saved line always means something: a zero or negative quantity is
  -- rejected at the database, mirroring DEC-012's strictly-positive rule.
  CONSTRAINT "purchase_line_quantity_positive" CHECK ("quantity" > 0),
  -- A present cost can never be negative; absent stays representable.
  CONSTRAINT "purchase_line_unit_cost_non_negative" CHECK ("unit_cost" >= 0)
);

-- Tenant-ownership key: the target of the composite purchase FK from
-- `purchase_line`, so a line can only reference a purchase of the SAME tenant.
CREATE UNIQUE INDEX "purchase_tenant_id_id_key" ON "purchase"("tenant_id", "id");

-- Tenant list lookup: `(tenant_id, status)` serves the status-filtered purchase
-- list without a second scan (DEC-018 leaves no numbering column to sort on).
CREATE INDEX "purchase_tenant_id_status_idx" ON "purchase"("tenant_id", "status");

-- Tenant-ownership key, mirroring every other tenant-scoped aggregate.
CREATE UNIQUE INDEX "purchase_line_tenant_id_id_key" ON "purchase_line"("tenant_id", "id");

-- One line per catalog item inside one purchase (DEC-012): the duplicate
-- rejection that keeps receiving deterministic. tenant_id leads the key, so the
-- same item may appear in another tenant's purchase and in another purchase.
CREATE UNIQUE INDEX "purchase_line_tenant_id_purchase_id_catalog_item_id_key"
  ON "purchase_line"("tenant_id", "purchase_id", "catalog_item_id");

ALTER TABLE "purchase" ADD CONSTRAINT "purchase_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a purchase can only reference a supplier of
-- the SAME tenant, and the supplier can never be hard-deleted out from under it.
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_tenant_id_supplier_id_fkey"
  FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a line can only reference a purchase of the
-- SAME tenant. RESTRICT (never CASCADE), so a draft's lines are removed
-- explicitly by the draft edit path before the header — no delete ever happens
-- implicitly.
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_tenant_id_purchase_id_fkey"
  FOREIGN KEY ("tenant_id", "purchase_id") REFERENCES "purchase"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a line can only reference a catalog item of
-- the SAME tenant.
ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_tenant_id_catalog_item_id_fkey"
  FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CONDITIONAL immutability (DEC-019, refining DEC-015). A DELETE is rejected
-- ONLY while the purchase is RECEIVED or CANCELLED; a DRAFT is fully editable,
-- so a line entered by mistake can be removed. This is intentionally not the
-- unconditional `restrict_violation` shape used by the catalog, supplier and
-- inventory tables.
CREATE OR REPLACE FUNCTION "purchase_no_delete_when_received_or_cancelled"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('RECEIVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a received or cancelled purchase cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_no_delete_when_received_or_cancelled_trigger"
  BEFORE DELETE ON "purchase"
  FOR EACH ROW EXECUTE FUNCTION "purchase_no_delete_when_received_or_cancelled"();

-- The line trigger reads the OWNING purchase's status, so a line is deletable
-- exactly while its purchase is DRAFT.
CREATE OR REPLACE FUNCTION "purchase_line_no_delete_when_received_or_cancelled"()
RETURNS TRIGGER AS $$
DECLARE
  parent_status "purchase_status";
BEGIN
  SELECT "status" INTO parent_status
  FROM "purchase"
  WHERE "tenant_id" = OLD."tenant_id" AND "id" = OLD."purchase_id";

  IF parent_status IN ('RECEIVED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'a line of a received or cancelled purchase cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_line_no_delete_when_received_or_cancelled_trigger"
  BEFORE DELETE ON "purchase_line"
  FOR EACH ROW EXECUTE FUNCTION "purchase_line_no_delete_when_received_or_cancelled"();
