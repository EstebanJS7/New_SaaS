import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPatientBody } from "@newsaas/patients";
import { resolvePatientColumns } from "./patient-columns.js";
import type { PatientColumnLayout } from "./patient-columns.js";
import {
  createPatientCatalogIndex,
  PATIENT_ROW_REJECTION_CODES,
  toPatientRow,
} from "./patient-row.js";
import type { GuardianLookup, PatientCatalogIndex } from "./patient-row.js";

/**
 * One patient row's verdict ([[IMP-004]]).
 *
 * The RULES are `@newsaas/patients`' rules, so a case about a boundary compares
 * against the SHARED schema's own message instead of a copy of it. What this file
 * covers is what the row contract ADDS: the catalog resolution, the sex fold, the
 * birth-date conversion, and [[DEC-070]]'s guardian reference.
 */

const SPECIES_DOG = "00000000-0000-4000-8000-0000000000a1";
const SPECIES_CAT = "00000000-0000-4000-8000-0000000000a2";
const BREED_LABRADOR = "00000000-0000-4000-8000-0000000000b1";
const BREED_SIAMESE = "00000000-0000-4000-8000-0000000000b2";
const GUARDIAN = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CUSTOMER = "00000000-0000-4000-8000-0000000000c2";

const CATALOG: PatientCatalogIndex = createPatientCatalogIndex({
  species: [
    { id: SPECIES_DOG, code: "DOG", name: "Dog" },
    { id: SPECIES_CAT, code: "CAT", name: "Cat" },
  ],
  breeds: [
    { id: BREED_LABRADOR, speciesId: SPECIES_DOG, code: "LAB", name: "Labrador" },
    { id: BREED_SIAMESE, speciesId: SPECIES_CAT, code: "SIA", name: "Siamese" },
  ],
});

/** The tenant's customers, as the prefetch would have answered. */
const GUARDIANS: GuardianLookup = {
  byDocumentNumber: (value) => (value === "DOC-9" ? GUARDIAN : null),
  byContactValue: (kind, value) => {
    if (kind === "PHONE" && value === "0981123456") return GUARDIAN;
    if (kind === "EMAIL" && value === "ana@example.com") return GUARDIAN;
    return null;
  },
};

const ALL_COLUMNS = [
  "name",
  "species",
  "sex",
  "breed",
  "birth_date",
  "guardian_document",
  "guardian_phone",
  "guardian_email",
];

function layoutOf(headers: readonly string[]): PatientColumnLayout {
  const resolved = resolvePatientColumns(headers);
  if (!resolved.ok) {
    throw new Error(resolved.message);
  }
  return resolved.layout;
}

function verdictOf(headers: readonly string[], cells: readonly string[]) {
  return toPatientRow(cells, layoutOf(headers), { catalog: CATALOG.lookup, guardians: GUARDIANS });
}

/** The shape every accepted row has: the create payload, guardian included. */
function accepted(
  cells: readonly string[],
  headers: readonly string[] = ALL_COLUMNS
): { ok: true; input: Record<string, unknown> } {
  const result = verdictOf(headers, cells);
  if (!result.ok) {
    throw new Error(`expected an accepted row, got ${result.code}: ${result.message}`);
  }
  return result;
}

