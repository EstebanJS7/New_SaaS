-- EPIC-03 Phase B · Migration 007 · Tenant branding overrides
--
-- Additive and reversible: creates the tenant-scoped branding table. One row
-- per tenant; a missing row means the tenant falls back to the product brand
-- preset. The JSON payload is validated against the v1 `brandOverrideSchema`
-- at the application boundary.

CREATE TABLE "tenant_branding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "overrides" JSONB NOT NULL,
    "updated_by_user_profile_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_branding_tenant_id_key"
    ON "tenant_branding"("tenant_id");

ALTER TABLE "tenant_branding"
    ADD CONSTRAINT "tenant_branding_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "tenant_branding"
    ADD CONSTRAINT "tenant_branding_updated_by_user_profile_id_fkey"
    FOREIGN KEY ("updated_by_user_profile_id") REFERENCES "user_profile"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
