-- Additive migration: EPIC-12 POS-001 sale data foundation.
--
-- Adds the tenant-scoped `sale` draft aggregate of the Core `sales` domain
-- (PRD §18, DEC-021, DEC-022, DEC-023, DEC-027, DEC-028) and its `sale_line`
-- children. This migration is strictly additive: it creates one enum, two
-- tables and their indexes/constraints/triggers, alters no existing table and
-- inserts no rows — a sale is user data, not seed data.
--
-- There is deliberately NO human-readable identifier (DEC-027): no `number`, no
-- `code` and no sequence column exists, and no allocation step is implied. The
-- scope surface is equally deliberate (DEC-028): `customer_id` is OPTIONAL
-- through a composite tenant-ownership FK, and there is no discount column, no
-- `appointment_id` and no `patient_id`. No `total` column exists either
-- (DEC-021): the sale total is the sum of the line totals.
--
-- Foreign keys are RESTRICT everywhere. Tenant ownership is carried by the
-- composite shape `(tenant_id, id)` on both tables, so a sale can only
-- reference a customer of the SAME tenant and a line can only reference a sale
-- and a catalog item of the SAME tenant:
--   * `sale(tenant_id, customer_id) -> customer(tenant_id, id)`
--   * `sale_line(tenant_id, sale_id) -> sale(tenant_id, id)`
--   * `sale_line(tenant_id, catalog_item_id) -> catalog_item(tenant_id, id)`
--
-- `sale_line.rate_code` additionally carries a RESTRICT reference to the GLOBAL
-- `tax_rate(code)` unique column (DEC-021), so the frozen snapshot can only name
-- a seeded rate and a rate a sale used can never be deleted.
--
-- The database additionally enforces the aggregate invariants the application
-- layer must respect:
--   * a line quantity is STRICTLY POSITIVE (`quantity > 0`) and every money
--     amount is non-negative (`>= 0`), so a saved line always means something;
--   * a duplicate `catalog_item_id` inside one sale is rejected by the
--     tenant-leading unique key, which is what keeps the update command's
--     line-set reconciliation keyed by catalog item deterministic (one line per
--     item);
--   * immutability is CONDITIONAL on the sale status (DEC-023): a `BEFORE
--     DELETE` trigger on each table raises `restrict_violation` ONLY while the
--     owning sale is COMPLETED or CANCELLED. A DRAFT stays fully editable —
--     including dropping a line entered by mistake during the update command's
--     reconciliation — while a settled sale and its lines stay immutable and
--     readable. This is deliberately NOT the unconditional trigger shape the
--     catalog, supplier and inventory tables use: that shape would forbid draft
--     line removal.
--
-- Data classification: the currency, the status and every line money amount are
-- INTERNAL (PRD §41), and logs and audit carry ids and field names only — never
-- a payload.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Sale lifecycle (PRD §18), pinned to exactly these three states. `COMPLETED`
-- is produced only by the CompleteSale transaction (POS-003) and `CANCELLED` is
-- reachable only from DRAFT (DEC-023). Evolve additively only.
CREATE TYPE "sale_status" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

CREATE TABLE "sale" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  -- OPTIONAL customer (DEC-028): a walk-in counter sale needs none.
  "customer_id" UUID,
  -- One ISO 4217 currency per sale, resolved server-side from the typed
  -- `sales.defaultCurrency` tenant setting (DEC-022). No conversion exists.
  "currency" VARCHAR(3) NOT NULL,
  "status" "sale_status" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sale_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  "catalog_item_id" UUID NOT NULL,
  -- Frozen stable rate code (DEC-021), backed by the RESTRICT reference to the
  -- global `tax_rate(code)` unique column declared below.
  "rate_code" VARCHAR(20) NOT NULL,
  "unit_price" DECIMAL(14,2) NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "line_total" DECIMAL(14,2) NOT NULL,
  "taxable_base" DECIMAL(14,2) NOT NULL,
  "tax_amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sale_line_pkey" PRIMARY KEY ("id"),
  -- A saved line always means something: a zero or negative quantity is
  -- rejected at the database, mirroring DEC-021's strictly-positive rule.
  CONSTRAINT "sale_line_quantity_positive" CHECK ("quantity" > 0),
  -- The frozen money amounts can never be negative (DEC-021).
  CONSTRAINT "sale_line_unit_price_non_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "sale_line_line_total_non_negative" CHECK ("line_total" >= 0),
  CONSTRAINT "sale_line_taxable_base_non_negative" CHECK ("taxable_base" >= 0),
  CONSTRAINT "sale_line_tax_amount_non_negative" CHECK ("tax_amount" >= 0)
);

