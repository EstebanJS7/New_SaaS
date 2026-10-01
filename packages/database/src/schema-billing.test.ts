import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-14 BILL-001 (invoice data foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state. This mirrors
 * `schema-sales.test.ts` / `schema-cash.test.ts`, which use the same mechanism
 * and the same always-on (no live database) policy.
 *
 * The partial unique index and the immutability triggers are gated by
 * inspecting their DDL TEXT — the predicate and the guarded `RAISE` are
 * asserted as text and nothing is executed here. A live PostgreSQL owns the
 * runtime proof (BILL-001's live-PostgreSQL block). What this file must catch
 * is the regression that matters:
 *   * an UNCONDITIONAL `invoice` delete/update trigger, which would block the
 *     `DRAFT -> CONFIRMED` transition itself because Prisma writes `updated_at`;
 *   * a partial unique index that lost its `WHERE`, which would silently
 *     contradict DEC-043's "a cancelled invoice releases its sale";
 *   * a stored header total reappearing on a snapshot aggregate (DEC-038);
 *   * a `CASCADE` that would let PostgreSQL destroy a confirmed financial
 *     document implicitly.
 *
 * Scope of this file: the persistence guarantees only. The `billing.*`
 * permission seeds are gated in `reference-seed.test.ts`, and the HTTP surface
 * belongs to BILL-002/BILL-003 and is asserted where it is implemented.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const BILLING_SQL = findMigration(MIGRATIONS, "_billing_invoice_foundation").sql;

/** The three invoice tables, in migration order. */
const INVOICE_TABLES = ["invoice", "invoice_line", "invoice_number_sequence"] as const;

/** Model block from `model <name>` to the closing brace. */
function modelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);

  const block = SCHEMA.slice(start, SCHEMA.indexOf("}", start));
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `model ${model} block must not be empty`).not.toBe("");
  return block;
}

/** Contiguous `///` doc comment lines immediately above `marker` in the schema. */
function docCommentAbove(marker: string): string {
  const start = SCHEMA.indexOf(marker);
  expect(start, `${marker} must exist`).toBeGreaterThan(-1);

  const lines: string[] = [];
  for (const line of SCHEMA.slice(0, start).split("\n").reverse()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("///")) {
      lines.unshift(trimmed);
      continue;
    }
    if (trimmed === "") {
      continue;
    }
    break;
  }
  expect(lines.length, `${marker} must have a doc comment`).toBeGreaterThan(0);
  return lines.map((line) => line.replace(/^\/\/\/\s?/, "")).join("\n");
}

/** Contiguous `///` doc comment lines immediately above `model <name>`. */
function modelDocComment(model: string): string {
  return docCommentAbove(`model ${model} `);
}

/** Enum literals from `enum <name>` to the closing brace. */
function enumLiterals(name: string): string[] {
  const start = SCHEMA.indexOf(`enum ${name} `);
  expect(start, `enum ${name} must exist`).toBeGreaterThan(-1);

  const block = SCHEMA.slice(SCHEMA.indexOf("{", start) + 1, SCHEMA.indexOf("}", start));
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("///") && !line.startsWith("@@"));
}

/** Single `CREATE TABLE` block, ending at the next DDL statement. */
function tableBlock(table: string): string {
  const start = BILLING_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = BILLING_SQL.slice(start);
  const boundaries = [
    rest.indexOf("CREATE TYPE", 1),
    rest.indexOf("CREATE TABLE", 1),
    rest.indexOf("ALTER TABLE", 1),
    rest.indexOf("CREATE UNIQUE INDEX", 1),
    rest.indexOf("CREATE INDEX", 1),
    rest.indexOf("CREATE OR REPLACE FUNCTION", 1),
  ].filter((index) => index > -1);

  const block = rest.slice(0, boundaries.length > 0 ? Math.min(...boundaries) : rest.length);
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `CREATE TABLE "${table}" block must not be empty`).not.toBe("");
  return block;
}

