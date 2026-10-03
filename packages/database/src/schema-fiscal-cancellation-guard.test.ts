import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations } from "./schema-files.js";

const SQL = findMigration(loadMigrations(), "_fiscal_document_cancellation_guard").sql;
const OTHER_GUARDS = [
  "fiscal_document_no_delete",
  "fiscal_document_cancelled_immutable",
  "fiscal_document_identity_immutable",
  "fiscal_document_provider_refs_write_once",
  "fiscal_document_attempts_monotonic",
];

function edgePattern(from: string, to: string): RegExp {
  return new RegExp(
    `OLD\\."status" = '${from}' AND NEW\\."status" (?:= '${to}'|IN \\([^)]*'${to}'[^)]*\\))`
  );
}

describe("migration · fiscal document cancellation guard (EPIC-15 FISC-005)", () => {
  it("is additive and has no transaction wrapper", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*ALTER TYPE\b/im);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(SQL).not.toMatch(/^\s*CREATE TABLE\b/im);
  });

  it("replaces the function only and adds no trigger", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"\(\)/);
    expect(SQL).not.toMatch(/^\s*CREATE TRIGGER\b/im);
    expect(SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(SQL).toMatch(/transition from % to % is not allowed/);
  });

  it("admits each cancellation edge while excluding worker and terminal edges", () => {
    for (const [from, to] of [
      ["PENDING", "CANCELLED"],
      ["QUEUED", "CANCELLED"],
      ["ERROR", "CANCELLED"],
      ["REJECTED", "CANCELLED"],
      ["SUBMITTED", "CANCEL_PENDING"],
      ["APPROVED", "CANCEL_PENDING"],
      ["CANCEL_PENDING", "CANCELLED"],
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
    ])
      expect(SQL, `${from} -> ${to}`).toMatch(edgePattern(from, to));
    for (const [from, to] of [
      ["SENDING", "CANCELLED"],
      ["CANCELLED", "PENDING"],
      ["CANCELLED", "CANCEL_PENDING"],
      ["CANCELLED", "CANCELLED"],
      ["APPROVED", "CANCELLED"],
      ["APPROVED", "ERROR"],
      ["PENDING", "APPROVED"],
      ["QUEUED", "SUBMITTED"],
      ["SUBMITTED", "SENDING"],
      ["REJECTED", "SENDING"],
    ])
      expect(SQL, `${from} -> ${to} must not be allowed`).not.toMatch(edgePattern(from, to));
    expect(SQL).toContain("worker holds that claim");
    expect(SQL).toContain("FISC-002 biconditional");
  });

  it("preserves the resolved_at implication and never-clear clauses", () => {
    expect(SQL).toMatch(
      /NEW\."status" IS DISTINCT FROM OLD\."status"[\s\S]*?NEW\."status" IN \('APPROVED', 'REJECTED'\) AND NEW\."resolved_at" IS NULL/
    );
    expect(SQL).not.toMatch(
      /\(\s*NEW\."resolved_at" IS NULL\s*\)\s*=\s*\(\s*NEW\."status" NOT IN/i
    );
    expect(SQL).toContain("implication, not a biconditional");
    for (const column of ["external_id", "cdc", "submitted_at", "resolved_at"])
      expect(SQL).toMatch(
        new RegExp(`OLD\\."${column}" IS NOT NULL AND NEW\\."${column}" IS NULL`)
      );
    for (const guard of OTHER_GUARDS) expect(SQL).not.toContain(`FUNCTION "${guard}"`);
  });
});
