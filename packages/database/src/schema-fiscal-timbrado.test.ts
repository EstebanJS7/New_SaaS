import { describe, expect, it } from "vitest";
import { findMigration, loadMigrations, loadPrismaSchema } from "./schema-files.js";

/**
 * EPIC-16 FISC-011 — the emitter profile, establishments and numbering ranges.
 *
 * The migration is hand-written, so this reads its text: it is the only place
 * that pins what the database will actually enforce. A CHECK that is missing
 * here is a CHECK that does not exist.
 */
const SQL = findMigration(loadMigrations(), "_fisc_011_emitter_profile_and_timbrado_ranges").sql;
const SCHEMA = loadPrismaSchema();
const TABLES = [
  "fiscal_emitter_profile",
  "fiscal_emitter_activity",
  "fiscal_establishment",
  "fiscal_timbrado_range",
];

describe("migration · timbrado and numbering ranges (EPIC-16 FISC-011)", () => {
  it("is additive: it creates and never drops, alters or rewrites", () => {
    expect(SQL).not.toMatch(/\bDROP\b/i);
    // `BEFORE DELETE ON` is the guard, not a deletion: what matters is that the
    // migration removes no row.
    expect(SQL).not.toMatch(/\bDELETE FROM\b/i);
    expect(SQL).not.toMatch(/\bUPDATE\s+"/i);
    expect(SQL).not.toMatch(/\bINSERT\b/i);
    expect(SQL).not.toMatch(/\bALTER TABLE\s+"(?!fiscal_)/i);
    for (const table of TABLES) {
      expect(SQL, table).toMatch(new RegExp(`CREATE TABLE "${table}" \\(`));
    }
  });

  it("scopes every table to its tenant with a composite ownership key", () => {
    for (const table of TABLES) {
      expect(SQL, table).toMatch(
        new RegExp(
          `ALTER TABLE "${table}"[\\s\\S]*?FOREIGN KEY \\("tenant_id"\\) REFERENCES "tenant"\\("id"\\)`
        )
      );
    }
    // The two composite references are what make a cross-tenant row
    // unrepresentable rather than merely rejected by a service.
    expect(SQL).toMatch(
      /FOREIGN KEY \("tenant_id", "profile_id"\)\s+REFERENCES "fiscal_emitter_profile"\("tenant_id", "id"\)/
    );
    expect(SQL).toMatch(
      /FOREIGN KEY \("tenant_id", "establishment_id"\)\s+REFERENCES "fiscal_establishment"\("tenant_id", "id"\)/
    );
  });

  it("keeps the counter monotonic, so a burnt number cannot come back", () => {
    // Static half: the counter is bounded by its own range.
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_timbrado_range_next_number_within_range"\s+CHECK \("next_number" >= "range_from"\)/
    );
    // Transition half: a CHECK cannot see the old value, so lowering a counter
    // from 500 back to 1 would pass it. That needs a BEFORE UPDATE trigger.
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION "fiscal_timbrado_range_next_number_monotonic"\(\)/
    );
    expect(SQL).toMatch(/IF NEW\."next_number" < OLD\."next_number" THEN/);
    expect(SQL).toMatch(
      /CREATE TRIGGER "fiscal_timbrado_range_next_number_monotonic_trigger"\s+BEFORE UPDATE ON "fiscal_timbrado_range" FOR EACH ROW/
    );
  });

  it("refuses a status that disagrees with the counter, and leaves RETIRED free", () => {
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_timbrado_range_exhausted_has_run_out"\s+CHECK \("status" <> 'EXHAUSTED' OR "next_number" > "range_to"\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_timbrado_range_active_has_numbers_left"\s+CHECK \("status" <> 'ACTIVE' OR "next_number" <= "range_to"\)/
    );
    // RETIRED appears in neither implication: an operator may retire a range at
    // any point in its life, so a third implication would be wrong.
    const implications =
      SQL.match(/CONSTRAINT "fiscal_timbrado_range_(exhausted|active)[^"]*"/g) ?? [];
    expect(implications).toHaveLength(2);
  });

  it("admits NULL as a real series state, and one seriesless range per key", () => {
    expect(SQL).toMatch(/"series" VARCHAR\(2\),/);
    expect(SQL).toMatch(/"series" IS NULL OR "series" ~ '\^\[A-Z\]\{2\}\$'/);
    // A plain unique index would not do it: PostgreSQL treats NULLs as distinct
    // and would admit many seriesless rows for the same establishment, point and
    // document type.
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "fiscal_timbrado_range_single_seriesless_key"[\s\S]*?WHERE "series" IS NULL;/
    );
  });

  it("admits at most one ACTIVE range per key, which is what the allocation needs", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "fiscal_timbrado_range_single_active_key"[\s\S]*?WHERE "status" = 'ACTIVE';/
    );
  });

  it("pins every scalar to the pattern the official schema states", () => {
    for (const [constraint, pattern] of [
      ["fiscal_emitter_profile_ruc_tRuc", "\\^\\[1-9\\]\\[0-9\\]\\*\\[0-9A-D\\]\\?\\$"],
      ["fiscal_emitter_profile_check_digit_tDVer", "\\^\\[0-9\\]\\$"],
      ["fiscal_establishment_code_tdEst", "\\^\\[0-9\\]\\{3\\}\\$"],
      ["fiscal_timbrado_range_expedition_point_tdPunExp", "\\^\\[0-9\\]\\{3\\}\\$"],
      ["fiscal_timbrado_range_series_tdSerieNum", "\\^\\[A-Z\\]\\{2\\}\\$"],
    ] as const) {
      expect(SQL, constraint).toMatch(
        new RegExp(`CONSTRAINT "${constraint}"[\\s\\S]{0,200}${pattern}`)
      );
    }
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_timbrado_range_timbrado_number_tdNumTim"\s+CHECK \(length\("timbrado_number"\) = 8 AND "timbrado_number" ~ '\^0\*\[1-9\]\[0-9\]\*\$'\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_timbrado_range_document_type_tiTiDE"\s+CHECK \("document_type" IN \(1, 4, 5, 6, 7, 9, 10\)\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_emitter_profile_tax_type_tiTImp" CHECK \("tax_type" BETWEEN 1 AND 5\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_emitter_profile_emission_type_tiTipEmi" CHECK \("emission_type" IN \(1, 2\)\)/
    );
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_establishment_department_code_tDepartamentos"\s+CHECK \("department_code" BETWEEN 1 AND 20\)/
    );
  });

  it("makes the optional groups all-or-nothing", () => {
    // `gRespDE` is optional as a whole, so a half-filled responsible issuer is
    // not a state the database admits.
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_emitter_profile_responsible_issuer_all_or_nothing" CHECK \(/
    );
    // `cDisEmi` and `dDesDisEmi` are both optional and must agree.
    expect(SQL).toMatch(
      /CONSTRAINT "fiscal_establishment_district_pair_all_or_nothing"\s+CHECK \(\("district_code" IS NULL\) = \("district_name" IS NULL\)\)/
    );
  });

  it("does not store the department name, because the official schema enumerates it", () => {
    // Storing it would be a second source for a closed set of twenty names.
    expect(SQL).not.toMatch(/"department_name"/);
    expect(SQL).toMatch(/"department_code" SMALLINT NOT NULL/);
  });

  it("refuses to delete a range, because its consumed numbers are history", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION "fiscal_timbrado_range_no_delete"\(\)/);
    expect(SQL).toMatch(/a timbrado range cannot be deleted; retire it instead/);
    expect(SQL).toMatch(
      /CREATE TRIGGER "fiscal_timbrado_range_no_delete_trigger"\s+BEFORE DELETE ON "fiscal_timbrado_range" FOR EACH ROW/
    );
  });

  it("declares the four models and the one enum the migration creates", () => {
    for (const model of [
      "FiscalEmitterProfile",
      "FiscalEmitterActivity",
      "FiscalEstablishment",
      "FiscalTimbradoRange",
    ]) {
      expect(SCHEMA, model).toMatch(new RegExp(`model ${model} \\{`));
    }
    const enumBody = /enum FiscalTimbradoRangeStatus \{([\s\S]*?)\n\}/.exec(SCHEMA)?.[1] ?? "";
    const values = enumBody
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"));
    expect(values).toEqual(["ACTIVE", "EXHAUSTED", "RETIRED"]);
    expect(SQL).toMatch(
      /CREATE TYPE "fiscal_timbrado_range_status" AS ENUM \('ACTIVE', 'EXHAUSTED', 'RETIRED'\);/
    );
  });
});
