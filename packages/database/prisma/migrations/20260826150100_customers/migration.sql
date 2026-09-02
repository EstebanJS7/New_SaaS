-- Additive migration: EPIC-04 Customer core (Customer, CustomerAddress,
-- CustomerContact) and inert PatientGuardian scaffold.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "customer_kind" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "customer_contact_kind" AS ENUM ('EMAIL', 'PHONE');

CREATE TABLE "customer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "kind" "customer_kind" NOT NULL,
  "display_name" TEXT NOT NULL,
  "legal_name" TEXT,
  "tax_id" TEXT,
  "first_name" TEXT,
  "last_name" TEXT,
  "document_number" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_address" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "label" TEXT,
  "line1" TEXT,
  "line2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postal_code" TEXT,
  "country_code" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_contact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "kind" "customer_contact_kind" NOT NULL,
  "label" TEXT,
  "value" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient_guardian" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "patient_guardian_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "patient_guardian" ADD CONSTRAINT "patient_guardian_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "patient_guardian" ADD CONSTRAINT "patient_guardian_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "customer_tenant_id_idx" ON "customer"("tenant_id");
CREATE INDEX "customer_tenant_id_is_active_idx" ON "customer"("tenant_id", "is_active");

CREATE INDEX "customer_address_tenant_id_idx" ON "customer_address"("tenant_id");
CREATE INDEX "customer_address_customer_id_idx" ON "customer_address"("customer_id");

CREATE INDEX "customer_contact_tenant_id_idx" ON "customer_contact"("tenant_id");
CREATE INDEX "customer_contact_customer_id_idx" ON "customer_contact"("customer_id");

CREATE INDEX "patient_guardian_tenant_id_idx" ON "patient_guardian"("tenant_id");
CREATE INDEX "patient_guardian_customer_id_idx" ON "patient_guardian"("customer_id");
CREATE UNIQUE INDEX "patient_guardian_customer_id_position_key" ON "patient_guardian"("customer_id", "position");
