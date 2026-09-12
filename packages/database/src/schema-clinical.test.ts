import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-06 CLI clinical data foundation.
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const CLINICAL_SQL = findMigration(MIGRATIONS, "_clinical").sql;

const CLINICAL_TABLES = [
  "clinical_encounter",
  "clinical_treatment",
  "clinical_vaccination",
  "clinical_deworming",
  "clinical_study",
  "clinical_weight",
] as const;

const SUBDOMAIN_TABLES = CLINICAL_TABLES.filter((table) => table !== "clinical_encounter");

describe("migration · clinical (EPIC-06 CLI-001)", () => {
  it("creates the six clinical tables", () => {
    for (const table of CLINICAL_TABLES) {
      expect(CLINICAL_SQL).toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
  });

  it("pins the encounter lifecycle to DRAFT | CLOSED", () => {
    expect(CLINICAL_SQL).toMatch(
      /CREATE TYPE "clinical_encounter_status" AS ENUM \('DRAFT', 'CLOSED'\)/
    );
    expect(CLINICAL_SQL).toMatch(
      /"status" "clinical_encounter_status" NOT NULL DEFAULT 'DRAFT'/
    );
  });

  it("requires the initial version on the encounter", () => {
    expect(CLINICAL_SQL).toMatch(/"version" INTEGER NOT NULL DEFAULT 1/);
  });

  it("uses RESTRICT FKs to tenant and to its composite tenant-ownership key", () => {
    // The tenant-ownership keys must be declared before the composite FKs that
    // target them: PostgreSQL requires the referenced key at constraint time.
    expect(CLINICAL_SQL).toMatch(
      /CREATE UNIQUE INDEX "patient_tenant_id_id_key" ON "patient"\("tenant_id", "id"\)/
    );
    expect(CLINICAL_SQL).toMatch(
      /CREATE UNIQUE INDEX "clinical_encounter_tenant_id_id_key"\s+ON "clinical_encounter"\("tenant_id", "id"\)/
    );

    for (const table of CLINICAL_TABLES) {
      expect(CLINICAL_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT`
        )
      );
      // Composite tenant-ownership FK: (tenant_id, patient_id) ->
      // patient(tenant_id, id). This is what makes a clinical row owned by
      // tenant A unable to reference a Patient owned by tenant B.
      expect(CLINICAL_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_patient_id_fkey"\\s+FOREIGN KEY \\("tenant_id", "patient_id"\\) REFERENCES "patient"\\("tenant_id", "id"\\)\\s+ON DELETE RESTRICT`
        )
      );
    }
  });

  it("declares the tenant-ownership keys before the composite FKs that use them", () => {
    const patientKey = CLINICAL_SQL.indexOf('CREATE UNIQUE INDEX "patient_tenant_id_id_key"');
    const encounterKey = CLINICAL_SQL.indexOf(
      'CREATE UNIQUE INDEX "clinical_encounter_tenant_id_id_key"'
    );
    const firstCompositeFk = CLINICAL_SQL.indexOf("_tenant_id_patient_id_fkey");

    expect(patientKey).toBeGreaterThan(-1);
    expect(encounterKey).toBeGreaterThan(-1);
    expect(firstCompositeFk).toBeGreaterThan(-1);
    expect(patientKey).toBeLessThan(firstCompositeFk);
    expect(encounterKey).toBeLessThan(firstCompositeFk);
  });

  it("links amendments to the original with a composite same-tenant RESTRICT self-FK", () => {
    expect(CLINICAL_SQL).toMatch(
      /ALTER TABLE "clinical_encounter" ADD CONSTRAINT "clinical_encounter_tenant_id_amends_encounter_id_fkey"[\s\S]*?FOREIGN KEY \("tenant_id", "amends_encounter_id"\) REFERENCES "clinical_encounter"\("tenant_id", "id"\)[\s\S]*?ON DELETE RESTRICT/
    );
  });

  it("indexes tenant/patient on every table and tenant/status on the encounter", () => {
    for (const table of CLINICAL_TABLES) {
      expect(CLINICAL_SQL).toMatch(
        new RegExp(
          `CREATE INDEX "${table}_tenant_id_patient_id_idx"\\s+ON "${table}"\\("tenant_id", "patient_id"\\)`
        )
      );
    }
    expect(CLINICAL_SQL).toMatch(
      /CREATE INDEX "clinical_encounter_tenant_id_status_idx"\s+ON "clinical_encounter"\("tenant_id", "status"\)/
    );
  });

  it("makes the amendment idempotency key unique per tenant", () => {
    expect(CLINICAL_SQL).toMatch(
      /CREATE UNIQUE INDEX "clinical_encounter_tenant_id_idempotency_key_key"\s+ON "clinical_encounter"\("tenant_id", "idempotency_key"\)/
    );
  });

  it("persists weight as a positive DECIMAL(10,3)", () => {
    expect(CLINICAL_SQL).toMatch(/"quantity" DECIMAL\(10,3\) NOT NULL/);
    expect(CLINICAL_SQL).toMatch(
      /CONSTRAINT "clinical_weight_quantity_positive" CHECK \("quantity" > 0\)/
    );
    // No floating point anywhere in the clinical DDL.
    expect(CLINICAL_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("rejects UPDATE of a CLOSED encounter and any encounter DELETE", () => {
    expect(CLINICAL_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION "clinical_encounter_immutable"\(\)/
    );
    expect(CLINICAL_SQL).toMatch(/IF OLD\."status" = 'CLOSED' THEN/);
    expect(CLINICAL_SQL).toMatch(/TG_OP = 'DELETE'/);
    expect(CLINICAL_SQL).toMatch(
      /CREATE TRIGGER "clinical_encounter_immutable_trigger"\s+BEFORE UPDATE OR DELETE ON "clinical_encounter"\s+FOR EACH ROW EXECUTE FUNCTION "clinical_encounter_immutable"\(\)/
    );
    expect(CLINICAL_SQL).toMatch(/ERRCODE = 'restrict_violation'/);
  });

  it("blocks hard delete of every subdomain record", () => {
    expect(CLINICAL_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION "clinical_subdomain_no_delete"\(\)/
    );
    for (const table of SUBDOMAIN_TABLES) {
      expect(CLINICAL_SQL).toMatch(
        new RegExp(
          `CREATE TRIGGER "${table}_no_delete_trigger"\\s+BEFORE DELETE ON "${table}"\\s+FOR EACH ROW EXECUTE FUNCTION "clinical_subdomain_no_delete"\\(\\)`
        )
      );
    }
  });
});

describe("schema · clinical inventory (EPIC-06 CLI-001)", () => {
  it("declares the six models, the lifecycle enum and the amendment self-relation", () => {
    for (const model of [
      "ClinicalEncounter",
      "ClinicalTreatment",
      "ClinicalVaccination",
      "ClinicalDeworming",
      "ClinicalStudy",
      "ClinicalWeight",
    ]) {
      expect(SCHEMA).toMatch(new RegExp(`model ${model}\\b`));
    }
    expect(SCHEMA).toMatch(/enum ClinicalEncounterStatus\b/);
    expect(SCHEMA).toMatch(/@@unique\(\[tenantId, idempotencyKey\]\)/);
    expect(SCHEMA).toMatch(
      /amendsEncounter\s+ClinicalEncounter\?\s+@relation\("ClinicalEncounterAmendment"/
    );
  });

  it("anchors every clinical model to tenant and patient", () => {
    const models = [
      "ClinicalEncounter",
      "ClinicalTreatment",
      "ClinicalVaccination",
      "ClinicalDeworming",
      "ClinicalStudy",
      "ClinicalWeight",
    ];
    for (const model of models) {
      const block = SCHEMA.slice(
        SCHEMA.indexOf(`model ${model} `),
        SCHEMA.indexOf("}", SCHEMA.indexOf(`model ${model} `))
      );
      expect(block, `${model} must scope tenant_id`).toMatch(
        /tenantId\s+String\s+@map\("tenant_id"\)/
      );
      expect(block, `${model} must anchor patient_id`).toMatch(
        /patientId\s+String\s+@map\("patient_id"\)/
      );
    }
  });

  it("pins composite tenant-ownership relations on Patient and clinical FKs", () => {
    // Patient exposes a (tenantId, id) key that every clinical composite FK targets.
    expect(SCHEMA).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(SCHEMA.match(/@@unique\(\[tenantId, id\]\)/g)).toHaveLength(2);

    const clinicalModels = [
      "ClinicalEncounter",
      "ClinicalTreatment",
      "ClinicalVaccination",
      "ClinicalDeworming",
      "ClinicalStudy",
      "ClinicalWeight",
    ];
    for (const model of clinicalModels) {
      const block = SCHEMA.slice(
        SCHEMA.indexOf(`model ${model} `),
        SCHEMA.indexOf("}", SCHEMA.indexOf(`model ${model} `))
      );
      expect(block, `${model} must use the composite tenant/patient FK`).toMatch(
        /patient\s+Patient\s+@relation\(fields: \[tenantId, patientId\], references: \[tenantId, id\]/
      );
    }

    // The amendment link is composite too, so cross-tenant amendments are impossible.
    expect(SCHEMA).toMatch(
      /amendsEncounter\s+ClinicalEncounter\?\s+@relation\("ClinicalEncounterAmendment", fields: \[tenantId, amendsEncounterId\], references: \[tenantId, id\]/
    );
  });

  it("keeps clinical content CONFIDENTIAL and internalNotes staff-only", () => {
    expect(SCHEMA).toMatch(/all clinical content is[\s\S]*?CONFIDENTIAL/);
    expect(SCHEMA).toMatch(/internalNotes[\s\S]*?staff-only/);
  });
});
