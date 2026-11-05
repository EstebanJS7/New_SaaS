import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * NCE-001 / DEC-090 — the credit note and its fiscal document.
 *
 * The behaviour was drilled against PostgreSQL 16 (see the Story's Verification
 * section); these assertions pin the clauses that drill depends on, so a later
 * edit cannot silently drop one.
 */
const SQL = findMigration(loadMigrations(), "_credit_note").sql;
const SCHEMA = loadPrismaSchema();

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

describe("credit_note (NCE-001)", () => {
  it("is total credit: one note per invoice and per reversal, one number per range", () => {
    const sql = normalize(SQL);
    expect(sql).toContain('ON "credit_note"("tenant_id", "invoice_id")');
    expect(sql).toContain('ON "credit_note"("tenant_id", "sale_reversal_id")');
    expect(sql).toContain('ON "credit_note"("tenant_id", "range_id", "document_number")');
  });

  it("only credits a factura electrónica, under a type-5 authorisation", () => {
    expect(SQL).toContain(`CHECK ("associated_cdc" ~ '^01[0-9]{7}[0-9A-D][0-9]{34}$')`);
    expect(SQL).toContain('CHECK ("document_type" = 5)');
    expect(SQL).toContain('CHECK ("motive" BETWEEN 1 AND 8)');
  });

  it("is append-only and checks the range and the invoice on insert", () => {
    expect(SQL).toMatch(
      /BEFORE UPDATE ON "credit_note" FOR EACH ROW EXECUTE FUNCTION "credit_note_append_only"/
    );
    expect(SQL).toMatch(
      /BEFORE DELETE ON "credit_note" FOR EACH ROW EXECUTE FUNCTION "credit_note_append_only"/
    );
    expect(SQL).toContain("a credit note can only credit a CONFIRMED invoice");
    expect(SQL).toContain("does not match the authorisation of range");
  });
});

describe("fiscal_document.credit_note_id (NCE-001)", () => {
  it("keeps one live FACTURA per invoice and counts notes on their own key", () => {
    const sql = normalize(SQL);
    expect(sql).toContain('DROP INDEX "fiscal_document_tenant_id_invoice_id_key"');
    expect(sql).toContain(
      `ON "fiscal_document"("tenant_id", "invoice_id") WHERE "status" <> 'CANCELLED' AND "credit_note_id" IS NULL`
    );
    expect(sql).toContain(
      `ON "fiscal_document"("tenant_id", "credit_note_id") WHERE "status" <> 'CANCELLED' AND "credit_note_id" IS NOT NULL`
    );
  });

  it("pairs the note with its own invoice and never re-points a document", () => {
    expect(SQL).toContain('BEFORE INSERT OR UPDATE ON "fiscal_document"');
    expect(SQL).toContain("a fiscal document cannot change the document it carries");
    expect(SQL).toContain("must carry the credited invoice");
  });

  it("is mirrored in the Prisma schema", () => {
    expect(SCHEMA).toMatch(/creditNoteId\s+String\?\s+@map\("credit_note_id"\) @db\.Uuid/);
    expect(SCHEMA).toMatch(/model CreditNote \{[\s\S]*?@@map\("credit_note"\)/);
  });
});
