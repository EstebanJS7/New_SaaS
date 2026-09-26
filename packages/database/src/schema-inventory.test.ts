import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * Schema inventory for the tenancy slice (spec: persistence / EPIC-01 schema
 * inventory — scenario "Schema-only surfaces stay inert"; spec: tenancy-core /
 * No self-service tenant creation).
 *
 * The route-enumeration half of the inertness proof is owned by task 5.3
 * (cross-tenant suite); this file pins the DATABASE side: required tables,
 * unique constraints, FK semantics, and the accepted role_id deviation.
 */

const SCHEMA = loadPrismaSchema();
const MIGRATIONS = loadMigrations();
const TENANCY_SQL = findMigration(MIGRATIONS, "_tenancy_core").sql;
const INVENTORY_SQL = findMigration(MIGRATIONS, "_inventory").sql;

/**
 * EPIC-10 WU1 (CAT-006) inventory gates. The helpers below mirror the ones in
 * `schema-catalog.test.ts`: they slice a single model block or a single
 * `CREATE TABLE` block out of the exact artifacts `prisma migrate deploy`
 * applies, so the assertions are faithful to real database state without a
 * live database.
 */
function inventoryModelBlock(model: string): string {
  const start = SCHEMA.indexOf(`model ${model} `);
  expect(start, `model ${model} must exist`).toBeGreaterThan(-1);

  const block = SCHEMA.slice(start, SCHEMA.indexOf("}", start));
  // A negative assertion on an empty block would pass vacuously.
  expect(block, `model ${model} block must not be empty`).not.toBe("");
  return block;
}

/** Single `CREATE TABLE` block, ending at the next DDL statement. */
function inventoryTableBlock(table: string): string {
  const start = INVENTORY_SQL.indexOf(`CREATE TABLE "${table}"`);
  expect(start, `CREATE TABLE "${table}" must exist`).toBeGreaterThan(-1);

  const rest = INVENTORY_SQL.slice(start);
  const boundaries = [
    rest.indexOf("CREATE TABLE", 1),
    rest.indexOf("ALTER TABLE", 1),
    rest.indexOf("CREATE UNIQUE INDEX", 1),
  ].filter((index) => index > -1);

  const block = rest.slice(0, boundaries.length > 0 ? Math.min(...boundaries) : rest.length);
  expect(block, `CREATE TABLE "${table}" block must not be empty`).not.toBe("");
  return block;
}

describe("migration 002 · tenancy core surface", () => {
  it("creates tenant, branch, tenant_membership, and customer_portal_access", () => {
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "tenant"/);
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "branch"/);
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "tenant_membership"/);
    expect(TENANCY_SQL).toMatch(/CREATE TABLE "customer_portal_access"/);
  });

  it("does not redefine identity tables owned by migration 001", () => {
    // tasks.md places staff_session in migration 001 (task 2.2); 002 must not
    // duplicate any of them.
    expect(TENANCY_SQL).not.toMatch(/CREATE TABLE "(user_profile|user_credential|staff_session)"/);
  });

  it("keeps tenant slugs globally unique", () => {
    expect(TENANCY_SQL).toMatch(/CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"\("slug"\)/);
  });

  it("allows exactly one membership per (tenant, profile)", () => {
    expect(TENANCY_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_membership_tenant_id_user_profile_id_key" ON "tenant_membership"\("tenant_id", "user_profile_id"\)/
    );
  });

  it("pins membership status to ACTIVE | SUSPENDED via enum", () => {
    expect(TENANCY_SQL).toMatch(
      /CREATE TYPE "tenant_membership_status" AS ENUM \('ACTIVE', 'SUSPENDED'\)/
    );
    expect(TENANCY_SQL).toMatch(/"status" "tenant_membership_status" NOT NULL/);
  });

  it("uses RESTRICT FKs for every non-session relationship", () => {
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "branch".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "tenant_membership".*"tenant_id".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "tenant_membership".*"user_profile_id".*REFERENCES "user_profile"\("id"\) ON DELETE RESTRICT/
    );
    expect(TENANCY_SQL).toMatch(
      /ALTER TABLE "customer_portal_access".*REFERENCES "tenant"\("id"\) ON DELETE RESTRICT/
    );
  });

  it("defers the role_id FOREIGN KEY to migration 003 and says so in-file", () => {
    // Accepted deviation: sequential SQL cannot forward-reference the role
    // table created by task 2.4 (U5); U5 ships an additive ALTER.
    expect(TENANCY_SQL).toMatch(/"role_id" UUID NOT NULL/);
    expect(TENANCY_SQL).not.toMatch(/REFERENCES\s+"role"/i);
    expect(TENANCY_SQL).toMatch(/migration 003/);
  });

  it("keeps branch inert and promotes portal access to EPIC-08 live data", () => {
    // Branch is still a schema-only scaffold.
    expect(SCHEMA).toMatch(/SCHEMA-ONLY SCAFFOLD/);
    // customer_portal_access is no longer inert: EPIC-08 links it to Customer.
    expect(SCHEMA).not.toMatch(/INERT SCAFFOLD/);
    expect(SCHEMA).toMatch(/model CustomerPortalAccess\b/);
    // The historical scaffolding note remains in the applied tenancy migration.
    expect(TENANCY_SQL).toMatch(/INERT SCAFFOLD/i);
  });

  it("classifies contact_email as INTERNAL in the applied artifact", () => {
    expect(TENANCY_SQL).toMatch(/INTERNAL/);
  });
});

