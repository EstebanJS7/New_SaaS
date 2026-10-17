import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema gate for the notification delivery aggregate (EPIC-17 NOTIF-001, WU-B).
 *
 * These assertions parse the migration SQL and the schema document -- the exact
 * artifacts `prisma migrate deploy` applies in CI -- so they hold without a live
 * database. The same cases were also executed against PostgreSQL 16 on a freshly
 * migrated database before this Story closed; this file is their regression net.
 */
const SQL = findMigration(loadMigrations(), "_notif_001_notification_delivery").sql;
const SCHEMA = loadPrismaSchema();

/**
 * Matches one edge, accepting either the single-target form (`= 'TO'`) or a
 * multi-target `IN (...)` list containing `TO`. The same matcher is used for the
 * forbidden pairs, so an edge hiding inside a multi-target list is caught rather
 * than missed by a `= 'TO'`-only negative assertion.
 */
function edgePattern(from: string, to: string): RegExp {
  return new RegExp(
    `OLD\\."status" = '${from}' AND NEW\\."status" (?:= '${to}'|IN \\([^)]*'${to}'[^)]*\\))`
  );
}

describe("migration · notification delivery (NOTIF-001)", () => {
  it("is additive: no drop, no data write, no type alteration, no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*ALTER TYPE\b/im);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("creates the four enum types with CREATE TYPE, not ALTER TYPE", () => {
    // A value appended by ALTER TYPE... ADD VALUE is unusable as an enum literal
    // in the same transaction, and Prisma runs one migration in ONE transaction.
    expect(SQL).toMatch(/CREATE TYPE "notification_channel" AS ENUM \('EMAIL', 'WHATSAPP'\);/);
    expect(SQL).toMatch(
      /CREATE TYPE "notification_delivery_status" AS ENUM \(\s*'SCHEDULED',\s*'QUEUED',\s*'SENDING',\s*'SENT',\s*'FAILED',\s*'CANCELLED'\s*\);/
    );
    expect(SQL).toMatch(
      /CREATE TYPE "notification_source_type" AS ENUM \('APPOINTMENT', 'FISCAL_DOCUMENT'\);/
    );
    expect(SQL).toMatch(/CREATE TYPE "notification_recipient_type" AS ENUM \('CUSTOMER'\);/);
  });

  it("creates the tenant-scoped table with its UTC timestamps", () => {
    expect(SQL).toMatch(/CREATE TABLE "notification_delivery"/);
    expect(SQL).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(SQL).toMatch(/"scheduled_at" TIMESTAMPTZ\(3\) NOT NULL/);
    // No bare TIMESTAMP anywhere: a TZ-naive column would lose the instant a
    // delayed job depends on.
    expect(SQL).not.toMatch(/"\w+" TIMESTAMP(\(|\s+WITHOUT\b)/i);
  });

  it("keeps the tenant FK restrictive", () => {
    expect(SQL).toMatch(
      /FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("enforces the intent key with a PARTIAL unique index that CANCELLED releases", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "notification_delivery_tenant_id_dedupe_key_key"\s+ON "notification_delivery" \("tenant_id", "dedupe_key"\)\s+WHERE "status" <> 'CANCELLED';/
    );
  });

  it("asserts the status/timestamp biconditionals in BOTH directions", () => {
    // `(status = X) = (column IS NOT NULL)` refuses a timestamp without its
    // status AND a status without its timestamp, which two one-way checks would
    // not do.
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_sent_at_check"\s+CHECK \(\("status" = 'SENT'\) = \("sent_at" IS NOT NULL\)\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_cancelled_at_check"\s+CHECK \(\("status" = 'CANCELLED'\) = \("cancelled_at" IS NOT NULL\)\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_cancellation_reason_check"\s+CHECK \(\("status" = 'CANCELLED'\) = \("cancellation_reason" IS NOT NULL\)\)/
    );
  });

  it("asserts the failure-reason coherence", () => {
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_failed_reason_check"\s+CHECK \("status" <> 'FAILED' OR "last_error_code" IS NOT NULL\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_sent_reason_check"\s+CHECK \("status" <> 'SENT' OR "last_error_code" IS NULL\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_error_code_status_check"\s+CHECK \("last_error_code" IS NULL OR "status" IN \('SENDING', 'FAILED'\)\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_attempt_count_check"\s+CHECK \("attempt_count" >= 0\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "notification_delivery_dedupe_key_check"\s+CHECK \(char_length\("dedupe_key"\) > 0 AND char_length\("dedupe_key"\) <= 200\)/
    );
  });

  it("freezes exactly SENT and CANCELLED, and leaves FAILED writable in place", () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION "notification_delivery_terminal_immutable"\(\)/
    );
    expect(SQL).toMatch(/IF OLD\."status" IN \('SENT', 'CANCELLED'\) THEN/);
    expect(SQL).not.toMatch(/IF OLD\."status" IN \('SENT', 'FAILED', 'CANCELLED'\) THEN/);
  });

  it("refuses to delete a delivery", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "notification_delivery_no_delete"\(\)/);
    expect(SQL).toMatch(
      /CREATE TRIGGER "notification_delivery_no_delete_trigger"\s+BEFORE DELETE ON "notification_delivery" FOR EACH ROW/
    );
  });

  it("makes the intent's identity immutable, dedupe_key included", () => {
    expect(SQL).toMatch(/NEW\."dedupe_key" IS DISTINCT FROM OLD\."dedupe_key"/);
    for (const column of [
      "tenant_id",
      "id",
      "channel",
      "dedupe_key",
      "source_type",
      "source_id",
      "recipient_type",
      "recipient_id",
      "scheduled_at",
      "created_at",
    ]) {
      expect(SQL, `${column} must be immutable`).toMatch(
        new RegExp(`NEW\\."${column}" IS DISTINCT FROM OLD\\."${column}"`)
      );
    }
  });

  it("defines the restrictive transition function and its BEFORE UPDATE trigger", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "notification_delivery_transition_guard"\(\)/);
    expect(SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(SQL).toMatch(
      /CREATE TRIGGER "notification_delivery_transition_guard_trigger"\s+BEFORE UPDATE ON "notification_delivery" FOR EACH ROW/
    );
  });

  it("contains exactly the allowed edges", () => {
    for (const [from, to] of [
      ["SCHEDULED", "QUEUED"],
      ["SCHEDULED", "SENDING"],
      ["SCHEDULED", "CANCELLED"],
      ["QUEUED", "SENDING"],
      ["QUEUED", "CANCELLED"],
      ["SENDING", "SENT"],
      ["SENDING", "FAILED"],
    ]) {
      expect(SQL, `${from} -> ${to}`).toMatch(edgePattern(from, to));
    }
    expect(SQL).toMatch(/IF NEW\."status" IS DISTINCT FROM OLD\."status" THEN/);
    expect(SQL).toMatch(/transition from % to % is not allowed/);
  });

  it("refuses every non-edge, including the terminal statuses' own", () => {
    for (const [from, to] of [
      ["SCHEDULED", "SENT"],
      ["SCHEDULED", "FAILED"],
      ["QUEUED", "SENT"],
      ["QUEUED", "FAILED"],
      ["SENDING", "QUEUED"],
      ["SENDING", "CANCELLED"],
      ["SENT", "SCHEDULED"],
      ["SENT", "FAILED"],
      ["FAILED", "SCHEDULED"],
      ["FAILED", "SENDING"],
      ["FAILED", "SENT"],
      ["CANCELLED", "SCHEDULED"],
      ["CANCELLED", "QUEUED"],
      ["CANCELLED", "SENT"],
    ]) {
      expect(SQL, `${from} -> ${to} must not be allowed`).not.toMatch(edgePattern(from, to));
    }
  });

  it("keeps the claim's lease from being cleared or rewound", () => {
    // A cleared lease makes an owned claim look abandoned and a rewound one is
    // the same thing with extra steps; both end in a second worker claiming an
    // attempt somebody else may be running.
    expect(SQL).toMatch(/OLD\."last_attempt_at" IS NOT NULL AND NEW\."last_attempt_at" IS NULL/);
    expect(SQL).toMatch(/NEW\."last_attempt_at" < OLD\."last_attempt_at"/);
    expect(SQL).toMatch(/a notification delivery last_attempt_at cannot be cleared/);
    expect(SQL).toMatch(/a notification delivery last_attempt_at cannot be rewound/);
  });

  it("keeps attempt_count monotonic in the guard", () => {
    expect(SQL).toMatch(
      /IF NEW\."attempt_count" < OLD\."attempt_count" THEN\s+RAISE EXCEPTION 'a notification delivery attempt_count cannot decrease'/
    );
  });
});

