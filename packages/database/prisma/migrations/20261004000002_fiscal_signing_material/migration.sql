-- Additive EPIC-16 FISC-007 tenant secret and signing-material persistence
-- (ADR-005, DEC-053).
--
-- tenant_secret holds RESTRICTED material: only the AES-256-GCM ciphertext, the
-- per-secret data key wrapped by the platform master key, and the master-key
-- version that wrapped it. No plaintext, no unwrapped key and no password is
-- ever stored here, and no log, DTO or audit payload may carry a column of this
-- table. Rows are tenant-scoped so a key-composition bug cannot become a
-- cross-tenant read.
--
-- tenant_fiscal_signing_material holds INTERNAL material: the certificate and
-- its metadata — the certificate is transmitted inside every signed DE, so it is
-- public — plus an opaque credential_ref into tenant_secret for the private key.
-- The operator's PKCS#12 password is never persisted.
--
-- No existing table or row is changed, so no backfill is required.
--
-- At most one ACTIVE material exists per tenant and environment. Retirement is
-- an explicit operation: the row survives as the permanent record, carries its
-- actor and reason, and its stored key is destroyed in the same transaction.
-- All references are RESTRICT and tenant ownership is composite.

CREATE TYPE "fiscal_signing_environment" AS ENUM ('TEST', 'PRODUCTION');
CREATE TYPE "fiscal_signing_material_status" AS ENUM ('ACTIVE', 'RETIRED');

CREATE TABLE "tenant_secret" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "key_version" INTEGER NOT NULL,
  "wrapped_key" BYTEA NOT NULL,
  "wrap_iv" BYTEA NOT NULL,
  "wrap_auth_tag" BYTEA NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "iv" BYTEA NOT NULL,
  "auth_tag" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_secret_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_secret_key_version_positive" CHECK ("key_version" >= 1),
  CONSTRAINT "tenant_secret_wrap_material_present" CHECK (
    octet_length("wrapped_key") > 0
    AND octet_length("wrap_iv") > 0
    AND octet_length("wrap_auth_tag") > 0
  )
);

CREATE TABLE "tenant_fiscal_signing_material" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "environment" "fiscal_signing_environment" NOT NULL,
  "status" "fiscal_signing_material_status" NOT NULL DEFAULT 'ACTIVE',
  "credential_ref" TEXT NOT NULL,
  "certificate_pem" TEXT NOT NULL,
  "certificate_subject" TEXT NOT NULL,
  "certificate_serial" TEXT NOT NULL,
  "certificate_fingerprint_sha256" TEXT NOT NULL,
  "key_algorithm" TEXT NOT NULL,
  "not_before" TIMESTAMPTZ(3) NOT NULL,
  "not_after" TIMESTAMPTZ(3) NOT NULL,
  "uploaded_by_user_profile_id" UUID,
  "retired_at" TIMESTAMPTZ(3),
  "retired_by_user_profile_id" UUID,
  "retirement_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_fiscal_signing_material_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_fiscal_signing_material_retired_at_iff_retired"
    CHECK (("retired_at" IS NULL) = ("status" = 'ACTIVE')),
  CONSTRAINT "tenant_fiscal_signing_material_retirement_reason_required"
    CHECK ("status" <> 'RETIRED' OR length(btrim(coalesce("retirement_reason", ''))) > 0),
  CONSTRAINT "tenant_fiscal_signing_material_validity_window"
    CHECK ("not_after" > "not_before")
);

-- The ownership key must exist before any composite reference targets it.
CREATE UNIQUE INDEX "tenant_secret_tenant_id_id_key" ON "tenant_secret"("tenant_id", "id");
CREATE UNIQUE INDEX "tenant_secret_tenant_id_key_key" ON "tenant_secret"("tenant_id", "key");

CREATE UNIQUE INDEX "tenant_fiscal_signing_material_tenant_id_id_key"
  ON "tenant_fiscal_signing_material"("tenant_id", "id");
CREATE INDEX "tenant_fiscal_signing_material_tenant_id_status_idx"
  ON "tenant_fiscal_signing_material"("tenant_id", "status");
-- Prisma cannot express a partial unique index, so the one-ACTIVE-material rule
-- is enforced here: a retired row falls outside the index.
CREATE UNIQUE INDEX "tenant_fiscal_signing_material_one_active_key"
  ON "tenant_fiscal_signing_material"("tenant_id", "environment") WHERE "status" = 'ACTIVE';

ALTER TABLE "tenant_secret" ADD CONSTRAINT "tenant_secret_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "tenant_fiscal_signing_material" ADD CONSTRAINT "tenant_fiscal_signing_material_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
