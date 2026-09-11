-- Additive migration: EPIC-05 PAT-001 Patient data foundation.
--
-- Adds the global seeded Species/Breed catalogs (Decision #2211) and the
-- tenant-scoped Patient aggregate, and activates the previously inert
-- PatientGuardian bridge between a Veterinary Patient and a Core Customer.
-- No backfill is required: patient_guardian is empty at this point.
--
-- Foreign keys are RESTRICT everywhere so taxonomy, Customers and confirmed
-- Patient/guardian rows can never be orphaned or hard-deleted. The exactly-one
-- active primary guardian invariant (Decision #2210) combines an immediate
-- partial unique index ("at most one") with a DEFERRABLE INITIALLY DEFERRED
-- constraint trigger ("at least one"). Data classification: Patient identity
-- and guardian links are CONFIDENTIAL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "patient_sex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

CREATE TABLE "species" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "species_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "breed" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "species_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "breed_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patient" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "species_id" UUID NOT NULL,
  "breed_id" UUID,
  "sex" "patient_sex" NOT NULL,
  "birth_date" TIMESTAMPTZ(3),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- Activate the inert scaffold: the Patient FK is safe because the table holds
-- no rows yet (design: guardian activation).
ALTER TABLE "patient_guardian"
  ADD COLUMN "patient_id" UUID NOT NULL,
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- The (customer_id, position) unique only existed to keep the inert scaffold
-- stable; the link unique is now (patient_id, customer_id).
DROP INDEX "patient_guardian_customer_id_position_key";

ALTER TABLE "breed" ADD CONSTRAINT "breed_species_id_fkey"
  FOREIGN KEY ("species_id") REFERENCES "species"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "patient" ADD CONSTRAINT "patient_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "patient" ADD CONSTRAINT "patient_species_id_fkey"
  FOREIGN KEY ("species_id") REFERENCES "species"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "patient" ADD CONSTRAINT "patient_breed_id_fkey"
  FOREIGN KEY ("breed_id") REFERENCES "breed"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "patient_guardian" ADD CONSTRAINT "patient_guardian_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patient"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "species_code_key" ON "species"("code");

CREATE UNIQUE INDEX "breed_species_id_code_key" ON "breed"("species_id", "code");

CREATE INDEX "patient_tenant_id_idx" ON "patient"("tenant_id");
CREATE INDEX "patient_tenant_id_is_active_idx" ON "patient"("tenant_id", "is_active");
CREATE INDEX "patient_species_id_idx" ON "patient"("species_id");
CREATE INDEX "patient_breed_id_idx" ON "patient"("breed_id");

CREATE UNIQUE INDEX "patient_guardian_patient_id_customer_id_key" ON "patient_guardian"("patient_id", "customer_id");

-- "At most one" active primary guardian per Patient (Decision #2210). Partial
-- unique indexes are immediate and cannot be deferred in PostgreSQL, so a
-- primary swap must demote the current primary before promoting the
-- replacement.
CREATE UNIQUE INDEX "patient_guardian_primary_active_key"
  ON "patient_guardian"("patient_id")
  WHERE "is_primary" AND "is_active";

-- "At least one" active primary guardian for an active Patient (Decision
-- #2210). Deferred to commit so a demote+promote swap inside one transaction
-- converges on exactly one. This is a narrow aggregate-specific invariant, not
-- a generic framework; live-PostgreSQL concurrency proof remains under TD-006.
--
-- A guardian UPDATE may reparent the link to a different Patient, so BOTH the
-- OLD and NEW Patient are affected: validating only NEW."patient_id" would let
-- the OLD active Patient commit with zero active primaries. Every affected
-- Patient is re-checked at commit; DISTINCT collapses the ordinary
-- unchanged-patient_id update to a single check so it cannot raise twice. An
-- INSERT affects only NEW and a DELETE only OLD.
CREATE OR REPLACE FUNCTION "patient_guardian_exactly_one_primary"()
RETURNS TRIGGER AS $$
DECLARE
  affected_patient_ids UUID[];
  affected_patient_id UUID;
  patient_is_active BOOLEAN;
  active_primary_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_patient_ids := ARRAY[NEW."patient_id"];
  ELSIF TG_OP = 'DELETE' THEN
    affected_patient_ids := ARRAY[OLD."patient_id"];
  ELSE
    affected_patient_ids := ARRAY[OLD."patient_id", NEW."patient_id"];
  END IF;

  FOR affected_patient_id IN
    SELECT DISTINCT pid
    FROM unnest(affected_patient_ids) AS pid
    WHERE pid IS NOT NULL
  LOOP
    SELECT "is_active" INTO patient_is_active
    FROM "patient"
    WHERE "id" = affected_patient_id;

    -- Inactive (or already-deleted) Patients are exempt from the invariant.
    CONTINUE WHEN patient_is_active IS NOT TRUE;

    SELECT COUNT(*) INTO active_primary_count
    FROM "patient_guardian"
    WHERE "patient_id" = affected_patient_id
      AND "is_primary" = TRUE
      AND "is_active" = TRUE;

    IF active_primary_count <> 1 THEN
      RAISE EXCEPTION
        'patient % must have exactly one active primary guardian (found %)',
        affected_patient_id, active_primary_count
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "patient_guardian_exactly_one_primary_trigger"
  AFTER INSERT OR UPDATE OR DELETE ON "patient_guardian"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "patient_guardian_exactly_one_primary"();

-- Patient-side half of the invariant (Decision #2210): an active Patient must
-- have exactly one active primary guardian. The guardian trigger above only
-- fires on patient_guardian writes, so a lone active Patient INSERT (or an
-- UPDATE that activates an inactive Patient) would commit with zero primaries.
-- This deferred trigger closes that gap for `patient` INSERT/UPDATE.
--
-- Like the guardian function, it re-reads the Patient's committed-state
-- `is_active` (mirroring the guardian function's table read) instead of trusting
-- the trigger-event snapshot, so a transaction that inserts a Patient active and
-- later deactivates it in the same transaction converges on the final state.
-- DELETE is intentionally not covered: patient_guardian.patient_id is RESTRICT,
-- and no hard-delete path for Patients exists.
CREATE OR REPLACE FUNCTION "patient_exactly_one_primary_guardian"()
RETURNS TRIGGER AS $$
DECLARE
  patient_is_active BOOLEAN;
  active_primary_count INTEGER;
BEGIN
  SELECT "is_active" INTO patient_is_active
  FROM "patient"
  WHERE "id" = NEW."id";

  -- Inactive (or already-deleted) Patients are exempt from the invariant.
  IF patient_is_active IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO active_primary_count
  FROM "patient_guardian"
  WHERE "patient_id" = NEW."id"
    AND "is_primary" = TRUE
    AND "is_active" = TRUE;

  IF active_primary_count <> 1 THEN
    RAISE EXCEPTION
      'patient % must have exactly one active primary guardian (found %)',
      NEW."id", active_primary_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "patient_exactly_one_primary_guardian_trigger"
  AFTER INSERT OR UPDATE ON "patient"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "patient_exactly_one_primary_guardian"();
