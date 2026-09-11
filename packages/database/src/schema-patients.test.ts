import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-05 PAT-001 (Patient data foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const PATIENTS_SQL = findMigration(MIGRATIONS, "_patients").sql;

describe("migration · patients (EPIC-05 PAT-001)", () => {
  it("creates the global taxonomy and tenant-scoped patient tables", () => {
    expect(PATIENTS_SQL).toMatch(/CREATE TABLE "species"/);
    expect(PATIENTS_SQL).toMatch(/CREATE TABLE "breed"/);
    expect(PATIENTS_SQL).toMatch(/CREATE TABLE "patient"/);
  });

  it("pins patient sex to MALE | FEMALE | UNKNOWN", () => {
    expect(PATIENTS_SQL).toMatch(
      /CREATE TYPE "patient_sex" AS ENUM \('MALE', 'FEMALE', 'UNKNOWN'\)/
    );
  });

  it("keeps Species and Breed global — no tenant_id column (Decision #2211)", () => {
    const speciesBlock = PATIENTS_SQL.slice(
      PATIENTS_SQL.indexOf('CREATE TABLE "species"'),
      PATIENTS_SQL.indexOf('CREATE TABLE "breed"')
    );
    const breedBlock = PATIENTS_SQL.slice(
      PATIENTS_SQL.indexOf('CREATE TABLE "breed"'),
      PATIENTS_SQL.indexOf('CREATE TABLE "patient"')
    );
    expect(speciesBlock).not.toContain("tenant_id");
    expect(breedBlock).not.toContain("tenant_id");

    expect(PATIENTS_SQL).toMatch(/CREATE UNIQUE INDEX "species_code_key" ON "species"\("code"\)/);
    expect(PATIENTS_SQL).toMatch(
      /CREATE UNIQUE INDEX "breed_species_id_code_key" ON "breed"\("species_id", "code"\)/
    );
  });

  it("activates PatientGuardian with the patient FK and primary/active flags", () => {
    expect(PATIENTS_SQL).toMatch(
      /ALTER TABLE "patient_guardian"[\s\S]*?"patient_id" UUID NOT NULL/
    );
    expect(PATIENTS_SQL).toMatch(/"is_primary" BOOLEAN NOT NULL DEFAULT false/);
    expect(PATIENTS_SQL).toMatch(/"is_active" BOOLEAN NOT NULL DEFAULT true/);
    expect(PATIENTS_SQL).toMatch(/DROP INDEX "patient_guardian_customer_id_position_key"/);
    expect(PATIENTS_SQL).toMatch(
      /CREATE UNIQUE INDEX "patient_guardian_patient_id_customer_id_key" ON "patient_guardian"\("patient_id", "customer_id"\)/
    );
  });

  it("uses RESTRICT foreign keys so taxonomy, tenants and links cannot be orphaned", () => {
    expect(PATIENTS_SQL).toMatch(
      /ALTER TABLE "breed"[\s\S]*?FOREIGN KEY \("species_id"\) REFERENCES "species"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
    expect(PATIENTS_SQL).toMatch(
      /ALTER TABLE "patient"[\s\S]*?FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
    expect(PATIENTS_SQL).toMatch(
      /ALTER TABLE "patient"[\s\S]*?FOREIGN KEY \("species_id"\) REFERENCES "species"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
    expect(PATIENTS_SQL).toMatch(
      /ALTER TABLE "patient"[\s\S]*?FOREIGN KEY \("breed_id"\) REFERENCES "breed"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
    expect(PATIENTS_SQL).toMatch(
      /ALTER TABLE "patient_guardian"[\s\S]*?FOREIGN KEY \("patient_id"\) REFERENCES "patient"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
  });

  it("enforces at most one active primary guardian via a partial unique index (Decision #2210)", () => {
    expect(PATIENTS_SQL).toMatch(
      /CREATE UNIQUE INDEX "patient_guardian_primary_active_key"\s+ON "patient_guardian"\("patient_id"\)\s+WHERE "is_primary" AND "is_active"/
    );
  });

  it("backs the at-least-one side with a deferred constraint trigger (Decision #2210)", () => {
    expect(PATIENTS_SQL).toMatch(
      /CREATE CONSTRAINT TRIGGER "patient_guardian_exactly_one_primary_trigger"/
    );
    expect(PATIENTS_SQL).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON "patient_guardian"/);
    expect(PATIENTS_SQL).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
    expect(PATIENTS_SQL).toMatch(/EXECUTE FUNCTION "patient_guardian_exactly_one_primary"\(\)/);
    // The trigger counts active primaries and raises when the count is not 1.
    expect(PATIENTS_SQL).toMatch(/active_primary_count <> 1/);
    expect(PATIENTS_SQL).toMatch(/ERRCODE = 'check_violation'/);
  });

  it("validates BOTH OLD and NEW Patient IDs on a guardian reparent (PAT-001 fix)", () => {
    // Scope to the guardian-side function so the Patient-side function below it
    // cannot satisfy these assertions.
    const guardianBlock = PATIENTS_SQL.slice(
      PATIENTS_SQL.indexOf('CREATE OR REPLACE FUNCTION "patient_guardian_exactly_one_primary"'),
      PATIENTS_SQL.indexOf('CREATE OR REPLACE FUNCTION "patient_exactly_one_primary_guardian"')
    );
    expect(guardianBlock).not.toBe("");

    // A reparent updates patient_id, so both the OLD and the NEW Patient must be
    // collected as affected; checking only NEW would orphan the OLD active Patient.
    expect(guardianBlock).toMatch(/'INSERT'[\s\S]*?ARRAY\[NEW\."patient_id"\]/);
    expect(guardianBlock).toMatch(/'DELETE'[\s\S]*?ARRAY\[OLD\."patient_id"\]/);
    expect(guardianBlock).toMatch(/ARRAY\[OLD\."patient_id", NEW\."patient_id"\]/);
    // DISTINCT de-duplicates so an unchanged patient_id is checked once.
    expect(guardianBlock).toMatch(/SELECT DISTINCT pid/);
    expect(guardianBlock).toMatch(/unnest\(affected_patient_ids\)/);

    // The single-ID COALESCE shortcut that caused the defect is gone.
    expect(guardianBlock).not.toMatch(/COALESCE\(NEW\."patient_id", OLD\."patient_id"\)/);
  });

  it("covers active Patient INSERT/UPDATE with a Patient-side deferred trigger (Decision #2210)", () => {
    // Scope the assertions to the Patient-side block so a match cannot be
    // satisfied by the guardian-side function above it.
    const patientBlock = PATIENTS_SQL.slice(
      PATIENTS_SQL.indexOf('CREATE OR REPLACE FUNCTION "patient_exactly_one_primary_guardian"')
    );
    expect(patientBlock).not.toBe("");

    expect(patientBlock).toMatch(
      /CREATE CONSTRAINT TRIGGER "patient_exactly_one_primary_guardian_trigger"\s+AFTER INSERT OR UPDATE ON "patient"\s+DEFERRABLE INITIALLY DEFERRED\s+FOR EACH ROW\s+EXECUTE FUNCTION "patient_exactly_one_primary_guardian"\(\)/
    );
    // Re-reads the Patient's final is_active state and exempts inactive rows.
    expect(patientBlock).toMatch(/SELECT "is_active" INTO patient_is_active/);
    expect(patientBlock).toMatch(/patient_is_active IS NOT TRUE/);
    // Counts active primaries and raises check_violation when not exactly one.
    expect(patientBlock).toMatch(/active_primary_count <> 1/);
    expect(patientBlock).toMatch(/ERRCODE = 'check_violation'/);
  });

  it("declares the Patient aggregate and the activated guardian bridge in the schema", () => {
    expect(SCHEMA).toMatch(/model Patient\b/);
    expect(SCHEMA).toMatch(/model Species\b/);
    expect(SCHEMA).toMatch(/model Breed\b/);
    expect(SCHEMA).toMatch(/enum PatientSex\b/);
    expect(SCHEMA).toMatch(/patient\s+Patient\s+@relation\(fields: \[patientId\]/);
    expect(SCHEMA).toMatch(/@@unique\(\[patientId, customerId\]\)/);
  });

  it("classifies Patient identity and guardian links as CONFIDENTIAL", () => {
    expect(SCHEMA).toMatch(/name and birthDate are CONFIDENTIAL/);
    expect(SCHEMA).toMatch(/Patient↔Customer link is CONFIDENTIAL/);
  });
});
