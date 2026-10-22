/**
 * One patient CSV row's verdict (EPIC-19 [[IMP-004]]).
 *
 * THE ROW IS VALIDATED BY THE SAME SCHEMA THE ENDPOINT USES. `createPatientBody` is
 * IMPORTED from `@newsaas/patients`; this module contains no length, enum or
 * conditional rule of its own for the patient contract. A patient's `name` is
 * 1..200 because the shared schema says so, `sex` is one of three literals because
 * the shared schema says so, and an ACTIVE patient needs a primary guardian because
 * the shared schema says so (Decision #2223) — a row refused here is refused by
 * `POST /patients` with the same sentence.
 *
 * WHAT THIS MODULE ADDS, and nothing more:
 *
 * 1. **The mapping of cells to payload keys**, where a blank cell is ABSENT.
 * 2. **The guardian reference** ([[DEC-070]]): exactly one of three columns names an
 *    EXISTING customer of this tenant, resolved through a prefetched
 *    {@link GuardianLookup}. None, two, or an unresolvable one is a ROW error and
 *    nothing is created — the import never invents a guardian.
 * 3. **The catalog resolution**: a human-typed `species`/`breed` word becomes a
 *    GLOBAL catalog id, by `code` first and then by `name`, case-insensitively.
 * 4. **The birth-date conversion**: a calendar date becomes the instant the create
 *    contract expects, pinned to NOON UTC (see {@link toCalendarDateInstant}).
 * 5. **The `sex` case fold** (see {@link foldSex}).
 *
 * `isActive` IS NEVER TAKEN FROM THE FILE. The import creates ACTIVE patients —
 * the file describes a live pet, and an inactive patient would sidestep the guardian
 * requirement for a record that then cannot be used — so the create contract's
 * default applies and the guardian reference is mandatory for every row. A column
 * that let the file deactivate a patient would be a column that lets a file opt out
 * of the ownership rule.
 */

import { createPatientBody } from "@newsaas/patients";
import type { CreatePatientInput, PatientCatalog } from "@newsaas/patients";
import { readColumnCell } from "./columns.js";
import type { PatientColumnDestination, PatientColumnLayout } from "./patient-columns.js";

/** Stable reason codes the caller maps to its own surface. Never re-worded in place. */
export const PATIENT_ROW_REJECTION_CODES = {
  /** No guardian column carries a value: the row does not say who owns the pet. */
  GUARDIAN_MISSING: "PATIENT_ROW_GUARDIAN_MISSING",
  /** More than one guardian column carries a value: the import must not guess. */
  GUARDIAN_AMBIGUOUS: "PATIENT_ROW_GUARDIAN_AMBIGUOUS",
  /** The `guardian_document` value names no customer of this tenant. */
  GUARDIAN_DOCUMENT_UNRESOLVED: "PATIENT_ROW_GUARDIAN_DOCUMENT_UNRESOLVED",
  /** The `guardian_phone` value names no customer of this tenant. */
  GUARDIAN_PHONE_UNRESOLVED: "PATIENT_ROW_GUARDIAN_PHONE_UNRESOLVED",
  /** The `guardian_email` value names no customer of this tenant. */
  GUARDIAN_EMAIL_UNRESOLVED: "PATIENT_ROW_GUARDIAN_EMAIL_UNRESOLVED",
  /** `species` names no entry of the GLOBAL catalog. */
  UNKNOWN_SPECIES: "PATIENT_ROW_UNKNOWN_SPECIES",
  /** `breed` is not a breed of the species the row declares. */
  UNKNOWN_BREED: "PATIENT_ROW_UNKNOWN_BREED",
  /** `birth_date` is not a calendar date the Gregorian calendar has. */
  INVALID_BIRTH_DATE: "PATIENT_ROW_INVALID_BIRTH_DATE",
  /** The assembled payload failed `createPatientBody`. */
  CREATE_CONTRACT: "PATIENT_ROW_INVALID",
} as const;

export type PatientRowRejectionCode =
  (typeof PATIENT_ROW_REJECTION_CODES)[keyof typeof PATIENT_ROW_REJECTION_CODES];