describe("schema · notification_delivery model", () => {
  it("maps to the table and back-references the tenant", () => {
    expect(SCHEMA).toMatch(/model NotificationDelivery \{/);
    expect(SCHEMA).toMatch(/@@map\("notification_delivery"\)/);
    expect(SCHEMA).toMatch(/notificationDeliveries\s+NotificationDelivery\[\]/);
    expect(SCHEMA).toMatch(
      /tenant Tenant @relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
  });

  it("declares the tenant-ownership key and the read paths' indexes", () => {
    expect(SCHEMA).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(SCHEMA).toMatch(/@@index\(\[tenantId, status\]\)/);
    expect(SCHEMA).toMatch(/@@index\(\[tenantId, sourceType, sourceId\]\)/);
    expect(SCHEMA).toMatch(/@@index\(\[tenantId, scheduledAt\]\)/);
  });

  it("declares NO payload or contact column, and no full unique index on the key", () => {
    const model = SCHEMA.slice(SCHEMA.indexOf("model NotificationDelivery {"));
    const body = model.slice(0, model.indexOf("\n}"));

    // The message is built at send time from the authoritative rows, and the
    // recipient is a reference the channel boundary resolves; a stored body or
    // datum could only go stale or leak.
    expect(body).not.toMatch(/payload/i);
    expect(body).not.toMatch(/recipientEmail|recipientPhone|email\s+String|phone\s+String/i);
    // The key's uniqueness is the PARTIAL index above; a full @@unique here would
    // contradict it.
    expect(body).not.toMatch(/@@unique\(\[tenantId, dedupeKey\]\)/);
  });
});
