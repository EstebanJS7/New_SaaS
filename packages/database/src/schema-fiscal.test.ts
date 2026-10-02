import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

const SCHEMA = loadPrismaSchema();
const FISCAL_SQL = findMigration(loadMigrations(), "_fiscal_data_foundation").sql;
const fiscalModel = SCHEMA.slice(
  SCHEMA.indexOf("model FiscalDocument "),
  SCHEMA.indexOf("}", SCHEMA.indexOf("model FiscalDocument "))
);

function functionBody(name: string): string {
  const start = FISCAL_SQL.indexOf(`CREATE OR REPLACE FUNCTION "${name}"()`);
  expect(start, `function ${name} exists`).toBeGreaterThan(-1);
  const body = FISCAL_SQL.slice(start);
  return body.slice(body.indexOf("BEGIN"), body.indexOf("$$ LANGUAGE plpgsql;"));
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
    expect(SCHEMA).toMatch(
      /Values are appended, never reordered or removed\. Evolve additively only\./
    );
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