/**
 * The existing-customer questions a patient row asks, already tenant-scoped by the
 * caller.
 *
 * A PREFETCH, for the same reason `DuplicateLookup` is one: the row contract is a
 * pure function and cannot await, so a database-backed lookup must already hold its
 * answers by the time planning starts. The worker reads every reference value the
 * FILE carries in bounded batches and answers from two maps.
 *
 * A CROSS-TENANT REFERENCE RESOLVES TO NOTHING, because the caller's queries carry
 * the ROW's tenant explicitly. That is the same `404`-shaped answer a foreign id
 * gets elsewhere: a patient linked to another tenant's customer must be impossible,
 * not merely unlikely.
 */
export interface GuardianLookup {
  /** The customer of THIS tenant whose document number is exactly `value`. */
  byDocumentNumber(value: string): string | null;
  /** The customer of THIS tenant carrying this `(kind, value)` contact. */
  byContactValue(kind: "PHONE" | "EMAIL", value: string): string | null;
}

/** One GLOBAL `species` row, as the row contract matches it. */
export interface PatientSpeciesCatalogRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** One GLOBAL `breed` row. A breed belongs to exactly one species. */
export interface PatientBreedCatalogRow {
  readonly id: string;
  readonly speciesId: string;
  readonly code: string;
  readonly name: string;
}

/**
 * The whole GLOBAL taxonomy, as the worker reads it in ONE prefetch.
 *
 * It is a snapshot rather than two delegates because the resolution rule below is
 * pure: a file resolves the same way against the same rows, whether they came from
 * PostgreSQL a moment ago or from a test's array.
 */
export interface PatientCatalogSnapshot {
  readonly species: readonly PatientSpeciesCatalogRow[];
  readonly breeds: readonly PatientBreedCatalogRow[];
}

/**
 * How a human-typed catalog word becomes a GLOBAL catalog id.
 *
 * Two methods, not four: the "by code, then by name, case-insensitively" rule is
 * this module's, so a caller cannot implement it a little differently.
 */
export interface PatientCatalogLookup {
  /** The species id this word names, or `null`. */
  speciesByValue(value: string): string | null;
  /** The breed id this word names WITHIN the resolved species, or `null`. */
  breedByValue(speciesId: string, value: string): string | null;
}

/**
 * The prefetched taxonomy, in the two shapes the two callers need.
 *
 * `lookup` resolves the FILE's words; `catalog` is what `createPatient` validates
 * the resulting ids against. Both come from the ONE snapshot, so the worker needs
 * one query and the create path re-checks the id it is about to write against the
 * same global rows the row was resolved from.
 */
export interface PatientCatalogIndex {
  readonly lookup: PatientCatalogLookup;
  /** The `PatientCatalog` `createPatient` takes, over the same snapshot. */
  readonly catalog: PatientCatalog;
}

interface SpeciesIndex {
  readonly byCode: Map<string, string>;
  readonly byName: Map<string, string>;
  readonly ids: Set<string>;
}

/** Case-insensitive `code`/`name` indexes; `code` wins when a row has both. */
function indexSpecies(rows: readonly PatientSpeciesCatalogRow[]): SpeciesIndex {
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.id);
    byCode.set(row.code.toLowerCase(), row.id);
    // First wins: `code` is the catalog's stable natural key and `name` is not
    // unique by constraint, so a name collision is settled by the caller's order
    // (the worker reads the catalog ordered by name) rather than by chance.
    if (!byName.has(row.name.toLowerCase())) byName.set(row.name.toLowerCase(), row.id);
  }
  return { byCode, byName, ids };
}

/** The same indexes, per species, for the breeds that species owns. */
function indexBreeds(rows: readonly PatientBreedCatalogRow[]): Map<string, SpeciesIndex> {
  const bySpecies = new Map<string, PatientBreedCatalogRow[]>();
  for (const row of rows) {
    const group = bySpecies.get(row.speciesId);
    if (group === undefined) bySpecies.set(row.speciesId, [row]);
    else group.push(row);
  }
  const index = new Map<string, SpeciesIndex>();
  for (const [speciesId, group] of bySpecies) index.set(speciesId, indexSpecies(group));
  return index;
}

