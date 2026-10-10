import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

const SCHEMA = loadPrismaSchema();
const FISCAL_SQL = findMigration(loadMigrations(), "_fiscal_data_foundation").sql;
const fiscalModel = SCHEMA.slice(
  SCHEMA.indexOf("model FiscalDocument "),
  SCHEMA.indexOf("}", SCHEMA.indexOf("model FiscalDocument "))
);

/**
 * EPIC-16 FISC-015 — the fiscal identity [[DEC-057]] decided.
 *
 * Its own migration, read as text: the DDL is hand-written, so a constraint that
 * is missing here is a constraint that does not exist. The schema half pins the
 * models and the nullability the readers depend on.
 */
const FISC_015_SQL = findMigration(loadMigrations(), "_fisc_015_fiscal_identity").sql;

function fisc015FunctionBody(name: string): string {
  const start = FISC_015_SQL.indexOf(`CREATE OR REPLACE FUNCTION "${name}"()`);
  expect(start, `function ${name} exists`).toBeGreaterThan(-1);
  const body = FISC_015_SQL.slice(start);
  return body.slice(body.indexOf("BEGIN"), body.indexOf("$$ LANGUAGE plpgsql;"));
}

/** The `model <name> { ... }` block, so an assertion is scoped to its own body. */
function modelBlock(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} `);
  expect(start, `model ${name} exists in the schema`).toBeGreaterThan(-1);
  return SCHEMA.slice(start, SCHEMA.indexOf("\n}", start));
}

function functionBody(name: string): string {
  const start = FISCAL_SQL.indexOf(`CREATE OR REPLACE FUNCTION "${name}"()`);
  expect(start, `function ${name} exists`).toBeGreaterThan(-1);
  const body = FISCAL_SQL.slice(start);
  return body.slice(body.indexOf("BEGIN"), body.indexOf("$$ LANGUAGE plpgsql;"));
}

/**
 * Returns the contiguous `///` doc-comment block immediately above `enum <name>`.
 * Scoping the additive-evolution assertion to the enum's OWN comment keeps it
 * from passing on some other model's text elsewhere in the schema.
 */
function enumDocComment(name: string): string {
  const marker = `enum ${name}`;
  const index = SCHEMA.indexOf(marker);
  expect(index, `${marker} exists in the schema`).toBeGreaterThan(-1);
  const lines = SCHEMA.slice(0, index).split("\n");
  const comment: string[] = [];
  for (let i = lines.length - 2; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("///")) break;
    comment.unshift(line.replace(/^\/\/\/\s?/, ""));
  }
  // The block wraps across lines, so join it into one logical sentence before
  // matching; otherwise the assertion only holds when the wrap happens to fall
  // where the pattern expects.
  return comment.join(" ");
}

