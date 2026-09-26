import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for EPIC-09 WU1 (CAT-001 catalog and tax-rate foundation).
 *
 * These checks parse the applied migration SQL and the schema document so a
 * live database is not required: CI applies these exact files, so textual
 * assertions on the DDL are faithful to real database state.
 *
 * Scope of this file: the persistence guarantees only. Seeding the three global
 * rates, the repository seam, the HTTP surface and the staff UI are later work
 * units of the same epic and are asserted where they are implemented.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const CATALOG_SQL = findMigration(MIGRATIONS, "_catalog").sql;

/** Model block from `model <name>` to the closing brace. */
function modelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);

  const block = SCHEMA.slice(start, SCHEMA.indexOf("}", start));
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `model ${model} block must not be empty`).not.toBe("");
  return block;
}

/** Single `CREATE TABLE` block, ending at the next DDL statement. */
function tableBlock(table: string): string {
  const start = CATALOG_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = CATALOG_SQL.slice(start);
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

describe("migration · catalog (EPIC-09 WU1 CAT-001)", () => {
  it("creates the global tax-rate table and the tenant-scoped catalog item table", () => {
    expect(CATALOG_SQL).toMatch(/CREATE TABLE "tax_rate"/);
    expect(CATALOG_SQL).toMatch(/CREATE TABLE "catalog_item"/);
  });

  it("pins the item kind to PRODUCT | SERVICE | MEDICATION | SUPPLY (PRD §15)", () => {
    expect(CATALOG_SQL).toMatch(
      /CREATE TYPE "catalog_item_kind" AS ENUM \('PRODUCT', 'SERVICE', 'MEDICATION', 'SUPPLY'\)/
    );
    expect(CATALOG_SQL).toMatch(/"kind" "catalog_item_kind" NOT NULL/);
  });

  it("keeps tax_rate global — no tenant_id — keyed by a unique code with a non-negative rate", () => {
    const taxRateBlock = tableBlock("tax_rate");

    expect(taxRateBlock).not.toContain("tenant_id");
    expect(taxRateBlock).toMatch(/"code" TEXT NOT NULL/);
    expect(taxRateBlock).toMatch(/"rate" DECIMAL\(5,2\) NOT NULL/);
    expect(taxRateBlock).toMatch(/CONSTRAINT "tax_rate_rate_non_negative" CHECK \("rate" >= 0\)/);
    expect(CATALOG_SQL).toMatch(/CREATE UNIQUE INDEX "tax_rate_code_key" ON "tax_rate"\("code"\)/);
  });

  it("inserts no rate rows: the reference seed owns the three seeded rates", () => {
    // The rate rows (EXEMPT, IVA_5, IVA_10) are seed-owned data, so the
    // migration must stay pure DDL — a hardcoded row here would be a second,
    // silently diverging source of truth.
    expect(CATALOG_SQL).not.toMatch(/\bINSERT\b/i);
  });

  it("stores the reference price as a nullable amount/currency pair (DEC-010)", () => {
    const catalogBlock = tableBlock("catalog_item");

    expect(catalogBlock).toMatch(/"reference_price_amount" DECIMAL\(14,2\),/);
    expect(catalogBlock).toMatch(/"reference_price_currency" VARCHAR\(3\),/);
    // Both columns stay nullable: a pair-less item is representable, an
    // amount-only or currency-only item is not (see the pair CHECK below).
    expect(catalogBlock).not.toMatch(/"reference_price_amount" DECIMAL\(14,2\) NOT NULL/);
    expect(catalogBlock).not.toMatch(/"reference_price_currency" VARCHAR\(3\) NOT NULL/);
    expect(catalogBlock).toMatch(/"is_active" BOOLEAN NOT NULL DEFAULT true/);
  });

  it("requires exactly one global rate per item (NOT NULL + RESTRICT) and rejects hard delete", () => {
    const catalogBlock = tableBlock("catalog_item");
    expect(catalogBlock).toMatch(/"tax_rate_id" UUID NOT NULL/);

    expect(CATALOG_SQL).toMatch(
      /ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tax_rate_id_fkey"\s+FOREIGN KEY \("tax_rate_id"\) REFERENCES "tax_rate"\("id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );

    expect(CATALOG_SQL).toMatch(/CREATE OR REPLACE FUNCTION "catalog_item_no_delete"\(\)/);
    expect(CATALOG_SQL).toMatch(
      /CREATE TRIGGER "catalog_item_no_delete_trigger"\s+BEFORE DELETE ON "catalog_item"\s+FOR EACH ROW EXECUTE FUNCTION "catalog_item_no_delete"\(\)/
    );
    expect(CATALOG_SQL).toMatch(/ERRCODE = 'restrict_violation'/);
  });

  it("scopes items to their tenant with a RESTRICT tenant FK and the composite ownership key", () => {
    expect(CATALOG_SQL).toMatch(
      /ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tenant_id_fkey"\s+FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(CATALOG_SQL).toMatch(
      /CREATE UNIQUE INDEX "catalog_item_tenant_id_id_key" ON "catalog_item"\("tenant_id", "id"\)/
    );
    expect(CATALOG_SQL).toMatch(
      /CREATE INDEX "catalog_item_tenant_id_idx" ON "catalog_item"\("tenant_id"\)/
    );
    expect(CATALOG_SQL).toMatch(
      /CREATE INDEX "catalog_item_tenant_id_is_active_idx" ON "catalog_item"\("tenant_id", "is_active"\)/
    );
    expect(CATALOG_SQL).toMatch(
      /CREATE INDEX "catalog_item_tax_rate_id_idx" ON "catalog_item"\("tax_rate_id"\)/
    );
  });

  it("enforces the amount/currency pair, non-negative amount and ISO 4217 shape in the database", () => {
    expect(CATALOG_SQL).toMatch(
      /CONSTRAINT "catalog_item_reference_price_pair_check"\s+CHECK \(\("reference_price_amount" IS NULL\) = \("reference_price_currency" IS NULL\)\)/
    );
    expect(CATALOG_SQL).toMatch(
      /CONSTRAINT "catalog_item_reference_price_non_negative"\s+CHECK \("reference_price_amount" >= 0\)/
    );
    expect(CATALOG_SQL).toMatch(
      /CONSTRAINT "catalog_item_reference_price_currency_format"\s+CHECK \("reference_price_currency" ~ '\^\[A-Z\]\{3\}\$'\)/
    );
    // No floating point money anywhere in the catalog DDL.
    expect(CATALOG_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("is additive: no existing table is altered and no later-epic dimension is added", () => {
    const alteredTables = [...CATALOG_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    expect(new Set(alteredTables)).toEqual(new Set(["catalog_item"]));

    // EPIC-10 WU1 (CAT-006) now OWNS the stock dimension, but it lands in its
    // own additive migration (`20260925000003_inventory`), not here: this
    // catalog migration is historical and must stay stock-free, so the pin is
    // kept deliberately rather than loosened. SKU, barcode, category, unit and
    // branch remain unowned by every shipped slice, and `tracks_inventory` is
    // not a valid alias for the real `tracks_stock` column.
    expect(CATALOG_SQL).not.toMatch(
      /"(sku|barcode|category|category_id|unit|unit_id|branch_id|tracks_stock|tracks_inventory)"/
    );
  });
});

describe("schema · catalog inventory (EPIC-09 WU1 CAT-001)", () => {
  it("declares the two models, the kind enum and their table mappings", () => {
    expect(SCHEMA).toMatch(/model TaxRate\b/);
    expect(SCHEMA).toMatch(/model CatalogItem\b/);
    expect(SCHEMA).toMatch(/enum CatalogItemKind\b/);
    expect(SCHEMA).toMatch(/@@map\("tax_rate"\)/);
    expect(SCHEMA).toMatch(/@@map\("catalog_item"\)/);
    expect(SCHEMA).toMatch(/@@map\("catalog_item_kind"\)/);
  });

  it("keeps TaxRate global and tenant-read-only in the schema document", () => {
    const taxRateModel = modelBlock("TaxRate");

    expect(taxRateModel).not.toMatch(/tenantId/);
    expect(taxRateModel).toMatch(/code\s+String\s+@unique/);
    expect(taxRateModel).toMatch(/rate\s+Decimal\s+@db\.Decimal\(5, 2\)/);
    expect(taxRateModel).toMatch(/catalogItems\s+CatalogItem\[\]/);
  });

  it("scopes CatalogItem to its tenant and requires its global rate reference", () => {
    const catalogItemModel = modelBlock("CatalogItem");

    expect(catalogItemModel).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
    expect(catalogItemModel).toMatch(/kind\s+CatalogItemKind\b/);
    expect(catalogItemModel).toMatch(/taxRateId\s+String\s+@map\("tax_rate_id"\)/);
    expect(catalogItemModel).toMatch(
      /taxRate\s+TaxRate\s+@relation\(fields: \[taxRateId\], references: \[id\], onDelete: Restrict/
    );
    expect(catalogItemModel).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict/
    );
    expect(catalogItemModel).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(catalogItemModel).toMatch(/@@index\(\[tenantId, isActive\]\)/);
    expect(catalogItemModel).toMatch(/@@index\(\[taxRateId\]\)/);
  });

  it("maps the optional price pair, the deactivation flag and the EPIC-10 stock dimension", () => {
    const catalogItemModel = modelBlock("CatalogItem");

    expect(catalogItemModel).toMatch(
      /referencePriceAmount\s+Decimal\?\s+@map\("reference_price_amount"\)\s+@db\.Decimal\(14, 2\)/
    );
    expect(catalogItemModel).toMatch(
      /referencePriceCurrency\s+String\?\s+@map\("reference_price_currency"\)\s+@db\.VarChar\(3\)/
    );
    expect(catalogItemModel).toMatch(/isActive\s+Boolean\s+@default\(true\)\s+@map\("is_active"\)/);
    // EPIC-10 WU1 (CAT-006) deliberately adds the ONE stock dimension to the
    // catalog: a non-null boolean defaulted to true and backfilled by kind in
    // the inventory migration. This gate is revised to pin that exact field
    // instead of forbidding it; `tracks_inventory` is still rejected as a
    // non-existent alias, and every other later-epic dimension stays forbidden.
    expect(catalogItemModel).toMatch(
      /tracksStock\s+Boolean\s+@default\(true\)\s+@map\("tracks_stock"\)/
    );
    expect(catalogItemModel).not.toMatch(
      /"(sku|barcode|category|category_id|unit|unit_id|branch_id|tracks_inventory)"/
    );
  });

  it("exposes the Tenant side of the catalog relation", () => {
    expect(modelBlock("Tenant")).toMatch(/catalogItems\s+CatalogItem\[\]/);
  });

  it("classifies catalog configuration as INTERNAL in both artifacts", () => {
    expect(SCHEMA).toMatch(/catalog configuration is INTERNAL/i);
    expect(CATALOG_SQL).toMatch(/catalog configuration is INTERNAL/i);
  });
});
