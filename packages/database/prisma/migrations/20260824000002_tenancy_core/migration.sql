-- EPIC-01 · Migration 002 · Tenancy core + inert scaffolding (tasks 2.3 / U4).
--
-- Tables: tenant, branch (schema-only), tenant_membership,
-- customer_portal_access (schema-only). Enum: tenant_membership_status.
--
-- Conventions (design D2): snake_case identifiers, UUID public ids via
-- gen_random_uuid(), timestamptz(3) UTC timestamps, no floating point money.
--
-- KNOWN DEVIATION (accepted during batch-mode apply):
--   tenant_membership.role_id is created here as a final NOT NULL uuid column,
--   but its FOREIGN KEY to role(id) ON DELETE RESTRICT is added by an additive
--   ALTER in migration 003 (task 2.4 / U5). Sequential migrations cannot
--   forward-reference the role table, which only exists from migration 003 on.
--
-- Scaffolding note: branch and customer_portal_access are INERT during
-- EPIC-01 — no endpoint or service mutates them; route-enumeration proof lands
-- with task 5.3. customer_portal_access.contact_email is INTERNAL: never
-- logged. Tenant creation is ops/seed-only; no registration surface exists.

CREATE TYPE "tenant_membership_status" AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE "tenant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

CREATE TABLE "branch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "branch_tenant_id_idx" ON "branch"("tenant_id");

CREATE TABLE "tenant_membership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    -- FK to role(id) deferred to migration 003 (see header deviation note).
    "role_id" UUID NOT NULL,
    "status" "tenant_membership_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_membership_pkey" PRIMARY KEY ("id")
);

-- Login resolves memberships by profile; the composite unique below leads
-- with tenant_id and cannot serve that lookup.
CREATE INDEX "tenant_membership_user_profile_id_idx" ON "tenant_membership"("user_profile_id");

-- One membership per (tenant, profile).
CREATE UNIQUE INDEX "tenant_membership_tenant_id_user_profile_id_key" ON "tenant_membership"("tenant_id", "user_profile_id");

CREATE TABLE "customer_portal_access" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_portal_access_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_portal_access_tenant_id_idx" ON "customer_portal_access"("tenant_id");

ALTER TABLE "branch" ADD CONSTRAINT "branch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "user_profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "customer_portal_access" ADD CONSTRAINT "customer_portal_access_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
