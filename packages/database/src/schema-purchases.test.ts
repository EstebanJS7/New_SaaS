import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-11 PUR-001 (purchase data foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state. This mirrors
 * `schema-suppliers.test.ts` / `schema-inventory.test.ts`, which use the same
 * mechanism and the same always-on (no live database) policy.
 *
 * The delete triggers are gated by inspecting their DDL TEXT — the predicate and
 * the guarded `RAISE` are asserted as text and the trigger is NOT executed here.
 * A live PostgreSQL owns the runtime proof (PUR-001 P3). What this file must
 * catch is the regression that matters: an unconditional `restrict_violation`
 * trigger copied from the catalog/supplier/inventory shape, which would forbid
 * removing a line from a DRAFT and contradict DEC-019.
 *
 * Scope of this file: the persistence guarantees only. The `purchases.*`
 * permission seeds are gated in `reference-seed.test.ts`, and the HTTP surface
 * is P2 and is asserted where it is implemented.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const PURCHASES_SQL = findMigration(MIGRATIONS, "_purchases").sql;

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
  const start = PURCHASES_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = PURCHASES_SQL.slice(start);
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
  const start = PURCHASES_SQL.indexOf(marker);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);

  const rest = PURCHASES_SQL.slice(start + marker.length);
  const end = rest.indexOf("$$ LANGUAGE plpgsql;");
  expect(end, `function ${name} must close with a plpgsql language clause`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("migration · purchases (EPIC-11 PUR-001)", () => {
  it("creates only the tenant-scoped purchase and purchase_line tables", () => {
    expect(PURCHASES_SQL).toMatch(/CREATE TABLE "purchase"/);
    expect(PURCHASES_SQL).toMatch(/CREATE TABLE "purchase_line"/);
    const createdTables = [...PURCHASES_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(new Set(createdTables)).toEqual(new Set(["purchase", "purchase_line"]));
  });

  it("pins the lifecycle enum to exactly DRAFT, RECEIVED and CANCELLED (PRD §17)", () => {
    const typeValues = /CREATE TYPE "purchase_status" AS ENUM \(([^)]*)\)/.exec(PURCHASES_SQL)?.[1];
    // Asserted exactly: an added literal is a lifecycle change, not a detail.
    expect(typeValues).toBe("'DRAFT', 'RECEIVED', 'CANCELLED'");
    expect(PURCHASES_SQL).toMatch(/"status" "purchase_status" NOT NULL DEFAULT 'DRAFT'/);
  });

  it("declares the DEC-012 purchase header with no numbering and no financial column", () => {
    const block = tableBlock("purchase");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"supplier_id" UUID NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    // DEC-018: no human-readable identifier, no sequence, no allocation column.
    expect(block).not.toMatch(/"(number|code|sequence|identifier|reference|display_number)"/i);
    // DEC-013: the amount surface lives on the line only, and only as a unit
    // cost. No total, tax or valuation column exists anywhere.
    expect(PURCHASES_SQL).not.toMatch(
      /"(total|line_total|purchase_total|tax|tax_id|tax_rate_id|tax_amount|amount|vat|unit_price|valuation)"/
    );
  });

  it("declares the DEC-012/DEC-013 line columns with the ledger quantity scale", () => {
    const block = tableBlock("purchase_line");

    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"purchase_id" UUID NOT NULL/);
    expect(block).toMatch(/"catalog_item_id" UUID NOT NULL/);
    // The ledger's exact scale, not a new one (DEC-012).
    expect(block).toMatch(/"quantity" DECIMAL\(10,3\) NOT NULL/);
    // One OPTIONAL informational cost, on the catalog reference-price scale
    // (DEC-013); a line without a cost is a valid state.
    expect(block).toMatch(/"unit_cost" DECIMAL\(14,2\),/);
    expect(block).not.toMatch(/"unit_cost" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it("rejects a non-positive quantity and a negative cost in the database", () => {
    expect(PURCHASES_SQL).toMatch(
      /CONSTRAINT "purchase_line_quantity_positive" CHECK \("quantity" > 0\)/
    );
    expect(PURCHASES_SQL).toMatch(
      /CONSTRAINT "purchase_line_unit_cost_non_negative" CHECK \("unit_cost" >= 0\)/
    );
    // No floating point anywhere in the purchase DDL: exact decimals only.
    expect(PURCHASES_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("scopes both tables to their tenant with RESTRICT and the composite ownership keys", () => {
    for (const table of ["purchase", "purchase_line"]) {
      expect(PURCHASES_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
      expect(PURCHASES_SQL).toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "${table}_tenant_id_id_key" ON "${table}"\\("tenant_id", "id"\\)`
        )
      );
    }
  });

  it("links the purchase to its supplier through a composite RESTRICT ownership FK", () => {
    expect(PURCHASES_SQL).toMatch(
      /ALTER TABLE "purchase" ADD CONSTRAINT "purchase_tenant_id_supplier_id_fkey"\s+FOREIGN KEY \("tenant_id", "supplier_id"\) REFERENCES "supplier"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("links the line to its purchase and its catalog item through composite RESTRICT FKs", () => {
    expect(PURCHASES_SQL).toMatch(
      /ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_tenant_id_purchase_id_fkey"\s+FOREIGN KEY \("tenant_id", "purchase_id"\) REFERENCES "purchase"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(PURCHASES_SQL).toMatch(
      /ALTER TABLE "purchase_line" ADD CONSTRAINT "purchase_line_tenant_id_catalog_item_id_fkey"\s+FOREIGN KEY \("tenant_id", "catalog_item_id"\) REFERENCES "catalog_item"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    // Never CASCADE: a draft's lines are removed explicitly, never implicitly,
    // and a tenant can never be deleted while it still owns purchases.
    expect(PURCHASES_SQL).not.toMatch(/ON DELETE CASCADE/);
  });

  it("rejects a duplicate catalog item inside one purchase", () => {
    expect(PURCHASES_SQL).toMatch(
      /CREATE UNIQUE INDEX "purchase_line_tenant_id_purchase_id_catalog_item_id_key"\s+ON "purchase_line"\("tenant_id", "purchase_id", "catalog_item_id"\)/
    );
  });

  it("serves the tenant list on (tenant_id, status)", () => {
    expect(PURCHASES_SQL).toMatch(
      /CREATE INDEX "purchase_tenant_id_status_idx" ON "purchase"\("tenant_id", "status"\)/
    );
  });

  it("makes the purchase delete CONDITIONAL on status: DRAFT is deletable, RECEIVED/CANCELLED are not", () => {
    // DDL-text inspection only: the trigger is asserted as text and is NOT
    // executed here, exactly like the sibling gates. What is asserted is that
    // the predicate names BOTH settled states and that the raise is GUARDED by
    // it — an unconditional `restrict_violation` (the catalog/supplier/
    // inventory shape) would fail these assertions and contradict DEC-019.
    const body = functionBody("purchase_no_delete_when_received_or_cancelled");

    expect(body).toMatch(/IF OLD\."status" IN \('RECEIVED', 'CANCELLED'\) THEN/);
    // The raise sits INSIDE the guard: everything before the raise carries the
    // predicate, so there is no blanket ban.
    const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
    expect(beforeRaise).toMatch(/OLD\."status" IN \('RECEIVED', 'CANCELLED'\)/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/a received or cancelled purchase cannot be deleted/);
    // A DRAFT delete falls through the guard and returns the row to be deleted.
    expect(body).toMatch(/RETURN OLD;/);

    expect(PURCHASES_SQL).toMatch(
      /CREATE TRIGGER "purchase_no_delete_when_received_or_cancelled_trigger"\s+BEFORE DELETE ON "purchase"\s+FOR EACH ROW EXECUTE FUNCTION "purchase_no_delete_when_received_or_cancelled"\(\)/
    );
  });

  it("makes the line delete CONDITIONAL on the OWNING purchase status", () => {
    const body = functionBody("purchase_line_no_delete_when_received_or_cancelled");

    // The line trigger reads the parent purchase's status rather than its own
    // row, which is the whole point of the conditional rule.
    expect(body).toMatch(/SELECT "status" INTO parent_status/);
    expect(body).toMatch(/FROM "purchase"/);
    expect(body).toMatch(/WHERE "tenant_id" = OLD\."tenant_id" AND "id" = OLD\."purchase_id"/);
    expect(body).toMatch(/IF parent_status IN \('RECEIVED', 'CANCELLED'\) THEN/);

    const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
    expect(beforeRaise).toMatch(/parent_status IN \('RECEIVED', 'CANCELLED'\)/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/a line of a received or cancelled purchase cannot be deleted/);
    expect(body).toMatch(/RETURN OLD;/);

    expect(PURCHASES_SQL).toMatch(
      /CREATE TRIGGER "purchase_line_no_delete_when_received_or_cancelled_trigger"\s+BEFORE DELETE ON "purchase_line"\s+FOR EACH ROW EXECUTE FUNCTION "purchase_line_no_delete_when_received_or_cancelled"\(\)/
    );
  });

  it("is additive: no existing table is altered, no row is inserted, nothing is dropped", () => {
    const alteredTables = [...PURCHASES_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    // The only ALTER targets the two new tables; existing tables are untouched.
    expect(new Set(alteredTables)).toEqual(new Set(["purchase", "purchase_line"]));

    expect(PURCHASES_SQL).not.toMatch(/\bINSERT\b/i);
    expect(PURCHASES_SQL).not.toMatch(/\bDROP\b/i);
    expect(PURCHASES_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(PURCHASES_SQL).not.toMatch(/\bTRUNCATE\b/i);
    // No data mutation: the only UPDATE tokens are the FK `ON UPDATE RESTRICT`
    // clauses, never an `UPDATE ... SET` statement.
    expect(PURCHASES_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
  });

  it("classifies the purchase fields in the applied artifact", () => {
    expect(PURCHASES_SQL).toMatch(/INTERNAL/);
    expect(PURCHASES_SQL).toMatch(
      /supplier reference and the purchase quantities are\n-- INTERNAL/
    );
    expect(PURCHASES_SQL).toMatch(/ids and field names only/);
  });
});

describe("schema · purchases (EPIC-11 PUR-001)", () => {
  it("declares both models, the enum and their table mappings", () => {
    expect(SCHEMA).toMatch(/model Purchase\b/);
    expect(SCHEMA).toMatch(/model PurchaseLine\b/);
    expect(SCHEMA).toMatch(/enum PurchaseStatus\b/);
    expect(SCHEMA).toMatch(/@@map\("purchase"\)/);
    expect(SCHEMA).toMatch(/@@map\("purchase_line"\)/);
    expect(SCHEMA).toMatch(/@@map\("purchase_status"\)/);
  });

  it("pins the enum to the three PRD §17 literals", () => {
    const start = SCHEMA.indexOf("enum PurchaseStatus ");
    expect(start).toBeGreaterThan(-1);
    const block = SCHEMA.slice(SCHEMA.indexOf("{", start) + 1, SCHEMA.indexOf("}", start));
    const literals = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("///") && !line.startsWith("@@"));
    expect(literals).toEqual(["DRAFT", "RECEIVED", "CANCELLED"]);
  });

  it("maps the DEC-012 header fields and defaults status to DRAFT", () => {
    const purchase = modelBlock("Purchase");

    expect(purchase).toMatch(
      /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/
    );
    expect(purchase).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(purchase).toMatch(/supplierId\s+String\s+@map\("supplier_id"\)\s+@db\.Uuid/);
    expect(purchase).toMatch(/status\s+PurchaseStatus\s+@default\(DRAFT\)/);
    expect(purchase).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(purchase).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)\s+@db\.Timestamptz\(3\)/
    );

    // DEC-018: no numbering field. DEC-013: no total, tax or valuation field.
    // Asserted on field declarations, so doc-comment prose that mentions
    // "number" or "total" is not mistaken for a column.
    expect(purchase).not.toMatch(
      /^\s*(number|code|sequence|identifier|reference|total|lineTotal|purchaseTotal|tax|taxRateId|amount|valuation)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
  });

  it("maps the DEC-012/DEC-013 line fields with the exact decimal scales", () => {
    const line = modelBlock("PurchaseLine");

    expect(line).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/purchaseId\s+String\s+@map\("purchase_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/catalogItemId\s+String\s+@map\("catalog_item_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/quantity\s+Decimal\s+@db\.Decimal\(10, 3\)/);
    // The single optional informational cost (DEC-013): nullable, no tax, no
    // computed total beside it.
    expect(line).toMatch(/unitCost\s+Decimal\?\s+@map\("unit_cost"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).not.toMatch(
      /^\s*(total|lineTotal|purchaseTotal|tax|taxRateId|taxAmount|amount|valuation|unitPrice)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
    // Exact decimals only (the schema-wide no-float guard).
    expect(line).not.toMatch(/\bFloat\b/);
  });

  it("exposes the composite tenant-ownership keys and relations on both models", () => {
    const purchase = modelBlock("Purchase");
    expect(purchase).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The supplier reference is COMPOSITE, so a foreign-tenant supplier is not a
    // representable state.
    expect(purchase).toMatch(
      /supplier\s+Supplier\s+@relation\(fields: \[tenantId, supplierId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(purchase).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(purchase).toMatch(/@@index\(\[tenantId, status\]\)/);

    const line = modelBlock("PurchaseLine");
    expect(line).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(
      /purchase\s+Purchase\s+@relation\(fields: \[tenantId, purchaseId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(
      /catalogItem\s+CatalogItem\s+@relation\(fields: \[tenantId, catalogItemId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The duplicate-line rejection and the ownership key (DEC-012).
    expect(line).toMatch(/@@unique\(\[tenantId, purchaseId, catalogItemId\]\)/);
    expect(line).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });

  it("exposes the Tenant, Supplier and CatalogItem sides of the purchase relations", () => {
    const tenant = modelBlock("Tenant");
    expect(tenant).toMatch(/purchases\s+Purchase\[\]/);
    expect(tenant).toMatch(/purchaseLines\s+PurchaseLine\[\]/);

    expect(modelBlock("Supplier")).toMatch(/purchases\s+Purchase\[\]/);
    expect(modelBlock("CatalogItem")).toMatch(/purchaseLines\s+PurchaseLine\[\]/);
  });

  it("documents DEC-018 (no number) and the conditional DEC-019 immutability", () => {
    expect(modelDocComment("Purchase")).toMatch(
      /No number, code or sequence column exists \(DEC-018\)/
    );
    expect(modelDocComment("PurchaseLine")).toMatch(
      /hard-deletable ONLY while its purchase is DRAFT/
    );
  });

  it("documents the data classification in both model doc comments", () => {
    const purchaseDoc = modelDocComment("Purchase");
    expect(purchaseDoc).toMatch(/supplier reference and the purchase quantities are\s+INTERNAL/);
    expect(purchaseDoc).toMatch(/logs and audit\s+carry ids and field names only/i);

    const lineDoc = modelDocComment("PurchaseLine");
    expect(lineDoc).toMatch(/purchase quantities and the optional unit cost are\s+INTERNAL/);
    expect(lineDoc).toMatch(/logs and audit carry ids and field names only/i);
  });
});
