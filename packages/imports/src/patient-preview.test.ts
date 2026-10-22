import { describe, expect, it } from "vitest";
import { CSV_REJECTION_CODES } from "./csv.js";
import { PATIENT_COLUMNS_REJECTION_CODES } from "./patient-columns.js";
import { createPatientCatalogIndex } from "./patient-row.js";
import type { GuardianLookup } from "./patient-row.js";
import { planPatientPreview } from "./patient-preview.js";

/**
 * The patient preview planner ([[IMP-004]]): the same shape `planCustomerPreview`
 * produces, so the SAME runner can walk it.
 */

const SPECIES_DOG = "00000000-0000-4000-8000-0000000000a1";
const GUARDIAN = "00000000-0000-4000-8000-0000000000c1";

const HEADERS = "name,species,sex,breed,birth_date,guardian_document,guardian_phone,guardian_email";

/** One CREATE (document), one CREATE (phone), one FAILED (nobody). */
const MIXED_CSV = [
  HEADERS,
  "Luna,dog,FEMALE,,2021-04-09,DOC-9,,",
  "Michi,cat,male,,,,0981123456,",
  "Toby,dog,MALE,,,NOBODY,,",
].join("\n");

const CATALOG = createPatientCatalogIndex({
  species: [
    { id: SPECIES_DOG, code: "DOG", name: "Dog" },
    { id: "00000000-0000-4000-8000-0000000000a2", code: "CAT", name: "Cat" },
  ],
  breeds: [],
}).lookup;

const GUARDIANS: GuardianLookup = {
  byDocumentNumber: (value) => (value === "DOC-9" ? GUARDIAN : null),
  byContactValue: (kind, value) => (kind === "PHONE" && value === "0981123456" ? GUARDIAN : null),
};

describe("planPatientPreview", () => {
  it("plans one verdict per data row, in file order, with the row's own code", () => {
    const plan = planPatientPreview({ csvText: MIXED_CSV, catalog: CATALOG, guardians: GUARDIANS });

    expect(plan.fileError).toBeUndefined();
    expect(plan.rows.map((row) => [row.rowNumber, row.status, row.code ?? null])).toEqual([
      [1, "CREATE", null],
      [2, "CREATE", null],
      [3, "FAILED", "PATIENT_ROW_GUARDIAN_DOCUMENT_UNRESOLVED"],
    ]);
  });

  it("carries no suspected-duplicate warning: there is no patient heuristic to run", () => {
    const plan = planPatientPreview({ csvText: MIXED_CSV, catalog: CATALOG, guardians: GUARDIANS });

    // Stated rather than left to be inferred: a patient has no natural unique key a
    // file could compare, so every row reports `false` and no lookup exists to be wrong.
    expect(plan.rows.every((row) => row.suspectedDuplicate === false)).toBe(true);
  });

  it("refuses an unreadable FILE with no rows at all", () => {
    const plan = planPatientPreview({ csvText: "", catalog: CATALOG, guardians: GUARDIANS });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(CSV_REJECTION_CODES.EMPTY_FILE);
  });

  it("refuses a file whose headers do not match the contract, with the patient codes", () => {
    const plan = planPatientPreview({
      csvText: "name,sex\nLuna,FEMALE",
      catalog: CATALOG,
      guardians: GUARDIANS,
    });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(PATIENT_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER);
    expect(plan.fileError?.message).toContain("species");
  });

  it("bounds every row message, whatever the file put in it", () => {
    const plan = planPatientPreview({
      csvText: [HEADERS, `Luna,${"z".repeat(800)},FEMALE,,,DOC-9,,`].join("\n"),
      catalog: CATALOG,
      guardians: GUARDIANS,
    });

    const row = plan.rows[0];
    expect(row.status).toBe("FAILED");
    if (row.status !== "FAILED") return;
    expect((row.message ?? "").length).toBeLessThanOrEqual(280);
    expect(row.message).not.toMatch(/[\r\n]/);
  });
});
