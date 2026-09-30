import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-12 POS-002 (cash foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state. This mirrors
 * `schema-sales.test.ts` / `schema-suppliers.test.ts`, which use the same
 * mechanism and the same always-on (no live database) policy.
 *
 * The partial unique index and the triggers are gated by inspecting their DDL
 * TEXT — the predicate, the guarded `RAISE` and the `BEFORE UPDATE` body are
 * asserted as text, and nothing is executed here. A live PostgreSQL owns the
 * runtime proof (POS-002's live-PostgreSQL block). What this file must catch is
 * the regression that matters: a dropped or weakened one-OPEN-session index, an
 * enum that quietly grew a reserved EPIC-13 kind, a `CASCADE` that would let
 * PostgreSQL destroy a confirmed cash record implicitly, and a mutable
 * `cash_movement`.
 *
 * Scope of this file: the persistence guarantees only. The `cash.*` permission
 * seeds are gated in `reference-seed.test.ts`, and the HTTP surface (the C2
 * slice) is asserted where it is implemented.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const CASH_SQL = findMigration(MIGRATIONS, "_cash_foundation").sql;
const CASH_EXTENSION_SQL = findMigration(MIGRATIONS, "_cash_data_foundation").sql;
const CASH_COMMANDS_SQL = findMigration(MIGRATIONS, "_cash_movement_commands").sql;

/** The three EPIC-12 cash tables, in migration order. */
const CASH_TABLES = ["cash_register", "cash_session", "cash_movement"] as const;

/** PRD §20 kinds reserved for EPIC-13 (DEC-020). */
const RESERVED_MOVEMENT_KINDS = [
  "REFUND",
  "INCOME",
  "EXPENSE",
  "WITHDRAWAL",
  "DEPOSIT",
  "ADJUSTMENT",
] as const;

/** Model block from `model <name>` to the closing brace. */
function modelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);

  const block = SCHEMA.slice(start, SCHEMA.indexOf("}", start));
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `model ${model} block must not be empty`).not.toBe("");
  return block;
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