/**
 * Builds the prefetched taxonomy from the GLOBAL catalog rows.
 *
 * Matching is EXACT after lowercasing and trimming both sides: a code or a name is a
 * catalog key, not free text, so `"dog"` and `"Dog"` are the same species while
 * `"dog "` becomes the same species only because the surrounding whitespace of the
 * cell is not part of the value.
 */
export function createPatientCatalogIndex(snapshot: PatientCatalogSnapshot): PatientCatalogIndex {
  const species = indexSpecies(snapshot.species);
  const breeds = indexBreeds(snapshot.breeds);

  const lookup: PatientCatalogLookup = {
    speciesByValue: (value) => {
      const key = value.trim().toLowerCase();
      return species.byCode.get(key) ?? species.byName.get(key) ?? null;
    },
    breedByValue: (speciesId, value) => {
      const index = breeds.get(speciesId);
      if (index === undefined) return null;
      const key = value.trim().toLowerCase();
      return index.byCode.get(key) ?? index.byName.get(key) ?? null;
    },
  };

  return {
    lookup,
    catalog: {
      species: {
        findFirst: ({ where }) =>
          Promise.resolve(species.ids.has(where.id) ? { id: where.id } : null),
      },
      breed: {
        findFirst: ({ where }) =>
          Promise.resolve(
            breeds.get(where.speciesId)?.ids.has(where.id) === true ? { id: where.id } : null
          ),
      },
    },
  };
}

/**
 * Exactly what `createPatient` takes, with the guardian REQUIRED.
 *
 * `CreatePatientInput` declares `primaryGuardianCustomerId` optional because an
 * explicitly inactive patient may omit it; a row of this import always carries a
 * resolved one, so the payload type says so and a caller cannot hand the writer a
 * patient without an owner.
 */
export type PatientRowInput = CreatePatientInput & {
  readonly primaryGuardianCustomerId: string;
};

/** Everything a row needs that the file cannot answer by itself. */
export interface PatientRowContext {
  readonly catalog: PatientCatalogLookup;
  readonly guardians: GuardianLookup;
}

export interface PatientRowSuccess {
  readonly ok: true;
  /** Exactly what `createPatient` takes; validated, never re-derived. */
  readonly input: PatientRowInput;
}

export interface PatientRowFailure {
  readonly ok: false;
  readonly code: PatientRowRejectionCode;
  /** Bounded, human readable, and safe to surface to an operator. */
  readonly message: string;
}

export type PatientRowResult = PatientRowSuccess | PatientRowFailure;

/**
 * The ceiling for a value quoted back in a message. A species or breed word is the
 * operator's own text and naming it is the point of the refusal, but one paste-bomb
 * cell must not become the whole message, and a newline in a quoted cell must not
 * break the row report it lands in.
 */
const QUOTED_VALUE_MAX_LENGTH = 60;

/** Collapsed, bounded and quoted: enough to find the cell, never a payload. */
function quoted(value: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  const bounded =
    flattened.length <= QUOTED_VALUE_MAX_LENGTH
      ? flattened
      : `${flattened.slice(0, QUOTED_VALUE_MAX_LENGTH - 1)}…`;
  return `"${bounded}"`;
}

/**
 * The instant a calendar date is stored as: **noon UTC** of that date.
 *
 * WHY NOON AND NOT MIDNIGHT, the same reason the clinical surface pins its due dates
 * to noon (`apps/web/.../clinical-records.tsx`, [[DEC-065]]): a birth date is a
 * CALENDAR DATE, and the surfaces that read it classify it by the tenant-local day.
 * Midnight UTC lands at 21:00 of the PREVIOUS tenant day in `America/Asuncion`
 * (-03), so a pet born on the 18th would be reported as born on the 17th. Twelve
 * hours of margin on both sides keeps the tenant-local calendar date equal to the
 * date the operator typed for any tenant offset in `(-12, +12)`.
 *
 * WHY THE BROWSER'S CLOCK IS NOT CONSULTED: the file carries a date, not an instant.
 * Parsing `2026-10-19` with `new Date(...)` would read it as UTC midnight and
 * formatting it locally would move it a day; pinning the text to noon UTC keeps the
 * conversion a pure function of the cell.
 *
 * A day the Gregorian calendar does not have (`2026-02-30`, `2026-13-01`) is REFUSED
 * rather than rolled forward: `Date.UTC` would silently turn it into the 2nd of
 * March, which is a birth date nobody wrote. The round-trip through `Date` is what
 * catches it, including the years `Date.UTC` maps into the 1900s.
 */
