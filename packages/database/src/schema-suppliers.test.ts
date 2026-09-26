import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-11 WU1 SUP-001 (Supplier data foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state. This mirrors
 * `schema-inventory.test.ts` / `schema-catalog.test.ts`, which use the same
 * mechanism and the same always-on (no live database) policy.
 *
 * Scope of this file: the persistence guarantees only. The `suppliers.*`
 * permission seeds are gated in `reference-seed.test.ts`, and the HTTP surface
 * is W2 and is asserted where it is implemented.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const SUPPLIERS_SQL = findMigration(MIGRATIONS, "_suppliers").sql;

/** Model block from `model <name>` to the closing brace. */
function modelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);

  const block = SCHEMA.slice(start, SCHEMA.indexOf("}", start));
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `model ${model} block must not be empty`).not.toBe("");
  return block;
}

/** Contiguous `///` doc comment lines immediately above `model <name>`. */
function modelDocComment(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);

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
  expect(lines.length, `model ${model} must have a doc comment`).toBeGreaterThan(0);
  return lines.map((line) => line.replace(/^\/\/\/\s?/, "")).join("\n");
}

/** Single `CREATE TABLE` block, ending at the next DDL statement. */
function tableBlock(table: string): string {
  const start = SUPPLIERS_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = SUPPLIERS_SQL.slice(start);
  const boundaries = [
    rest.indexOf("CREATE TABLE", 1),
    rest.indexOf("ALTER TABLE", 1),
    rest.indexOf("CREATE UNIQUE INDEX", 1),
  ].filter((index) => index > -1);

  const block = rest.slice(0, boundaries.length > 0 ? Math.min(...boundaries) : rest.length);
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `CREATE TABLE "${table}" block must not be empty`).not.toBe("");
  return block;
}

