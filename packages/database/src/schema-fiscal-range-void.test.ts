import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * EPIC-16 FISC-016 WU-D — the record that proves a range void happened.
 *
 * The migration is hand-written, so this reads its text: it is the only place
 * that pins what the database will actually enforce. A CHECK that is missing
 * here is a CHECK that does not exist.
 */
const SQL = findMigration(loadMigrations(), "_fisc_016_range_void").sql;
const CLAIM_SQL = findMigration(loadMigrations(), "_fisc_016_range_void_claim").sql;
const SCHEMA = loadPrismaSchema();
const TABLE = "fiscal_range_void";

describe("migration · the voided numbering range (EPIC-16 FISC-016 WU-D)", () => {
  it("is additive: it creates and never drops, alters or rewrites a row", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bDELETE FROM\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+"/i);
    // `BEFORE INSERT ON` is the guard's own name; what must not appear is a
    // statement that writes a row.
    expect(SQL).not.toMatch(/\bINSERT INTO\b/i);
    // The only table it alters is its own: every other statement of the
    // migration is additive against the existing ones.
    expect(SQL).toMatch(new RegExp(`CREATE TABLE "${TABLE}" \\(`));
    expect(SQL).not.toMatch(/\bALTER TABLE "(?!fiscal_range_void")/i);
  });

  it("scopes the row to its tenant and reaches its range through the tenant", () => {
    expect(SQL).toMatch(
      /FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    // The range is referenced by its primary key, because a composite
    // `(tenant_id, id)` key does not exist on `fiscal_timbrado_range` — the same
    // ground FISC-015's allocation stands on, and the trigger below is what buys
    // the ownership check that key would have given.
    expect(SQL).toMatch(
      /FOREIGN KEY \("range_id"\) REFERENCES "fiscal_timbrado_range"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION "fiscal_range_void_range_belongs_to_tenant"\(\)/
    );
    expect(SQL).toMatch(
      /FROM "fiscal_timbrado_range"[\s\S]*?WHERE "tenant_id" = NEW\."tenant_id" AND "id" = NEW\."range_id"/
    );
    expect(SQL).toMatch(/timbrado range % does not belong to tenant %/);
    expect(SQL).toMatch(
      new RegExp(
        `CREATE TRIGGER "fiscal_range_void_range_belongs_to_tenant_trigger"\\s+BEFORE INSERT ON "${TABLE}" FOR EACH ROW`
      )
    );
  });

  it("is append-only: a row is written once, never edited and never deleted", () => {
    // The discipline `invoice_fiscal_allocation` established: the record of an
    // operation that reached a provider is history.
    for (const [suffix, event, message] of [
      ["no_update", "BEFORE UPDATE", "cannot be updated"],
      ["no_delete", "BEFORE DELETE", "cannot be deleted"],
    ] as const) {
      expect(SQL).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION "fiscal_range_void_${suffix}"\\(\\)`)
      );
      expect(SQL).toContain(message);
      expect(SQL).toMatch(
        new RegExp(
          `CREATE TRIGGER "fiscal_range_void_${suffix}_trigger"\\s+${event} ON "${TABLE}" FOR EACH ROW`
        )
      );
    }
    // Every trigger fires BEFORE: the guard is a refusal, not a correction.
    const triggers = SQL.match(/CREATE TRIGGER "[^"]+"\s+(BEFORE|AFTER)/g) ?? [];
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      expect(trigger).toContain("BEFORE");
    }
  });

  it("pins the voided interval with the schema's own `tdNumDE` bounds, ordered", () => {
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_range_void_interval_ordered" CHECK \("from_number" <= "to_number"\)/
    );
    for (const column of ["from_number", "to_number"]) {
      expect(SQL, column).toMatch(
        new RegExp(
          `CONSTRAINT "fiscal_range_void_${column}_tdNumDE"[\\s\\S]{0,80}CHECK \\("${column}" BETWEEN 1 AND 9999999\\)`
        )
      );
    }
    // The ordering rule is OURS: §25.7 records that no schema facet asserts
    // `dNumIn <= dNumFin`, so a reversed interval would be accepted by the
    // provider and void nothing.
    expect(SQL).toMatch(/CHECK \("from_number" <= "to_number"\)/);
  });

  it("keeps the reason in `tmotEve`'s own domain, because that is what it is", () => {
    // The column holds exactly the text that travelled as the event's `mOtEve`,
    // so its domain is the facet's (5..500) and not a new one.
    expect(SQL).toMatch(/"reason" VARCHAR\(500\) NOT NULL/);
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_range_void_reason_tmotEve"[\s\S]{0,40}CHECK \(length\("reason"\) BETWEEN 5 AND 500\)/
    );
  });

  it("cannot record an accepted void that left its range usable", () => {
    // The status flip and the record are one transaction, so the two cannot
    // disagree: a row that says the provider accepted the void cannot also say
    // the range stayed ACTIVE. A refusal leaves the range wherever it was, which
    // is why the implication runs one way only.
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_range_void_voided_left_the_range_unusable"[\s\S]{0,80}CHECK \("outcome" <> 'VOIDED' OR "range_status" <> 'ACTIVE'\)/
    );
    // The status column is the range's own enum, not a second vocabulary for
    // the same three values.
    expect(SQL).toMatch(/"range_status" "fiscal_timbrado_range_status" NOT NULL/);
  });

  it("carries the provider's answer as its own enum and its own nullable columns", () => {
    expect(SQL).toMatch(
      /CREATE TYPE "fiscal_range_void_outcome" AS ENUM \(\s*'VOIDED',\s*'REJECTED',\s*'CONFIGURATION_ERROR',\s*'TRANSIENT_FAILURE'\s*\);/
    );
    expect(SQL).toMatch(/"outcome" "fiscal_range_void_outcome" NOT NULL/);
    // The provider's code, message and reference are nullable: an answer that
    // carries none is a real answer, and `null` is how a row says so.
    for (const column of ["reason_code", "provider_reason", "provider_reference"]) {
      expect(SQL, column).toMatch(new RegExp(`"${column}" TEXT,`));
    }
    // The operator's reason and the provider's message are separate columns:
    // one is the tenant's own text and the other is a service's.
    expect(SQL).toMatch(/"reason" VARCHAR\(500\) NOT NULL/);
    expect(SQL).not.toMatch(/"reason" TEXT/);
  });

  it("indexes the reader the tenant-scoped queries use", () => {
    expect(SQL).toMatch(
      /CREATE INDEX "fiscal_range_void_tenant_id_range_id_created_at_idx"\s+ON "fiscal_range_void"\("tenant_id", "range_id", "created_at"\)/
    );
  });

  it("declares the model and the enum the migration creates, and nothing else", () => {
    expect(SCHEMA).toMatch(/model FiscalRangeVoid \{/);
    expect(SCHEMA).toContain('@@map("fiscal_range_void")');
    const enumBody = /enum FiscalRangeVoidOutcome \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    const values = enumBody
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"));
    expect(values).toEqual([
      "VOIDED",
      "REJECTED",
      "CONFIGURATION_ERROR",
      "TRANSIENT_FAILURE",
      "PENDING",
      "IN_FLIGHT",
    ]);
    // The existing range enum is untouched: the terminal status of a void is
    // `RETIRED`, which already means exactly this operation; the correction
    // appends the claim's own `VOIDING`.
    const rangeEnum = /enum FiscalTimbradoRangeStatus \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(rangeEnum).toContain("RETIRED");
    expect(rangeEnum).toContain("VOIDING");
    expect(SQL).not.toMatch(/ALTER TYPE "fiscal_timbrado_range_status"/);
  });

  it("adds no column to an existing table", () => {
    expect(SQL).not.toMatch(/\bADD COLUMN\b/i);
    expect(SQL).not.toMatch(/\bCREATE TABLE "(?!fiscal_range_void")/i);
  });
});

/**
 * The correction's own migration: the claim's two states and the single
 * settlement transition the append-only trigger now admits.
 */
describe("migration · the void's claim (FISC-016 WU-D)", () => {
  it("appends VOIDING, PENDING and IN_FLIGHT, and never uses them in the migration itself", () => {
    expect(CLAIM_SQL).toMatch(/ALTER TYPE "fiscal_timbrado_range_status" ADD VALUE 'VOIDING'/);
    expect(CLAIM_SQL).toMatch(/ALTER TYPE "fiscal_range_void_outcome" ADD VALUE 'PENDING'/);
    expect(CLAIM_SQL).toMatch(/ALTER TYPE "fiscal_range_void_outcome" ADD VALUE 'IN_FLIGHT'/);
    // PG16 forbids using a new enum value in the transaction that adds it.
    expect(CLAIM_SQL).not.toMatch(/CHECK|INSERT INTO|UPDATE "/);
  });

  it("lets the settlement close an IN_FLIGHT record exactly once", () => {
    expect(CLAIM_SQL).toMatch(/CREATE OR REPLACE FUNCTION "fiscal_range_void_no_update"/);
    // The claim's own entry into flight, before any provider call.
    expect(CLAIM_SQL).toMatch(
      /OLD\."outcome"::text = 'PENDING' AND NEW\."outcome"::text = 'IN_FLIGHT'/
    );
    // The settlement closes exactly that in-flight state...
    expect(CLAIM_SQL).toMatch(/OLD\."outcome"::text = 'IN_FLIGHT'/);
    // ...and the state it replaced is no longer closable directly.
    expect(CLAIM_SQL).not.toMatch(/NEW\."outcome"::text <> 'PENDING'/);
    expect(CLAIM_SQL).toContain("cannot be updated");
  });

  it("adopts an in-flight claim only with the next attempt and a NEWER lease", () => {
    // The lease is the guard an observer cannot bypass: an adoption must state
    // both its attempt identity and a lease newer than the one it replaces.
    expect(CLAIM_SQL).toMatch(/NEW\."attempt" = OLD\."attempt" \+ 1/);
    expect(CLAIM_SQL).toMatch(/NEW\."claimed_at" > OLD\."claimed_at"/);
    expect(CLAIM_SQL).toMatch(/NEW\."claimed_at" IS NOT NULL/);
  });

  it("gives the claim an attempt identity and a lease the settlement CASes on", () => {
    expect(CLAIM_SQL).toMatch(
      /ALTER TABLE "fiscal_range_void" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1/
    );
    expect(CLAIM_SQL).toMatch(
      /ALTER TABLE "fiscal_range_void" ADD COLUMN "claimed_at" TIMESTAMPTZ\(3\)/
    );
    expect(SCHEMA).toMatch(/attempt\s+Int\s+@default\(1\)/);
    expect(SCHEMA).toMatch(/claimedAt\s+DateTime\?\s+@map\("claimed_at"\)/);
  });
});