/** Body of one `CREATE OR REPLACE FUNCTION "<name>"()` declaration. */
function functionBody(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION "${name}"()`;
  const start = BILLING_SQL.indexOf(marker);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);

  const rest = BILLING_SQL.slice(start + marker.length);
  const end = rest.indexOf("$$ LANGUAGE plpgsql;");
  expect(end, `function ${name} must close with a plpgsql language clause`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("migration · invoice foundation (EPIC-14 BILL-001)", () => {
  it("creates exactly the three tenant-scoped invoice tables and nothing else", () => {
    for (const table of INVOICE_TABLES) {
      expect(BILLING_SQL).toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
    const createdTables = [...BILLING_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    // Set equality: a fourth table is a scope change, not a detail.
    expect(new Set(createdTables)).toEqual(new Set(INVOICE_TABLES));
  });

  it("pins the invoice status enum to exactly DRAFT, CONFIRMED and CANCELLED (PRD §21, DEC-038)", () => {
    const typeValues = /CREATE TYPE "invoice_status" AS ENUM \(([^)]*)\)/.exec(BILLING_SQL)?.[1];
    // Asserted exactly: an added literal is a lifecycle change, not a detail.
    expect(typeValues).toBe("'DRAFT', 'CONFIRMED', 'CANCELLED'");
    expect(BILLING_SQL).toMatch(/"status" "invoice_status" NOT NULL DEFAULT 'DRAFT'/);
  });

  it("creates the enum with CREATE TYPE and never extends it with ALTER TYPE in the same migration", () => {
    // `invoice_status` is a NEW type, so it is created outright; the literals
    // must also stay usable by the CHECKs below in this same transaction, which
    // a freshly appended `ALTER TYPE ... ADD VALUE` value would not be.
    expect(BILLING_SQL).toMatch(
      /CREATE TYPE "invoice_status" AS ENUM \('DRAFT', 'CONFIRMED', 'CANCELLED'\);/
    );
    // Statement-anchored: the header PROSE explains why `ALTER TYPE ... ADD
    // VALUE` is not used, so only a real statement counts here.
    expect(BILLING_SQL).not.toMatch(/^\s*ALTER TYPE\b/m);
    expect(BILLING_SQL).not.toMatch(/^\s*DROP TYPE\b/m);
  });

  it("declares the DEC-038 invoice header inherited from the source sale", () => {
    const block = tableBlock("invoice");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    // The sale link is NOT NULL: an invoice with no completed sale is not a
    // representable state in this epic (DEC-038 Option A).
    expect(block).toMatch(/"sale_id" UUID NOT NULL/);
    // DEC-028/DEC-038: the customer is inherited and OPTIONAL.
    expect(block).toMatch(/"customer_id" UUID,/);
    expect(block).not.toMatch(/"customer_id" UUID NOT NULL/);
    // DEC-022/DEC-038: the currency is inherited from the sale, never read from
    // a request body.
    expect(block).toMatch(/"currency" VARCHAR\(3\) NOT NULL/);
    expect(block).toMatch(/"status" "invoice_status" NOT NULL DEFAULT 'DRAFT'/);
    // DEC-039: the series is NOT NULL with a database default of 'A'.
    expect(block).toMatch(/"series" VARCHAR\(8\) NOT NULL DEFAULT 'A'/);
    // Number, confirmation and cancellation columns (DEC-039, DEC-043).
    expect(block).toMatch(/"number" INTEGER/);
    expect(block).not.toMatch(/"number" INTEGER NOT NULL/);
    expect(block).toMatch(/"confirmed_at" TIMESTAMPTZ\(3\),/);
    expect(block).toMatch(/"cancelled_at" TIMESTAMPTZ\(3\),/);
    expect(block).toMatch(/"cancel_reason" VARCHAR\(500\),/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    // DEC-038: the total is the sum of the immutable lines; no stored header
    // total exists, which would be a second authority over the frozen snapshot.
    expect(block).not.toMatch(/"(subtotal|total|tax_total|grand_total|taxTotal)"/i);
  });

  it("declares the DEC-038 immutable line snapshot with the sale's exact decimal scales", () => {
    const block = tableBlock("invoice_line");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"invoice_id" UUID NOT NULL/);
    expect(block).toMatch(/"catalog_item_id" UUID NOT NULL/);
    expect(block).toMatch(/"position" INTEGER NOT NULL/);
    expect(block).toMatch(/"description" VARCHAR\(200\) NOT NULL/);
    // The frozen stable rate code, not a rate id (DEC-021, DEC-038).
    expect(block).toMatch(/"rate_code" VARCHAR\(20\) NOT NULL/);
    // Money on the sale reference scale, quantities on the ledger scale: the
    // snapshot invents no new precision.
    expect(block).toMatch(/"unit_price" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"quantity" DECIMAL\(10,3\) NOT NULL/);
    expect(block).toMatch(/"line_total" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"taxable_base" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"tax_amount" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    // Append-only snapshot: written once, never touched, so no updated_at.
    expect(block).not.toMatch(/"updated_at"/);

    // DEC-038: the snapshot freezes the rate code, never a rate id.
    expect(block).not.toMatch(/"(tax_rate_id|tax_id)"/i);
  });

  it("declares the per-tenant numbering counter (DEC-039)", () => {
    const block = tableBlock("invoice_number_sequence");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"series" VARCHAR\(8\) NOT NULL DEFAULT 'A'/);
    expect(block).toMatch(/"next_value" INTEGER NOT NULL DEFAULT 1/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("never uses floating point for invoice money", () => {
    expect(BILLING_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("rejects an unnumbered confirmation and a numbered draft with the exact DEC-039 predicates", () => {
    // `(("number" IS NULL) = ("confirmed_at" IS NULL))` is a BICONDITIONAL: a
    // number without a confirmation and a confirmation without a number are
    // both unrepresentable, so the allocation point and its evidence agree.
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_number_iff_confirmed" CHECK \(\("number" IS NULL\) = \("confirmed_at" IS NULL\)\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_number_positive" CHECK \("number" IS NULL OR "number" > 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_series_not_blank" CHECK \(length\(btrim\("series"\)\) > 0\)/
    );
  });

  it("keeps the three invoice states mutually consistent with their timestamps", () => {
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_draft_not_confirmed" CHECK \("status" <> 'DRAFT' OR "confirmed_at" IS NULL\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_confirmed_requires_timestamp" CHECK \("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_cancelled_at_matches_status" CHECK \(\("status" = 'CANCELLED'\) = \("cancelled_at" IS NOT NULL\)\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_cancel_reason_present" CHECK \("status" <> 'CANCELLED' OR \("cancel_reason" IS NOT NULL AND length\(btrim\("cancel_reason"\)\) > 0\)\)/
    );
  });

  it("rejects a non-positive quantity and every negative money or position value on the line", () => {
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_quantity_positive" CHECK \("quantity" > 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_unit_price_non_negative" CHECK \("unit_price" >= 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_line_total_non_negative" CHECK \("line_total" >= 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_taxable_base_non_negative" CHECK \("taxable_base" >= 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_tax_amount_non_negative" CHECK \("tax_amount" >= 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_position_non_negative" CHECK \("position" >= 0\)/
    );
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_line_description_not_blank" CHECK \(length\(btrim\("description"\)\) > 0\)/
    );
  });

  it("rejects a counter below 1, so allocation can only advance positively", () => {
    expect(BILLING_SQL).toMatch(
      /CONSTRAINT "invoice_number_sequence_next_value_positive" CHECK \("next_value" >= 1\)/
    );
  });

  it("scopes all three tables to their tenant with RESTRICT and the composite ownership keys", () => {
    for (const table of INVOICE_TABLES) {
      expect(BILLING_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
      expect(BILLING_SQL).toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "${table}_tenant_id_id_key" ON "${table}"\\("tenant_id", "id"\\)`
        )
      );
    }
    // Never CASCADE: no tenant, sale, customer or catalog item deletion may
    // destroy a confirmed financial document implicitly.
    expect(BILLING_SQL).not.toMatch(/ON DELETE CASCADE/);
  });

  it("links the invoice to its sale and its OPTIONAL customer through composite RESTRICT FKs", () => {
    // The column nullability is what makes the customer reference optional
    // (MATCH SIMPLE), so a customerless invoice of a walk-in sale is valid.
    expect(tableBlock("invoice")).toMatch(/"customer_id" UUID,/);
    expect(BILLING_SQL).toMatch(
      /ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_sale_id_fkey"\s+FOREIGN KEY \("tenant_id", "sale_id"\) REFERENCES "sale"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(BILLING_SQL).toMatch(
      /ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_customer_id_fkey"\s+FOREIGN KEY \("tenant_id", "customer_id"\) REFERENCES "customer"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("links the line to its invoice and its catalog item through composite RESTRICT FKs", () => {
    expect(BILLING_SQL).toMatch(
      /ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_invoice_id_fkey"\s+FOREIGN KEY \("tenant_id", "invoice_id"\) REFERENCES "invoice"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(BILLING_SQL).toMatch(
      /ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_catalog_item_id_fkey"\s+FOREIGN KEY \("tenant_id", "catalog_item_id"\) REFERENCES "catalog_item"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("backs the frozen rate code with a RESTRICT reference to the global tax_rate(code) column", () => {
    expect(BILLING_SQL).toMatch(
      /ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_rate_code_fkey"\s+FOREIGN KEY \("rate_code"\) REFERENCES "tax_rate"\("code"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("keeps at most one LIVE invoice per sale with the exact DEC-043 partial predicate", () => {
    // DDL-text inspection only: the index is NOT executed here, and the partial
    // predicate is asserted character by character. A dropped `WHERE` would make
    // the index unconditional and contradict DEC-043's "cancelling releases the
    // sale for a corrected replacement"; a missing `tenant_id` term would make
    // the key cross-tenant.
    const index =
      /CREATE UNIQUE INDEX "invoice_tenant_id_sale_id_key"\s+ON "invoice"\("tenant_id", "sale_id"\) WHERE "status" <> 'CANCELLED';/.exec(
        BILLING_SQL
      )?.[0];
    expect(index).toBeDefined();
    expect(index).toMatch(/WHERE "status" <> 'CANCELLED'/);
    // A CANCELLED row must fall OUTSIDE the index rather than back into it: the
    // predicate is `<> 'CANCELLED'`, never an equality that would pin cancelled
    // invoices into a single row, and it is not unconditional.
    expect(index).not.toMatch(/WHERE "status" = /);
    expect(index).not.toMatch(/IS NOT NULL/);
  });

  it("makes the (tenant, series, number) allocation key a plain unconditional unique index", () => {
    const index =
      /CREATE UNIQUE INDEX "invoice_tenant_id_series_number_key"\s+ON "invoice"\("tenant_id", "series", "number"\);/.exec(
        BILLING_SQL
      )?.[0];
    expect(index).toBeDefined();
    // DEC-039: allocation uniqueness holds for every status, so a confirmed
    // number can never be handed out twice — not even by a cancelled row.
    expect(index).not.toMatch(/WHERE/i);
  });

  it("serves the tenant invoice list on (tenant_id, status)", () => {
    expect(BILLING_SQL).toMatch(
      /CREATE INDEX "invoice_tenant_id_status_idx" ON "invoice"\("tenant_id", "status"\)/
    );
  });

  it("orders the lines deterministically with one position per invoice", () => {
    expect(BILLING_SQL).toMatch(
      /CREATE UNIQUE INDEX "invoice_line_tenant_id_invoice_id_position_key"\s+ON "invoice_line"\("tenant_id", "invoice_id", "position"\)/
    );
  });

  it("keeps one counter per (tenant, series)", () => {
    expect(BILLING_SQL).toMatch(
      /CREATE UNIQUE INDEX "invoice_number_sequence_tenant_id_series_key"\s+ON "invoice_number_sequence"\("tenant_id", "series"\)/
    );
  });

  it("makes the invoice delete CONDITIONAL on status, so a DRAFT can still be discarded", () => {
    // DDL-text inspection only, exactly like the sibling gates. The predicate is
    // asserted as text and the trigger is NOT executed here.
    //
    // The delete guard is deliberately CONDITIONAL, not the unconditional
    // `restrict_violation` shape the cash ledger uses, so a `DRAFT` may still be
    // discarded before it becomes a document. The UPDATE guard has its own
    // sibling test, because its predicate is a transition allow-list.
    for (const [name, operation, returned] of [
      ["invoice_no_delete_when_not_draft", "DELETE", "OLD"],
    ] as const) {
      const body = functionBody(name);

      expect(body).toMatch(/IF OLD\."status" <> 'DRAFT' THEN/);
      // The raise sits INSIDE the guard: everything before the raise carries the
      // predicate, so there is no blanket ban.
      const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
      expect(beforeRaise).toMatch(/OLD\."status" <> 'DRAFT'/);
      // The unconditional sibling shape — a raise straight after BEGIN, with no
      // predicate in front of it — is absent.
      expect(body).not.toMatch(/BEGIN\s+RAISE EXCEPTION/);
      expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
      expect(body).toMatch(new RegExp(`RETURN ${returned};`));

      expect(BILLING_SQL).toMatch(
        new RegExp(
          `CREATE TRIGGER "${name}_trigger"\\s+BEFORE ${operation} ON "invoice"\\s+FOR EACH ROW EXECUTE FUNCTION "${name}"\\(\\)`
        )
      );
    }
  });

  it("permits only the three legitimate header transitions and rejects every other update", () => {
    // The update guard is CONDITIONAL, and for the same concrete reason the
    // delete guard is: Prisma writes `updated_at` and confirmation and
    // cancellation update an existing row, so an unconditional `BEFORE UPDATE`
    // trigger would block the very transitions it exists to protect. It is
    // still not a hole: only `DRAFT -> CONFIRMED`, `DRAFT -> CANCELLED` and
    // `CONFIRMED -> CANCELLED` pass.
    const body = functionBody("invoice_no_update_unless_permitted_transition");

    // A cancelled invoice is terminal, and a draft is immutable from creation:
    // each has its own explicit rejection ahead of the three-clause predicate.
    expect(body).toMatch(/IF OLD\."status" = 'CANCELLED' THEN/);
    expect(body).toMatch(/IF OLD\."status" = 'DRAFT' AND NEW\."status" = 'DRAFT' THEN/);
    // The exhaustive allow-list: three transitions in exactly two clauses, and
    // every raise sits inside the `NOT (...)` rejection.
    expect(body).toMatch(
      /\(OLD\."status" = 'DRAFT' AND NEW\."status" IN \('CONFIRMED', 'CANCELLED'\)\)/
    );
    expect(body).toMatch(/OR \(OLD\."status" = 'CONFIRMED' AND NEW\."status" = 'CANCELLED'\)/);
    expect(body).toMatch(/IF NOT \(/);
    expect(body).not.toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/RETURN NEW;/);

    expect(BILLING_SQL).toMatch(
      /CREATE TRIGGER "invoice_no_update_unless_permitted_transition_trigger"\s+BEFORE UPDATE ON "invoice"\s+FOR EACH ROW EXECUTE FUNCTION "invoice_no_update_unless_permitted_transition"\(\)/
    );
  });

  it("never reallocates an allocated number", () => {
    // DEC-043: a confirmed invoice keeps its number even after cancellation, so
    // an in-place number change is rejected at the database.
    const body = functionBody("invoice_number_never_reallocated");

    expect(body).toMatch(
      /OLD\."number" IS NOT NULL AND NEW\."number" IS DISTINCT FROM OLD\."number"/
    );
    const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
    expect(beforeRaise).toMatch(/NEW\."number" IS DISTINCT FROM OLD\."number"/);
    expect(body).not.toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/RETURN NEW;/);

    expect(BILLING_SQL).toMatch(
      /CREATE TRIGGER "invoice_number_never_reallocated_trigger"\s+BEFORE UPDATE ON "invoice"\s+FOR EACH ROW EXECUTE FUNCTION "invoice_number_never_reallocated"\(\)/
    );
  });

  it("makes the invoice line snapshot append-only: unconditional UPDATE and DELETE rejection", () => {
    // There is no draft state for a line and no legitimate edit path, so the
    // shape is the unconditional `restrict_violation` the cash ledger uses —
    // NOT the status-conditional shape of the invoice header.
    const updateBody = functionBody("invoice_line_no_update");
    expect(updateBody).toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(updateBody).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(updateBody).toMatch(/an immutable invoice line snapshot cannot be updated/);

    const deleteBody = functionBody("invoice_line_no_delete");
    expect(deleteBody).toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(deleteBody).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(deleteBody).toMatch(/an immutable invoice line snapshot cannot be deleted/);

    expect(BILLING_SQL).toMatch(
      /CREATE TRIGGER "invoice_line_no_update_trigger"\s+BEFORE UPDATE ON "invoice_line"\s+FOR EACH ROW EXECUTE FUNCTION "invoice_line_no_update"\(\)/
    );
    expect(BILLING_SQL).toMatch(
      /CREATE TRIGGER "invoice_line_no_delete_trigger"\s+BEFORE DELETE ON "invoice_line"\s+FOR EACH ROW EXECUTE FUNCTION "invoice_line_no_delete"\(\)/
    );
  });

  it("declares exactly these five immutability triggers and no counter trigger", () => {
    const triggers = [...BILLING_SQL.matchAll(/CREATE TRIGGER "([a-z_]+)"/g)].map(
      ([, trigger]) => trigger
    );
    expect(new Set(triggers)).toEqual(
      new Set([
        "invoice_no_delete_when_not_draft_trigger",
        "invoice_no_update_unless_permitted_transition_trigger",
        "invoice_number_never_reallocated_trigger",
        "invoice_line_no_update_trigger",
        "invoice_line_no_delete_trigger",
      ])
    );
    // `invoice_number_sequence` is MEANT to be updated, so it carries no trigger
    // at all: a counter that could not advance could not allocate.
    expect(BILLING_SQL).not.toMatch(
      /CREATE TRIGGER "[^"]+"\s+BEFORE (DELETE|UPDATE|INSERT) ON "invoice_number_sequence"/
    );
  });

  it("is additive: no existing table is altered, no row is written, nothing is dropped", () => {
    const alteredTables = [...BILLING_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    // The only ALTER targets the three new tables; existing tables are untouched.
    expect(new Set(alteredTables)).toEqual(new Set(INVOICE_TABLES));

    expect(BILLING_SQL).not.toMatch(/\bINSERT\b/i);
    expect(BILLING_SQL).not.toMatch(/\bDROP\b/i);
    expect(BILLING_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(BILLING_SQL).not.toMatch(/\bTRUNCATE\b/i);
    // No data mutation: the only UPDATE tokens are the FK `ON UPDATE RESTRICT`
    // clauses and the `BEFORE UPDATE` trigger declarations, never `UPDATE ... SET`.
    expect(BILLING_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    // No row is seeded: a numbering counter row, an invoice and its lines are
    // user data, not seed data.
    expect(BILLING_SQL).not.toMatch(/\bINSERT\s+INTO\b/i);
    // Prisma wraps each migration in ONE transaction already; an explicit
    // BEGIN/COMMIT would nest or split it.
    expect(BILLING_SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("classifies the invoice fields in the applied artifact", () => {
    expect(BILLING_SQL).toMatch(/CONFIDENTIAL/);
    expect(BILLING_SQL).toMatch(/INTERNAL \(PRD §41\)/);
    expect(BILLING_SQL).toMatch(/logs and audit carry ids and field names only/);
    // DEC-042: the aggregate is fiscal-free, and the migration says so.
    expect(BILLING_SQL).toMatch(/DEC-042/);
  });
});

describe("schema · invoice foundation (EPIC-14 BILL-001)", () => {
  it("declares the three models, the enum and their table mappings", () => {
    expect(SCHEMA).toMatch(/model Invoice\b/);
    expect(SCHEMA).toMatch(/model InvoiceLine\b/);
    expect(SCHEMA).toMatch(/model InvoiceNumberSequence\b/);
    expect(SCHEMA).toMatch(/enum InvoiceStatus\b/);
    expect(SCHEMA).toMatch(/@@map\("invoice"\)/);
    expect(SCHEMA).toMatch(/@@map\("invoice_line"\)/);
    expect(SCHEMA).toMatch(/@@map\("invoice_number_sequence"\)/);
    expect(SCHEMA).toMatch(/@@map\("invoice_status"\)/);
  });

  it("pins the enum to the three PRD §21 literals and documents additive evolution", () => {
    expect(enumLiterals("InvoiceStatus")).toEqual(["DRAFT", "CONFIRMED", "CANCELLED"]);

    const doc = docCommentAbove("enum InvoiceStatus ");
    expect(doc).toMatch(/PRD §21, DEC-038/);
    // The standard additive sentence must close the doc comment verbatim.
    expect(doc).toMatch(
      /Values are appended, never reordered or removed\. Evolve additively only\.$/
    );
  });

  it("maps the DEC-038 header fields and defaults status to DRAFT", () => {
    const invoice = modelBlock("Invoice");

    expect(invoice).toMatch(
      /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/
    );
    expect(invoice).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    // DEC-038: the sale link is required...
    expect(invoice).toMatch(/saleId\s+String\s+@map\("sale_id"\)\s+@db\.Uuid/);
    // ...and the inherited customer is optional (DEC-028, DEC-038).
    expect(invoice).toMatch(/customerId\s+String\?\s+@map\("customer_id"\)\s+@db\.Uuid/);
    expect(invoice).toMatch(/currency\s+String\s+@db\.VarChar\(3\)/);
    expect(invoice).toMatch(/status\s+InvoiceStatus\s+@default\(DRAFT\)/);
    expect(invoice).toMatch(/series\s+String\s+@default\("A"\)\s+@db\.VarChar\(8\)/);
    expect(invoice).toMatch(/number\s+Int\?/);
    expect(invoice).not.toMatch(/number\s+Int\s/);
    expect(invoice).toMatch(
      /confirmedAt\s+DateTime\?\s+@map\("confirmed_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(invoice).toMatch(
      /cancelledAt\s+DateTime\?\s+@map\("cancelled_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(invoice).toMatch(
      /cancelReason\s+String\?\s+@map\("cancel_reason"\)\s+@db\.VarChar\(500\)/
    );
    expect(invoice).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(invoice).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)\s+@db\.Timestamptz\(3\)/
    );

    // DEC-038: no stored header total. Asserted on field declarations, so
    // doc-comment prose that mentions "total" is not mistaken for a column.
    expect(invoice).not.toMatch(
      /^\s*(subtotal|total|taxTotal|grandTotal|tax_total|grand_total)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
    expect(invoice).not.toMatch(/\bFloat\b/);
  });

  it("maps the DEC-038 line snapshot with the exact decimal scales and no updatedAt", () => {
    const line = modelBlock("InvoiceLine");

    expect(line).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/invoiceId\s+String\s+@map\("invoice_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/catalogItemId\s+String\s+@map\("catalog_item_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/position\s+Int\b/);
    expect(line).toMatch(/description\s+String\s+@db\.VarChar\(200\)/);
    expect(line).toMatch(/rateCode\s+String\s+@map\("rate_code"\)\s+@db\.VarChar\(20\)/);
    expect(line).toMatch(/unitPrice\s+Decimal\s+@map\("unit_price"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(/quantity\s+Decimal\s+@db\.Decimal\(10, 3\)/);
    expect(line).toMatch(/lineTotal\s+Decimal\s+@map\("line_total"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(/taxableBase\s+Decimal\s+@map\("taxable_base"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(/taxAmount\s+Decimal\s+@map\("tax_amount"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    // An immutable snapshot is written once: no `updatedAt` field exists.
    expect(line).not.toMatch(/^\s*updatedAt\s+DateTime/m);
    // The frozen snapshot carries no tax-rate id and no derived header total.
    expect(line).not.toMatch(
      /^\s*(taxRateId|taxId|total|subtotal)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
    expect(line).not.toMatch(/\bFloat\b/);
  });

  it("maps the counter fields without inventing a Prisma-side sequence", () => {
    const sequence = modelBlock("InvoiceNumberSequence");

    expect(sequence).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(sequence).toMatch(/series\s+String\s+@default\("A"\)\s+@db\.VarChar\(8\)/);
    expect(sequence).toMatch(/nextValue\s+Int\s+@default\(1\)\s+@map\("next_value"\)/);
    expect(sequence).toMatch(/@@unique\(\[tenantId, series\]\)/);
    expect(sequence).not.toMatch(/\bFloat\b/);
  });

  it("exposes the composite tenant-ownership keys and relations on all three models", () => {
    const invoice = modelBlock("Invoice");
    expect(invoice).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(invoice).toMatch(
      /sale\s+Sale\s+@relation\(fields: \[tenantId, saleId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The customer reference is COMPOSITE and OPTIONAL, so a foreign-tenant
    // customer is not a representable state while a missing customer is.
    expect(invoice).toMatch(
      /customer\s+Customer\?\s+@relation\(fields: \[tenantId, customerId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(invoice).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(invoice).toMatch(/@@unique\(\[tenantId, series, number\]\)/);
    expect(invoice).toMatch(/@@index\(\[tenantId, status\]\)/);

    const line = modelBlock("InvoiceLine");
    expect(line).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(
      /invoice\s+Invoice\s+@relation\(fields: \[tenantId, invoiceId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(
      /catalogItem\s+CatalogItem\s+@relation\(fields: \[tenantId, catalogItemId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The frozen rate code references the GLOBAL unique `code`, RESTRICT only.
    expect(line).toMatch(
      /taxRate\s+TaxRate\s+@relation\(fields: \[rateCode\], references: \[code\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(line).toMatch(/@@unique\(\[tenantId, invoiceId, position\]\)/);

    const sequence = modelBlock("InvoiceNumberSequence");
    expect(sequence).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(sequence).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });

  it("does NOT model the live-invoice rule as a Prisma unique, because it is partial", () => {
    // DEC-043: cancelling an invoice releases its sale, so a `(tenantId, saleId)`
    // unique on the model would be false. The partial index lives in the
    // migration and the sale side is a LIST relation for the same reason.
    const invoice = modelBlock("Invoice");
    expect(invoice).not.toMatch(/@@unique\(\[tenantId, saleId\]\)/);
    expect(invoice).not.toMatch(/sale\s+Sale\?\s+@relation/);

    const sale = modelBlock("Sale");
    expect(sale).toMatch(/invoices\s+Invoice\[\]/);
    // The relation's own doc comment states where the partial rule lives and
    // why the sale side is a list.
    expect(sale).toMatch(/invoice_tenant_id_sale_id_key/);
    expect(sale).toMatch(/WHERE "status" <> 'CANCELLED'/);
    expect(sale).toMatch(/Prisma\s+cannot express as `@@unique\(\[tenantId, saleId\]\)`/);
  });

  it("references only composite keys the referenced tables actually declare", () => {
    // PostgreSQL accepts a composite FK only when the target columns carry a
    // unique index; this asserts the prerequisite the story tells us to verify.
    for (const model of ["Sale", "Customer", "CatalogItem"]) {
      expect(modelBlock(model)).toMatch(/@@unique\(\[tenantId, id\]\)/);
    }
    // `tax_rate(code)` is `@unique`, so the RESTRICT rate-code reference is
    // accepted by PostgreSQL.
    expect(modelBlock("TaxRate")).toMatch(/code\s+String\s+@unique/);
    // The invoice's own ownership key is what `invoice_line` targets.
    expect(modelBlock("Invoice")).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });

  it("exposes the Tenant, Sale, Customer, CatalogItem and TaxRate sides of the relations", () => {
    const tenant = modelBlock("Tenant");
    expect(tenant).toMatch(/invoices\s+Invoice\[\]/);
    expect(tenant).toMatch(/invoiceLines\s+InvoiceLine\[\]/);
    expect(tenant).toMatch(/invoiceNumberSequences\s+InvoiceNumberSequence\[\]/);

    expect(modelBlock("Sale")).toMatch(/invoices\s+Invoice\[\]/);
    expect(modelBlock("Customer")).toMatch(/invoices\s+Invoice\[\]/);
    expect(modelBlock("CatalogItem")).toMatch(/invoiceLines\s+InvoiceLine\[\]/);
    expect(modelBlock("TaxRate")).toMatch(/invoiceLines\s+InvoiceLine\[\]/);
  });

  it("documents the DEC-038 absences: no stored header totals and no editable draft", () => {
    const doc = modelDocComment("Invoice");
    expect(doc).toMatch(/NO stored header totals exist/);
    expect(doc).toMatch(/invoice total is the sum of its immutable lines/);
    expect(doc).toMatch(
      /projection of\s+the frozen snapshot, not the pricing arithmetic DEC-038 forbids/
    );
    expect(doc).toMatch(/IMMUTABLE from creation at every status \(DEC-038\)/);
    expect(doc).toMatch(/Prisma\s+cannot express a partial index/);

    // DEC-042 is a property of the WHOLE aggregate, so it is stated once in the
    // section banner that names the epic and the binding decisions.
    expect(SCHEMA).toMatch(/EPIC-14 BILL-001 invoice data foundation, DEC-038, DEC-039,/);
    expect(SCHEMA).toMatch(/The aggregate is FISCAL-FREE \(DEC-042\)/);

    const lineDoc = modelDocComment("InvoiceLine");
    expect(lineDoc).toMatch(/APPEND-ONLY snapshot with `createdAt` ONLY and no `updatedAt`/);
    expect(lineDoc).toMatch(/rejects every UPDATE and every DELETE/);
  });

  it("states the fiscal-free boundary and the additive migration in the section banner", () => {
    // DEC-042: no fiscal status, document, provider or queue column exists here.
    expect(SCHEMA).toMatch(/FISCAL-FREE \(DEC-042\)/);
    expect(SCHEMA).toMatch(/no fiscal status, fiscal document,/);
    expect(SCHEMA).toMatch(/provider, queue or submission column exists/);
    // DEC-040: the fiscal permission stays reserved for EPIC-15.
    expect(SCHEMA).toMatch(/`fiscal\.invoice\.issue` stays reserved/);
    // The migration below this banner is strictly additive.
    expect(SCHEMA).toMatch(/strictly additive: it creates three tables and one enum,/);
    // Data classification closes the banner.
    expect(SCHEMA).toMatch(/never a payload\.\n\/\/ -{10,}/);
  });

  it("classifies the invoice and line fields in both model doc comments", () => {
    const invoiceDoc = modelDocComment("Invoice");
    expect(invoiceDoc).toMatch(/customer and sale references are CONFIDENTIAL/);
    expect(invoiceDoc).toMatch(/money amounts, status, series and number are INTERNAL \(PRD §41\)/);
    expect(invoiceDoc).toMatch(/logs and\s+audit carry ids and\s+field\s+names\s+only/);

    const lineDoc = modelDocComment("InvoiceLine");
    expect(lineDoc).toMatch(/CONFIDENTIAL/);
    expect(lineDoc).toMatch(/INTERNAL \(PRD §41\)/);
    expect(lineDoc).toMatch(/logs and audit carry ids and field names\s+only/);
  });
});
