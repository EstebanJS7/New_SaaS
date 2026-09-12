-- Additive migration: EPIC-06 CLI clinical data foundation.
--
-- Adds six tenant-scoped, Patient-anchored clinical tables (one encounter plus
-- the treatment/vaccination/deworming/study/weight subdomains). No backfill is
-- required: none of these tables exist yet.
--
-- Foreign keys are RESTRICT everywhere so Patients, tenants and clinical rows
-- can never be orphaned or hard-deleted. Clinical rows additionally reference
-- their Patient through a COMPOSITE tenant-ownership FK
-- ((tenant_id, patient_id) -> patient(tenant_id, id)); the tenant_id column is
-- deliberately part of that key, so PostgreSQL rejects any clinical row whose
-- tenant does not own the referenced Patient. The amendment self-FK is composite
-- for the same reason, so amendments cannot link across tenants. The database
-- additionally enforces the spec invariants that the application layer must
-- respect:
--   * a CLOSED encounter is immutable (UPDATE rejected) and no encounter may be
--     hard-deleted (DELETE rejected); corrections go through a linked,
--     audited amendment INSERT;
--   * subdomain records are never hard-deleted;
--   * a weight quantity is strictly positive.
-- Data classification: all clinical content is CONFIDENTIAL; `internal_notes`
-- is staff-only and never exposed to client-safe projections.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "clinical_encounter_status" AS ENUM ('DRAFT', 'CLOSED');

CREATE TABLE "clinical_encounter" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "status" "clinical_encounter_status" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason_for_visit" TEXT,
  "anamnesis" TEXT,
  "diagnosis" TEXT,
  "treatment_plan" TEXT,
  "internal_notes" TEXT,
  "client_summary" TEXT,
  "amends_encounter_id" UUID,
  "amendment_reason" TEXT,
  "idempotency_key" TEXT,
  "closed_at" TIMESTAMPTZ(3),
  "closed_by_user_profile_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_encounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_treatment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "administered_at" TIMESTAMPTZ(3) NOT NULL,
  "context" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_treatment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_vaccination" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "vaccine" TEXT NOT NULL,
  "administered_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_vaccination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_deworming" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "product" TEXT NOT NULL,
  "administered_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_deworming_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_study" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "study_type" TEXT NOT NULL,
  "performed_at" TIMESTAMPTZ(3) NOT NULL,
  "result" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_study_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_weight" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "measured_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clinical_weight_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clinical_weight_quantity_positive" CHECK ("quantity" > 0)
);

-- Tenant-ownership keys: unique targets for the composite FKs below. They are
-- declared before the FKs because PostgreSQL requires the referenced key to
-- exist at constraint-creation time.
CREATE UNIQUE INDEX "patient_tenant_id_id_key" ON "patient"("tenant_id", "id");
CREATE UNIQUE INDEX "clinical_encounter_tenant_id_id_key"
  ON "clinical_encounter"("tenant_id", "id");

ALTER TABLE "clinical_encounter" ADD CONSTRAINT "clinical_encounter_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_encounter" ADD CONSTRAINT "clinical_encounter_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_encounter" ADD CONSTRAINT "clinical_encounter_tenant_id_amends_encounter_id_fkey"
  FOREIGN KEY ("tenant_id", "amends_encounter_id") REFERENCES "clinical_encounter"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_encounter" ADD CONSTRAINT "clinical_encounter_closed_by_user_profile_id_fkey"
  FOREIGN KEY ("closed_by_user_profile_id") REFERENCES "user_profile"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_treatment" ADD CONSTRAINT "clinical_treatment_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_treatment" ADD CONSTRAINT "clinical_treatment_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_vaccination" ADD CONSTRAINT "clinical_vaccination_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_vaccination" ADD CONSTRAINT "clinical_vaccination_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_deworming" ADD CONSTRAINT "clinical_deworming_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_deworming" ADD CONSTRAINT "clinical_deworming_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_study" ADD CONSTRAINT "clinical_study_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_study" ADD CONSTRAINT "clinical_study_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_weight" ADD CONSTRAINT "clinical_weight_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "clinical_weight" ADD CONSTRAINT "clinical_weight_tenant_id_patient_id_fkey"
  FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "clinical_encounter_tenant_id_idempotency_key_key"
  ON "clinical_encounter"("tenant_id", "idempotency_key");

CREATE INDEX "clinical_encounter_tenant_id_patient_id_idx"
  ON "clinical_encounter"("tenant_id", "patient_id");

CREATE INDEX "clinical_encounter_tenant_id_status_idx"
  ON "clinical_encounter"("tenant_id", "status");

CREATE INDEX "clinical_treatment_tenant_id_patient_id_idx"
  ON "clinical_treatment"("tenant_id", "patient_id");

CREATE INDEX "clinical_vaccination_tenant_id_patient_id_idx"
  ON "clinical_vaccination"("tenant_id", "patient_id");

CREATE INDEX "clinical_deworming_tenant_id_patient_id_idx"
  ON "clinical_deworming"("tenant_id", "patient_id");

CREATE INDEX "clinical_study_tenant_id_patient_id_idx"
  ON "clinical_study"("tenant_id", "patient_id");

CREATE INDEX "clinical_weight_tenant_id_patient_id_idx"
  ON "clinical_weight"("tenant_id", "patient_id");

-- CLOSED immutability + no hard delete for encounters. A close transition
-- writes a DRAFT row (OLD.status = 'DRAFT') so it stays allowed; an amendment
-- is an INSERT of a new CLOSED row linked to the original. Any UPDATE of an
-- already-CLOSED row or any DELETE raises.
CREATE OR REPLACE FUNCTION "clinical_encounter_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical encounters are immutable and cannot be hard-deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'closed clinical encounter % is immutable', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "clinical_encounter_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "clinical_encounter"
  FOR EACH ROW EXECUTE FUNCTION "clinical_encounter_immutable"();

-- Subdomain records are never hard-deleted (spec: Clinical subdomain records).
CREATE OR REPLACE FUNCTION "clinical_subdomain_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'clinical records are immutable and cannot be hard-deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "clinical_treatment_no_delete_trigger"
  BEFORE DELETE ON "clinical_treatment"
  FOR EACH ROW EXECUTE FUNCTION "clinical_subdomain_no_delete"();

CREATE TRIGGER "clinical_vaccination_no_delete_trigger"
  BEFORE DELETE ON "clinical_vaccination"
  FOR EACH ROW EXECUTE FUNCTION "clinical_subdomain_no_delete"();

CREATE TRIGGER "clinical_deworming_no_delete_trigger"
  BEFORE DELETE ON "clinical_deworming"
  FOR EACH ROW EXECUTE FUNCTION "clinical_subdomain_no_delete"();

CREATE TRIGGER "clinical_study_no_delete_trigger"
  BEFORE DELETE ON "clinical_study"
  FOR EACH ROW EXECUTE FUNCTION "clinical_subdomain_no_delete"();

CREATE TRIGGER "clinical_weight_no_delete_trigger"
  BEFORE DELETE ON "clinical_weight"
  FOR EACH ROW EXECUTE FUNCTION "clinical_subdomain_no_delete"();