describe("migration · inventory (EPIC-10 WU1 CAT-006)", () => {
  it("creates the movement and balance tables and the movement-type enum", () => {
    expect(INVENTORY_SQL).toMatch(/CREATE TABLE "stock_movement"/);
    expect(INVENTORY_SQL).toMatch(/CREATE TABLE "stock_balance"/);
    expect(INVENTORY_SQL).toMatch(/CREATE TYPE "stock_movement_type" AS ENUM/);
  });

  it("pins the movement type to ADJUSTMENT only (PRD §16)", () => {
    // The enum literal is asserted exactly: PURCHASE, SALE, TRANSFER_* and the
    // *_REVERSAL compensations belong to EPIC-11/EPIC-12 and must not exist yet.
    const typeValues = /CREATE TYPE "stock_movement_type" AS ENUM \(([^)]*)\)/.exec(
      INVENTORY_SQL
    )?.[1];
    expect(typeValues).toBe("'ADJUSTMENT'");
    expect(INVENTORY_SQL).toMatch(/"type" "stock_movement_type" NOT NULL/);
  });

  it("adds the stock dimension to the catalog and backfills it by kind", () => {
    expect(INVENTORY_SQL).toMatch(
      /ALTER TABLE "catalog_item" ADD COLUMN "tracks_stock" BOOLEAN NOT NULL DEFAULT true;/
    );
    // Existing rows are backfilled deterministically: physical-item kinds track
    // stock, SERVICE does not.
    expect(INVENTORY_SQL).toMatch(
      /UPDATE "catalog_item" SET "tracks_stock" = \("kind" <> 'SERVICE'\);/
    );
  });

  it("is additive with no data seed: only the catalog backfill mutates rows", () => {
    const alteredTables = [...INVENTORY_SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      ([, table]) => table
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    expect(new Set(alteredTables)).toEqual(
      new Set(["catalog_item", "stock_movement", "stock_balance"])
    );
    // No INSERT anywhere: the ledger is created empty and no seed row exists.
    expect(INVENTORY_SQL).not.toMatch(/\bINSERT\b/i);
  });

  it("scopes both tables to their tenant with a RESTRICT tenant FK", () => {
    for (const table of ["stock_movement", "stock_balance"]) {
      expect(INVENTORY_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_fkey"\\s+FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
    }
    expect(INVENTORY_SQL).toMatch(
      /CREATE UNIQUE INDEX "stock_movement_tenant_id_id_key" ON "stock_movement"\("tenant_id", "id"\)/
    );
  });

  it("links both tables to the catalog through a composite RESTRICT tenant-ownership FK", () => {
    for (const table of ["stock_movement", "stock_balance"]) {
      expect(INVENTORY_SQL).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_catalog_item_id_fkey"\\s+FOREIGN KEY \\("tenant_id", "catalog_item_id"\\) REFERENCES "catalog_item"\\("tenant_id", "id"\\)\\s+ON DELETE RESTRICT ON UPDATE RESTRICT`
        )
      );
    }
  });

  it("stores a signed quantity and rejects zero in the database", () => {
    const movementBlock = inventoryTableBlock("stock_movement");
    expect(movementBlock).toMatch(/"quantity" DECIMAL\(10,3\) NOT NULL/);
    expect(movementBlock).toMatch(
      /CONSTRAINT "stock_movement_quantity_non_zero" CHECK \("quantity" <> 0\)/
    );
    expect(movementBlock).toMatch(/"reason" TEXT NOT NULL/);
    // The compensating link is nullable: this slice never populates it.
    expect(movementBlock).toMatch(/"reverses_movement_id" UUID,/);
  });

  it("reserves a composite RESTRICT self-FK for compensating reversals", () => {
    expect(INVENTORY_SQL).toMatch(
      /ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_reverses_movement_id_fkey"\s+FOREIGN KEY \("tenant_id", "reverses_movement_id"\) REFERENCES "stock_movement"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("keeps the balance projection non-negative and one row per (tenant, item)", () => {
    const balanceBlock = inventoryTableBlock("stock_balance");
    expect(balanceBlock).toMatch(/"quantity" DECIMAL\(10,3\) NOT NULL/);
    expect(balanceBlock).toMatch(
      /CONSTRAINT "stock_balance_quantity_non_negative" CHECK \("quantity" >= 0\)/
    );
    expect(INVENTORY_SQL).toMatch(
      /CREATE UNIQUE INDEX "stock_balance_tenant_id_catalog_item_id_key"\s+ON "stock_balance"\("tenant_id", "catalog_item_id"\)/
    );
  });

  it("makes confirmed movements immutable: DELETE raises, no update semantics", () => {
    expect(INVENTORY_SQL).toMatch(/CREATE OR REPLACE FUNCTION "stock_movement_no_delete"\(\)/);
    expect(INVENTORY_SQL).toMatch(
      /CREATE TRIGGER "stock_movement_no_delete_trigger"\s+BEFORE DELETE ON "stock_movement"\s+FOR EACH ROW EXECUTE FUNCTION "stock_movement_no_delete"\(\)/
    );
    expect(INVENTORY_SQL).toMatch(/ERRCODE = 'restrict_violation'/);
    // The ledger has no update surface at all: no UPDATE trigger is declared.
    expect(INVENTORY_SQL).not.toMatch(/BEFORE UPDATE ON "stock_movement"/);
  });

  it("adds no location, branch, warehouse or floating-point dimension", () => {
    expect(INVENTORY_SQL).not.toMatch(/"(location|location_id|branch_id|warehouse|warehouse_id)"/);
    expect(INVENTORY_SQL).not.toMatch(/\b(DOUBLE|REAL|FLOAT)\b/i);
  });

  it("classifies stock quantities and reasons as INTERNAL in the applied artifact", () => {
    expect(INVENTORY_SQL).toMatch(/INTERNAL/);
  });
});