describe("migration · suppliers (EPIC-11 WU1 SUP-001)", () => {
  it("creates only the tenant-scoped supplier table", () => {
    expect(SUPPLIERS_SQL).toMatch(/CREATE TABLE "supplier"/);
    const createdTables = [...SUPPLIERS_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(new Set(createdTables)).toEqual(new Set(["supplier"]));
  });

  it("declares the DEC-011 field set with modest bounded columns and no financial column", () => {
    const block = tableBlock("supplier");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"name" VARCHAR\(200\) NOT NULL/);
    // Optional identity/contact fields (DEC-011): present but nullable.
    expect(block).toMatch(/"legal_name" VARCHAR\(200\),/);
    expect(block).toMatch(/"tax_id" VARCHAR\(50\),/);
    expect(block).toMatch(/"email" VARCHAR\(320\),/);
    expect(block).toMatch(/"phone" VARCHAR\(50\),/);
    expect(block).toMatch(/"address" VARCHAR\(500\),/);
    expect(block).toMatch(/"is_active" BOOLEAN NOT NULL DEFAULT true/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    // Identity data only: no balance, owed amount, payment or numbering column.
    expect(block).not.toMatch(
      /"(balance|owed_amount|credit_limit|payment_term|payment_terms|number|code|currency|amount)"/
    );
  });

  it("bounds the required name to 1..200 characters in the database", () => {
    expect(SUPPLIERS_SQL).toMatch(
      /CONSTRAINT "supplier_name_length" CHECK \(char_length\("name"\) BETWEEN 1 AND 200\)/
    );
  });

  it("scopes suppliers to their tenant with a RESTRICT tenant FK and the composite ownership key", () => {
    expect(SUPPLIERS_SQL).toMatch(
      /ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_fkey"\s+FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(SUPPLIERS_SQL).toMatch(
      /CREATE UNIQUE INDEX "supplier_tenant_id_id_key" ON "supplier"\("tenant_id", "id"\)/
    );
  });

  it("keys the tenant list on (tenant_id, name)", () => {
    expect(SUPPLIERS_SQL).toMatch(
      /CREATE INDEX "supplier_tenant_id_name_idx" ON "supplier"\("tenant_id", "name"\)/
    );
    // The trading name is deliberately NOT unique (DEC-011).
    expect(SUPPLIERS_SQL).not.toMatch(/CREATE UNIQUE INDEX [^;]*ON "supplier"\("name"\)/);
    expect(SUPPLIERS_SQL).not.toMatch(
      /CREATE UNIQUE INDEX [^;]*ON "supplier"\("tenant_id", "name"\)/
    );
  });

  it("enforces per-tenant tax-id uniqueness when present with an explicit partial index", () => {
    // DEC-011 fixes the MECHANISM: an explicit PARTIAL unique index. The
    // `WHERE tax_id IS NOT NULL` predicate puts absent identifiers outside the
    // index entirely, so a repeated PRESENT tax_id inside one tenant collides
    // while multiple absent values coexist by construction.
    //
    // These assertions inspect the applied DDL text only: the always-on schema
    // gate runs without a live PostgreSQL, so the three runtime behaviours (a
    // repeated present value rejected, multiple absent values coexisting, the
    // same value allowed in another tenant) are asserted at the SQL level and
    // are NOT executed here. The live-PostgreSQL suite owns runtime proof.
    expect(SUPPLIERS_SQL).toMatch(
      /CREATE UNIQUE INDEX "supplier_tenant_id_tax_id_key" ON "supplier"\("tenant_id", "tax_id"\) WHERE "tax_id" IS NOT NULL/
    );
    // The predicate is explicit, never silently approximated by a plain
    // composite UNIQUE: the same index name must never appear without it.
    expect(SUPPLIERS_SQL).not.toMatch(
      /CREATE UNIQUE INDEX "supplier_tenant_id_tax_id_key" ON "supplier"\("tenant_id", "tax_id"\);/
    );
    // The SAME tax_id in ANOTHER tenant is a different key: tenant_id leads the
    // partial index, so uniqueness is scoped to the owning tenant.
    // Two suppliers with an ABSENT tax_id coexist because the column stays
    // NULLABLE and the partial predicate leaves those rows out of the index.
    const block = tableBlock("supplier");
    expect(block).toMatch(/"tax_id" VARCHAR\(50\),/);
    expect(block).not.toMatch(/"tax_id" VARCHAR\(50\) NOT NULL/);
  });

  it("makes suppliers undeletable: DELETE raises restrict_violation", () => {
    expect(SUPPLIERS_SQL).toMatch(/CREATE OR REPLACE FUNCTION "supplier_no_delete"\(\)/);
    expect(SUPPLIERS_SQL).toMatch(
      /CREATE TRIGGER "supplier_no_delete_trigger"\s+BEFORE DELETE ON "supplier"\s+FOR EACH ROW EXECUTE FUNCTION "supplier_no_delete"\(\)/
    );
    expect(SUPPLIERS_SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(SUPPLIERS_SQL).toMatch(/suppliers are deactivated and cannot be hard-deleted/);
  });

  it("is additive: no existing table is altered, no row is inserted, nothing is dropped", () => {
    const alteredTables = [...SUPPLIERS_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    // The only ALTER targets the new table; existing tables are untouched.
    expect(new Set(alteredTables)).toEqual(new Set(["supplier"]));

    expect(SUPPLIERS_SQL).not.toMatch(/\bINSERT\b/i);
    expect(SUPPLIERS_SQL).not.toMatch(/\bDROP\b/i);
    expect(SUPPLIERS_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    // No data mutation: the only UPDATE tokens are the FK `ON UPDATE RESTRICT`
    // clauses, never an `UPDATE ... SET` statement.
    expect(SUPPLIERS_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    // No floating point anywhere in the supplier DDL.
    expect(SUPPLIERS_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("classifies supplier identity fields in the applied artifact", () => {
    expect(SUPPLIERS_SQL).toMatch(/CONFIDENTIAL/);
    expect(SUPPLIERS_SQL).toMatch(/name is INTERNAL/);
  });
});

describe("schema · suppliers (EPIC-11 WU1 SUP-001)", () => {
  it("declares the Supplier model and its table mapping", () => {
    expect(SCHEMA).toMatch(/model Supplier\b/);
    expect(SCHEMA).toMatch(/@@map\("supplier"\)/);
  });

  it("maps the DEC-011 fields to snake_case columns with the column bounds", () => {
    const supplier = modelBlock("Supplier");

    expect(supplier).toMatch(
      /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/
    );
    expect(supplier).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(supplier).toMatch(/name\s+String\s+@db\.VarChar\(200\)/);
    expect(supplier).toMatch(/legalName\s+String\?\s+@map\("legal_name"\)\s+@db\.VarChar\(200\)/);
    expect(supplier).toMatch(/taxId\s+String\?\s+@map\("tax_id"\)\s+@db\.VarChar\(50\)/);
    expect(supplier).toMatch(/email\s+String\?\s+@db\.VarChar\(320\)/);
    expect(supplier).toMatch(/phone\s+String\?\s+@db\.VarChar\(50\)/);
    expect(supplier).toMatch(/address\s+String\?\s+@db\.VarChar\(500\)/);
    expect(supplier).toMatch(/isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
    expect(supplier).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(supplier).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)\s+@db\.Timestamptz\(3\)/
    );

    // The trading name is required but not unique (DEC-011).
    expect(supplier).not.toMatch(/name\s+String\s+@unique/);
    // No financial or numbering field is persisted on a supplier. Assert on
    // field declarations, not doc-comment prose, so wording like "any number of
    // rows" is not mistaken for a column.
    expect(supplier).not.toMatch(
      /^\s*(balance|owedAmount|creditLimit|paymentTerm|paymentTerms|number|code|currency|amount)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
  });

  it("scopes Supplier to its tenant and exposes the composite ownership and lookup keys", () => {
    const supplier = modelBlock("Supplier");

    expect(supplier).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(supplier).toMatch(/@@unique\(\[tenantId, id\]\)/);
    // The DEC-011 partial index cannot be expressed as a plain `@@unique`: that
    // would approximate the predicate with full-column uniqueness. It is
    // declared as raw SQL in the suppliers migration and documented on the model
    // doc comment, which the next test asserts.
    expect(supplier).not.toMatch(/@@unique\(\[tenantId, taxId\]\)/);
    expect(supplier).toMatch(/@@index\(\[tenantId, name\]\)/);
  });

  it("documents the raw partial tax-id index on the Supplier model doc comment", () => {
    const doc = modelDocComment("Supplier");
    // Index name, columns and predicate -- the CustomerPortalAccess /
    // PatientGuardian documentation shape.
    expect(doc).toMatch(/supplier_tenant_id_tax_id_key/);
    expect(doc).toMatch(/\(tenant_id, tax_id\) WHERE tax_id IS\s+NOT NULL/);
    // Why it lives in raw SQL rather than a Prisma attribute.
    expect(doc).toMatch(/raw SQL in the suppliers migration/);
    expect(doc).toMatch(/Prisma\s+cannot express partial indexes/);
  });

  it("exposes the Tenant side of the supplier relation", () => {
    expect(modelBlock("Tenant")).toMatch(/suppliers\s+Supplier\[\]/);
  });

  it("documents the DEC-011 classification in the model doc comment", () => {
    const doc = modelDocComment("Supplier");
    expect(doc).toMatch(
      /taxId, legalName, email, phone and\s+address are CONFIDENTIAL; name is INTERNAL/
    );
    expect(doc).toMatch(/application logs carry ids only/i);
    expect(doc).toMatch(/Tenant-scoped supplier register/);
  });
});