describe("migration · fiscal data foundation (EPIC-15 FISC-002)", () => {
  it("creates exactly the additive fiscal_document table", () => {
    const created = [...FISCAL_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(([, name]) => name);
    expect(created).toEqual(["fiscal_document"]);
    expect(FISCAL_SQL).not.toMatch(/\bDROP\b/i);
    expect(FISCAL_SQL).not.toMatch(/\bINSERT\b/i);
    expect(FISCAL_SQL).not.toMatch(/\bUPDATE\s+[^\s]+\s+SET\b/i);
    expect(FISCAL_SQL).not.toMatch(/^\s*ALTER TYPE\b/im);
    expect(FISCAL_SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it("pins the enums, ownership key, composite invoice FK and partial index", () => {
    expect(FISCAL_SQL).toMatch(
      /CREATE TYPE "fiscal_provider" AS ENUM \('THIRD_PARTY', 'SIFEN_DIRECT', 'FAKE'\)/
    );
    expect(FISCAL_SQL).toMatch(
      /CREATE TYPE "fiscal_document_status" AS ENUM \('PENDING', 'QUEUED', 'SENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ERROR', 'CANCEL_PENDING', 'CANCELLED'\)/
    );
    // Scoped to each fiscal enum's own doc comment: a global schema match would
    // also pass if the evolution rule were written on some unrelated model.
    for (const name of ["FiscalProvider", "FiscalDocumentStatus"]) {
      expect(enumDocComment(name), name).toMatch(
        /Values are appended, never reordered or removed\. Evolve additively only\./
      );
    }
    expect(
      FISCAL_SQL.indexOf('CREATE UNIQUE INDEX "fiscal_document_tenant_id_id_key"')
    ).toBeLessThan(FISCAL_SQL.indexOf("fiscal_document_tenant_id_invoice_id_fkey"));
    expect(FISCAL_SQL).toMatch(
      /FOREIGN KEY \("tenant_id", "invoice_id"\) REFERENCES "invoice"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    expect(FISCAL_SQL).toMatch(
      /CREATE UNIQUE INDEX "fiscal_document_tenant_id_invoice_id_key" ON "fiscal_document"\("tenant_id", "invoice_id"\) WHERE "status" <> 'CANCELLED';/
    );
  });

  it("pins both named CHECKs and all five restrictive trigger bodies", () => {
    expect(FISCAL_SQL).toMatch(
      /CONSTRAINT "fiscal_document_attempt_count_non_negative" CHECK \("attempt_count" >= 0\)/
    );
    expect(FISCAL_SQL).toMatch(
      /CONSTRAINT "fiscal_document_cancelled_at_iff_cancelled" CHECK \(\("cancelled_at" IS NULL\) = \("status" <> 'CANCELLED'\)\)/
    );
    expect(FISCAL_SQL).not.toMatch(/external_id_iff_resolved/);
    expect(FISCAL_SQL).not.toMatch(/terminal_immutable/);
    expect(functionBody("fiscal_document_cancelled_immutable")).toMatch(
      /IF OLD\."status" = 'CANCELLED' THEN/
    );
    for (const name of [
      "fiscal_document_no_delete",
      "fiscal_document_cancelled_immutable",
      "fiscal_document_identity_immutable",
      "fiscal_document_provider_refs_write_once",
      "fiscal_document_attempts_monotonic",
    ]) {
      expect(functionBody(name), name).toMatch(/ERRCODE = 'restrict_violation'/);
      expect(FISCAL_SQL).toContain(`CREATE TRIGGER "${name}_trigger"`);
    }
  });
});

describe("schema · fiscal data foundation (EPIC-15 FISC-002)", () => {
  it("maps the exact enums, tenant-scoped model and safe invoice linkage", () => {
    expect(SCHEMA).toContain("enum FiscalProvider");
    expect(SCHEMA).toContain("enum FiscalDocumentStatus");
    expect(fiscalModel).toMatch(/@@map\("fiscal_document"\)/);
    expect(fiscalModel).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(fiscalModel).toMatch(
      /invoice Invoice @relation\(fields: \[tenantId, invoiceId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(SCHEMA).toMatch(/fiscalDocuments\s+FiscalDocument\[\]/);
    expect(fiscalModel).not.toMatch(/series|currency|customer|money/i);
    expect(SCHEMA).toMatch(/no secret material is stored/i);
  });
});

describe("migration · fiscal identity (EPIC-16 FISC-015)", () => {
  it("is additive: it creates and never drops, deletes or rewrites", () => {
    const created = [...FISC_015_SQL.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(([, name]) => name);
    expect(created).toEqual(["tenant_tax_classification", "tenant_fiscal_csc"]);
    expect(FISC_015_SQL).not.toMatch(/\bDROP\b/i);
    expect(FISC_015_SQL).not.toMatch(/\bDELETE FROM\b/i);
    expect(FISC_015_SQL).not.toMatch(/\bUPDATE\s+"/i);
    // The guards are `BEFORE INSERT OR UPDATE` triggers, so the prose and the DDL
    // both mention the words: what must not exist is a statement that writes a row.
    expect(FISC_015_SQL).not.toMatch(/\bINSERT INTO\b/i);
    // The three columns it adds to existing tables are nullable and defaulted to
    // NULL, so no row is rewritten and no backfill is required.
    for (const column of [
      /ALTER TABLE "customer" ADD COLUMN "fiscal_operation_type" "fiscal_operation_type";/,
      /ALTER TABLE "catalog_item" ADD COLUMN "unit_of_measure_code" VARCHAR\(4\);/,
      /ALTER TABLE "fiscal_emitter_profile" ADD COLUMN "default_establishment_id" UUID;/,
      /ALTER TABLE "fiscal_emitter_profile" ADD COLUMN "default_expedition_point" VARCHAR\(3\);/,
      /ALTER TABLE "fiscal_emitter_profile" ADD COLUMN "default_document_type" SMALLINT;/,
    ]) {
      expect(FISC_015_SQL).toMatch(column);
    }
    expect(FISC_015_SQL).not.toMatch(/ADD COLUMN [^;]*NOT NULL/);
  });

  it("pins the three enums to the protocol's own value sets", () => {
    // `tiAfecIVA` §21.5, `iTiOpe` §22.3 and the CSC's own lifecycle.
    expect(FISC_015_SQL).toMatch(
      /CREATE TYPE "fiscal_iva_affectation" AS ENUM \(\s*'GRAVADO_IVA', 'EXONERADO', 'EXENTO', 'GRAVADO_PARCIAL'\s*\);/
    );
    expect(FISC_015_SQL).toMatch(
      /CREATE TYPE "fiscal_operation_type" AS ENUM \('B2B', 'B2C', 'B2G', 'B2F'\)/
    );
    expect(FISC_015_SQL).toMatch(/CREATE TYPE "fiscal_csc_status" AS ENUM \('ACTIVE', 'RETIRED'\)/);
  });

  it("scopes the classification to its tenant and names the GLOBAL rate by code", () => {
    expect(FISC_015_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_tax_classification_tenant_id_rate_code_key"\s+ON "tenant_tax_classification"\("tenant_id", "rate_code"\)/
    );
    expect(FISC_015_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_tax_classification_tenant_id_id_key"\s+ON "tenant_tax_classification"\("tenant_id", "id"\)/
    );
    expect(FISC_015_SQL).toMatch(
      /FOREIGN KEY \("tenant_id"\) REFERENCES "tenant"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
    // The global rate is referenced by its natural key, not by its row id, so a
    // classification names a code a reader can cite.
    expect(FISC_015_SQL).toMatch(
      /FOREIGN KEY \("rate_code"\) REFERENCES "tax_rate"\("code"\) ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("pairs the proportionality with the one affectation that carries it", () => {
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "tenant_tax_classification_proportionality_iff_partial"\s+CHECK \(\("affectation" = 'GRAVADO_PARCIAL'\) = \("proportionality" IS NOT NULL\)\)/
    );
    // `tPorcDesc8`'s own bound (§21.4), which the column's DECIMAL(5,2) does not
    // imply.
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "tenant_tax_classification_proportionality_dPropIVA"\s+CHECK \("proportionality" IS NULL OR \("proportionality" >= 0 AND "proportionality" <= 100\)\)/
    );
  });

  it("makes the classification and the rate it names agree, in both directions", () => {
    const body = fisc015FunctionBody("tenant_tax_classification_matches_rate");
    // `dTasaIVA`'s observation (§21): rate 0 with the two untaxed affectations,
    // 5 or 10 with the two taxed ones, and nothing else at all.
    expect(body).toMatch(/IF rate_value = 0 THEN/);
    expect(body).toMatch(/NEW\."affectation" NOT IN \('EXONERADO', 'EXENTO'\)/);
    expect(body).toMatch(/ELSIF rate_value IN \(5, 10\) THEN/);
    expect(body).toMatch(/NEW\."affectation" NOT IN \('GRAVADO_IVA', 'GRAVADO_PARCIAL'\)/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(FISC_015_SQL).toContain(
      'CREATE TRIGGER "tenant_tax_classification_matches_rate_trigger"\n  BEFORE INSERT OR UPDATE ON "tenant_tax_classification"'
    );
    // The converse: a rate cannot move under a classification that reads it, so
    // a mismatch is impossible rather than merely unlikely.
    const guard = fisc015FunctionBody("tax_rate_classified_rate_immutable");
    expect(guard).toMatch(/NEW\."rate" IS DISTINCT FROM OLD\."rate"/);
    expect(guard).toMatch(/FROM "tenant_tax_classification" WHERE "rate_code" = OLD\."code"/);
    expect(guard).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(FISC_015_SQL).toContain(
      'CREATE TRIGGER "tax_rate_classified_rate_immutable_trigger"\n  BEFORE UPDATE ON "tax_rate"'
    );
  });

  it("leaves the customer's operation type nullable and undefaulted", () => {
    // DEC-057 Q2: the declaration is the tenant's, and no default is invented for
    // any of the four values. A DEFAULT here would silently classify a customer.
    expect(FISC_015_SQL).toMatch(
      /ALTER TABLE "customer" ADD COLUMN "fiscal_operation_type" "fiscal_operation_type";/
    );
    expect(FISC_015_SQL).not.toMatch(/fiscal_operation_type"[^;]*DEFAULT/);
    expect(FISC_015_SQL).not.toMatch(/fiscal_operation_type"[^;]*NOT NULL/);
  });

  it("adds the unit of measure as a nullable code with its length pinned", () => {
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "catalog_item_unit_of_measure_code_cUniMed"\s+CHECK \("unit_of_measure_code" IS NULL OR length\("unit_of_measure_code"\) BETWEEN 1 AND 4\)/
    );
    // No alphabet is asserted: no retrieved source pins one, and the recorded
    // examples (`77`, `2366`, `2329`) are not a rule.
    expect(FISC_015_SQL).not.toMatch(/unit_of_measure_code"[^;]*~/);
  });

  it("makes the default issuance point atomic and tenant-owned", () => {
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "fiscal_emitter_profile_default_issuance_point_all_or_nothing" CHECK \(\s*\("default_establishment_id" IS NULL\) = \("default_expedition_point" IS NULL\)\s+AND \("default_establishment_id" IS NULL\) = \("default_document_type" IS NULL\)\s*\)/
    );
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "fiscal_emitter_profile_default_expedition_point_tdPunExp"\s+CHECK \("default_expedition_point" IS NULL OR "default_expedition_point" ~ '\^\[0-9\]\{3\}\$'\)/
    );
    // `tiTiDE`'s own set, the same one the range carries: 1 is Factura
    // electrónica (§21.5).
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "fiscal_emitter_profile_default_document_type_tiTiDE"\s+CHECK \("default_document_type" IS NULL OR "default_document_type" IN \(1, 4, 5, 6, 7, 9, 10\)\)/
    );
    // Composite tenant ownership: a cross-tenant default establishment is
    // unrepresentable, not merely rejected by a service.
    expect(FISC_015_SQL).toMatch(
      /FOREIGN KEY \("tenant_id", "default_establishment_id"\)\s+REFERENCES "fiscal_establishment"\("tenant_id", "id"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/
    );
  });

  it("mirrors the signing material's shape for the CSC, and never its value", () => {
    expect(FISC_015_SQL).toMatch(/"id_csc" VARCHAR\(4\) NOT NULL/);
    expect(FISC_015_SQL).toMatch(/"secret_ref" TEXT NOT NULL/);
    expect(FISC_015_SQL).toMatch(/"status" "fiscal_csc_status" NOT NULL DEFAULT 'ACTIVE'/);
    // The two retirement invariants the signing material carries, mirrored.
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "tenant_fiscal_csc_retired_at_iff_retired"\s+CHECK \(\("retired_at" IS NULL\) = \("status" = 'ACTIVE'\)\)/
    );
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "tenant_fiscal_csc_retirement_reason_required"\s+CHECK \("status" <> 'RETIRED' OR length\(btrim\(coalesce\("retirement_reason", ''\)\)\) > 0\)/
    );
    expect(FISC_015_SQL).toMatch(
      /CONSTRAINT "tenant_fiscal_csc_id_csc_four_characters" CHECK \(length\("id_csc"\) = 4\)/
    );
    // The value is never a column: only the opaque reference is.
    expect(FISC_015_SQL).not.toMatch(/"csc" /);
    expect(FISC_015_SQL).toMatch(
      /CREATE UNIQUE INDEX "tenant_fiscal_csc_one_active_per_id_key"\s+ON "tenant_fiscal_csc"\("tenant_id", "environment", "id_csc"\) WHERE "status" = 'ACTIVE';/
    );
  });

  it("bounds the ACTIVE CSCs at two, which no unique index can express", () => {
    const body = fisc015FunctionBody("tenant_fiscal_csc_at_most_two_active");
    expect(body).toMatch(/IF NEW\."status" = 'ACTIVE' THEN/);
    expect(body).toMatch(/SELECT count\(\*\) INTO active_count/);
    expect(body).toMatch(/AND "environment" = NEW\."environment"/);
    expect(body).toMatch(/AND "id" <> NEW\."id"/);
    expect(body).toMatch(/IF active_count >= 2 THEN/);
    expect(body).toMatch(/ERRCODE = 'restrict_violation'/);
    expect(FISC_015_SQL).toContain(
      'CREATE TRIGGER "tenant_fiscal_csc_at_most_two_active_trigger"\n  BEFORE INSERT OR UPDATE ON "tenant_fiscal_csc"'
    );
    // The bound is per taxpayer AND per environment: the two DNIT environments
    // are independent, exactly as the signing material's one-ACTIVE rule is.
    expect(body).not.toMatch(/SELECT count\(\*\) INTO active_count[\s\S]*?AND "status" <> /);
  });

  it("carries the protocol citations the constants come from", () => {
    expect(FISC_015_SQL).toMatch(/SIFEN-BASELINE\.md/);
    expect(FISC_015_SQL).toMatch(/§21\.5/);
    expect(FISC_015_SQL).toMatch(/§21\.4/);
    expect(FISC_015_SQL).toMatch(/§21\.3/);
    expect(FISC_015_SQL).toMatch(/§22\.3/);
    expect(FISC_015_SQL).toMatch(/§24\.2/);
    expect(FISC_015_SQL).toMatch(/§24\.3/);
  });
});

describe("schema · fiscal identity (EPIC-16 FISC-015)", () => {
  it("declares the three enums with their evolution rule and table mappings", () => {
    expect(SCHEMA).toContain("enum FiscalIvaAffectation");
    expect(SCHEMA).toContain("enum FiscalOperationType");
    expect(SCHEMA).toContain("enum FiscalCscStatus");
    for (const name of ["FiscalIvaAffectation", "FiscalOperationType", "FiscalCscStatus"]) {
      expect(enumDocComment(name), name).toMatch(
        /Values are appended, never reordered or removed\. Evolve additively only\./
      );
    }
    expect(SCHEMA).toMatch(/@@map\("fiscal_iva_affectation"\)/);
    expect(SCHEMA).toMatch(/@@map\("fiscal_operation_type"\)/);
    expect(SCHEMA).toMatch(/@@map\("fiscal_csc_status"\)/);
    // The four affectations and the four operation types, each with its code
    // cited where the code matters.
    for (const member of ["GRAVADO_IVA", "EXONERADO", "EXENTO", "GRAVADO_PARCIAL"]) {
      expect(SCHEMA).toMatch(new RegExp(`^\\s{2}${member}$`, "m"));
    }
    for (const member of ["B2B", "B2C", "B2G", "B2F"]) {
      expect(SCHEMA).toMatch(new RegExp(`^\\s{2}${member}$`, "m"));
    }
  });

  it("declares the classification as a tenant-scoped aggregate over a global rate", () => {
    const model = modelBlock("TenantTaxClassification");
    expect(model).toMatch(/@@map\("tenant_tax_classification"\)/);
    expect(model).toMatch(/@@unique\(\[tenantId, rateCode\]\)/);
    expect(model).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(model).toMatch(/proportionality Decimal\? @db\.Decimal\(5, 2\)/);
    expect(model).toMatch(/affectation FiscalIvaAffectation/);
    expect(model).toMatch(/rateCode String @map\("rate_code"\)/);
    expect(model).toMatch(
      /taxRate TaxRate @relation\(fields: \[rateCode\], references: \[code\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(modelBlock("TaxRate")).toMatch(/tenantClassifications TenantTaxClassification\[\]/);
  });

  it("declares the CSC as a tenant-scoped aggregate that stores no value", () => {
    const model = modelBlock("TenantFiscalCsc");
    expect(model).toMatch(/@@map\("tenant_fiscal_csc"\)/);
    expect(model).toMatch(/@@unique\(\[tenantId, id\]\)/);
    expect(model).toMatch(/idCsc String @map\("id_csc"\) @db\.VarChar\(4\)/);
    expect(model).toMatch(/secretRef String @map\("secret_ref"\)/);
    expect(model).toMatch(/status\s+FiscalCscStatus @default\(ACTIVE\)/);
    expect(model).toMatch(/retiredAt\s+DateTime\? @map\("retired_at"\) @db\.Timestamptz\(3\)/);
    expect(model).toMatch(/retirementReason\s+String\?\s+@map\("retirement_reason"\)/);
    expect(model).not.toMatch(/^\s*csc\s/m);
    expect(modelBlock("Tenant")).toMatch(/tenantFiscalCscs\s+TenantFiscalCsc\[\]/);
    expect(modelBlock("Tenant")).toMatch(/tenantTaxClassifications\s+TenantTaxClassification\[\]/);
  });

  it("leaves the customer's and the item's new columns nullable and undefaulted", () => {
    expect(modelBlock("Customer")).toMatch(
      /fiscalOperationType FiscalOperationType\? @map\("fiscal_operation_type"\)/
    );
    expect(modelBlock("Customer")).not.toMatch(/fiscalOperationType[^\n]*@default/);
    expect(modelBlock("CatalogItem")).toMatch(
      /unitOfMeasureCode String\? @map\("unit_of_measure_code"\) @db\.VarChar\(4\)/
    );
    expect(modelBlock("CatalogItem")).not.toMatch(/unitOfMeasureCode[^\n]*@default/);
  });

  it("gives the profile a nullable default issuance point and its tenant-owned establishment", () => {
    const model = modelBlock("FiscalEmitterProfile");
    expect(model).toMatch(
      /defaultEstablishmentId String\? @map\("default_establishment_id"\) @db\.Uuid/
    );
    expect(model).toMatch(
      /defaultExpeditionPoint String\? @map\("default_expedition_point"\) @db\.VarChar\(3\)/
    );
    expect(model).toMatch(
      /defaultDocumentType Int\? @map\("default_document_type"\) @db\.SmallInt/
    );
    expect(model).not.toMatch(/defaultEstablishmentId[^\n]*@default/);
    expect(model).toMatch(
      /defaultEstablishment FiscalEstablishment\? @relation\(fields: \[tenantId, defaultEstablishmentId\], references: \[tenantId, id\], onDelete: Restrict, onUpdate: Restrict\)/
    );
    expect(modelBlock("FiscalEstablishment")).toMatch(
      /defaultForEmitterProfiles FiscalEmitterProfile\[\]/
    );
  });
});