describe("toPatientRow", () => {
  it("accepts a row and carries the resolved species and the guardian's customer id", () => {
    const result = verdictOf(
      ["name", "species", "sex", "guardian_document"],
      ["Luna", "Dog", "FEMALE", "DOC-9"]
    );

    expect(result).toEqual({
      ok: true,
      input: {
        name: "Luna",
        speciesId: SPECIES_DOG,
        sex: "FEMALE",
        primaryGuardianCustomerId: GUARDIAN,
      },
    });
  });

  it("NEVER carries `isActive`: the import creates an active patient", () => {
    const { input } = accepted(["Luna", "dog", "FEMALE", "", "", "DOC-9", "", ""]);

    // The create contract's default is active, and an inactive patient would sidestep
    // the guardian requirement for a record that then cannot be used.
    expect(input).not.toHaveProperty("isActive");
    expect(createPatientBody.safeParse(input).success).toBe(true);
  });

  it("resolves a species by CODE first and then by NAME, case-insensitively", () => {
    const byCode = accepted(["Luna", "cat", "MALE", "", "", "DOC-9", "", ""]);
    const byName = accepted(["Luna", "Cat", "MALE", "", "", "DOC-9", "", ""]);
    const shouted = accepted(["Luna", "CAT", "MALE", "", "", "DOC-9", "", ""]);

    expect(byCode.input.speciesId).toBe(SPECIES_CAT);
    expect(byName.input.speciesId).toBe(SPECIES_CAT);
    expect(shouted.input.speciesId).toBe(SPECIES_CAT);
  });

  it("refuses an unknown species, naming the value", () => {
    const result = verdictOf(
      ["name", "species", "sex", "guardian_document"],
      ["Luna", "Dragon", "FEMALE", "DOC-9"]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.UNKNOWN_SPECIES);
    expect(result.message).toContain("Dragon");
    expect(result.message).toContain('"species"');
  });

  it("resolves a breed inside the species, and refuses one that belongs to another", () => {
    const labrador = accepted(["Luna", "dog", "FEMALE", "labrador", "", "DOC-9", "", ""]);
    expect(labrador.input.breedId).toBe(BREED_LABRADOR);

    const wrongSpecies = verdictOf(
      ["name", "species", "sex", "breed", "guardian_document"],
      ["Luna", "dog", "FEMALE", "Siamese", "DOC-9"]
    );

    expect(wrongSpecies.ok).toBe(false);
    if (wrongSpecies.ok) return;
    expect(wrongSpecies.code).toBe(PATIENT_ROW_REJECTION_CODES.UNKNOWN_BREED);
    expect(wrongSpecies.message).toContain("Siamese");
    // The message quotes the species the row DECLARED, as the operator wrote it.
    expect(wrongSpecies.message).toContain('"dog"');
  });

  it("case-folds `sex` because it is a closed vocabulary, and leaves a real misspelling to the schema", () => {
    expect(accepted(["Luna", "dog", "male", "", "", "DOC-9", "", ""]).input.sex).toBe("MALE");
    expect(accepted(["Luna", "dog", "Female", "", "", "DOC-9", "", ""]).input.sex).toBe("FEMALE");
    expect(accepted(["Luna", "dog", "unknown", "", "", "DOC-9", "", ""]).input.sex).toBe("UNKNOWN");

    // Only the CASE is folded: a value outside the three literals is handed to
    // `createPatientBody` and refused with the schema's own words.
    const misspelled = verdictOf(
      ["name", "species", "sex", "guardian_document"],
      ["Luna", "dog", "masculino", "DOC-9"]
    );
    expect(misspelled.ok).toBe(false);
    if (misspelled.ok) return;
    expect(misspelled.code).toBe(PATIENT_ROW_REJECTION_CODES.CREATE_CONTRACT);
    // The fold is CASE-ONLY, so the schema sees `MASCULINO` and names it in its own
    // message: nothing here decided that `masculino` meant something.
    expect(misspelled.message).toContain("MASCULINO");
    expect(misspelled.message).toContain("Invalid enum value");
  });

  it("pins `birth_date` to NOON UTC, so the tenant-local date is the date typed", () => {
    const { input } = accepted(["Luna", "dog", "FEMALE", "", "2021-04-09", "DOC-9", "", ""]);

    expect(input.birthDate).toBe("2021-04-09T12:00:00.000Z");
    // The point of noon: the instant's calendar date in the tenant's zone
    // (America/Asuncion, -03/-04) is the date the operator typed.
    expect(
      new Date(input.birthDate as string).toLocaleDateString("en-CA", {
        timeZone: "America/Asuncion",
      })
    ).toBe("2021-04-09");
  });

  it("refuses a `birth_date` the calendar does not have, instead of rolling it forward", () => {
    for (const value of ["2021-02-30", "2021-13-01", "21-04-09", "2021-4-9"]) {
      const result = verdictOf(
        ["name", "species", "sex", "birth_date", "guardian_document"],
        ["Luna", "dog", "FEMALE", value, "DOC-9"]
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.INVALID_BIRTH_DATE);
      expect(result.message).toContain("birth_date");
      // A birth date is CONFIDENTIAL: the message names the column, not the value.
      expect(result.message).not.toContain(value);
    }
  });

  it("accepts a valid calendar date, leap years included", () => {
    const { input } = accepted(["Luna", "dog", "FEMALE", "", "2024-02-29", "DOC-9", "", ""]);
    expect(input.birthDate).toBe("2024-02-29T12:00:00.000Z");
  });
});

