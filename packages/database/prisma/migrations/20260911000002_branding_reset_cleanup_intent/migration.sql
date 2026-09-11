-- Migration 010 · Durable branding-reset storage cleanup intent
--
-- Additive and reversible: creates the cleanup-status enum and the
-- tenant-scoped intent table. No existing table or column is altered, so
-- existing tenants and rows are unaffected. Ordered after
-- `20260911000001_tenant_lifecycle`.
--
-- Data classification: storage_keys INTERNAL (opaque object keys; never logged
-- as a list); last_error INTERNAL (sanitized message, no sensitive payloads).

-- Cleanup lifecycle discriminator. Values are pinned; evolve additively only.
CREATE TYPE "branding_reset_cleanup_status" AS ENUM ('PENDING', 'COMPLETED', 'DEAD_LETTER');

-- Single-purpose durable intent: one row per reset that disconnected storage
-- objects. Committed with the reset transaction, drained by the worker (U6).
CREATE TABLE "branding_reset_cleanup_intent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "reset_audit_id" UUID,
    "requested_by_user_profile_id" UUID,
    "storage_keys" TEXT[],
    "status" "branding_reset_cleanup_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "branding_reset_cleanup_intent_pkey" PRIMARY KEY ("id")
);

-- Reconciliation sweep reads stale PENDING rows in created order.
CREATE INDEX "branding_reset_cleanup_intent_status_created_at_idx"
    ON "branding_reset_cleanup_intent"("status", "created_at");

-- FK RESTRICT keeps intent rows indestructible while the tenant exists, so a
-- pending cleanup can never be orphaned by a tenant delete.
ALTER TABLE "branding_reset_cleanup_intent"
    ADD CONSTRAINT "branding_reset_cleanup_intent_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
