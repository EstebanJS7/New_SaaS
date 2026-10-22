import { describe, expect, it } from "vitest";
import { CSV_REJECTION_CODES } from "./csv.js";
import { planPatientCommit } from "./patient-commit.js";
import { createPatientCatalogIndex } from "./patient-row.js";
import type { GuardianLookup } from "./patient-row.js";

/**
 * The patient commit's payloads ([[IMP-004]]).
 *
 * The COMMIT re-reads the artefact to recover the payloads the outcome table
 * deliberately does not store, so this module must reproduce exactly what the preview
 * validated — including the resolved catalog ids and the resolved guardian.
 */

const SPECIES_DOG = "00000000-0000-4000-8000-0000000000a1";
const SPECIES_CAT = "00000000-0000-4000-8000-0000000000a2";
const BREED_LABRADOR = "00000000-0000-4000-8000-0000000000b1";
const GUARDIAN = "00000000-0000-4000-8000-0000000000c1";

const HEADERS = "name,species,sex,breed,birth_date,guardian_document,guardian_phone,guardian_email";

const CSV = [
  HEADERS,
  // Row 1: complete — breed, birth date and a document reference.
  "Luna,dog,FEMALE,labrador,2021-04-09,DOC-9,,",
  // Row 2: a cat resolved by code, guarded by a phone.
  "Michi,cat,male,,,,0981123456,",
  // Row 3: a reference that resolves to nobody.
  "Toby,dog,MALE,,,NOBODY,,",
].join("\n");

const CATALOG = createPatientCatalogIndex({
  species: [
    { id: SPECIES_DOG, code: "DOG", name: "Dog" },
    { id: SPECIES_CAT, code: "CAT", name: "Cat" },
  ],
  breeds: [{ id: BREED_LABRADOR, speciesId: SPECIES_DOG, code: "LAB", name: "Labrador" }],
}).lookup;

const GUARDIANS: GuardianLookup = {
  byDocumentNumber: (value) => (value === "DOC-9" ? GUARDIAN : null),
  byContactValue: (kind, value) => (kind === "PHONE" && value === "0981123456" ? GUARDIAN : null),
};

describe("planPatientCommit", () => {
  it("produces one payload per derivable row, keyed by the row number", () => {
    const plan = planPatientCommit({ csvText: CSV, catalog: CATALOG, guardians: GUARDIANS });

    expect(plan.fileError).toBeUndefined();
    // Row 3 is ABSENT rather than recorded as failed: whether it is committed at all is
    // the PREVIEW's verdict, and this module does not get a second opinion on it.
    expect(plan.rows.map((row) => row.rowNumber)).toEqual([1, 2]);
  });

  it("rebuilds the SAME payload the preview validated, guardian and catalog included", () => {
    const plan = planPatientCommit({ csvText: CSV, catalog: CATALOG, guardians: GUARDIANS });

    expect(plan.rows[0].input).toEqual({
      name: "Luna",
      speciesId: SPECIES_DOG,
      breedId: BREED_LABRADOR,
      sex: "FEMALE",
      birthDate: "2021-04-09T12:00:00.000Z",
      primaryGuardianCustomerId: GUARDIAN,
    });
    expect(plan.rows[1].input).toMatchObject({
      name: "Michi",
      speciesId: SPECIES_CAT,
      sex: "MALE",
      primaryGuardianCustomerId: GUARDIAN,
    });
  });

  it("carries a file refusal as the package's own stable code, with no rows", () => {
    const plan = planPatientCommit({ csvText: "", catalog: CATALOG, guardians: GUARDIANS });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(CSV_REJECTION_CODES.EMPTY_FILE);
  });

  it("yields no payload for a row the create contract refuses", () => {
    const plan = planPatientCommit({
      csvText: [HEADERS, "Luna,dog,masculino,,,DOC-9,,"].join("\n"),
      catalog: CATALOG,
      guardians: GUARDIANS,
    });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError).toBeUndefined();
  });
});
