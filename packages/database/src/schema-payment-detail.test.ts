import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * PAY-DET-001 / DEC-091 — the payment detail a factura electrónica's
 * `gPaConEIni` needs (TD-074). Drilled against PostgreSQL 16 (see the Story);
 * these assertions pin the clauses the drill depends on.
 */
const SQL = findMigration(loadMigrations(), "_payment_fiscal_detail").sql;
const SCHEMA = loadPrismaSchema();

describe("payment fiscal detail (PAY-DET-001)", () => {
  it("adds nullable columns, so payments written before keep their rows", () => {
    for (const column of [
      '"card_type" "payment_card_type"',
      '"card_brand" "payment_card_brand"',
      '"card_brand_name" VARCHAR(20)',
      '"qr_kind" "payment_qr_kind"',
      '"check_number" VARCHAR(8)',
      '"check_bank" VARCHAR(20)',
      '"other_description" VARCHAR(30)',
    ]) {
      expect(SQL).toContain(`ADD COLUMN ${column}`);
    }
    expect(SQL).not.toMatch(/ADD COLUMN "[a-z_]+" [^,;]* NOT NULL/);
  });

  it("requires each method's detail on INSERT only", () => {
    expect(SQL).toContain(
      'BEFORE INSERT ON "payment" FOR EACH ROW EXECUTE FUNCTION "payment_fiscal_detail_required"()'
    );
    expect(SQL).toContain("a card payment needs its type (credit or debit) and its brand");
    expect(SQL).toContain("a QR payment needs its kind (wallet or bank app)");
    expect(SQL).toContain("a cheque payment needs its number and its bank");
    expect(SQL).toContain('an "other" payment needs a description');
  });

  it("forbids detail that does not belong to the method, and pins the SIFEN shapes", () => {
    for (const constraint of [
      "payment_card_detail_only_for_card",
      "payment_card_brand_name_iff_other",
      "payment_qr_detail_only_for_qr",
      "payment_check_detail_only_for_check",
      "payment_other_detail_only_for_other",
    ]) {
      expect(SQL).toContain(`"${constraint}"`);
    }
    expect(SQL).toContain(`CHECK ("check_number" IS NULL OR "check_number" ~ '^[0-9]{8}$')`);
  });

  it("is mirrored in the Prisma schema", () => {
    expect(SCHEMA).toMatch(/enum PaymentCardType \{\s+CREDIT\s+DEBIT/);
    expect(SCHEMA).toMatch(/cardBrand\s+PaymentCardBrand\?\s+@map\("card_brand"\)/);
    expect(SCHEMA).toMatch(/qrKind\s+PaymentQrKind\?\s+@map\("qr_kind"\)/);
  });
});