-- Tenant-ownership key: the target of the composite sale FK from `sale_line`,
-- so a line can only reference a sale of the SAME tenant.
CREATE UNIQUE INDEX "sale_tenant_id_id_key" ON "sale"("tenant_id", "id");

-- Tenant list lookup: `(tenant_id, status)` serves the status-filtered sale
-- list without a second scan (DEC-027 leaves no numbering column to sort on).
CREATE INDEX "sale_tenant_id_status_idx" ON "sale"("tenant_id", "status");

-- Tenant-ownership key, mirroring every other tenant-scoped aggregate.
CREATE UNIQUE INDEX "sale_line_tenant_id_id_key" ON "sale_line"("tenant_id", "id");

-- One line per catalog item inside one sale: the duplicate rejection that keeps
-- the update command's line-set reconciliation keyed by `catalog_item_id`
-- deterministic. tenant_id leads the key, so the same item may appear in
-- another tenant's sale and in another sale. UNCONDITIONAL by design: a
-- duplicate of one item inside a single draft is never a valid state, whatever
-- the sale status.
CREATE UNIQUE INDEX "sale_line_tenant_id_sale_id_catalog_item_id_key"
  ON "sale_line"("tenant_id", "sale_id", "catalog_item_id");

ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: when a customer is present it must be in the
-- SAME tenant, and the customer can never be hard-deleted out from under a
-- sale. OPTIONAL by column nullability (MATCH SIMPLE), so a walk-in sale is a
-- valid state and is never rejected for lacking a customer (DEC-028).
ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a line can only reference a sale of the SAME
-- tenant. RESTRICT (never CASCADE), so a draft's lines are removed explicitly
-- by the update command's reconciliation — no delete ever happens implicitly.
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_sale_id_fkey"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Composite tenant-ownership FK: a line can only reference a catalog item of
-- the SAME tenant.
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_catalog_item_id_fkey"
  FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- RESTRICT reference to the GLOBAL rate row (DEC-021): `rate_code` can only
-- name a seeded `tax_rate.code`, so an unknown or invalid code is not a
-- representable state, and a rate a sale used can never be deleted or renamed.
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_rate_code_fkey"
  FOREIGN KEY ("rate_code") REFERENCES "tax_rate"("code")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CONDITIONAL immutability (DEC-023). A DELETE is rejected ONLY while the sale
-- is COMPLETED or CANCELLED; a DRAFT is fully editable, so a line removed by
-- the update command's reconciliation can be dropped. This is intentionally not
-- the unconditional `restrict_violation` shape used by the catalog, supplier
-- and inventory tables.
CREATE OR REPLACE FUNCTION "sale_no_delete_when_completed_or_cancelled"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a completed or cancelled sale cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sale_no_delete_when_completed_or_cancelled_trigger"
  BEFORE DELETE ON "sale"
  FOR EACH ROW EXECUTE FUNCTION "sale_no_delete_when_completed_or_cancelled"();

-- The line trigger reads the OWNING sale's status, so a line is deletable
-- exactly while its sale is DRAFT.
CREATE OR REPLACE FUNCTION "sale_line_no_delete_when_completed_or_cancelled"()
RETURNS TRIGGER AS $$
DECLARE
  parent_status "sale_status";
BEGIN
  SELECT "status" INTO parent_status
  FROM "sale"
  WHERE "tenant_id" = OLD."tenant_id" AND "id" = OLD."sale_id";

  IF parent_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'a line of a completed or cancelled sale cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sale_line_no_delete_when_completed_or_cancelled_trigger"
  BEFORE DELETE ON "sale_line"
  FOR EACH ROW EXECUTE FUNCTION "sale_line_no_delete_when_completed_or_cancelled"();
