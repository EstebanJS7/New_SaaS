import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * TD-033 item 5 — the cancellation's lease, and the edge that keeps it honest.
 *
 * The guard's body is replaced by this migration, so the earlier edges and the
 * non-clearing clauses are not restated here: they are **derived** from the
 * migration that installs the previous body and compared as sets. A hand-copied
 * list would pass while a clause was silently dropped — and a dropped clause here
 * would relax a guard the whole fiscal state machine stands on.
 */
const MIGRATIONS = loadMigrations();
const SQL = findMigration(MIGRATIONS, "_fisc_012_cancel_pending_lease").sql;
const PREVIOUS_GUARD = findMigration(MIGRATIONS, "_fiscal_document_provider_reference").sql;
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

const LEASE_CHECK = `  IF OLD."status" = 'CANCEL_PENDING' AND NEW."status" = 'CANCEL_PENDING'
    AND ((OLD."cancel_pending_since" IS NOT NULL AND NEW."cancel_pending_since" IS NULL)
      OR (OLD."cancel_pending_since" IS NOT NULL
        AND NEW."cancel_pending_since" IS NOT NULL
        AND NEW."cancel_pending_since" < OLD."cancel_pending_since")) THEN
    RAISE EXCEPTION 'fiscal document cancel_pending_since may never be cleared or rewound'
      USING ERRCODE = 'restrict_violation';
  END IF;

`;

describe("migration · the cancellation's lease (TD-033 item 5)", () => {
  it("is additive, adds one nullable column, and has no transaction wrapper", () => {
    expect(SQL).toMatch(
      /ALTER TABLE "fiscal_document" ADD COLUMN "cancel_pending_since" TIMESTAMPTZ\(3\);/
    );
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bINSERT\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(SQL).not.toMatch(/^\s*CREATE TABLE\b/im);
    // The column is a lease, not a state: a default would fabricate an attempt
    // nobody made, and NOT NULL would be impossible for every existing row.
    expect(SQL).not.toMatch(/ALTER TYPE/i);
    expect(SQL).not.toMatch(
      /ADD COLUMN "cancel_pending_since" TIMESTAMPTZ\(3\)\s+(?:NOT NULL|DEFAULT)/i
    );
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

  it("admits the parked state again without requiring the lease to move", () => {
    // The same-state edge is the state's own re-entry, not an attempt: an attempt
    // is a write that moves the lease, and the API owns that policy. Requiring a
    // strictly newer lease here would reject the terminal writes too, because
    // they carry no lease at all.
    expect(normalize(SQL)).toContain(
      normalize("(OLD.\"status\" = 'CANCEL_PENDING' AND NEW.\"status\" = 'CANCEL_PENDING')")
    );
    // The check below the transition block refuses only what it can distinguish:
    // a lease that exists and is cleared, or one that moves backwards.
    expect(normalize(SQL)).toContain(normalize(LEASE_CHECK.trim()));
    // NULL -> NULL is admitted on purpose: a row parked before this column existed
    // carries no lease, and the terminal outcomes carry none either, so refusing
    // that write would roll back the audit row it is meant to persist.
    expect(SQL).toContain("NULL -> NULL");
  });

  it("admits a parked cancellation from every pre-state the cancel command allows", () => {
    // The API's gates refuse CANCELLED, SENDING and a live-lease CANCEL_PENDING;
    // every other status reaches the provider. A TRANSIENT_FAILURE from any of
    // them is "submitted, fate unknown", which is exactly what CANCEL_PENDING
    // means, so refusing the edge would abort the transaction carrying the audit
    // row and last_error_* instead of parking the document.
    const edges = guardEdges(SQL);
    for (const from of [
      "SUBMITTED",
      "APPROVED",
      "PENDING",
      "QUEUED",
      "REJECTED",
      "ERROR",
      "CANCEL_PENDING",
    ]) {
      expect(edges.has(`${from}->CANCEL_PENDING`), `${from} -> CANCEL_PENDING`).toBe(true);
    }
  });

  it("preserves every edge and non-clearing clause the earlier guards installed", () => {
    // Derived from the migration that installs the previous body: an edge or a
    // clause dropped by this one is a difference between the two sets.
    expect(guardEdges(SQL)).toEqual(
      new Set([
        ...guardEdges(PREVIOUS_GUARD),
        "CANCEL_PENDING->CANCEL_PENDING",
        // A cancel the API admits from a document the tax administration already
        // refused, or that never left the queue, reaches the provider too, and a
        // timeout on any of those parks it the same way.
        "PENDING->CANCEL_PENDING",
        "QUEUED->CANCEL_PENDING",
        "REJECTED->CANCEL_PENDING",
        "ERROR->CANCEL_PENDING",
      ])
    );
    expect(nonClearingColumns(SQL)).toEqual(nonClearingColumns(PREVIOUS_GUARD));
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

  it("does not extend the worker's sweep or any other guard", () => {
    for (const guard of OTHER_GUARDS) {
      expect(SQL, guard).not.toContain(guard);
    }
    // A parked cancellation is not a submission: the sweep walks SUBMITTED, and
    // no index or query for CANCEL_PENDING is added here. The migration's own
    // header records that decision, so a later reader does not take the silence
    // for an oversight.
    expect(SQL).not.toMatch(/CREATE INDEX/i);
    expect(SQL).not.toMatch(/next_query_at/);
    expect(SQL).toContain("sweep");
  });

  it("declares the column on the Prisma model and classifies it", () => {
    const model = /model FiscalDocument \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    expect(model).toMatch(
      /^\s*cancelPendingSince DateTime\? @map\("cancel_pending_since"\) @db\.Timestamptz\(3\)$/m
    );
    // The lease's own doc comment carries the classification, and it names the
    // window it is read against, because the constant lives in the API.
    expect(model).toMatch(/\/\/\/[^\n]*INTERNAL/);
    expect(model).toContain("FISCAL_CANCEL_PENDING_LEASE_MS");
  });
});