/** Single `CREATE TABLE` block, ending at the next DDL statement. */
function tableBlock(table: string): string {
  const start = CASH_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = CASH_SQL.slice(start);
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
function functionBodyFrom(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION "${name}"()`;
  const start = sql.indexOf(marker);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);

  const rest = sql.slice(start + marker.length);
  const end = rest.indexOf("$$ LANGUAGE plpgsql;");
  expect(end, `function ${name} must close with a plpgsql language clause`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

function functionBody(name: string): string {
  return functionBodyFrom(CASH_SQL, name);
}

describe("migration · cash foundation (EPIC-12 POS-002)", () => {
  it("creates only the three tenant-scoped cash tables", () => {
    for (const table of CASH_TABLES) {
      expect(CASH_SQL).toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
    const createdTables = [...CASH_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(new Set(createdTables)).toEqual(new Set(CASH_TABLES));
  });

  it("pins the movement enum to exactly SALE and never seeds a reserved kind (DEC-020)", () => {
    const typeValues = /CREATE TYPE "cash_movement_type" AS ENUM \(([^)]*)\)/.exec(CASH_SQL)?.[1];
    // Asserted exactly: a second literal here is a scope change (EPIC-13's).
    expect(typeValues).toBe("'SALE'");
    for (const kind of RESERVED_MOVEMENT_KINDS) {
      expect(typeValues).not.toContain(kind);
    }
    expect(CASH_SQL).toMatch(/"type" "cash_movement_type" NOT NULL/);
  });

  it("pins the session status enum to exactly OPEN and CLOSED", () => {
    const typeValues = /CREATE TYPE "cash_session_status" AS ENUM \(([^)]*)\)/.exec(CASH_SQL)?.[1];
    expect(typeValues).toBe("'OPEN', 'CLOSED'");
    expect(CASH_SQL).toMatch(/"status" "cash_session_status" NOT NULL DEFAULT 'OPEN'/);
  });

  it("declares the register columns with a bounded non-empty name and no branch scope", () => {
    const block = tableBlock("cash_register");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"name" VARCHAR\(200\) NOT NULL/);
    expect(block).toMatch(/"is_active" BOOLEAN NOT NULL DEFAULT true/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(
      /CONSTRAINT "cash_register_name_length" CHECK \(char_length\("name"\) BETWEEN 1 AND 200\)/
    );

    // DEC-020: cash is tenant-wide; no location dimension exists.
    expect(block).not.toMatch(/branch/i);
  });

  it("declares the session columns, the required opening float and its non-negative CHECK", () => {
    const block = tableBlock("cash_session");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"register_id" UUID NOT NULL/);
    expect(block).toMatch(/"opened_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"opened_by_membership_id" UUID NOT NULL/);
    // The required opening float: not nullable, money at Decimal(14, 2).
    expect(block).toMatch(/"opening_amount" DECIMAL\(14,2\) NOT NULL/);
    expect(block).not.toMatch(/"opening_amount" DECIMAL\(14,2\),/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    // `0.00` is allowed, a negative float is not.
    expect(block).toMatch(
      /CONSTRAINT "cash_session_opening_amount_non_negative" CHECK \("opening_amount" >= 0\)/
    );
    expect(block).not.toMatch(/branch/i);
  });

  it("declares the immutable movement columns with an exact non-zero amount", () => {
    const block = tableBlock("cash_movement");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"register_id" UUID NOT NULL/);
    expect(block).toMatch(/"session_id" UUID NOT NULL/);
    expect(block).toMatch(/"amount" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"reason" VARCHAR\(500\)/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    // Append-only by design: a movement is written once and never touched.
    expect(block).not.toMatch(/"updated_at"/);
    expect(block).toMatch(/CONSTRAINT "cash_movement_amount_non_zero" CHECK \("amount" <> 0\)/);
    expect(block).not.toMatch(/branch/i);
  });

  it("never uses floating point for cash money", () => {
    expect(CASH_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("scopes all three tables to their tenant with RESTRICT and the composite ownership keys", () => {
    for (const table of CASH_TABLES) {
      expect(CASH_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
      expect(CASH_SQL).toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "${table}_tenant_id_id_key" ON "${table}"\\("tenant_id", "id"\\)`
        )
      );
    }
    // Never CASCADE: no tenant, register, session or membership deletion may
    // destroy a confirmed cash record implicitly.
    expect(CASH_SQL).not.toMatch(/ON DELETE CASCADE/);
  });

  it("links the session to its register and its opener through composite RESTRICT FKs", () => {
    expect(CASH_SQL).toMatch(
      /ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_register_id_fkey"\s+FOREIGN KEY \("tenant_id", "register_id"\) REFERENCES "cash_register"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    // The opener is a membership OF THE SAME TENANT, not a global profile.
    expect(CASH_SQL).toMatch(
      /ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_opened_by_membership_id_fkey"\s+FOREIGN KEY \("tenant_id", "opened_by_membership_id"\) REFERENCES "tenant_membership"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("links the movement to its register and its session through composite RESTRICT FKs", () => {
    expect(CASH_SQL).toMatch(
      /ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_register_id_fkey"\s+FOREIGN KEY \("tenant_id", "register_id"\) REFERENCES "cash_register"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(CASH_SQL).toMatch(
      /ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_session_id_fkey"\s+FOREIGN KEY \("tenant_id", "session_id"\) REFERENCES "cash_session"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("enforces at most one OPEN session per register with the exact partial unique predicate", () => {
    // DDL-text inspection only: the index is NOT executed here, and the partial
    // predicate is asserted character by character. A dropped `WHERE`, a missing
    // `tenant_id` term or a rename would all fail these assertions, and without
    // them PRD §20's rule degrades to an application convention a second writer
    // could forget.
    const index =
      /CREATE UNIQUE INDEX "cash_session_one_open_per_register_key" ON "cash_session"\("tenant_id", "register_id"\) WHERE "status" = 'OPEN';/.exec(
        CASH_SQL
      )?.[0];
    expect(index).toBeDefined();
    expect(index).toMatch(/WHERE "status" = 'OPEN'/);
    // The predicate must exclude CLOSED sessions rather than pin them into a
    // single row: equality on OPEN, never `<>`-style or unconditional uniqueness.
    expect(index).not.toMatch(/IS NOT NULL/);
  });

  it("keeps one register name per tenant", () => {
    expect(CASH_SQL).toMatch(
      /CREATE UNIQUE INDEX "cash_register_tenant_id_name_key" ON "cash_register"\("tenant_id", "name"\)/
    );
  });

  it("serves the tenant session list on (tenant_id, status)", () => {
    expect(CASH_SQL).toMatch(
      /CREATE INDEX "cash_session_tenant_id_status_idx" ON "cash_session"\("tenant_id", "status"\)/
    );
  });

  it("rejects any DELETE of a session or a confirmed movement, unconditionally", () => {
    // There is no draft state in cash, so the trigger shape is the unconditional
    // `restrict_violation` the catalog/supplier/inventory tables use — NOT the
    // status-conditional shape of the sale and purchase aggregates.
    const sessionBody = functionBody("cash_session_no_delete");
    expect(sessionBody).toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(sessionBody).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(sessionBody).toMatch(/a cash session cannot be hard-deleted/);

    const movementBody = functionBody("cash_movement_no_delete");
    expect(movementBody).toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(movementBody).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(movementBody).toMatch(/a confirmed cash movement cannot be deleted/);

    expect(CASH_SQL).toMatch(
      /CREATE TRIGGER "cash_session_no_delete_trigger"\s+BEFORE DELETE ON "cash_session"\s+FOR EACH ROW EXECUTE FUNCTION "cash_session_no_delete"\(\)/
    );
    expect(CASH_SQL).toMatch(
      /CREATE TRIGGER "cash_movement_no_delete_trigger"\s+BEFORE DELETE ON "cash_movement"\s+FOR EACH ROW EXECUTE FUNCTION "cash_movement_no_delete"\(\)/
    );
  });

  it("rejects any UPDATE of a confirmed movement, so it is immutable and not merely undeletable", () => {
    const body = functionBody("cash_movement_no_update");
    expect(body).toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/a confirmed cash movement is immutable/);

    expect(CASH_SQL).toMatch(
      /CREATE TRIGGER "cash_movement_no_update_trigger"\s+BEFORE UPDATE ON "cash_movement"\s+FOR EACH ROW EXECUTE FUNCTION "cash_movement_no_update"\(\)/
    );
  });

  it("declares exactly the three immutability triggers", () => {
    const triggers = [...CASH_SQL.matchAll(/CREATE TRIGGER "([a-z_]+)"/g)].map(
      ([, trigger]) => trigger
    );
    expect(new Set(triggers)).toEqual(
      new Set([
        "cash_session_no_delete_trigger",
        "cash_movement_no_delete_trigger",
        "cash_movement_no_update_trigger",
      ])
    );
  });

  it("is additive: no existing table is altered, no row is inserted, nothing is dropped", () => {
    const alteredTables = [...CASH_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    // The only ALTER targets the three new tables; existing tables are untouched.
    expect(new Set(alteredTables)).toEqual(new Set(CASH_TABLES));

    expect(CASH_SQL).not.toMatch(/\bINSERT\b/i);
    expect(CASH_SQL).not.toMatch(/\bDROP\b/i);
    expect(CASH_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(CASH_SQL).not.toMatch(/\bTRUNCATE\b/i);
    // No data mutation: the only UPDATE tokens are the FK `ON UPDATE RESTRICT`
    // clauses and the `BEFORE UPDATE` trigger declaration, never `UPDATE ... SET`.
    expect(CASH_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
  });

  it("classifies the cash fields in the applied artifact", () => {
    expect(CASH_SQL).toMatch(/INTERNAL \(PRD §41\)/);
    expect(CASH_SQL).toMatch(/logs and audit carry ids and/);
    expect(CASH_SQL).toMatch(/field names only/);
  });
});

describe("migration · cash data foundation extension (EPIC-13 CASH-001)", () => {
  it("appends the six remaining movement enum values without rewriting the enum", () => {
    const values = [
      ...CASH_EXTENSION_SQL.matchAll(/ALTER TYPE "cash_movement_type" ADD VALUE '([A-Z_]+)'/g),
    ].map(([, value]) => value);
    expect(values).toEqual(["REFUND", "INCOME", "EXPENSE", "WITHDRAWAL", "DEPOSIT", "ADJUSTMENT"]);
    expect(CASH_EXTENSION_SQL).not.toMatch(/CREATE TYPE "cash_movement_type"/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/DROP TYPE/);
  });

  it("adds nullable close-result money columns to cash_session", () => {
    expect(CASH_EXTENSION_SQL).toMatch(/ADD COLUMN "expected_amount" DECIMAL\(14,2\)/);
    expect(CASH_EXTENSION_SQL).toMatch(/ADD COLUMN "counted_amount" DECIMAL\(14,2\)/);
    expect(CASH_EXTENSION_SQL).toMatch(/ADD COLUMN "difference_amount" DECIMAL\(14,2\)/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/"expected_amount" DECIMAL\(14,2\) NOT NULL/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/"counted_amount" DECIMAL\(14,2\) NOT NULL/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/"difference_amount" DECIMAL\(14,2\) NOT NULL/);
  });

  it("requires a reason for manual/corrective kinds without unsafe enum-literal use", () => {
    expect(CASH_EXTENSION_SQL).toMatch(
      /CONSTRAINT "cash_movement_reason_required"\s+CHECK \("type"::text IN \('SALE', 'INCOME'\) OR \("reason" IS NOT NULL AND btrim\("reason"\) <> ''\)\)/
    );
    expect(CASH_EXTENSION_SQL).not.toMatch(/"type"\s*=\s*'INCOME'/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/'INCOME'::cash_movement_type/);
  });

  it("rejects inserting a movement into a CLOSED session", () => {
    const body = functionBodyFrom(
      CASH_EXTENSION_SQL,
      "cash_movement_no_insert_into_closed_session"
    );
    expect(body).toMatch(/SELECT "status"\s+INTO session_status/);
    expect(body).toMatch(/WHERE "id" = NEW\."session_id"\s+FOR UPDATE/);
    expect(body).toMatch(/IF session_status = 'CLOSED' THEN/);
    expect(body).toMatch(/a cash movement cannot be inserted into a closed session/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/RETURN NEW/);
    expect(CASH_EXTENSION_SQL).toMatch(
      /CREATE TRIGGER "cash_movement_no_insert_into_closed_session_trigger"\s+BEFORE INSERT ON "cash_movement"\s+FOR EACH ROW EXECUTE FUNCTION "cash_movement_no_insert_into_closed_session"\(\)/
    );
  });

  it("is additive and does not recreate the EPIC-12 cash invariants", () => {
    expect(CASH_EXTENSION_SQL).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(CASH_EXTENSION_SQL).not.toMatch(/\bDROP\b/i);
    expect(CASH_EXTENSION_SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(CASH_EXTENSION_SQL).not.toMatch(/cash_session_one_open_per_register_key/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/cash_session_no_delete_trigger/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/cash_movement_no_delete_trigger/);
    expect(CASH_EXTENSION_SQL).not.toMatch(/cash_movement_no_update_trigger/);
  });

  it("classifies the EPIC-13 cash extension fields in the applied artifact", () => {
    expect(CASH_EXTENSION_SQL).toMatch(/INTERNAL \(PRD §41\)/);
    expect(CASH_EXTENSION_SQL).toMatch(/logs and audit carry ids and field names only/);
  });
});

describe("migration · cash movement commands (EPIC-13 CASH-002)", () => {
  it("creates the direction enum with exactly INCREASE and DECREASE", () => {
    const typeValues = /CREATE TYPE "cash_movement_direction" AS ENUM \(([^)]*)\)/.exec(
      CASH_COMMANDS_SQL
    )?.[1];
    expect(typeValues).toBe("'INCREASE', 'DECREASE'");
    expect(CASH_COMMANDS_SQL).not.toMatch(/CREATE TYPE "cash_movement_type"/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/DROP TYPE/);
  });

  it("adds the nullable direction column to cash_movement", () => {
    expect(CASH_COMMANDS_SQL).toMatch(
      /ALTER TABLE "cash_movement" ADD COLUMN "direction" "cash_movement_direction"/
    );
    // Required exactly for ADJUSTMENT and NULL for every other kind: the
    // exclusivity is the CHECK's job, so the column itself must stay nullable
    // and must never be defaulted.
    expect(CASH_COMMANDS_SQL).not.toMatch(/"direction" "cash_movement_direction" NOT NULL/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/"direction"[^\n]*DEFAULT/);
  });

  it("carries the EXCLUSIVE direction CHECK with the exact DEC-030 predicate", () => {
    // The predicate is asserted character by character: it must DEMAND a
    // direction for ADJUSTMENT and FORBID one for every other kind, so a row can
    // satisfy neither both halves nor a third state. `type` is compared as TEXT
    // because the six EPIC-13 enum values were appended in the previous
    // migration's transaction and are unsafe as enum literals in this one.
    expect(CASH_COMMANDS_SQL).toMatch(
      /CONSTRAINT "cash_movement_direction_required"\s+CHECK \(\("type"::text = 'ADJUSTMENT' AND "direction" IS NOT NULL\) OR \("type"::text <> 'ADJUSTMENT' AND "direction" IS NULL\)\)/
    );
    expect(CASH_COMMANDS_SQL).not.toMatch(/'ADJUSTMENT'::cash_movement_type/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/"type"\s*=\s*'ADJUSTMENT'/);
  });

  it("never uses floating point for the cash movement direction surface", () => {
    expect(CASH_COMMANDS_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("is additive: it alters only cash_movement and writes nothing", () => {
    const alteredTables = [...CASH_COMMANDS_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(new Set(alteredTables)).toEqual(new Set(["cash_movement"]));

    expect(CASH_COMMANDS_SQL).not.toMatch(/\bINSERT\b/i);
    expect(CASH_COMMANDS_SQL).not.toMatch(/\bDROP\b/i);
    expect(CASH_COMMANDS_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(CASH_COMMANDS_SQL).not.toMatch(/\bTRUNCATE\b/i);
    // No data mutation: the only UPDATE tokens would be trigger declarations, and
    // this slice declares none.
    expect(CASH_COMMANDS_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    // The EPIC-12 and CASH-001 guarantees are not recreated here.
    expect(CASH_COMMANDS_SQL).not.toMatch(/cash_session_one_open_per_register_key/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/cash_movement_reason_required/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/cash_movement_no_delete_trigger/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/cash_movement_no_update_trigger/);
    expect(CASH_COMMANDS_SQL).not.toMatch(/cash_movement_no_insert_into_closed_session/);
  });

  it("classifies the direction field in the applied artifact", () => {
    expect(CASH_COMMANDS_SQL).toMatch(/INTERNAL \(PRD §41\)/);
    expect(CASH_COMMANDS_SQL).toMatch(/audit carry ids and field names only/);
  });
});

describe("schema · cash foundation (EPIC-12 POS-002)", () => {
  it("declares the three models, the two enums and their table mappings", () => {
    expect(SCHEMA).toMatch(/model CashRegister\b/);
    expect(SCHEMA).toMatch(/model CashSession\b/);
    expect(SCHEMA).toMatch(/model CashMovement\b/);
    expect(SCHEMA).toMatch(/enum CashMovementType\b/);
    expect(SCHEMA).toMatch(/enum CashSessionStatus\b/);
    expect(SCHEMA).toMatch(/@@map\("cash_register"\)/);
    expect(SCHEMA).toMatch(/@@map\("cash_session"\)/);
    expect(SCHEMA).toMatch(/@@map\("cash_movement"\)/);
    expect(SCHEMA).toMatch(/@@map\("cash_movement_type"\)/);
    expect(SCHEMA).toMatch(/@@map\("cash_session_status"\)/);
  });

  it("pins the movement enum to SALE plus the six EPIC-13 kinds in appended order", () => {
    expect(enumLiterals("CashMovementType")).toEqual([
      "SALE",
      "REFUND",
      "INCOME",
      "EXPENSE",
      "WITHDRAWAL",
      "DEPOSIT",
      "ADJUSTMENT",
    ]);

    const doc = docCommentAbove("enum CashMovementType ");
    expect(doc).toMatch(/DEC-030/);
    expect(doc).toMatch(/appended, never\s+reordered or removed/);
    expect(doc).toMatch(/sign is owned by the movement kind/);
    for (const kind of RESERVED_MOVEMENT_KINDS) {
      expect(doc).toContain(kind);
    }
  });

  it("pins the session status enum to OPEN and CLOSED", () => {
    expect(enumLiterals("CashSessionStatus")).toEqual(["OPEN", "CLOSED"]);
  });

  it("maps the register fields with the bounded name and the per-tenant name unique", () => {
    const register = modelBlock("CashRegister");

    expect(register).toMatch(
      /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/
    );
    expect(register).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(register).toMatch(/name\s+String\s+@db\.VarChar\(200\)/);
    expect(register).toMatch(/isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
    expect(register).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(register).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)\s+@db\.Timestamptz\(3\)/
    );

    expect(register).toMatch(/@@unique\(\[tenantId, id\]\)/);
    // A registry cannot hold two drawers called the same thing.
    expect(register).toMatch(/@@unique\(\[tenantId, name\]\)/);
    // DEC-020: no Branch dimension anywhere in the cash aggregate.
    expect(register).not.toMatch(/\bbranchId\b/);
    expect(register).not.toMatch(/\bFloat\b/);
  });

  it("maps the session fields, the required opening float and the opener membership FK", () => {
    const session = modelBlock("CashSession");

    expect(session).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(session).toMatch(/registerId\s+String\s+@map\("register_id"\)\s+@db\.Uuid/);
    expect(session).toMatch(/status\s+CashSessionStatus\s+@default\(OPEN\)/);
    expect(session).toMatch(
      /openedAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("opened_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(session).toMatch(
      /openedByMembershipId\s+String\s+@map\("opened_by_membership_id"\)\s+@db\.Uuid/
    );
    // Required opening float on the money scale: not optional, no default.
    expect(session).toMatch(
      /openingAmount\s+Decimal\s+@map\("opening_amount"\)\s+@db\.Decimal\(14, 2\)/
    );
    expect(session).not.toMatch(/openingAmount\s+Decimal\?/);
    expect(session).not.toMatch(/openingAmount[^\n]*@default/);
    expect(session).toMatch(
      /expectedAmount\s+Decimal\?\s+@map\("expected_amount"\)\s+@db\.Decimal\(14, 2\)/
    );
    expect(session).toMatch(
      /countedAmount\s+Decimal\?\s+@map\("counted_amount"\)\s+@db\.Decimal\(14, 2\)/
    );
    expect(session).toMatch(
      /differenceAmount\s+Decimal\?\s+@map\("difference_amount"\)\s+@db\.Decimal\(14, 2\)/
    );

    expect(session).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // Both references are COMPOSITE tenant-ownership FKs, so a foreign-tenant
    // register or opener is not a representable state.
    expect(session).toMatch(
      /register\s+CashRegister\s+@relation\(fields: \[tenantId, registerId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(session).toMatch(
      /openedByMembership\s+TenantMembership\s+@relation\(fields: \[tenantId, openedByMembershipId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(session).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(session).toMatch(/@@index\(\[tenantId, status\]\)/);
    expect(session).not.toMatch(/\bbranchId\b/);
    expect(session).not.toMatch(/\bFloat\b/);
  });

  it("maps the movement fields with exact money and no branch scope", () => {
    const movement = modelBlock("CashMovement");

    expect(movement).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(movement).toMatch(/registerId\s+String\s+@map\("register_id"\)\s+@db\.Uuid/);
    expect(movement).toMatch(/sessionId\s+String\s+@map\("session_id"\)\s+@db\.Uuid/);
    expect(movement).toMatch(/type\s+CashMovementType\b/);
    expect(movement).toMatch(/amount\s+Decimal\s+@map\("amount"\)\s+@db\.Decimal\(14, 2\)/);
    expect(movement).toMatch(/reason\s+String\?\s+@db\.VarChar\(500\)/);
    expect(movement).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    // Append-only: a movement is written once, so it has no `updatedAt` field.
    expect(movement).not.toMatch(/^\s*updatedAt\s+DateTime/m);

    expect(movement).toMatch(
      /register\s+CashRegister\s+@relation\(fields: \[tenantId, registerId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(movement).toMatch(
      /session\s+CashSession\s+@relation\(fields: \[tenantId, sessionId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(movement).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(movement).not.toMatch(/\bbranchId\b/);
    expect(movement).not.toMatch(/\bFloat\b/);
  });

  it("references only composite keys the referenced tables actually declare", () => {
    // PostgreSQL accepts a composite FK only when the target columns carry a
    // unique index; this asserts the prerequisite the story tells us to verify.
    expect(modelBlock("CashRegister")).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(modelBlock("CashSession")).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(modelBlock("TenantMembership")).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });

  it("exposes the Tenant, TenantMembership and CashRegister sides of the cash relations", () => {
    const tenant = modelBlock("Tenant");
    expect(tenant).toMatch(/cashRegisters\s+CashRegister\[\]/);
    expect(tenant).toMatch(/cashSessions\s+CashSession\[\]/);
    expect(tenant).toMatch(/cashMovements\s+CashMovement\[\]/);

    expect(modelBlock("TenantMembership")).toMatch(/openedCashSessions\s+CashSession\[\]/);

    const register = modelBlock("CashRegister");
    expect(register).toMatch(/sessions\s+CashSession\[\]/);
    expect(register).toMatch(/movements\s+CashMovement\[\]/);
    expect(modelBlock("CashSession")).toMatch(/movements\s+CashMovement\[\]/);
  });

  it("documents that the one-OPEN-session rule lives in the migration, not in Prisma", () => {
    const sessionDoc = modelDocComment("CashSession");
    expect(sessionDoc).toMatch(/cash_session_one_open_per_register_key/);
    expect(sessionDoc).toMatch(/WHERE\s+status = 'OPEN'/);
    expect(sessionDoc).toMatch(/Prisma cannot express\s+a partial index/);
  });

  it("documents the DEC-020 absences: no branch scope and no EPIC-12 movement writer", () => {
    const registerDoc = modelDocComment("CashRegister");
    expect(registerDoc).toMatch(/no `branchId` \(DEC-020\)/);
    // The per-tenant unique name is flagged as a slice-level choice, not as a
    // silently introduced constraint.
    expect(registerDoc).toMatch(/slice-level choice/);

    const movementDoc = modelDocComment("CashMovement");
    expect(movementDoc).toMatch(/NOTHING in EPIC-12 writes a movement/);
    expect(movementDoc).toMatch(/POS-003/);
    expect(movementDoc).toMatch(/IMMUTABLE/);
    expect(movementDoc).toMatch(/compensating movement/);
    expect(movementDoc).toMatch(/OPTIONAL\s+for `SALE` and `INCOME`/);
    expect(movementDoc).toMatch(/REQUIRED by a database CHECK/);

    const sessionDoc = modelDocComment("CashSession");
    expect(sessionDoc).toMatch(/required opening float/);
    expect(sessionDoc).toMatch(/0\.00/);
  });

  it("documents the additive movement enum and type-owned sign convention", () => {
    const doc = docCommentAbove("enum CashMovementType ");
    expect(doc).toMatch(/remaining PRD §20 kinds are appended by EPIC-13/);
    expect(doc).toMatch(/values are appended, never\s+reordered or removed/);
    expect(doc).toMatch(/SALE\/INCOME\/DEPOSIT add/);
    expect(doc).toMatch(/REFUND\/EXPENSE\/WITHDRAWAL subtract/);
  });

  it("documents the data classification in the three model doc comments", () => {
    for (const model of ["CashRegister", "CashSession", "CashMovement"]) {
      const doc = modelDocComment(model);
      expect(doc, `${model} must classify its data`).toMatch(/INTERNAL \(PRD §41\)/);
      expect(doc, `${model} must keep logs payload-free`).toMatch(
        /logs and\s+audit carry ids and\s+field\s+names\s+only/
      );
    }
  });
});

describe("schema · cash movement commands (EPIC-13 CASH-002)", () => {
  it("pins the movement direction enum, its mapping and its DEC-030 contract", () => {
    expect(SCHEMA).toMatch(/enum CashMovementDirection\b/);
    expect(SCHEMA).toMatch(/@@map\("cash_movement_direction"\)/);
    // Asserted exactly: a third literal (or a reordered one) is a scope change.
    expect(enumLiterals("CashMovementDirection")).toEqual(["INCREASE", "DECREASE"]);

    const doc = docCommentAbove("enum CashMovementDirection ");
    expect(doc).toMatch(/DEC-030/);
    expect(doc).toMatch(/required EXACTLY for `ADJUSTMENT`/);
    expect(doc).toMatch(/NULL for every other kind/);
    expect(doc).toMatch(/`amount` stays positive/);
  });

  it("declares direction as an optional enum on CashMovement without modelling the CHECK", () => {
    const movement = modelBlock("CashMovement");
    expect(movement).toMatch(/direction\s+CashMovementDirection\?/);
    // The exclusivity is a raw-SQL CHECK, so Prisma must NOT model it: the field
    // is a plain optional enum, with no default and no uniqueness of its own.
    expect(movement).not.toMatch(/direction[^\n]*@default/);
    expect(movement).not.toMatch(/direction[^\n]*@unique/);

    const fieldDoc = docCommentAbove("direction  CashMovementDirection?");
    expect(fieldDoc).toMatch(/DEC-030/);
    expect(fieldDoc).toMatch(/REQUIRED exactly for/);
    expect(fieldDoc).toMatch(/`amount` stays positive/);
  });
});
