-- EPIC-01 · Migration 004 · Entitlements boundary + audit scaffolding
-- (tasks 2.4 / U5, split 2 of 2 — see the split note in migration 003).
--
-- Tables: feature_code, plan, plan_capability, tenant_entitlement, audit_log.
-- Enum: audit_actor_type.
--
-- Conventions (design D2): snake_case identifiers, UUID public ids via
-- gen_random_uuid(), timestamptz(3) UTC timestamps, RESTRICT FKs everywhere.
--
-- Entitlements semantics (design D8): plans only pre-map feature codes; access
-- is granted exclusively through explicit tenant_entitlement rows — nothing
-- grants automatically. UNIQUE(tenant_id, feature_code_id) doubles as the
-- lookup index for EntitlementsService.has() (task 7.1).
--
-- Audit semantics (design D9): audit_log is APPEND-ONLY. Rows are written once
-- via AuditWriter.append() and never updated or deleted; there is no
-- updated_at column by design. metadata jsonb payloads are sanitized before
-- append — CONFIDENTIAL/RESTRICTED material is never logged. The
-- (tenant_id, created_at DESC) index serves trail queries.

CREATE TYPE "audit_actor_type" AS ENUM ('STAFF', 'SYSTEM');

CREATE TABLE "feature_code" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_code_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_code_code_key" ON "feature_code"("code");

CREATE TABLE "plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

CREATE TABLE "plan_capability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "feature_code_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_capability_pkey" PRIMARY KEY ("id")
);

-- One mapping per (plan, feature code); doubles as the seed upsert key.
CREATE UNIQUE INDEX "plan_capability_plan_id_feature_code_id_key" ON "plan_capability"("plan_id", "feature_code_id");

CREATE TABLE "tenant_entitlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "feature_code_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_entitlement_pkey" PRIMARY KEY ("id")
);

-- One grant per (tenant, feature code); serves has(tenant, code) lookups.
CREATE UNIQUE INDEX "tenant_entitlement_tenant_id_feature_code_id_key" ON "tenant_entitlement"("tenant_id", "feature_code_id");

CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Null for system-wide events.
    "tenant_id" UUID,
    -- Null for SYSTEM actor rows.
    "actor_user_profile_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    -- Event name in "domain.event" form.
    "action" TEXT NOT NULL,
    -- Polymorphic target coordinates; TEXT because targets span domains.
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

ALTER TABLE "plan_capability" ADD CONSTRAINT "plan_capability_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "plan_capability" ADD CONSTRAINT "plan_capability_feature_code_id_fkey" FOREIGN KEY ("feature_code_id") REFERENCES "feature_code"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tenant_entitlement" ADD CONSTRAINT "tenant_entitlement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tenant_entitlement" ADD CONSTRAINT "tenant_entitlement_feature_code_id_fkey" FOREIGN KEY ("feature_code_id") REFERENCES "feature_code"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_profile_id_fkey" FOREIGN KEY ("actor_user_profile_id") REFERENCES "user_profile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
