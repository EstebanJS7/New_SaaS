import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-12 POS-001 (sale draft data foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state. This mirrors
 * `schema-purchases.test.ts` / `schema-suppliers.test.ts`, which use the same
 * mechanism and the same always-on (no live database) policy.
 *
 * The delete triggers are gated by inspecting their DDL TEXT — the predicate and
 * the guarded `RAISE` are asserted as text and the trigger is NOT executed here.
 * A live PostgreSQL owns the runtime proof (POS-001's live-PostgreSQL block).
 * What this file must catch is the regression that matters: an unconditional
 * `restrict_violation` trigger copied from the catalog/supplier/inventory shape,
 * which would forbid removing a line from a DRAFT and contradict DEC-023.
 *
 * Scope of this file: the persistence guarantees only. The `sales.*` permission
 * seeds are gated in `reference-seed.test.ts`, and the HTTP surface is POS-001
 * W2 and is asserted where it is implemented.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const SALES_SQL = findMigration(MIGRATIONS, "_sales").sql;
const SALE_COMPLETION_SQL = findMigration(MIGRATIONS, "_sale_completion").sql;

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

/** Single `CREATE TABLE` block, ending at the next DDL statement. */
function tableBlock(table: string): string {
  const start = SALES_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = SALES_SQL.slice(start);
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
  const start = SALES_SQL.indexOf(marker);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);

  const rest = SALES_SQL.slice(start + marker.length);
  const end = rest.indexOf("$$ LANGUAGE plpgsql;");
  expect(end, `function ${name} must close with a plpgsql language clause`).toBeGreaterThan(-1);
  return rest.slice(0, end);
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

/**
 * Single `CREATE TABLE` block from the POS-003 completion migration, ending at
 * the next DDL statement.
 */
function completionTableBlock(table: string): string {
  const start = SALE_COMPLETION_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = SALE_COMPLETION_SQL.slice(start);
  const boundaries = [
    rest.indexOf("CREATE TYPE", 1),
    rest.indexOf("CREATE TABLE", 1),
    rest.indexOf("ALTER TABLE", 1),
    rest.indexOf("CREATE UNIQUE INDEX", 1),
    rest.indexOf("CREATE INDEX", 1),
    rest.indexOf("CREATE OR REPLACE FUNCTION", 1),
  ].filter((index) => index > -1);

  const block = rest.slice(0, boundaries.length > 0 ? Math.min(...boundaries) : rest.length);
  expect(block, `CREATE TABLE "${table}" block must not be empty`).not.toBe("");
  return block;
}

/** Body of one function declaration in the POS-003 completion migration. */
function completionFunctionBody(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION "${name}"()`;
  const start = SALE_COMPLETION_SQL.indexOf(marker);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);

  const rest = SALE_COMPLETION_SQL.slice(start + marker.length);
  const end = rest.indexOf("$$ LANGUAGE plpgsql;");
  expect(end, `function ${name} must close with a plpgsql language clause`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("migration · sales (EPIC-12 POS-001)", () => {
  it("creates only the tenant-scoped sale and sale_line tables", () => {
    expect(SALES_SQL).toMatch(/CREATE TABLE "sale"/);
    expect(SALES_SQL).toMatch(/CREATE TABLE "sale_line"/);
    const createdTables = [...SALES_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(new Set(createdTables)).toEqual(new Set(["sale", "sale_line"]));
  });

  it("pins the lifecycle enum to exactly DRAFT, COMPLETED and CANCELLED (PRD §18, DEC-023)", () => {
    const typeValues = /CREATE TYPE "sale_status" AS ENUM \(([^)]*)\)/.exec(SALES_SQL)?.[1];
    // Asserted exactly: an added literal is a lifecycle change, not a detail.
    expect(typeValues).toBe("'DRAFT', 'COMPLETED', 'CANCELLED'");
    expect(SALES_SQL).toMatch(/"status" "sale_status" NOT NULL DEFAULT 'DRAFT'/);
  });

  it("declares the DEC-021/DEC-027/DEC-028 sale header with no numbering, scope or total column", () => {
    const block = tableBlock("sale");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    // DEC-028: the customer is OPTIONAL, so a walk-in sale is representable.
    expect(block).toMatch(/"customer_id" UUID,/);
    expect(block).not.toMatch(/"customer_id" UUID NOT NULL/);
    expect(block).toMatch(/"currency" VARCHAR\(3\) NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    // DEC-027: no human-readable identifier, no sequence, no allocation column.
    expect(block).not.toMatch(/"(number|code|sequence|identifier|reference|display_number)"/i);
    // DEC-028: no discount and no clinical link of any kind.
    expect(block).not.toMatch(
      /"(discount|discount_percent|discount_amount|appointment_id|patient_id)"/i
    );
    // DEC-021: the total is the sum of the line totals; no stored total exists.
    expect(block).not.toMatch(/"(total|sale_total|subtotal|grand_total)"/i);
  });

  it("declares the DEC-021 line snapshot with the exact decimal scales", () => {
    const block = tableBlock("sale_line");

    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"sale_id" UUID NOT NULL/);
    expect(block).toMatch(/"catalog_item_id" UUID NOT NULL/);
    // The frozen stable rate code, not a rate id (DEC-021).
    expect(block).toMatch(/"rate_code" VARCHAR\(20\) NOT NULL/);
    // Money on the catalog reference-price scale and quantities on the ledger
    // scale — the decision's exact precisions, never a new one.
    expect(block).toMatch(/"unit_price" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"quantity" DECIMAL\(10,3\) NOT NULL/);
    expect(block).toMatch(/"line_total" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"taxable_base" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"tax_amount" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    // DEC-021: the frozen snapshot carries no tax-rate id and no derived
    // document-level arithmetic beside it.
    expect(block).not.toMatch(/"(tax_rate_id|tax_id|total|discount)"\s/i);
  });

  it("rejects a non-positive quantity and every negative money amount in the database", () => {
    expect(SALES_SQL).toMatch(/CONSTRAINT "sale_line_quantity_positive" CHECK \("quantity" > 0\)/);
    expect(SALES_SQL).toMatch(
      /CONSTRAINT "sale_line_unit_price_non_negative" CHECK \("unit_price" >= 0\)/
    );
    expect(SALES_SQL).toMatch(
      /CONSTRAINT "sale_line_line_total_non_negative" CHECK \("line_total" >= 0\)/
    );
    expect(SALES_SQL).toMatch(
      /CONSTRAINT "sale_line_taxable_base_non_negative" CHECK \("taxable_base" >= 0\)/
    );
    expect(SALES_SQL).toMatch(
      /CONSTRAINT "sale_line_tax_amount_non_negative" CHECK \("tax_amount" >= 0\)/
    );
    // No floating point anywhere in the sale DDL: exact decimals only.
    expect(SALES_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("scopes both tables to their tenant with RESTRICT and the composite ownership keys", () => {
    for (const table of ["sale", "sale_line"]) {
      expect(SALES_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
      expect(SALES_SQL).toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "${table}_tenant_id_id_key" ON "${table}"\\("tenant_id", "id"\\)`
        )
      );
    }
  });

  it("links the OPTIONAL customer to the same tenant through a composite RESTRICT FK", () => {
    // The column nullability is what makes the reference optional (MATCH
    // SIMPLE), so a walk-in sale is never rejected (DEC-028).
    expect(tableBlock("sale")).toMatch(/"customer_id" UUID,/);
    expect(SALES_SQL).toMatch(
      /ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_customer_id_fkey"\s+FOREIGN KEY \("tenant_id", "customer_id"\) REFERENCES "customer"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("links the line to its sale and its catalog item through composite RESTRICT FKs", () => {
    expect(SALES_SQL).toMatch(
      /ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_sale_id_fkey"\s+FOREIGN KEY \("tenant_id", "sale_id"\) REFERENCES "sale"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(SALES_SQL).toMatch(
      /ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_catalog_item_id_fkey"\s+FOREIGN KEY \("tenant_id", "catalog_item_id"\) REFERENCES "catalog_item"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    // Never CASCADE: a draft's lines are removed explicitly, never implicitly,
    // and a tenant can never be deleted while it still owns sales.
    expect(SALES_SQL).not.toMatch(/ON DELETE CASCADE/);
  });

  it("backs the frozen rate code with a RESTRICT reference to the global tax_rate(code) column", () => {
    expect(SALES_SQL).toMatch(
      /ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_rate_code_fkey"\s+FOREIGN KEY \("rate_code"\) REFERENCES "tax_rate"\("code"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("rejects a duplicate catalog item inside one sale, unconditionally", () => {
    // The unique key is UNCONDITIONAL (no `WHERE`), so the update command's
    // reconciliation keyed by catalog item stays deterministic for every status.
    const index =
      /CREATE UNIQUE INDEX "sale_line_tenant_id_sale_id_catalog_item_id_key"\s+ON "sale_line"\("tenant_id", "sale_id", "catalog_item_id"\);/.exec(
        SALES_SQL
      )?.[0];
    expect(index).toBeDefined();
    expect(index).not.toMatch(/WHERE/i);
  });

  it("serves the tenant list on (tenant_id, status)", () => {
    expect(SALES_SQL).toMatch(
      /CREATE INDEX "sale_tenant_id_status_idx" ON "sale"\("tenant_id", "status"\)/
    );
  });

  it("makes the sale delete CONDITIONAL on status: DRAFT is deletable, COMPLETED/CANCELLED are not", () => {
    // DDL-text inspection only: the trigger is asserted as text and is NOT
    // executed here, exactly like the sibling gates. What is asserted is that
    // the predicate names BOTH settled states and that the raise is GUARDED by
    // it — an unconditional `restrict_violation` (the catalog/supplier/
    // inventory shape) would fail these assertions and contradict DEC-023.
    const body = functionBody("sale_no_delete_when_completed_or_cancelled");

    expect(body).toMatch(/IF OLD\."status" IN \('COMPLETED', 'CANCELLED'\) THEN/);
    // The raise sits INSIDE the guard: everything before the raise carries the
    // predicate, so there is no blanket ban.
    const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
    expect(beforeRaise).toMatch(/OLD\."status" IN \('COMPLETED', 'CANCELLED'\)/);
    // The unconditional sibling shape — a raise straight after BEGIN, with no
    // predicate in front of it — is absent.
    expect(body).not.toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/a completed or cancelled sale cannot be deleted/);
    // A DRAFT delete falls through the guard and returns the row to be deleted.
    expect(body).toMatch(/RETURN OLD;/);

    expect(SALES_SQL).toMatch(
      /CREATE TRIGGER "sale_no_delete_when_completed_or_cancelled_trigger"\s+BEFORE DELETE ON "sale"\s+FOR EACH ROW EXECUTE FUNCTION "sale_no_delete_when_completed_or_cancelled"\(\)/
    );
  });

  it("makes the line delete CONDITIONAL on the OWNING sale status", () => {
    const body = functionBody("sale_line_no_delete_when_completed_or_cancelled");

    // The line trigger reads the parent sale's status rather than its own row,
    // which is the whole point of the conditional rule.
    expect(body).toMatch(/SELECT "status" INTO parent_status/);
    expect(body).toMatch(/FROM "sale"/);
    expect(body).toMatch(/WHERE "tenant_id" = OLD\."tenant_id" AND "id" = OLD\."sale_id"/);
    expect(body).toMatch(/IF parent_status IN \('COMPLETED', 'CANCELLED'\) THEN/);

    const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
    expect(beforeRaise).toMatch(/parent_status IN \('COMPLETED', 'CANCELLED'\)/);
    expect(body).not.toMatch(/BEGIN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(body).toMatch(/a line of a completed or cancelled sale cannot be deleted/);
    expect(body).toMatch(/RETURN OLD;/);

    expect(SALES_SQL).toMatch(
      /CREATE TRIGGER "sale_line_no_delete_when_completed_or_cancelled_trigger"\s+BEFORE DELETE ON "sale_line"\s+FOR EACH ROW EXECUTE FUNCTION "sale_line_no_delete_when_completed_or_cancelled"\(\)/
    );
  });

  it("is additive: no existing table is altered, no row is inserted, nothing is dropped", () => {
    const alteredTables = [...SALES_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    // The only ALTER targets the two new tables; existing tables are untouched.
    expect(new Set(alteredTables)).toEqual(new Set(["sale", "sale_line"]));

    expect(SALES_SQL).not.toMatch(/\bINSERT\b/i);
    expect(SALES_SQL).not.toMatch(/\bDROP\b/i);
    expect(SALES_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SALES_SQL).not.toMatch(/\bTRUNCATE\b/i);
    // No data mutation: the only UPDATE tokens are the FK `ON UPDATE RESTRICT`
    // clauses, never an `UPDATE ... SET` statement.
    expect(SALES_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
  });

  it("classifies the sale money and status fields in the applied artifact", () => {
    expect(SALES_SQL).toMatch(/INTERNAL \(PRD §41\)/);
    expect(SALES_SQL).toMatch(/logs and audit carry ids and field names only/);
  });
});

describe("schema · sales (EPIC-12 POS-001)", () => {
  it("declares both models, the enum and their table mappings", () => {
    expect(SCHEMA).toMatch(/model Sale\b/);
    expect(SCHEMA).toMatch(/model SaleLine\b/);
    expect(SCHEMA).toMatch(/enum SaleStatus\b/);
    expect(SCHEMA).toMatch(/@@map\("sale"\)/);
    expect(SCHEMA).toMatch(/@@map\("sale_line"\)/);
    expect(SCHEMA).toMatch(/@@map\("sale_status"\)/);
  });

  it("pins the enum to the three PRD §18 literals and documents additive evolution", () => {
    const start = SCHEMA.indexOf("enum SaleStatus ");
    expect(start).toBeGreaterThan(-1);
    const block = SCHEMA.slice(SCHEMA.indexOf("{", start) + 1, SCHEMA.indexOf("}", start));
    const literals = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("///") && !line.startsWith("@@"));
    expect(literals).toEqual(["DRAFT", "COMPLETED", "CANCELLED"]);

    const doc = docCommentAbove("enum SaleStatus ");
    expect(doc).toMatch(/PRD §18, DEC-023/);
    expect(doc).toMatch(/appended, never reordered or removed/);
  });

  it("maps the DEC-021/DEC-027/DEC-028 header fields and defaults status to DRAFT", () => {
    const sale = modelBlock("Sale");

    expect(sale).toMatch(
      /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/
    );
    expect(sale).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    // DEC-028: the customer is optional; a walk-in sale needs none.
    expect(sale).toMatch(/customerId\s+String\?\s+@map\("customer_id"\)\s+@db\.Uuid/);
    expect(sale).toMatch(/currency\s+String\s+@db\.VarChar\(3\)/);
    expect(sale).toMatch(/status\s+SaleStatus\s+@default\(DRAFT\)/);
    expect(sale).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(sale).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)\s+@db\.Timestamptz\(3\)/
    );

    // DEC-027: no numbering field. DEC-028: no discount and no clinical link.
    // DEC-021: no stored total. Asserted on field declarations, so doc-comment
    // prose that mentions "number" or "total" is not mistaken for a column.
    expect(sale).not.toMatch(
      /^\s*(number|sequence|identifier|displayNumber|discount|discountPercent|discountAmount|appointmentId|patientId|total|saleTotal|subtotal)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
  });

  it("maps the DEC-021/DEC-022 line snapshot fields with the exact decimal scales", () => {
    const line = modelBlock("SaleLine");

    expect(line).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/saleId\s+String\s+@map\("sale_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/catalogItemId\s+String\s+@map\("catalog_item_id"\)\s+@db\.Uuid/);
    expect(line).toMatch(/rateCode\s+String\s+@map\("rate_code"\)\s+@db\.VarChar\(20\)/);
    expect(line).toMatch(/unitPrice\s+Decimal\s+@map\("unit_price"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(/quantity\s+Decimal\s+@db\.Decimal\(10, 3\)/);
    expect(line).toMatch(/lineTotal\s+Decimal\s+@map\("line_total"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(/taxableBase\s+Decimal\s+@map\("taxable_base"\)\s+@db\.Decimal\(14, 2\)/);
    expect(line).toMatch(/taxAmount\s+Decimal\s+@map\("tax_amount"\)\s+@db\.Decimal\(14, 2\)/);
    // DEC-021: the snapshot freezes the rate code, never a rate id, and no
    // discount joins the money record.
    expect(line).not.toMatch(
      /^\s*(taxRateId|taxId|discount|discountPercent|discountAmount)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
    // Exact decimals only (the schema-wide no-float guard).
    expect(line).not.toMatch(/\bFloat\b/);
  });

  it("exposes the composite tenant-ownership keys and relations on both models", () => {
    const sale = modelBlock("Sale");
    expect(sale).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The customer reference is COMPOSITE and OPTIONAL, so a foreign-tenant
    // customer is not a representable state while a missing customer is.
    expect(sale).toMatch(
      /customer\s+Customer\?\s+@relation\(fields: \[tenantId, customerId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(sale).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(sale).toMatch(/@@index\(\[tenantId, status\]\)/);

    const line = modelBlock("SaleLine");
    expect(line).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(
      /sale\s+Sale\s+@relation\(fields: \[tenantId, saleId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(line).toMatch(
      /catalogItem\s+CatalogItem\s+@relation\(fields: \[tenantId, catalogItemId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The frozen rate code references the GLOBAL unique `code`, RESTRICT only.
    expect(line).toMatch(
      /taxRate\s+TaxRate\s+@relation\(fields: \[rateCode\], references: \[code\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    // The duplicate-line rejection and the ownership key.
    expect(line).toMatch(/@@unique\(\[tenantId, saleId, catalogItemId\]\)/);
    expect(line).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });

  it("references only composite keys the referenced tables actually declare", () => {
    // PostgreSQL accepts a composite FK only when the target columns carry a
    // unique index; this asserts the prerequisite the story tells us to verify.
    for (const model of ["Customer", "CatalogItem"]) {
      expect(modelBlock(model)).toMatch(/@@unique\(\[tenantId, id\]\)/);
    }
    // `tax_rate(code)` is `@unique`, so the RESTRICT rate-code reference is
    // accepted by PostgreSQL.
    expect(modelBlock("TaxRate")).toMatch(/code\s+String\s+@unique/);
    // The sale's own ownership key is what `sale_line` targets.
    expect(modelBlock("Sale")).toMatch(/@@unique\(\[tenantId, id\]\)/);
  });

  it("exposes the Tenant, Customer, CatalogItem and TaxRate sides of the sale relations", () => {
    const tenant = modelBlock("Tenant");
    expect(tenant).toMatch(/sales\s+Sale\[\]/);
    expect(tenant).toMatch(/saleLines\s+SaleLine\[\]/);

    expect(modelBlock("Customer")).toMatch(/sales\s+Sale\[\]/);
    expect(modelBlock("CatalogItem")).toMatch(/saleLines\s+SaleLine\[\]/);
    expect(modelBlock("TaxRate")).toMatch(/saleLines\s+SaleLine\[\]/);
  });

  it("documents the DEC-027/DEC-028 absences and the conditional DEC-023 immutability", () => {
    const saleDoc = modelDocComment("Sale");
    expect(saleDoc).toMatch(
      /No number, sequence or formatted identifier column exists \(DEC-027\)/
    );
    expect(saleDoc).toMatch(/No `appointmentId` and no `patientId` column exists/);
    expect(saleDoc).toMatch(/hard-deletable ONLY while it is DRAFT \(DEC-023\)/);

    const lineDoc = modelDocComment("SaleLine");
    expect(lineDoc).toMatch(/hard-deletable ONLY while its sale is DRAFT \(DEC-023\)/);
    expect(lineDoc).toMatch(/RESTRICT reference to the global row/);
  });

  it("documents the data classification in both model doc comments", () => {
    const saleDoc = modelDocComment("Sale");
    expect(saleDoc).toMatch(/currency, the status and the line money amounts are\s+INTERNAL/);
    expect(saleDoc).toMatch(/logs\s+and audit carry ids and field names only/i);

    const lineDoc = modelDocComment("SaleLine");
    expect(lineDoc).toMatch(/money amounts and the frozen rate code are INTERNAL/);
    expect(lineDoc).toMatch(/logs\s+and audit carry ids and field names only/i);
  });
});

describe("migration · sale completion (EPIC-12 POS-003)", () => {
  it("appends the additive SALE movement kind and leaves the existing values alone", () => {
    expect(SALE_COMPLETION_SQL).toMatch(/ALTER TYPE "stock_movement_type" ADD VALUE 'SALE';/);

    // Exactly one value is appended: the effective set grows, nothing is
    // reordered, renamed or removed (DEC-029, PRD §16).
    const addedValues = [
      ...SALE_COMPLETION_SQL.matchAll(/ALTER TYPE "stock_movement_type" ADD VALUE ('[^']*')/g),
    ].map((match) => match[1]);
    expect(addedValues).toEqual(["'SALE'"]);
    expect(SALE_COMPLETION_SQL).not.toMatch(/ALTER TYPE "stock_movement_type" (DROP|RENAME)/);
  });

  it("creates only the payment and idempotency_record tables", () => {
    const createdTables = [...SALE_COMPLETION_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(new Set(createdTables)).toEqual(new Set(["payment", "idempotency_record"]));
  });

  it("pins the payment method enum to exactly the six PRD §19 literals in order (DEC-029)", () => {
    const typeValues = /CREATE TYPE "payment_method" AS ENUM \(([^)]*)\)/.exec(
      SALE_COMPLETION_SQL
    )?.[1];
    // Asserted exactly: an added tender kind is a scope change, not a detail.
    expect(typeValues).toBe("'CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CHECK', 'OTHER'");
  });

  it("declares the DEC-029 payment shape with no change, tender or credit column", () => {
    const block = completionTableBlock("payment");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"sale_id" UUID NOT NULL/);
    expect(block).toMatch(/"method" "payment_method" NOT NULL/);
    // Money on the sale-line reference scale, never a new precision.
    expect(block).toMatch(/"amount" DECIMAL\(14,2\) NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(block).toMatch(/"updated_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);

    // DEC-029: the exact-amount tender rule models no second money quantity and
    // no customer credit, so none of these columns may appear.
    expect(block).not.toMatch(
      /"(tendered_amount|change|change_amount|refunded_amount|credit|credit_amount|overpayment)"/i
    );
  });

  it("declares the DEC-024 idempotency shape with the fingerprint and result reference", () => {
    const block = completionTableBlock("idempotency_record");

    expect(block).toMatch(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(block).toMatch(/"tenant_id" UUID NOT NULL/);
    expect(block).toMatch(/"operation" VARCHAR\(64\) NOT NULL/);
    expect(block).toMatch(/"key" VARCHAR\(255\) NOT NULL/);
    expect(block).toMatch(/"fingerprint" VARCHAR\(64\) NOT NULL/);
    expect(block).toMatch(/"result_sale_id" UUID NOT NULL/);
    expect(block).toMatch(/"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    // Append-only row: nothing legitimately edits it, so it carries no
    // updated_at.
    expect(block).not.toMatch(/"updated_at"/);
  });

  it("rejects a non-positive payment amount and blank idempotency columns in the database", () => {
    expect(SALE_COMPLETION_SQL).toMatch(
      /CONSTRAINT "payment_amount_positive" CHECK \("amount" > 0\)/
    );
    expect(SALE_COMPLETION_SQL).toMatch(
      /CONSTRAINT "idempotency_record_operation_length" CHECK \(char_length\("operation"\) BETWEEN 1 AND 64\)/
    );
    expect(SALE_COMPLETION_SQL).toMatch(
      /CONSTRAINT "idempotency_record_key_length" CHECK \(char_length\("key"\) BETWEEN 1 AND 255\)/
    );
    // No floating point anywhere in the completion DDL: exact decimals only.
    expect(SALE_COMPLETION_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("scopes both tables to their tenant with RESTRICT and the composite ownership keys", () => {
    for (const table of ["payment", "idempotency_record"]) {
      expect(SALE_COMPLETION_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
      expect(SALE_COMPLETION_SQL).toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "${table}_tenant_id_id_key" ON "${table}"\\("tenant_id", "id"\\)`
        )
      );
    }
  });

  it("links each row to its own tenant's sale through a composite RESTRICT FK", () => {
    expect(SALE_COMPLETION_SQL).toMatch(
      /ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_sale_id_fkey"\s+FOREIGN KEY \("tenant_id", "sale_id"\) REFERENCES "sale"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(SALE_COMPLETION_SQL).toMatch(
      /ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_tenant_id_result_sale_id_fkey"\s+FOREIGN KEY \("tenant_id", "result_sale_id"\) REFERENCES "sale"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    // Never CASCADE: a payment or a record is removed explicitly, never
    // implicitly, and a tenant or sale can never drag them along.
    expect(SALE_COMPLETION_SQL).not.toMatch(/ON DELETE CASCADE/);
  });

  it("makes the idempotency key unique per (tenant, operation, key)", () => {
    // tenant_id leads the key, so the key scope is the tenant, never global.
    expect(SALE_COMPLETION_SQL).toMatch(
      /CREATE UNIQUE INDEX "idempotency_record_tenant_id_operation_key_key"\s+ON "idempotency_record"\("tenant_id", "operation", "key"\)/
    );
  });

  it("makes the payment delete AND update CONDITIONAL on the OWNING sale status", () => {
    // DDL-text inspection only, exactly like the `sale_line` gates: the
    // predicate and the guarded raise are asserted as text and nothing is
    // executed here. An unconditional `restrict_violation` (the cash shape)
    // would fail these assertions and contradict DEC-023.
    for (const [name, operation, returned] of [
      ["payment_no_delete_when_completed_or_cancelled", "DELETE", "OLD"],
      ["payment_no_update_when_completed_or_cancelled", "UPDATE", "NEW"],
    ] as const) {
      const body = completionFunctionBody(name);

      expect(body).toMatch(/SELECT "status" INTO parent_status/);
      expect(body).toMatch(/FROM "sale"/);
      expect(body).toMatch(/WHERE "tenant_id" = OLD\."tenant_id" AND "id" = OLD\."sale_id"/);
      expect(body).toMatch(/IF parent_status IN \('COMPLETED', 'CANCELLED'\) THEN/);

      const beforeRaise = body.slice(0, body.indexOf("RAISE EXCEPTION"));
      expect(beforeRaise).toMatch(/parent_status IN \('COMPLETED', 'CANCELLED'\)/);
      expect(body).not.toMatch(/BEGIN\s+RAISE EXCEPTION/);
      expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
      expect(body).toMatch(new RegExp(`RETURN ${returned};`));

      expect(SALE_COMPLETION_SQL).toMatch(
        new RegExp(
          `CREATE TRIGGER "${name}_trigger"\\s+BEFORE ${operation} ON "payment"\\s+FOR EACH ROW EXECUTE FUNCTION "${name}"\\(\\)`
        )
      );
    }
  });

  it("declares no delete or update trigger on the idempotency record (TD-020)", () => {
    // Nothing purges this table and PRD §41 forbids an automatic destructive
    // retention policy, so no trigger may block the approved policy later.
    expect(SALE_COMPLETION_SQL).not.toMatch(
      /CREATE TRIGGER "[^"]+"\s+BEFORE (DELETE|UPDATE|INSERT) ON "idempotency_record"/
    );
    expect(SALE_COMPLETION_SQL).toMatch(/TD-020/);
  });

  it("is additive: no pre-existing table is altered, no row is inserted, nothing is dropped", () => {
    const alteredTables = [...SALE_COMPLETION_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    // The only ALTER TABLE targets the two new tables; the single pre-existing
    // object touched is the additive `stock_movement_type` value above.
    expect(new Set(alteredTables)).toEqual(new Set(["payment", "idempotency_record"]));

    expect(SALE_COMPLETION_SQL).not.toMatch(/\bINSERT\b/i);
    expect(SALE_COMPLETION_SQL).not.toMatch(/\bDROP\b/i);
    expect(SALE_COMPLETION_SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SALE_COMPLETION_SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SALE_COMPLETION_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
  });

  it("classifies the payment and idempotency fields in the applied artifact", () => {
    expect(SALE_COMPLETION_SQL).toMatch(/INTERNAL \(PRD §41\)/);
    expect(SALE_COMPLETION_SQL).toMatch(/logs and audit carry ids and field names/);
  });
});

describe("schema · sale completion (EPIC-12 POS-003)", () => {
  it("declares both models, the payment enum and their table mappings", () => {
    expect(SCHEMA).toMatch(/model Payment\b/);
    expect(SCHEMA).toMatch(/model IdempotencyRecord\b/);
    expect(SCHEMA).toMatch(/enum PaymentMethod\b/);
    expect(SCHEMA).toMatch(/@@map\("payment"\)/);
    expect(SCHEMA).toMatch(/@@map\("idempotency_record"\)/);
    expect(SCHEMA).toMatch(/@@map\("payment_method"\)/);
  });

  it("appends SALE to StockMovementType and documents the effective set", () => {
    expect(enumLiterals("StockMovementType")).toEqual(["ADJUSTMENT", "PURCHASE", "SALE"]);

    const doc = docCommentAbove("enum StockMovementType ");
    expect(doc).toMatch(/`SALE` is the\s+signed negative output/);
    expect(doc).toMatch(/`TRANSFER_\*` and the `\*_REVERSAL` compensations stay\s+reserved/);
    expect(doc).toMatch(/values are appended, never reordered or removed/);
  });

  it("pins the payment method enum to the six PRD §19 literals and documents the decision", () => {
    expect(enumLiterals("PaymentMethod")).toEqual([
      "CASH",
      "CARD",
      "BANK_TRANSFER",
      "QR",
      "CHECK",
      "OTHER",
    ]);

    const doc = docCommentAbove("enum PaymentMethod ");
    expect(doc).toMatch(/PRD §19/);
    expect(doc).toMatch(/DEC-029/);
    expect(doc).toMatch(/values are appended, never reordered\s+or removed/);
  });

  it("maps the DEC-029 payment fields and the composite tenant-ownership keys", () => {
    const payment = modelBlock("Payment");

    expect(payment).toMatch(
      /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/
    );
    expect(payment).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)\s+@db\.Uuid/);
    expect(payment).toMatch(/saleId\s+String\s+@map\("sale_id"\)\s+@db\.Uuid/);
    expect(payment).toMatch(/method\s+PaymentMethod/);
    expect(payment).toMatch(/amount\s+Decimal\s+@map\("amount"\)\s+@db\.Decimal\(14, 2\)/);
    expect(payment).toMatch(
      /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/
    );
    expect(payment).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@map\("updated_at"\)\s+@db\.Timestamptz\(3\)/
    );

    // DEC-029: no tender, change, refund or credit field is modelled. Asserted
    // on field declarations, so doc-comment prose is not mistaken for a column.
    expect(payment).not.toMatch(
      /^\s*(tenderedAmount|tendered|change|changeAmount|refundedAmount|credit|creditAmount|overpayment)\s+(String|Decimal|Int|BigInt|Float|Boolean)\b/im
    );
    expect(payment).not.toMatch(/\bFloat\b/);

    expect(payment).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(payment).toMatch(
      /sale\s+Sale\s+@relation\(fields: \[tenantId, saleId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(payment).toMatch(/@@unique\(\[tenantId, id\]\)/);

    const doc = modelDocComment("Payment");
    expect(doc).toMatch(/NO\s+`tenderedAmount`, no `change`, no `refundedAmount`/);
    expect(doc).toMatch(/DEC-029/);
  });

  it("maps the DEC-024 idempotency record with its unique replay key", () => {
    const record = modelBlock("IdempotencyRecord");

    expect(record).toMatch(/id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)/);
    expect(record).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
    expect(record).toMatch(/operation\s+String\s+@db\.VarChar\(64\)/);
    expect(record).toMatch(/key\s+String\s+@db\.VarChar\(255\)/);
    expect(record).toMatch(/fingerprint\s+String\s+@db\.VarChar\(64\)/);
    expect(record).toMatch(/resultSaleId\s+String\s+@map\("result_sale_id"\)\s+@db\.Uuid/);
    expect(record).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)/);
    // Append-only: nothing legitimately edits a record, so no updatedAt.
    expect(record).not.toMatch(/updatedAt/);

    expect(record).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(record).toMatch(
      /resultSale\s+Sale\s+@relation\(fields: \[tenantId, resultSaleId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(record).toMatch(/@@unique\(\[tenantId, operation, key\]\)/);
    expect(record).toMatch(/@@unique\(\[tenantId, id\]\)/);

    const doc = modelDocComment("IdempotencyRecord");
    expect(doc).toMatch(/DEC-024/);
    expect(doc).toMatch(/`resultSaleId` is the sale-specific result reference/);
    expect(doc).toMatch(/TD-020/);
  });

  it("exposes the Tenant and Sale sides of the completion relations", () => {
    const tenant = modelBlock("Tenant");
    expect(tenant).toMatch(/payments\s+Payment\[\]/);
    expect(tenant).toMatch(/idempotencyRecords\s+IdempotencyRecord\[\]/);

    const sale = modelBlock("Sale");
    expect(sale).toMatch(/payments\s+Payment\[\]/);
    expect(sale).toMatch(/idempotencyRecords\s+IdempotencyRecord\[\]/);
  });

  it("references only composite keys the referenced tables actually declare", () => {
    // PostgreSQL accepts a composite FK only when the target columns carry a
    // unique index; the sale ownership key is the prerequisite both composite
    // completion FKs target and it must already exist.
    expect(modelBlock("Sale")).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(modelBlock("Sale")).toMatch(/@@map\("sale"\)/);
  });

  it("documents the data classification in both model doc comments", () => {
    const paymentDoc = modelDocComment("Payment");
    expect(paymentDoc).toMatch(/method and the amount are INTERNAL/);
    expect(paymentDoc).toMatch(/logs and audit carry ids and field names only/i);

    const recordDoc = modelDocComment("IdempotencyRecord");
    expect(recordDoc).toMatch(/operation token, the key and the fingerprint are\s+INTERNAL/);
    expect(recordDoc).toMatch(/logs and audit carry ids and field names only/i);
  });
});
