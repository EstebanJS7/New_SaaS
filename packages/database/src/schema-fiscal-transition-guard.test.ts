import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations } from "./schema-files.js";

const SQL = findMigration(loadMigrations(), "_fiscal_document_transition_guard").sql;
const EXISTING_GUARDS = [
  "fiscal_document_no_delete",
  "fiscal_document_cancelled_immutable",
  "fiscal_document_identity_immutable",
  "fiscal_document_provider_refs_write_once",
  "fiscal_document_attempts_monotonic",
];

/**
 * Matches one edge, accepting either the single-target form (`= 'TO'`) or a
 * multi-target `IN (...)` list containing `TO`.
 *
 * A per-edge regex that assumed only the single form would fail the moment two
 * targets share a clause, which is exactly what the D4 list does: `PENDING`
 * targets both `QUEUED` and `SENDING`. Using the same matcher for the forbidden
 * pairs also catches one hiding inside a multi-target list, which a
 * `= 'TO'`-only negative assertion would miss.
 */
function edgePattern(from: string, to: string): RegExp {
  return new RegExp(
    `OLD\\."status" = '${from}' AND NEW\\."status" (?:= '${to}'|IN \\([^)]*'${to}'[^)]*\\))`
  );
}

describe("migration · fiscal document transition guard (EPIC-15 FISC-004)", () => {
  it("is additive, creates no table, and has no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*ALTER TYPE\b/im);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(SQL).not.toMatch(/^\s*CREATE TABLE\b/im);
  });

  it("defines the restrictive function and row-level BEFORE UPDATE trigger", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"\(\)/);
    expect(SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(SQL).toMatch(
      /CREATE TRIGGER "fiscal_document_transition_guard_trigger"\s+BEFORE UPDATE ON "fiscal_document" FOR EACH ROW/
    );
  });

  it("contains exactly the D4 allowed edges and rejects other status changes", () => {
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
      ["ERROR", "SENDING"],
    ]) {
      expect(SQL, `${from} -> ${to}`).toMatch(edgePattern(from, to));
    }
    expect(SQL).toMatch(/IF NEW\."status" IS DISTINCT FROM OLD\."status" THEN/);
    expect(SQL).toMatch(/transition from % to % is not allowed/);
    for (const [from, to] of [
      ["PENDING", "APPROVED"],
      ["PENDING", "REJECTED"],
      ["QUEUED", "SUBMITTED"],
      ["SUBMITTED", "SENDING"],
      ["ERROR", "APPROVED"],
      ["APPROVED", "CANCELLED"],
      ["APPROVED", "ERROR"],
      ["APPROVED", "PENDING"],
      ["REJECTED", "SENDING"],
      ["CANCELLED", "PENDING"],
      ["CANCEL_PENDING", "CANCELLED"],
    ]) {
      expect(SQL, `${from} -> ${to} must not be allowed`).not.toMatch(edgePattern(from, to));
    }
  });

  it("requires resolved_at only as an entering-status implication, never a biconditional", () => {
    expect(SQL).toMatch(
      /NEW\."status" IS DISTINCT FROM OLD\."status"[\s\S]*?NEW\."status" IN \('APPROVED', 'REJECTED'\) AND NEW\."resolved_at" IS NULL/
    );
    expect(SQL).not.toMatch(
      /\(\s*NEW\."resolved_at" IS NULL\s*\)\s*=\s*\(\s*NEW\."status" NOT IN/i
    );
    expect(SQL).toContain("implication, not a biconditional");
  });

  it("never clears any of the four evidence columns and leaves existing guards untouched", () => {
    for (const column of ["external_id", "cdc", "submitted_at", "resolved_at"]) {
      expect(SQL).toMatch(
        new RegExp(`OLD\\."${column}" IS NOT NULL AND NEW\\."${column}" IS NULL`)
      );
    }
    for (const guard of EXISTING_GUARDS) expect(SQL).not.toContain(`FUNCTION "${guard}"`);
  });
});
