import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  normalizePatientHeader,
  PATIENT_COLUMNS,
  PATIENT_COLUMNS_REJECTION_CODES,
  PATIENT_COLUMN_HEADERS,
  REQUIRED_PATIENT_COLUMNS,
  resolvePatientColumns,
} from "./patient-columns.js";

/**
 * The patient header contract ([[IMP-004]]): one declaration, the SAME three refusals
 * the customer contract already had, and the guardian group that is NOT a required
 * column.
 */
describe("normalizePatientHeader", () => {
  it("trims, collapses internal whitespace runs and lowercases", () => {
    expect(normalizePatientHeader(" Birth   Date ")).toBe("birth_date");
    expect(normalizePatientHeader("GUARDIAN_PHONE")).toBe("guardian_phone");
    expect(normalizePatientHeader("Species")).toBe("species");
  });
});

describe("resolvePatientColumns", () => {
  it("declares the contract once: name, species, sex required, the rest optional", () => {
    expect(Object.keys(PATIENT_COLUMNS)).toEqual([
      "name",
      "species",
      "sex",
      "breed",
      "birth_date",
      "guardian_document",
      "guardian_phone",
      "guardian_email",
    ]);
    // The guardian columns are NOT individual requirements: exactly one of them must be
    // FILLED on each row, which is the row contract's decision, and naming any of them
    // here would refuse a file that references guardians by another one.
    expect(REQUIRED_PATIENT_COLUMNS).toEqual(["name", "species", "sex"]);
    expect(PATIENT_COLUMN_HEADERS).toEqual(Object.keys(PATIENT_COLUMNS));
  });

  it("normalizes the file's headers before matching them", () => {
    const result = resolvePatientColumns([" Name ", "SPECIES", "\uFEFF Sex ", "Guardian Phone"]);

    expect(result).toEqual({
      ok: true,
      layout: {
        headers: ["name", "species", "sex", "guardian_phone"],
        index: { name: 0, species: 1, sex: 2, guardianPhone: 3 },
      },
    });
  });

  it("matches by header name, so a re-ordered file resolves to the right columns", () => {
    const result = resolvePatientColumns(["guardian_email", "sex", "name", "species"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.index).toEqual({
      guardianEmail: 0,
      sex: 1,
      name: 2,
      species: 3,
    });
  });

  it("refuses an unknown header — including `is_active`, which the file may not set", () => {
    const unknown = resolvePatientColumns(["name", "species", "sex", "favourite_toy"]);
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.code).toBe(PATIENT_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER);
    expect(unknown.message).toContain("favourite_toy");
    expect(unknown.message).toContain("guardian_document");

    // [[IMP-004]]: the import creates ACTIVE patients, and a column that let a file
    // deactivate one would be a column that opts out of the ownership rule.
    const isActive = resolvePatientColumns(["name", "species", "sex", "is_active"]);
    expect(isActive.ok).toBe(false);
    if (isActive.ok) return;
    expect(isActive.code).toBe(PATIENT_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER);
    expect(isActive.message).toContain("is_active");
  });

  it("refuses two headers that normalize to the same column, naming it", () => {
    const result = resolvePatientColumns(["name", "species", "sex", "Name"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_COLUMNS_REJECTION_CODES.DUPLICATE_HEADER);
    expect(result.message).toContain("name");
  });

  it("refuses a file with no required header, naming it and the entity", () => {
    const result = resolvePatientColumns(["name", "sex", "guardian_phone"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER);
    expect(result.message).toContain("species");
    // The sentence is the shared resolver's, with THIS entity's noun in it.
    expect(result.message).toContain("imported patient");
  });
});

describe("the patient header contract restates no rule", () => {
  it("declares its columns and lets the SHARED resolver decide every refusal", async () => {
    const source = await readFile(new URL("./patient-columns.ts", import.meta.url), "utf8");

    expect(source).toContain('from "./columns.js"');
    expect(source).toContain("resolveColumns(headers, PATIENT_COLUMN_CONTRACT)");
    // None of the resolver's machinery is re-implemented here: the duplicate check, the
    // unknown-column check and the normalization each have ONE home.
    expect(source).not.toContain(".has(key)");
    expect(source).not.toContain("Object.hasOwn");
    expect(source).not.toContain("replace(/\\s+/g");
  });
});
