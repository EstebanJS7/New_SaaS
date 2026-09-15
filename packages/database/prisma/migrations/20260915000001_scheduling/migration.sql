-- Additive migration: EPIC-07 SCH scheduling data foundation.
--
-- Adds the tenant- and branch-scoped `appointment` table plus its
-- `appointment_status` lifecycle enum. No backfill is required: the table does
-- not exist yet.
--
-- Foreign keys are RESTRICT everywhere so tenants, branches, patients and
-- memberships can never be orphaned or hard-deleted. Appointment references its
-- Branch, Patient and professional TenantMembership through COMPOSITE
-- tenant-ownership FKs ((tenant_id, x_id) -> x(tenant_id, id)); tenant_id is
-- deliberately part of every key, so PostgreSQL rejects any appointment whose
-- tenant does not own the referenced row. The database additionally enforces the
-- spec invariants the application layer must respect:
--   * start/end are persisted as UTC TIMESTAMPTZ(3) and the range is valid
--     (end_at strictly after start_at);
--   * no appointment may be hard-deleted (DELETE rejected); lifecycle
--     termination is a status change, never a row removal.
-- Data classification: appointment scheduling details are CONFIDENTIAL; the
-- table stores no free-text service or Catalog field.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "appointment_status" AS ENUM (
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
);

CREATE TABLE "appointment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "professional_membership_id" UUID NOT NULL,
  "status" "appointment_status" NOT NULL DEFAULT 'SCHEDULED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "start_at" TIMESTAMPTZ(3) NOT NULL,
  "end_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "appointment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_time_range_check" CHECK ("end_at" > "start_at")
);

-- Tenant-ownership keys: unique targets for the composite FKs below. They are
-- declared before the FKs because PostgreSQL requires the referenced key to
-- exist at constraint-creation time. `patient_tenant_id_id_key` already exists
-- (created by the patients/clinical migrations).
CREATE UNIQUE INDEX "branch_tenant_id_id_key" ON "branch"("tenant_id", "id");
CREATE UNIQUE INDEX "tenant_membership_tenant_id_id_key"
  ON "tenant_membership"("tenant_id", "id");
CREATE UNIQUE INDEX "appointment_tenant_id_id_key" ON "appointment"("tenant_id", "id");

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_branch_id_fkey"
  FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_professional_membership_id_fkey"
  FOREIGN KEY ("tenant_id", "professional_membership_id") REFERENCES "tenant_membership"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "appointment_tenant_id_branch_id_idx"
  ON "appointment"("tenant_id", "branch_id");

CREATE INDEX "appointment_tenant_id_professional_membership_id_idx"
  ON "appointment"("tenant_id", "professional_membership_id");

CREATE INDEX "appointment_tenant_id_patient_id_idx"
  ON "appointment"("tenant_id", "patient_id");

CREATE INDEX "appointment_tenant_id_status_idx"
  ON "appointment"("tenant_id", "status");

-- Appointments are never hard-deleted: lifecycle termination is an explicit
-- status transition (Cancelled/NoShow) recorded in the audit trail, so a DELETE
-- raises instead of silently destroying schedule history.
CREATE OR REPLACE FUNCTION "appointment_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'appointments are immutable and cannot be hard-deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "appointment_no_delete_trigger"
  BEFORE DELETE ON "appointment"
  FOR EACH ROW EXECUTE FUNCTION "appointment_no_delete"();
