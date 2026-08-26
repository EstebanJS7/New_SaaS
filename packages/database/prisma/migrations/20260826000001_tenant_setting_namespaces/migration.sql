-- EPIC-02 · Migration 006 · Typed tenant settings namespaces
--
-- Additive and reversible: this migration creates only the tenant-scoped
-- settings table. Payload validation and namespace authorization remain in the
-- API registry/service boundary.

CREATE TABLE "tenant_setting_namespace" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_setting_namespace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_setting_namespace_tenant_id_namespace_key"
    ON "tenant_setting_namespace"("tenant_id", "namespace");

CREATE INDEX "tenant_setting_namespace_tenant_id_idx"
    ON "tenant_setting_namespace"("tenant_id");

ALTER TABLE "tenant_setting_namespace"
    ADD CONSTRAINT "tenant_setting_namespace_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