function toCalendarDateInstant(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const [, year, month, day] = match;
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    probe.getUTCFullYear() !== Number(year) ||
    probe.getUTCMonth() !== Number(month) - 1 ||
    probe.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return `${value}T12:00:00.000Z`;
}

/**
 * Folds a `sex` cell into the create contract's own vocabulary.
 *
 * WHY THIS IS CASE-FOLDED WHILE `kind` IS NOT (`customer-row.ts`): `sex` is a CLOSED
 * domain vocabulary of three values that means the same thing in every case — nobody
 * types `MALE` on a spreadsheet, and refusing `male` would refuse the file an
 * operator actually has. `kind` is not folded because `INDIVIDUAL`/`COMPANY` is a
 * business classification whose misspelling is a mistake worth naming. What is
 * folded is only the CASE: a value outside the three literals is handed to
 * `createPatientBody` unchanged and refused with the schema's own message.
 */
function foldSex(value: string): string {
  return value.toUpperCase();
}

interface GuardianReference {
  readonly column: PatientColumnDestination;
  readonly label: string;
  readonly kind: "DOCUMENT" | "PHONE" | "EMAIL";
  readonly value: string;
  readonly unresolvedCode: PatientRowRejectionCode;
}

function guardianReference(
  cells: readonly string[],
  layout: PatientColumnLayout,
  destination: PatientColumnDestination,
  label: string,
  kind: GuardianReference["kind"],
  unresolvedCode: PatientRowRejectionCode
): GuardianReference | undefined {
  const value = readColumnCell(cells, layout, destination);
  if (value === undefined) return undefined;
  return { column: destination, label, kind, value, unresolvedCode };
}

/**
 * Turns one row's cells into a create payload, or refuses it.
 *
 * THE ORDER IS THE CONTRACT, and each step's reason:
 *
 * 1. **The guardian reference.** It decides who owns the record, it is the one thing
 *    a patients file cannot infer, and an unresolvable owner makes every other
 *    answer about a record that will not exist moot ([[DEC-070]]).
 * 2. **The species, then the breed**, because a breed is only meaningful within the
 *    species the same row declares.
 * 3. **The birth date**, because the kind of value it must be (a calendar date on
 *    disk, an instant on the wire) is this module's conversion, not the schema's.
 * 4. **`createPatientBody`**, the last word on everything else.
 */