describe("the guardian reference (DEC-070)", () => {
  it("resolves a DOCUMENT reference", () => {
    const { input } = accepted(["Luna", "dog", "FEMALE", "", "", "DOC-9", "", ""]);
    expect(input.primaryGuardianCustomerId).toBe(GUARDIAN);
  });

  it("resolves a PHONE reference", () => {
    const { input } = accepted(["Luna", "dog", "FEMALE", "", "", "", "0981123456", ""]);
    expect(input.primaryGuardianCustomerId).toBe(GUARDIAN);
  });

  it("resolves an EMAIL reference", () => {
    const { input } = accepted(["Luna", "dog", "FEMALE", "", "", "", "", "ana@example.com"]);
    expect(input.primaryGuardianCustomerId).toBe(GUARDIAN);
  });

  it("refuses a row with NO reference: it does not say who owns the pet", () => {
    const result = verdictOf(
      ["name", "species", "sex", "guardian_document", "guardian_phone", "guardian_email"],
      ["Luna", "dog", "FEMALE", "", "", ""]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.GUARDIAN_MISSING);
    expect(result.message).toContain("guardian_document");
  });

  it("refuses a file with no guardian column at all as a ROW error, not a file error", () => {
    // The header contract accepts it: three of the three guardian columns being absent
    // is a legal file whose rows are refused, which is the honest answer — the header
    // is not broken, the file simply does not say who owns the pets.
    const result = verdictOf(["name", "species", "sex"], ["Luna", "dog", "FEMALE"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.GUARDIAN_MISSING);
  });

  it("refuses TWO references as ambiguous: the import does not guess who owns the pet", () => {
    const result = verdictOf(
      ["name", "species", "sex", "guardian_document", "guardian_email"],
      ["Luna", "dog", "FEMALE", "DOC-9", "ana@example.com"]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.GUARDIAN_AMBIGUOUS);
    expect(result.message).toContain("guardian_document");
    expect(result.message).toContain("guardian_email");
  });

  it("refuses an unresolved reference with a code that names WHICH one failed", () => {
    const cases = [
      {
        headers: ["name", "species", "sex", "guardian_document"],
        cells: ["Luna", "dog", "FEMALE", "DOC-NOBODY"],
        code: PATIENT_ROW_REJECTION_CODES.GUARDIAN_DOCUMENT_UNRESOLVED,
        column: "guardian_document",
      },
      {
        headers: ["name", "species", "sex", "guardian_phone"],
        cells: ["Luna", "dog", "FEMALE", "0999999999"],
        code: PATIENT_ROW_REJECTION_CODES.GUARDIAN_PHONE_UNRESOLVED,
        column: "guardian_phone",
      },
      {
        headers: ["name", "species", "sex", "guardian_email"],
        cells: ["Luna", "dog", "FEMALE", "nobody@example.com"],
        code: PATIENT_ROW_REJECTION_CODES.GUARDIAN_EMAIL_UNRESOLVED,
        column: "guardian_email",
      },
    ] as const;

    for (const testCase of cases) {
      const result = verdictOf(testCase.headers, testCase.cells);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(testCase.code);
      expect(result.message).toContain(testCase.column);
      // The value is personal data: the message names the column and never the cell.
      expect(result.message).not.toContain(testCase.cells[3]);
    }
  });

  it("resolves a cross-tenant reference to NOTHING, which is the same row error", () => {
    // A lookup that only knows the OTHER tenant's customer answers null for everything:
    // the worker's queries carry the row's tenant, so a foreign customer is invisible.
    const foreignOnly: GuardianLookup = {
      byDocumentNumber: () => null,
      byContactValue: () => null,
    };

    const result = toPatientRow(
      ["Luna", "dog", "FEMALE", "DOC-9"],
      layoutOf(["name", "species", "sex", "guardian_document"]),
      { catalog: CATALOG.lookup, guardians: foreignOnly }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.GUARDIAN_DOCUMENT_UNRESOLVED);
    expect(OTHER_CUSTOMER).not.toBe(GUARDIAN);
  });
});

describe("validation parity with the create contract", () => {
  it("refuses a row `createPatientBody` refuses, with the SCHEMA's own message", () => {
    const tooLong = "L".repeat(201);

    const contract = createPatientBody.safeParse({
      name: tooLong,
      speciesId: SPECIES_DOG,
      sex: "FEMALE",
      primaryGuardianCustomerId: GUARDIAN,
    });
    expect(contract.success).toBe(false);
    if (contract.success) return;

    const result = verdictOf(
      ["name", "species", "sex", "guardian_document"],
      [tooLong, "dog", "FEMALE", "DOC-9"]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.CREATE_CONTRACT);
    expect(result.message).toContain(contract.error.issues[0].message);
    expect(result.message).toContain("name");
  });

  it("refuses a blank `name` with the schema's required-field message", () => {
    const result = verdictOf(
      ["name", "species", "sex", "guardian_document"],
      ["", "dog", "FEMALE", "DOC-9"]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(PATIENT_ROW_REJECTION_CODES.CREATE_CONTRACT);
    expect(result.message).toContain("name");
  });
});

describe("the patient row carries no second copy of a rule", () => {
  it("validates through `createPatientBody` and declares no rule of its own", async () => {
    const files = [
      "patient-row.ts",
      "patient-columns.ts",
      "patient-preview.ts",
      "patient-commit.ts",
      "patient-commit-writer.ts",
    ];
    const sources = await Promise.all(
      files.map((file) => readFile(new URL(`./${file}`, import.meta.url), "utf8"))
    );
    const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");

    const rowSource = sources[0];
    expect(rowSource).toContain('from "@newsaas/patients"');
    expect(rowSource).toContain("createPatientBody.safeParse");
    // The writer calls the DOMAIN, it does not write a patient table of its own.
    expect(sources[4]).toContain("createPatient(");

    // No schema of its own, no enum of its own, no length bound of its own — in any of
    // the five modules this entity added.
    for (const [index, source] of sources.entries()) {
      expect(source, files[index]).not.toMatch(/z\.(object|string|enum|discriminatedUnion)/);
      expect(source, files[index]).not.toMatch(/\.max\(\s*\d+\s*\)/);
      expect(source, files[index]).not.toMatch(/\.min\(\s*\d+\s*\)/);
      expect(source, files[index]).not.toContain('["MALE"');
      expect(source, files[index]).not.toContain('["FEMALE"');
    }

    const manifest = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
    // `zod` is not a dependency of this package: the schemas stay owned by the domains.
    expect(manifest.dependencies?.zod).toBeUndefined();
  });
});
