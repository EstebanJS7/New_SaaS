import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Recursively lists source files under a directory.
 */
function walkSourceFiles(dir: string, extensions: readonly string[]): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
      files.push(...walkSourceFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Schema inventory for EPIC-03 Phase B (Tenant Branding) and EPIC-04
 * (Customers). These checks parse the applied migration SQL and schema so a
 * live database is not required.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const BRANDING_SQL = findMigration(MIGRATIONS, "_tenant_branding").sql;
const CUSTOMERS_SQL = findMigration(MIGRATIONS, "_customers").sql;

describe("migration 007 · tenant branding", () => {
  it("creates the tenant_branding table with a unique tenant index", () => {
    expect(BRANDING_SQL).toMatch(/CREATE TABLE "tenant_branding"/);
    expect(BRANDING_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_branding_tenant_id_key"[\s\S]*?ON "tenant_branding"\("tenant_id"\)/
    );
  });

  it("stores versioned overrides as JSONB", () => {
    expect(BRANDING_SQL).toMatch(/"schema_version" INTEGER NOT NULL/);
    expect(BRANDING_SQL).toMatch(/"overrides" JSONB NOT NULL/);
  });

  it("uses RESTRICT foreign keys toward tenant and updater", () => {
    expect(BRANDING_SQL).toMatch(
      /ALTER TABLE "tenant_branding"[\s\S]*?FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
    expect(BRANDING_SQL).toMatch(
      /ALTER TABLE "tenant_branding"[\s\S]*?FOREIGN KEY \("updated_by_user_profile_id"\) REFERENCES "user_profile"\("id"\)[\s\S]*?ON DELETE RESTRICT/
    );
  });

  it("declares the TenantBranding model in the schema", () => {
    expect(SCHEMA).toMatch(/model TenantBranding/);
    expect(SCHEMA).toMatch(/tenantBranding\s+TenantBranding\[\]/);
  });
});

describe("migration 008 · customers", () => {
  it("creates customer, customer_address, customer_contact and patient_guardian", () => {
    expect(CUSTOMERS_SQL).toMatch(/CREATE TABLE "customer"/);
    expect(CUSTOMERS_SQL).toMatch(/CREATE TABLE "customer_address"/);
    expect(CUSTOMERS_SQL).toMatch(/CREATE TABLE "customer_contact"/);
    expect(CUSTOMERS_SQL).toMatch(/CREATE TABLE "patient_guardian"/);
  });

  it("pins customer kind to INDIVIDUAL | COMPANY", () => {
    expect(CUSTOMERS_SQL).toMatch(
      /CREATE TYPE "customer_kind" AS ENUM \('INDIVIDUAL', 'COMPANY'\)/
    );
  });

  it("indexes tenant and active scopes", () => {
    expect(CUSTOMERS_SQL).toMatch(/CREATE INDEX "customer_tenant_id_idx"/);
    expect(CUSTOMERS_SQL).toMatch(/CREATE INDEX "customer_tenant_id_is_active_idx"/);
  });

  it("creates PatientGuardian as a Customer-owned scaffold; Patient activation ships separately", () => {
    // The EPIC-04 migration deliberately created the scaffold WITHOUT a patient
    // FK; EPIC-05 activates it in its own additive migration.
    expect(CUSTOMERS_SQL).not.toMatch(/CREATE TABLE "patient"/);
    expect(CUSTOMERS_SQL).not.toMatch(/ADD COLUMN "patient_id"/);
    expect(SCHEMA).toMatch(/guardians\s+PatientGuardian\[\]/);

    const patientsSql = findMigration(MIGRATIONS, "_patients").sql;
    expect(patientsSql).toMatch(/ALTER TABLE "patient_guardian"[\s\S]*?"patient_id" UUID NOT NULL/);
  });

  it("marks confidential fields in the schema comments", () => {
    expect(SCHEMA).toMatch(/CONFIDENTIAL/);
  });

  it("references PatientGuardian only from the Veterinary Patients module", () => {
    // Veterinary → Core boundary: PatientGuardian is Veterinary-owned. The
    // Patients module (`apps/api/src/patients/**`, `apps/web/**/patients/**`)
    // may reference it; every other application module may not.
    const roots = ["../../apps/api/src", "../../apps/web/src"];
    const extensions = [".ts", ".tsx"];
    const violations: string[] = [];

    for (const root of roots) {
      for (const file of walkSourceFiles(root, extensions)) {
        if (file.includes("/patients/")) {
          continue;
        }
        const content = readFileSync(file, "utf-8");
        if (content.includes("PatientGuardian")) {
          violations.push(file);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
