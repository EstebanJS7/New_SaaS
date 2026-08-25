import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for the tenancy slice (spec: persistence / EPIC-01 schema
 * inventory — scenario "Schema-only surfaces stay inert"; spec: tenancy-core /
 * No self-service tenant creation).
 *
 * The route-enumeration half of the inertness proof is owned by task 5.3
 * (cross-tenant suite); this file pins the DATABASE side: required tables,
 * unique constraints, FK semantics, and the accepted role_id deviation.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const TENANCY_SQL = findMigration(MIGRATIONS, "_tenancy_core").sql;

describe("migration 002 · tenancy core surface", () => {
  it("creates tenant, branch, tenant_membership, and customer_portal_access", () => {
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "tenant"/);
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "branch"/);
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "tenant_membership"/);
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "customer_portal_access"/);
  });

  it("does not redefine identity tables owned by migration 001", () => {
    // tasks.md places staff_session in migration 001 (task 2.2); 002 must not
    // duplicate any of them.
    expect(TENANCY_SQL).not.toMatch(/CREATE TABLE "(user_profile|user_credential|staff_session)"/);
  });

  it("keeps tenant slugs globally unique", () => {
    expect(TENANCY_SQL).toMatch(/CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"\("slug"\)/);
  });

  it("allows exactly one membership per (tenant, profile)", () => {
    expect(TENANCY_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_membership_tenant_id_user_profile_id_key" ON "tenant_membership"\("tenant_id", "user_profile_id"\)/
    );
  });

  it("pins membership status to ACTIVE | SUSPENDED via enum", () => {
    expect(TENANCY_SQL).toMatch(
      /CREATE TYPE "tenant_membership_status" AS ENUM \('ACTIVE', 'SUSPENDED'\)/
    );
    expect(TENANCY_SQL).toMatch(/"status" "tenant_membership_status" NOT NULL/);
  });

  it("uses RESTRICT FKs for every non-session relationship", () => {
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "branch".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "tenant_membership".*"tenant_id".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "tenant_membership".*"user_profile_id".*REFERENCES "user_profile"\("id"\) ON DELETE RESTRICT/
    );
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "customer_portal_access".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
  });

  it("defers the role_id FOREIGN KEY to migration 003 and says so in-file", () => {
    // Accepted deviation: sequential SQL cannot forward-reference the role
    // table created by task 2.4 (U5); U5 ships an additive ALTER.
    expect(TENANCY_SQL).toMatch(/"role_id" UUID NOT NULL/);
    expect(TENANCY_SQL).not.toMatch(/REFERENCES\s+"role"/i);
    expect(TENANCY_SQL).toMatch(/migration 003/);
  });

  it("marks branch and customer portal access as inert scaffolding", () => {
    expect(SCHEMA).toMatch(/SCHEMA-ONLY SCAFFOLD/);
    expect(SCHEMA).toMatch(/INERT SCAFFOLD/);
    expect(TENANCY_SQL).toMatch(/INERT SCAFFOLD/i);
  });

  it("classifies contact_email as INTERNAL in the applied artifact", () => {
    expect(TENANCY_SQL).toMatch(/INTERNAL/);
  });
});
