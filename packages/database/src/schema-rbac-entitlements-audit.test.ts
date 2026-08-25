import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for the RBAC / entitlements / audit slice (task 2.4, spec:
 * persistence / Schema conventions + inventory; rbac-entitlements-seed).
 *
 * Pins migration 003 (RBAC tables + deferred membership FK) and migration 004
 * (entitlements boundary + append-only audit log) against design D2/D8/D9.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const RBAC_SQL = findMigration(MIGRATIONS, "_rbac_roles").sql;
const ENTITLEMENTS_AUDIT_SQL = findMigration(MIGRATIONS, "_entitlements_audit").sql;

describe("migration 003 · RBAC surface", () => {
  it("creates role, permission, and role_permission", () => {
    expect(RBAC_SQL).toMatch(/CREATE TABLE "role"/);
    expect(RBAC_SQL).toMatch(/CREATE TABLE "permission"/);
    expect(RBAC_SQL).toMatch(/CREATE TABLE "role_permission"/);
  });

  it("keeps role codes and permission keys globally unique", () => {
    expect(RBAC_SQL).toMatch(/CREATE UNIQUE INDEX "role_code_key" ON "role"\("code"\)/);
    expect(RBAC_SQL).toMatch(/CREATE UNIQUE INDEX "permission_key_key" ON "permission"\("key"\)/);
  });

  it("allows exactly one permission binding per (role, permission) pair", () => {
    expect(RBAC_SQL).toMatch(
      /CREATE UNIQUE INDEX "role_permission_role_id_permission_id_key" ON "role_permission"\("role_id", "permission_id"\)/
    );
  });

  it("restricts every RBAC foreign key", () => {
    expect(RBAC_SQL).toMatch(
      /ALTER TABLE "role_permission".*"role_id".*REFERENCES "role"\("id"\) ON DELETE RESTRICT/
    );
    expect(RBAC_SQL).toMatch(
      /ALTER TABLE "role_permission".*"permission_id".*REFERENCES "permission"\("id"\) ON DELETE RESTRICT/
    );
  });

  it("resolves the deferred tenant_membership.role_id FOREIGN KEY with RESTRICT", () => {
    // Closes the deviation accepted in migration 002 (sequential SQL cannot
    // forward-reference role). The column itself stays in 002; only the
    // constraint is added here.
    expect(RBAC_SQL).not.toMatch(/ADD COLUMN.*"role_id"/);
    expect(RBAC_SQL).toMatch(
      /ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_role_id_fkey" FOREIGN KEY \("role_id"\) REFERENCES "role"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("documents the 003/004 contingency split in-file", () => {
    expect(RBAC_SQL).toMatch(/split 1 of 2/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/split 2 of 2/);
  });
});

describe("migration 004 · entitlements boundary", () => {
  it("creates feature_code, plan, plan_capability, and tenant_entitlement", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/CREATE TABLE "feature_code"/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/CREATE TABLE "plan"/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/CREATE TABLE "plan_capability"/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/CREATE TABLE "tenant_entitlement"/);
  });

  it("keeps plan and feature-code codes unique", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /CREATE UNIQUE INDEX "feature_code_code_key" ON "feature_code"\("code"\)/
    );
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /CREATE UNIQUE INDEX "plan_code_key" ON "plan"\("code"\)/
    );
  });

  it("uniquely joins plans to feature codes", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /CREATE UNIQUE INDEX "plan_capability_plan_id_feature_code_id_key" ON "plan_capability"\("plan_id", "feature_code_id"\)/
    );
  });

  it("uniquely grants entitlements per (tenant, feature code)", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_entitlement_tenant_id_feature_code_id_key" ON "tenant_entitlement"\("tenant_id", "feature_code_id"\)/
    );
  });

  it("restricts every entitlement foreign key including tenant", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /ALTER TABLE "tenant_entitlement".*"tenant_id".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /ALTER TABLE "plan_capability".*REFERENCES "plan"\("id"\) ON DELETE RESTRICT/
    );
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /ALTER TABLE "tenant_entitlement".*"feature_code_id".*REFERENCES "feature_code"\("id"\) ON DELETE RESTRICT/
    );
  });
});

describe("migration 004 · append-only audit log (design D9)", () => {
  it("pins actor types to STAFF | SYSTEM via enum", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /CREATE TYPE "audit_actor_type" AS ENUM \('STAFF', 'SYSTEM'\)/
    );
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"actor_type" "audit_actor_type" NOT NULL/);
  });

  it("carries the complete D9 column shape", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/CREATE TABLE "audit_log"/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"tenant_id" UUID,/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"actor_user_profile_id" UUID,/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"action" TEXT NOT NULL/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"target_type" TEXT,/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"target_id" TEXT,/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"metadata" JSONB NOT NULL/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(/"request_id" TEXT,/);
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/
    );
  });

  it("is append-only: no updated_at column exists to mutate", () => {
    const tableBlock = ENTITLEMENTS_AUDIT_SQL.slice(
      ENTITLEMENTS_AUDIT_SQL.indexOf('CREATE TABLE "audit_log"'),
      ENTITLEMENTS_AUDIT_SQL.indexOf("audit_log_pkey")
    );
    expect(tableBlock).not.toContain("updated_at");
  });

  it("indexes trail queries by (tenant_id, created_at DESC)", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"\("tenant_id", "created_at" DESC\)/
    );
  });

  it("restricts audit foreign keys so the trail cannot be orphaned", () => {
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /ALTER TABLE "audit_log".*"tenant_id".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
    expect(ENTITLEMENTS_AUDIT_SQL).toMatch(
      /ALTER TABLE "audit_log".*"actor_user_profile_id".*REFERENCES "user_profile"\("id"\) ON DELETE RESTRICT/
    );
  });

  it("documents the append-only boundary at model level", () => {
    expect(SCHEMA).toContain("APPEND-ONLY BOUNDARY");
  });
});
