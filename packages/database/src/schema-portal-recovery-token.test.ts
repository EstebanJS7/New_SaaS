import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema gate for the portal's recovery token ([[PORTAL-002]]).
 *
 * The staff token's mirror, with one property the staff one cannot have: a tenant column is
 * deliberately ABSENT here, because the access it belongs to already carries the tenant and two
 * homes for one fact can disagree.
 */
const SQL = findMigration(loadMigrations(), "_portal_002_recovery_token").sql;
const SCHEMA = loadPrismaSchema();

/**
 * The DDL with its comments removed.
 *
 * This migration explains its decisions in prose, including the columns it deliberately does NOT
 * have — so an absence assertion against the raw text would fail on the explanation. The check is
 * about the DDL, so it reads the DDL.
 */
const DDL = SQL.replace(/^--.*$/gm, "");

describe("migration · portal recovery token (PORTAL-002)", () => {
  it("is additive: no drop, no data write, no alteration, no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("stores only what a reset needs, and no personal data", () => {
    expect(SQL).toMatch(/CREATE TABLE "portal_password_reset_token"/);
    expect(SQL).toMatch(/"portal_access_id"\s+UUID\s+NOT NULL/);
    expect(SQL).toMatch(/"token_hash"\s+TEXT\s+NOT NULL/);
    for (const forbidden of ['"email"', '"token" ', '"ip"', '"user_agent"', '"body"']) {
      expect(DDL).not.toContain(`  ${forbidden}`);
    }
  });

  it("has NO tenant column, because the access it belongs to carries the tenant", () => {
    // Two homes for one fact can disagree; the read asserts they agree instead.
    expect(DDL).not.toMatch(/"tenant_id"/);
    const model = /model PortalPasswordResetToken \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1];
    expect(model).toBeDefined();
    expect(model).not.toMatch(/tenantId/);
    expect(model).toMatch(/portalAccessId String @map\("portal_access_id"\)/);
  });

  it("is keyed to a PORTAL ACCESS, never to a user profile", () => {
    // The identity boundary DEC-008 requires, one level down: a staff token cannot be redeemed here
    // and a portal token cannot be redeemed there. A `user_profile_id` column here would be the way
    // that boundary is lost.
    expect(DDL).not.toMatch(/user_profile_id/);
    expect(SQL).toMatch(
      /FOREIGN KEY \("portal_access_id"\) REFERENCES "customer_portal_access" \("id"\)\s+ON DELETE CASCADE ON UPDATE CASCADE/
    );
    expect(SCHEMA).toMatch(
      /portalAccess CustomerPortalAccess @relation\(fields: \[portalAccessId\]/
    );
    expect(SCHEMA).toMatch(/passwordResetTokens PortalPasswordResetToken\[\]/);
  });

  it("refuses an expiry that is not after its own creation", () => {
    expect(SQL).toMatch(
      /CONSTRAINT "portal_password_reset_token_expiry_after_creation" CHECK \("expires_at" > "created_at"\)/
    );
  });

  it("makes a lookup by digest one row by construction", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "portal_password_reset_token_token_hash_key"\s+ON "portal_password_reset_token" \("token_hash"\);/
    );
  });

  it("locks the token's identity at insert", () => {
    for (const column of ["id", "portal_access_id", "token_hash", "expires_at", "created_at"]) {
      expect(SQL).toMatch(new RegExp(`NEW\\."${column}" IS DISTINCT FROM OLD\\."${column}"`));
    }
  });

  it("makes the token single-use, refusing the rewrite and the clear separately", () => {
    const guard =
      /FUNCTION "portal_password_reset_token_single_use"\(\)([\s\S]*?)\$\$ LANGUAGE plpgsql;/.exec(
        SQL
      )?.[1];
    expect(guard).toBeDefined();
    expect(guard).toMatch(/cannot be un-consumed/);
    expect(guard).toMatch(/consumption instant cannot be rewritten/);
  });

  it("appends the delivery enum values without using them as literals", () => {
    expect(SQL).toMatch(
      /ALTER TYPE "notification_source_type" ADD VALUE IF NOT EXISTS 'PORTAL_ACCOUNT';/
    );
    expect(SQL).toMatch(
      /ALTER TYPE "notification_recipient_type" ADD VALUE IF NOT EXISTS 'PORTAL_HOLDER';/
    );
    const occurrences = (value: string) => (SQL.match(new RegExp(`'${value}'`, "g")) ?? []).length;
    expect(occurrences("PORTAL_ACCOUNT")).toBe(1);
    expect(occurrences("PORTAL_HOLDER")).toBe(1);
  });

  it("declares both enum values and the model in the schema document", () => {
    const source = /enum NotificationSourceType \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    const recipient = /enum NotificationRecipientType \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(source).toMatch(/\bPORTAL_ACCOUNT\b/);
    expect(recipient).toMatch(/\bPORTAL_HOLDER\b/);
    // The values that were there survive: the extension is additive.
    expect(source).toMatch(/\bSTAFF_ACCOUNT\b/);
    expect(recipient).toMatch(/\bSTAFF\b/);
  });
});
