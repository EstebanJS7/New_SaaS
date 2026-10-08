import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * EPIC-16 FISC-010 WU-D — the provider's operation handle.
 *
 * The guard's body is replaced by this migration, so the earlier edge and
 * non-clearing clauses are not restated here: they are **derived** from the
 * migration that installs the previous body and compared as sets. A hand-copied
 * list would pass while a clause was silently dropped.
 */
const MIGRATIONS = loadMigrations();
const SQL = findMigration(MIGRATIONS, "_fiscal_document_provider_reference").sql;
const PREVIOUS_GUARD = findMigration(MIGRATIONS, "_fiscal_document_signing_state").sql;
const SCHEMA = loadPrismaSchema();

const OTHER_GUARDS = [
  "fiscal_document_no_delete",
  "fiscal_document_cancelled_immutable",
  "fiscal_document_identity_immutable",
  "fiscal_document_provider_refs_write_once",
  "fiscal_document_attempts_monotonic",
];

const GUARD_FUNCTION =
  /CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/;

/** Whitespace-insensitive, so a re-indent cannot hide a changed clause. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function guardFunction(sql: string): string {
  const match = GUARD_FUNCTION.exec(sql);
  if (!match) throw new Error("expected the migration to replace the transition guard");
  return normalize(match[0]);
}

const EDGE_LIST = /OLD\."status" = '([A-Z_]+)' AND NEW\."status" IN \(([^)]*)\)/g;
const EDGE_SINGLE = /OLD\."status" = '([A-Z_]+)' AND NEW\."status" = '([A-Z_]+)'/g;

/** Every admitted edge the guard body declares, written `FROM->TO`. */
function guardEdges(sql: string): Set<string> {
  const edges = new Set<string>();
  for (const match of sql.matchAll(EDGE_LIST)) {
    for (const target of match[2].matchAll(/'([A-Z_]+)'/g)) {
      edges.add(`${match[1]}->${target[1]}`);
    }
  }
  for (const match of sql.matchAll(EDGE_SINGLE)) {
    edges.add(`${match[1]}->${match[2]}`);
  }
  return edges;
}

/** Every column the guard refuses to clear, read off its own clauses. */
function nonClearingColumns(sql: string): Set<string> {
  const pattern = /IF OLD\."([a-z_]+)" IS NOT NULL AND NEW\."\1" IS NULL THEN/g;
  return new Set([...sql.matchAll(pattern)].map((match) => match[1]));
}

const NEW_CLAUSE =
  'IF OLD."provider_reference" IS NOT NULL AND NEW."provider_reference" IS NULL THEN ' +
  "RAISE EXCEPTION 'fiscal document provider_reference cannot be cleared' USING ERRCODE = 'restrict_violation'; END IF;";

describe("migration · fiscal document provider reference (EPIC-16 FISC-010)", () => {
  it("is additive, adds one nullable column, and has no transaction wrapper", () => {
    expect(SQL).toMatch(/ALTER TABLE "fiscal_document" ADD COLUMN "provider_reference" TEXT;/);
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(SQL).not.toMatch(/^\s*CREATE TABLE\b/im);
    // ADR-007 §4: the handle must survive resolution, so the migration must not
    // touch the enum, add a default or make the column non-null.
    expect(SQL).not.toMatch(/ALTER TYPE/i);
    expect(SQL).not.toMatch(/ADD COLUMN "provider_reference" TEXT\s+(?:NOT NULL|DEFAULT)/i);
  });

  it("defines the restrictive function and recreates no trigger", () => {
    expect(guardFunction(SQL)).toContain("RETURN NEW;");
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "fiscal_document_transition_guard"\(\)/);
    expect(SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    // The trigger resolves the function by name, so recreating it would risk two
    // triggers firing on the same row.
    expect(SQL).not.toMatch(/CREATE TRIGGER/i);
    expect(SQL).not.toMatch(/DROP TRIGGER/i);
  });

  it("carries the complete previous body forward plus exactly one clause", () => {
    const previous = guardFunction(PREVIOUS_GUARD);
    // Non-vacuity: the body being carried forward is the state machine, not a stub.
    expect(previous).toContain("fiscal document transition from % to % is not allowed");
    expect(guardEdges(PREVIOUS_GUARD).size).toBeGreaterThan(5);
    // The replacer is a function because `$$` inside a replacement string is
    // JavaScript's escape for a single `$`, which would silently compare against
    // a body PostgreSQL would never accept.
    const expected = previous.replace(
      "RETURN NEW; END; $$ LANGUAGE plpgsql;",
      () => `${NEW_CLAUSE} RETURN NEW; END; $$ LANGUAGE plpgsql;`
    );
    expect(
      guardFunction(SQL),
      "the new body must be the previous one with the provider_reference clause inserted"
    ).toBe(normalize(expected));
  });

  it("refuses to clear provider_reference, in the shape of the four existing clauses", () => {
    expect(normalize(SQL)).toContain(normalize(NEW_CLAUSE));
    expect(SQL).toContain(
      "RAISE EXCEPTION 'fiscal document provider_reference cannot be cleared' USING ERRCODE = 'restrict_violation';"
    );
  });

  it("preserves every edge and non-clearing clause the earlier guards installed", () => {
    // Derived from the migration that installs the previous body: an edge or a
    // clause dropped by this one is a difference between the two sets.
    expect(guardEdges(SQL)).toEqual(guardEdges(PREVIOUS_GUARD));
    expect(nonClearingColumns(SQL)).toEqual(
      new Set([...nonClearingColumns(PREVIOUS_GUARD), "provider_reference"])
    );
    // The four carried clauses are named so a failure says which one went missing.
    for (const column of ["external_id", "cdc", "submitted_at", "resolved_at"]) {
      expect(nonClearingColumns(SQL).has(column), `${column} write-once`).toBe(true);
    }
    // resolved_at stays an implication: only a transition into a resolved status
    // requires it, so a cancelled APPROVED document keeps its evidence.
    expect(normalize(SQL)).toContain(
      normalize(`AND NEW."status" IN ('APPROVED', 'REJECTED') AND NEW."resolved_at" IS NULL THEN`)
    );
  });

  it("leaves the other guards untouched", () => {
    for (const guard of OTHER_GUARDS) {
      expect(SQL, guard).not.toContain(guard);
    }
  });

  it("declares the column on the Prisma model and classifies it", () => {
    const model = /model FiscalDocument \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(model).toMatch(/^\s*providerReference String\? @map\("provider_reference"\)$/m);
    // A provider reference is CONFIDENTIAL material, so the model's own
    // classification sentence has to name it (AGENTS.md data classification).
    const documentation = SCHEMA.slice(0, SCHEMA.indexOf("model FiscalDocument {"));
    expect(documentation).toContain("providerReference");
  });
});
