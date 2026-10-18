import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema gate for the staff password-recovery token (DAT-007, EPIC-01).
 *
 * These assertions parse the migration SQL and the schema document -- the exact
 * artifacts `prisma migrate deploy` applies -- so they hold without a live
 * database. The same cases were executed against PostgreSQL 16 on a freshly
 * migrated database before this Story closed; this file is their regression net.
 */
const SQL = findMigration(loadMigrations(), "_dat_007_password_reset_token").sql;
const SCHEMA = loadPrismaSchema();

describe("migration · password reset token (DAT-007)", () => {
  it("is additive: no drop, no data write, no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("creates the table with the four columns a reset needs and nothing else", () => {
    expect(SQL).toMatch(/CREATE TABLE "password_reset_token"/);
    // The plaintext token is absent by construction: the table stores a digest.
    expect(SQL).toMatch(/"token_hash"\s+TEXT\s+NOT NULL/);
    expect(SQL).toMatch(/"user_profile_id"\s+UUID\s+NOT NULL/);
    expect(SQL).toMatch(/"expires_at"\s+TIMESTAMPTZ\(3\)\s+NOT NULL/);
    expect(SQL).toMatch(/"consumed_at"\s+TIMESTAMPTZ\(3\),/);
  });

  it("stores no plaintext token, no email address and no address of the requester", () => {
    // The whole table is a digest and two instants. A column that could carry the
    // requester's address, the message, or the token itself would make this table a
    // RESTRICTED store, and none exists.
    for (const forbidden of ['"token"', '"email"', '"ip"', '"user_agent"', '"body"']) {
      expect(SQL).not.toContain(`  ${forbidden} `);
    }
  });

  it("has NO tenant column, and that is the invariant rather than an oversight", () => {
    // The credential a reset authorises is `UserCredential`, whose key is shared
    // with `UserProfile` and is therefore global to the profile, not to a
    // membership: a staff member with two memberships has ONE password. Scoping the
    // token to a tenant would mean the flow could only reset the password of a
    // member of the tenant it happened to have in hand. If a future edit adds a
    // `tenant_id` here, it should read this case first.
    expect(SQL).not.toMatch(/"tenant_id"/);
    const model = /model PasswordResetToken \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1];
    expect(model).toBeDefined();
    expect(model).not.toMatch(/tenantId/);
    expect(model).toMatch(/userProfileId String @map\("user_profile_id"\)/);
  });

  it("refuses an expiry that is not after its own creation", () => {
    expect(SQL).toMatch(
      /CONSTRAINT "password_reset_token_expiry_after_creation" CHECK \("expires_at" > "created_at"\)/
    );
  });

  it("makes a lookup by digest one row by construction", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "password_reset_token_token_hash_key"\s+ON "password_reset_token" \("token_hash"\);/
    );
  });

  it("cascades from the profile, like every other identity token", () => {
    expect(SQL).toMatch(
      /FOREIGN KEY \("user_profile_id"\) REFERENCES "user_profile" \("id"\)\s+ON DELETE CASCADE ON UPDATE CASCADE/
    );
  });

  it("locks the token's identity at insert", () => {
    for (const column of ["id", "user_profile_id", "token_hash", "expires_at", "created_at"]) {
      expect(SQL).toMatch(new RegExp(`NEW\\."${column}" IS DISTINCT FROM OLD\\."${column}"`));
    }
    expect(SQL).toMatch(
      /CREATE TRIGGER "password_reset_token_identity_immutable_trigger"\s+BEFORE UPDATE ON "password_reset_token"/
    );
  });

  it("makes the token single-use, refusing both a rewrite and a clear", () => {
    const guard =
      /FUNCTION "password_reset_token_single_use"\(\)([\s\S]*?)\$\$ LANGUAGE plpgsql;/.exec(
        SQL
      )?.[1];
    expect(guard).toBeDefined();
    // A clear is its own message rather than a generic refusal: "un-consumed" is a
    // different mistake from "consumed twice", and a reader should not have to infer
    // which one they made.
    expect(guard).toMatch(/cannot be un-consumed/);
    expect(guard).toMatch(/consumption instant cannot be rewritten/);
    // And the guard's condition is narrowed to a SET value: an update that leaves
    // `consumed_at` alone (a touch, a future column) is not a second consumption.
    expect(guard).toMatch(
      /OLD\."consumed_at" IS NOT NULL AND NEW\."consumed_at" IS DISTINCT FROM OLD\."consumed_at"/
    );
  });

  it("appends the two delivery enum values instead of replacing a type", () => {
    expect(SQL).toMatch(
      /ALTER TYPE "notification_source_type" ADD VALUE IF NOT EXISTS 'STAFF_ACCOUNT';/
    );
    expect(SQL).toMatch(
      /ALTER TYPE "notification_recipient_type" ADD VALUE IF NOT EXISTS 'STAFF';/
    );
    // A value added in a transaction cannot be USED as a literal in that same
    // transaction, and Prisma runs one migration in ONE transaction (PostgreSQL 12
    // and later allow the ADD itself inside one). This migration therefore declares
    // the values and writes no row: the assertion is that neither value appears
    // anywhere else in the file, which is what keeps the rule satisfied.
    const occurrences = (value: string) => (SQL.match(new RegExp(`'${value}'`, "g")) ?? []).length;
    expect(occurrences("STAFF_ACCOUNT")).toBe(1);
    expect(occurrences("STAFF")).toBe(1);
  });

  it("declares both enum values in the schema document, which is what Prisma reads", () => {
    const source = /enum NotificationSourceType \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    const recipient = /enum NotificationRecipientType \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(source).toMatch(/\bSTAFF_ACCOUNT\b/);
    expect(recipient).toMatch(/\bSTAFF\b/);
    // The existing values survive: the extension is additive in the document too.
    expect(source).toMatch(/\bAPPOINTMENT\b/);
    expect(source).toMatch(/\bFISCAL_DOCUMENT\b/);
    expect(recipient).toMatch(/\bCUSTOMER\b/);
  });

  it("declares the relation on BOTH sides, or Prisma cannot load the schema", () => {
    expect(SCHEMA).toMatch(/passwordResetTokens PasswordResetToken\[\]/);
    expect(SCHEMA).toMatch(
      /userProfile UserProfile @relation\(fields: \[userProfileId\], references: \[id\], onDelete: Cascade, onUpdate: Cascade\)/
    );
  });

  it("maps the table and every column to the names the DDL uses", () => {
    expect(SCHEMA).toMatch(/@@map\("password_reset_token"\)/);
    for (const mapping of [
      'tokenHash String @unique @map("token_hash")',
      'userProfileId String @map("user_profile_id") @db.Uuid',
      'expiresAt DateTime @map("expires_at") @db.Timestamptz(3)',
      'consumedAt DateTime? @map("consumed_at") @db.Timestamptz(3)',
    ]) {
      expect(SCHEMA).toContain(mapping);
    }
  });
});
