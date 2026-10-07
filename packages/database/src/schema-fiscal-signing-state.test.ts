import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * EPIC-16 FISC-009 — the `SIGNING` state.
 *
 * The guard's body is replaced by a later migration, so this reads the migration
 * that installs the current one rather than the FISC-004 original: the two
 * earlier files describe the state machine as it was, and this one describes it
 * as it is.
 */
const SQL = findMigration(loadMigrations(), "_fiscal_document_signing_state").sql;
const SCHEMA = loadPrismaSchema();
const OTHER_GUARDS = [
  "fiscal_document_no_delete",
  "fiscal_document_cancelled_immutable",
  "fiscal_document_identity_immutable",
  "fiscal_document_provider_refs_write_once",
  "fiscal_document_attempts_monotonic",
];

/**
 * Matches one edge, accepting either the single-target form (`= 'TO'`) or a
 * multi-target `IN (...)` list containing `TO`, so a forbidden pair hiding
 * inside a list is caught as well as one written on its own.
 */
function edgePattern(from: string, to: string): RegExp {
  return new RegExp(
    `OLD\\."status" = '${from}' AND NEW\\."status" (?:= '${to}'|IN \\([^)]*'${to}'[^)]*\\))`
  );
}

describe("migration · fiscal document signing state (EPIC-16 FISC-009)", () => {
  it("is additive, creates no table, and has no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(SQL).not.toMatch(/^\s*CREATE TABLE\b/im);
  });

  it("appends SIGNING to the enum, and never references it as a value in this transaction", () => {
    expect(SQL).toMatch(/ALTER TYPE "fiscal_document_status" ADD VALUE IF NOT EXISTS 'SIGNING';/);
    // The only other occurrence is the guard's PL/pgSQL body, which is stored as
    // source and is not resolved against the enum when the function is created.
    // A `SELECT ... WHERE status = 'SIGNING'` here would fail on PostgreSQL 12+.
    const references = SQL.match(/'SIGNING'/g) ?? [];
    expect(references.length).toBeGreaterThan(1);
    expect(SQL).not.toMatch(/WHERE[^;]*=\s*'SIGNING'/i);
  });

  it("defines the restrictive function, and recreates no trigger", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"\(\)/);
    expect(SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    // The trigger resolves the function by name, so recreating it would be noise
    // and would risk two triggers firing on the same row.
    expect(SQL).not.toMatch(/CREATE TRIGGER/i);
  });

  it("admits the three edges that make SIGNING a stage", () => {
    for (const [from, to] of [
      ["QUEUED", "SIGNING"],
      ["SIGNING", "SENDING"],
      ["SIGNING", "ERROR"],
    ]) {
      expect(SQL, `${from} -> ${to}`).toMatch(edgePattern(from, to));
    }
    expect(SQL).toMatch(/transition from % to % is not allowed/);
  });

  it("keeps SIGNING -> CANCELLED excluded, because a worker holds that claim", () => {
    expect(SQL).not.toMatch(edgePattern("SIGNING", "CANCELLED"));
    // The same reason the original exclusion exists, so the guard does not
    // silently become the place where one of the two is allowed.
    expect(SQL).not.toMatch(edgePattern("SENDING", "CANCELLED"));
  });

  it("preserves every edge and invariant the earlier guards installed", () => {
    for (const [from, to] of [
      ["PENDING", "QUEUED"],
      ["PENDING", "SENDING"],
      ["QUEUED", "SENDING"],
      ["SENDING", "SUBMITTED"],
      ["SENDING", "APPROVED"],
      ["SENDING", "REJECTED"],
      ["SENDING", "ERROR"],
      ["SUBMITTED", "APPROVED"],
      ["SUBMITTED", "REJECTED"],
      ["SUBMITTED", "ERROR"],
      ["SUBMITTED", "CANCEL_PENDING"],
      ["APPROVED", "CANCEL_PENDING"],
      ["REJECTED", "CANCELLED"],
      ["ERROR", "SENDING"],
      ["CANCEL_PENDING", "CANCELLED"],
    ]) {
      expect(SQL, `${from} -> ${to}`).toMatch(edgePattern(from, to));
    }
    // resolved_at stays an implication, not a biconditional.
    expect(SQL).toMatch(
      /NEW\."status" IN \('APPROVED', 'REJECTED'\) AND NEW\."resolved_at" IS NULL/
    );
    for (const column of ["external_id", "cdc", "submitted_at", "resolved_at"]) {
      expect(SQL, `${column} write-once`).toMatch(
        new RegExp(`OLD\\."${column}" IS NOT NULL AND NEW\\."${column}" IS NULL`)
      );
    }
  });

  it("leaves the other guards untouched", () => {
    for (const guard of OTHER_GUARDS) {
      expect(SQL, guard).not.toContain(guard);
    }
  });

  it("declares SIGNING last in the Prisma enum, matching what PostgreSQL can do", () => {
    const enumBody = /enum FiscalDocumentStatus \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    const values = enumBody
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"));
    // `ALTER TYPE ... ADD VALUE` appends, so a value declared in the middle would
    // describe an order the database cannot have without recreating the type.
    expect(values[values.length - 1]).toBe("SIGNING");
    expect(values).toEqual([
      "PENDING",
      "QUEUED",
      "SENDING",
      "SUBMITTED",
      "APPROVED",
      "REJECTED",
      "ERROR",
      "CANCEL_PENDING",
      "CANCELLED",
      "SIGNING",
    ]);
  });
});
