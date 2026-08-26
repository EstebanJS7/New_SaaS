-- EPIC-02 · Migration 005 · Per-tenant RBAC role-permission overrides
-- (DEC-003, maintainer-authorized 2026-08-25; review CRITICAL-1 resolution).
--
-- Table: tenant_role_permission_override. Roles stay GLOBAL reference data —
-- this migration adds ONLY the tenant-local override layer, so one tenant can
-- never rewrite another tenant's effective permissions through shared rows.
--
-- Effective set of (tenant, role) =
--   (role_permission baseline ∪ overrides granted=true) − overrides granted=false.
--
-- Conventions (design D2): snake_case identifiers, UUID public ids via
-- gen_random_uuid(), timestamptz(3) UTC timestamps, RESTRICT FKs everywhere.
-- `permission_key` is TEXT validated at service level against the seeded
-- catalog; no FK toward permission(id) keeps the catalog replaceable as code.

CREATE TABLE "tenant_role_permission_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_role_permission_override_pkey" PRIMARY KEY ("id")
);

-- One override verdict per (tenant, role, catalog key).
CREATE UNIQUE INDEX "tenant_role_permission_override_tenant_id_role_id_permission_key_key" ON "tenant_role_permission_override"("tenant_id", "role_id", "permission_key");

-- Tenant-scoped administration lookups resolve by (tenant, role).
CREATE INDEX "tenant_role_permission_override_tenant_id_role_id_idx" ON "tenant_role_permission_override"("tenant_id", "role_id");

ALTER TABLE "tenant_role_permission_override" ADD CONSTRAINT "tenant_role_permission_override_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tenant_role_permission_override" ADD CONSTRAINT "tenant_role_permission_override_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
