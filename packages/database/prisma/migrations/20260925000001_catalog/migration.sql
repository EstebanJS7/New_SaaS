-- Additive migration: EPIC-09 WU1 CAT-001 catalog foundation.
--
-- Adds the tenant-scoped `catalog_item` aggregate and the GLOBAL seeded
-- `tax_rate` reference catalog it references (PRD §15, DEC-010). No backfill is
-- required: neither table exists yet, and this migration deliberately inserts
-- NO rows — the three global rates (EXEMPT, IVA_5, IVA_10) are owned by the
-- reference seed, which must run before any item can be inserted.
--
-- Foreign keys are RESTRICT everywhere, so a tenant or a referenced tax rate
-- can never be orphaned or hard-deleted. The database additionally enforces the
-- invariants the application layer must respect:
--   * a catalog item cannot be hard-deleted (DELETE rejected); removal is
--     deactivation through is_active;
--   * the optional reference price is an amount/currency pair — both present or
--     both absent — with a non-negative amount and an ISO 4217 uppercase code;
--   * a tax rate is non-negative.
-- Data classification: catalog configuration is INTERNAL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "catalog_item_kind" AS ENUM ('PRODUCT', 'SERVICE', 'MEDICATION', 'SUPPLY');

CREATE TABLE "tax_rate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rate" DECIMAL(5,2) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tax_rate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_rate_rate_non_negative" CHECK ("rate" >= 0)
);

CREATE TABLE "catalog_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "kind" "catalog_item_kind" NOT NULL,
  "name" TEXT NOT NULL,
  "tax_rate_id" UUID NOT NULL,
  "reference_price_amount" DECIMAL(14,2),
  "reference_price_currency" VARCHAR(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catalog_item_pkey" PRIMARY KEY ("id"),
  -- The reference price is one pair (DEC-010): both columns present or both
  -- absent. The equality of the two NULL tests rejects an amount without a
  -- currency AND a currency without an amount, so no reader ever guesses one.
  CONSTRAINT "catalog_item_reference_price_pair_check"
    CHECK (("reference_price_amount" IS NULL) = ("reference_price_currency" IS NULL)),
  CONSTRAINT "catalog_item_reference_price_non_negative"
    CHECK ("reference_price_amount" >= 0),
  -- ISO 4217 shape only; the accepted code list is validated by the API. NULL
  -- passes the CHECK (a NULL result is not a violation), so a pair-less item is
  -- unaffected.
  CONSTRAINT "catalog_item_reference_price_currency_format"
    CHECK ("reference_price_currency" ~ '^[A-Z]{3}$')
);

-- Tenant-ownership key: the target of the future composite service FK from
-- `appointment` (EPIC-09 WU4), so an appointment can only reference a service
-- item of the SAME tenant.
CREATE UNIQUE INDEX "catalog_item_tenant_id_id_key" ON "catalog_item"("tenant_id", "id");

CREATE UNIQUE INDEX "tax_rate_code_key" ON "tax_rate"("code");

ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Every catalog item must reference exactly one GLOBAL seeded rate: the column
-- is NOT NULL and the FK is RESTRICT, so a rate-less item is not a representable
-- state and a referenced rate row can never be deleted.
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tax_rate_id_fkey"
  FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rate"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "catalog_item_tenant_id_idx" ON "catalog_item"("tenant_id");
CREATE INDEX "catalog_item_tenant_id_is_active_idx" ON "catalog_item"("tenant_id", "is_active");
CREATE INDEX "catalog_item_tax_rate_id_idx" ON "catalog_item"("tax_rate_id");

-- Catalog items are never hard-deleted: removal is deactivation through
-- is_active, so a DELETE raises instead of silently destroying catalog history.
CREATE OR REPLACE FUNCTION "catalog_item_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'catalog items are deactivated and cannot be hard-deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "catalog_item_no_delete_trigger"
  BEFORE DELETE ON "catalog_item"
  FOR EACH ROW EXECUTE FUNCTION "catalog_item_no_delete"();
