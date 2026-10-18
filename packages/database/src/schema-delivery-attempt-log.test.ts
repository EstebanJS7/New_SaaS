import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema gate for the delivery attempt log ([[TD-046]]).
 *
 * Parses the migration SQL and the schema document — the exact artifacts
 * `prisma migrate deploy` applies — so the cases hold without a live database.
 */
const SQL = findMigration(loadMigrations(), "_td_046_delivery_attempt_log").sql;
const SCHEMA = loadPrismaSchema();

describe("migration · delivery attempt log (TD-046)", () => {
  it("is additive: no drop, no data write, no alteration, no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*ALTER TYPE\b/im);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("declares the outcome enum with CREATE TYPE, since it is a new type", () => {
    expect(SQL).toMatch(/CREATE TYPE "notification_attempt_outcome" AS ENUM \('SENT', 'FAILED'\);/);
  });

  it("stores the bounded reason and the provider's raw error NOWHERE", () => {
    // The decision TD-046 recorded: the raw text is RESTRICTED material this epic keeps
    // out of every stored field, and it would need sanitizing anyway.
    expect(SQL).toMatch(/"reason_code"\s+TEXT,/);
    expect(SQL).toMatch(/"reason_message"\s+TEXT,/);
    for (const forbidden of ["provider_error", "raw_error", "raw_message", "payload", "body"]) {
      expect(SQL).not.toContain(`"${forbidden}"`);
    }
  });

  it("is APPEND-ONLY, with the edit and the removal refused separately", () => {
    const guard =
      /FUNCTION "notification_delivery_attempt_append_only"\(\)([\s\S]*?)\$\$ LANGUAGE plpgsql;/.exec(
        SQL
      )?.[1];
    expect(guard).toBeDefined();
    expect(guard).toMatch(/cannot be deleted/);
    expect(guard).toMatch(/cannot be edited/);
    expect(SQL).toMatch(
      /CREATE TRIGGER "notification_delivery_attempt_append_only_trigger"\s+BEFORE UPDATE OR DELETE ON "notification_delivery_attempt"/
    );
  });

  it("keeps the outcome and its reason in agreement", () => {
    const check =
      /CONSTRAINT "notification_delivery_attempt_reason_biconditional" CHECK \(([\s\S]*?)\),\n/.exec(
        SQL
      )?.[1];
    expect(check).toBeDefined();
    // A failure explains itself; a success carries nothing.
    expect(check).toMatch(/'FAILED' AND "reason_code" IS NOT NULL/);
    expect(check).toMatch(/'SENT' AND "reason_code" IS NULL AND "reason_message" IS NULL/);
  });

  it("numbers attempts from one, and never records one twice", () => {
    expect(SQL).toMatch(/CHECK \("attempt_number" >= 1\)/);
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "notification_delivery_attempt_delivery_id_attempt_number_key"\s+ON "notification_delivery_attempt" \("delivery_id", "attempt_number"\);/
    );
  });

  it("declares the cascade as a fence — and the parent cannot be deleted at all", () => {
    expect(SQL).toMatch(
      /FOREIGN KEY \("delivery_id"\) REFERENCES "notification_delivery" \("id"\)\s+ON DELETE CASCADE ON UPDATE CASCADE/
    );
    // The live run of this migration is what established the second half: the delivery
    // table carries its own `no_delete` guard, so a delivery is CANCELLED rather than
    // removed and this cascade can never fire. Asserted here because it is the reason the
    // log is effectively permanent — and that is what a log should be.
    expect(
      loadMigrations()
        .map((file) => file.sql)
        .join("\n")
    ).toMatch(/notification_delivery_no_delete/);
  });

  it("declares the model, its enum and BOTH sides of the relation in the schema", () => {
    const model = /model NotificationDeliveryAttempt \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1];
    expect(model).toBeDefined();
    expect(model).toMatch(/attemptNumber Int @map\("attempt_number"\)/);
    expect(model).toMatch(/outcome NotificationAttemptOutcome/);
    expect(model).toMatch(/@@unique\(\[deliveryId, attemptNumber\]\)/);
    expect(model).toMatch(/@@map\("notification_delivery_attempt"\)/);
    expect(SCHEMA).toMatch(/enum NotificationAttemptOutcome \{[\s\S]*?SENT[\s\S]*?FAILED/);
    // Without the collection on the delivery, Prisma cannot load the schema at all.
    expect(SCHEMA).toMatch(/attempts NotificationDeliveryAttempt\[\]/);
  });
});
