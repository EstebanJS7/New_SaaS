-- DEC-005 + ADR-004 · Migration 009 · Tenant lifecycle status
--
-- Additive and reversible: creates the tenant_status enum and a NOT NULL
-- status column on tenant defaulting to ACTIVE. Existing tenants backfill to
-- ACTIVE in the same statement, so no row is rewritten and no invariant
-- depends on the new column yet.

-- Tenant lifecycle enum. Only ACTIVE and SUSPENDED exist (ADR-004 D1).
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- NOT NULL with a constant DEFAULT: PostgreSQL backfills every existing row in
-- one pass without a separate UPDATE.
ALTER TABLE "tenant"
    ADD COLUMN "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE';
