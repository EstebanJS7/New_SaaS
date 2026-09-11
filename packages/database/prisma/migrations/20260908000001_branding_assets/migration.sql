-- DEC-004 PR 1 · Migration 008 · Tenant branding assets
--
-- Additive and reversible: creates the tenant-scoped branding asset table and
-- nullable FK columns on tenant_branding. Existing rows keep NULL asset FKs and
-- continue to fall back to the product brand preset.

-- Create the asset-kind enum first.
CREATE TYPE "branding_asset_kind" AS ENUM ('LOGO_LIGHT', 'LOGO_DARK', 'FAVICON');

-- Tenant-owned asset metadata. Only opaque keys live here; bytes are stored in
-- the approved object-storage boundary.
CREATE TABLE "branding_asset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "branding_asset_kind" NOT NULL,
    "asset_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_user_profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branding_asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branding_asset_tenant_id_kind_key"
    ON "branding_asset"("tenant_id", "kind");

CREATE INDEX "branding_asset_tenant_id_idx"
    ON "branding_asset"("tenant_id");

ALTER TABLE "branding_asset"
    ADD CONSTRAINT "branding_asset_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "branding_asset"
    ADD CONSTRAINT "branding_asset_uploaded_by_user_profile_id_fkey"
    FOREIGN KEY ("uploaded_by_user_profile_id") REFERENCES "user_profile"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Add asset FKs to tenant_branding. ON DELETE SET NULL preserves the override
-- row when an asset is replaced or removed.
ALTER TABLE "tenant_branding"
    ADD COLUMN "display_name" TEXT,
    ADD COLUMN "logo_light_asset_id" UUID,
    ADD COLUMN "logo_dark_asset_id" UUID,
    ADD COLUMN "favicon_asset_id" UUID;

CREATE UNIQUE INDEX "tenant_branding_logo_light_asset_id_key"
    ON "tenant_branding"("logo_light_asset_id");

CREATE UNIQUE INDEX "tenant_branding_logo_dark_asset_id_key"
    ON "tenant_branding"("logo_dark_asset_id");

CREATE UNIQUE INDEX "tenant_branding_favicon_asset_id_key"
    ON "tenant_branding"("favicon_asset_id");

ALTER TABLE "tenant_branding"
    ADD CONSTRAINT "tenant_branding_logo_light_asset_id_fkey"
    FOREIGN KEY ("logo_light_asset_id") REFERENCES "branding_asset"("id")
    ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "tenant_branding"
    ADD CONSTRAINT "tenant_branding_logo_dark_asset_id_fkey"
    FOREIGN KEY ("logo_dark_asset_id") REFERENCES "branding_asset"("id")
    ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "tenant_branding"
    ADD CONSTRAINT "tenant_branding_favicon_asset_id_fkey"
    FOREIGN KEY ("favicon_asset_id") REFERENCES "branding_asset"("id")
    ON DELETE SET NULL ON UPDATE RESTRICT;
