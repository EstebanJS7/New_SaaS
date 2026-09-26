-- Additive migration: EPIC-11 WU1 SUP-001 supplier data foundation.
--
-- Adds the tenant-scoped `supplier` registry (PRD §5, §17; DEC-011) referenced
-- by the EPIC-11 purchase aggregate. This migration is strictly additive: it
-- creates one new table, alters no existing table and inserts no rows — a
-- supplier is user data, not seed data.
--
-- Foreign keys are RESTRICT, so a tenant can never be deleted while it still
-- owns suppliers and a supplier can never be orphaned. The database additionally
-- enforces the invariants the application layer must respect:
--   * a supplier can never be hard-deleted (DELETE raises `restrict_violation`);
--     removal is deactivation through `is_active`, so historical purchases keep
--     their supplier reference;
--   * `tax_id` is unique per tenant WHEN PRESENT. The mechanism is the explicit
--     PARTIAL unique index `supplier_tenant_id_tax_id_key` on
--     (tenant_id, tax_id) WHERE tax_id IS NOT NULL, declared as raw SQL because
--     Prisma cannot express partial indexes. Absent identifiers are outside the
--     index entirely, so any number of suppliers may omit the identifier, while
--     a repeated present value inside one tenant is rejected.
--   * `name` is bounded to 1..200 characters, matching the column and the W2
--     DTO bound.
--
-- Data classification: tax_id, legal_name, email, phone and address are
-- CONFIDENTIAL; name is INTERNAL; application logs carry ids only.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "supplier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "legal_name" VARCHAR(200),
  "tax_id" VARCHAR(50),
  "email" VARCHAR(320),
  "phone" VARCHAR(50),
  "address" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_pkey" PRIMARY KEY ("id"),
  -- Required trading name, 1..200 characters. The column already caps the upper
  -- bound; the CHECK adds the non-empty lower bound and keeps one authoritative
  -- length rule in the DDL that the W2 DTO mirrors.
  CONSTRAINT "supplier_name_length" CHECK (char_length("name") BETWEEN 1 AND 200)
);

-- Tenant-ownership key: the target of the composite supplier FK from the
-- EPIC-11 purchase aggregate, so a purchase can only reference a supplier of
-- the SAME tenant.
CREATE UNIQUE INDEX "supplier_tenant_id_id_key" ON "supplier"("tenant_id", "id");

-- Per-tenant tax-id uniqueness WHEN PRESENT. Explicit PARTIAL unique index,
-- declared as raw SQL because Prisma cannot express partial indexes: the
-- `WHERE tax_id IS NOT NULL` predicate leaves absent identifiers outside the
-- index entirely, so multiple suppliers with an absent tax_id coexist while a
-- repeated present value inside one tenant is rejected. The same tax_id in
-- another tenant is a different key because tenant_id leads the index.
CREATE UNIQUE INDEX "supplier_tenant_id_tax_id_key" ON "supplier"("tenant_id", "tax_id") WHERE "tax_id" IS NOT NULL;

-- Tenant list lookup: `(tenant_id, name)` serves the alphabetical supplier list.
CREATE INDEX "supplier_tenant_id_name_idx" ON "supplier"("tenant_id", "name");

ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Suppliers are never hard-deleted: removal is deactivation through is_active,
-- so a DELETE raises instead of silently destroying the supplier a purchase
-- references.
CREATE OR REPLACE FUNCTION "supplier_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'suppliers are deactivated and cannot be hard-deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "supplier_no_delete_trigger"
  BEFORE DELETE ON "supplier"
  FOR EACH ROW EXECUTE FUNCTION "supplier_no_delete"();