describe("schema · inventory (EPIC-10 WU1 CAT-006)", () => {
  it("declares the two ledger models, the enum and their table mappings", () => {
    expect(SCHEMA).toMatch(/model StockMovement\b/);
    expect(SCHEMA).toMatch(/model StockBalance\b/);
    expect(SCHEMA).toMatch(/enum StockMovementType\b/);
    expect(SCHEMA).toMatch(/@@map\("stock_movement"\)/);
    expect(SCHEMA).toMatch(/@@map\("stock_balance"\)/);
    expect(SCHEMA).toMatch(/@@map\("stock_movement_type"\)/);
  });

  it("adds the single stock dimension to CatalogItem and its ledger back-references", () => {
    const catalogItemModel = inventoryModelBlock("CatalogItem");
    expect(catalogItemModel).toMatch(
      /tracksStock\s+Boolean\s+@default\(true\)\s+@map\("tracks_stock"\)/
    );
    expect(catalogItemModel).toMatch(/stockMovements\s+StockMovement\[\]/);
    expect(catalogItemModel).toMatch(/stockBalances\s+StockBalance\[\]/);
  });

  it("scopes StockMovement to its tenant with the composite item FK and the reserved self-FK", () => {
    const movementModel = inventoryModelBlock("StockMovement");
    expect(movementModel).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
    expect(movementModel).toMatch(/catalogItemId\s+String\s+@map\("catalog_item_id"\)/);
    expect(movementModel).toMatch(/type\s+StockMovementType\b/);
    expect(movementModel).toMatch(/quantity\s+Decimal\s+@db\.Decimal\(10, 3\)/);
    expect(movementModel).toMatch(/reason\s+String\b/);
    expect(movementModel).toMatch(/reversesMovementId\s+String\?\s+@map\("reverses_movement_id"\)/);
    expect(movementModel).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict/
    );
    expect(movementModel).toMatch(
      /catalogItem\s+CatalogItem\s+@relation\(fields: \[tenantId, catalogItemId\], references: \[tenantId, id\], onDelete: Restrict/
    );
    expect(movementModel).toMatch(
      /reversesMovement\s+StockMovement\?\s+@relation\("StockMovementReversal", fields: \[tenantId, reversesMovementId\], references: \[tenantId, id\], onDelete: Restrict/
    );
    expect(movementModel).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(movementModel).toMatch(/@@index\(\[tenantId, catalogItemId\]\)/);
    expect(movementModel).toMatch(/@@index\(\[tenantId, reversesMovementId\]\)/);
  });

  it("keeps one balance row per (tenant, item) as a transactional projection", () => {
    const balanceModel = inventoryModelBlock("StockBalance");
    expect(balanceModel).toMatch(/tenantId\s+String\s+@map\("tenant_id"\)/);
    expect(balanceModel).toMatch(/catalogItemId\s+String\s+@map\("catalog_item_id"\)/);
    expect(balanceModel).toMatch(/quantity\s+Decimal\s+@db\.Decimal\(10, 3\)/);
    expect(balanceModel).toMatch(
      /catalogItem\s+CatalogItem\s+@relation\(fields: \[tenantId, catalogItemId\], references: \[tenantId, id\], onDelete: Restrict/
    );
    expect(balanceModel).toMatch(/@@unique\(\[tenantId, catalogItemId\]\)/);
  });

  it("exposes the Tenant side of the ledger relations", () => {
    const tenantModel = inventoryModelBlock("Tenant");
    expect(tenantModel).toMatch(/stockMovements\s+StockMovement\[\]/);
    expect(tenantModel).toMatch(/stockBalances\s+StockBalance\[\]/);
  });

  it("classifies stock quantities and reasons as INTERNAL in the schema document", () => {
    expect(SCHEMA).toMatch(/stock quantities and adjustment reasons are INTERNAL/i);
  });
});