export function toPatientRow(
  cells: readonly string[],
  layout: PatientColumnLayout,
  context: PatientRowContext
): PatientRowResult {
  const references = [
    guardianReference(
      cells,
      layout,
      "guardianDocument",
      "guardian_document",
      "DOCUMENT",
      PATIENT_ROW_REJECTION_CODES.GUARDIAN_DOCUMENT_UNRESOLVED
    ),
    guardianReference(
      cells,
      layout,
      "guardianPhone",
      "guardian_phone",
      "PHONE",
      PATIENT_ROW_REJECTION_CODES.GUARDIAN_PHONE_UNRESOLVED
    ),
    guardianReference(
      cells,
      layout,
      "guardianEmail",
      "guardian_email",
      "EMAIL",
      PATIENT_ROW_REJECTION_CODES.GUARDIAN_EMAIL_UNRESOLVED
    ),
  ].filter((reference): reference is GuardianReference => reference !== undefined);

  if (references.length === 0) {
    return {
      ok: false,
      code: PATIENT_ROW_REJECTION_CODES.GUARDIAN_MISSING,
      message:
        'The row does not say who owns this patient. Fill exactly one of "guardian_document", "guardian_phone" or "guardian_email" with a customer that already exists in this tenant.',
    };
  }

  if (references.length > 1) {
    const carried = references.map((reference) => `"${reference.label}"`).join(" and ");
    return {
      ok: false,
      code: PATIENT_ROW_REJECTION_CODES.GUARDIAN_AMBIGUOUS,
      message: `The row carries ${carried}, so it names more than one guardian. Keep exactly one: this import does not guess which customer owns the patient.`,
    };
  }

  const reference = references[0];
  const guardianCustomerId =
    reference.kind === "DOCUMENT"
      ? context.guardians.byDocumentNumber(reference.value)
      : context.guardians.byContactValue(reference.kind, reference.value);

  if (guardianCustomerId === null) {
    // The reference's VALUE is never quoted: a document number, a phone number and
    // an e-mail address are personal data, and the row number plus the column name
    // is everything an operator needs to find the cell.
    return {
      ok: false,
      code: reference.unresolvedCode,
      message: `The "${reference.label}" value matches no customer in this tenant. Import the customer first, or correct the reference.`,
    };
  }

  const speciesValue = readColumnCell(cells, layout, "species");
  let speciesId: string | undefined;

  if (speciesValue !== undefined) {
    const resolved = context.catalog.speciesByValue(speciesValue);
    if (resolved === null) {
      return {
        ok: false,
        code: PATIENT_ROW_REJECTION_CODES.UNKNOWN_SPECIES,
        message: `The "species" value ${quoted(speciesValue)} is not in the species catalog. Use a species code or name the catalog knows.`,
      };
    }
    speciesId = resolved;
  }

  const breedValue = readColumnCell(cells, layout, "breed");
  let breedId: string | undefined;

  // A breed only means something inside a species, so a row whose `species` cell is
  // blank or unknown is refused by the branch above and never reaches this one.
  if (breedValue !== undefined && speciesValue !== undefined && speciesId !== undefined) {
    const resolved = context.catalog.breedByValue(speciesId, breedValue);
    if (resolved === null) {
      return {
        ok: false,
        code: PATIENT_ROW_REJECTION_CODES.UNKNOWN_BREED,
        message: `The "breed" value ${quoted(breedValue)} is not a breed of the species ${quoted(speciesValue)}. A breed must belong to the species the row declares.`,
      };
    }
    breedId = resolved;
  }

  const birthDateValue = readColumnCell(cells, layout, "birthDate");
  let birthDate: string | undefined;

  if (birthDateValue !== undefined) {
    const instant = toCalendarDateInstant(birthDateValue);
    if (instant === null) {
      return {
        ok: false,
        code: PATIENT_ROW_REJECTION_CODES.INVALID_BIRTH_DATE,
        message:
          'The "birth_date" cell is not a calendar date. Write the date as YYYY-MM-DD, for example 2024-03-17.',
      };
    }
    birthDate = instant;
  }

  const sexValue = readColumnCell(cells, layout, "sex");

  // Only DEFINED values are put into the payload: the create schema is strict, and a
  // blank cell means the file carried no value, not an empty string. A blank `name`,
  // `species` or `sex` therefore reaches the schema as an ABSENCE and is refused by
  // the schema's own required-field message.
  const candidate: Record<string, string | undefined> = {
    name: readColumnCell(cells, layout, "name"),
    speciesId,
    breedId,
    sex: sexValue === undefined ? undefined : foldSex(sexValue),
    birthDate,
    primaryGuardianCustomerId: guardianCustomerId,
  };

  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value !== undefined) payload[key] = value;
  }

  const parsed = createPatientBody.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    return {
      ok: false,
      code: PATIENT_ROW_REJECTION_CODES.CREATE_CONTRACT,
      message: `The row does not satisfy the patient create contract: ${path.length > 0 ? `${path}: ` : ""}${issue.message}`,
    };
  }

  return {
    ok: true,
    input: { ...parsed.data, primaryGuardianCustomerId: guardianCustomerId },
  };
}
