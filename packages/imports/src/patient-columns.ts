/**
 * The patient header contract (EPIC-19 [[IMP-004]]).
 *
 * ONE DECLARATION, ONE HOME, and the SAME RESOLVER the customer contract uses
 * (`columns.ts`): normalization, the duplicate check, the unknown-column check and
 * the missing-required check are not restated here. What differs is the set of
 * columns and the fact that this entity's guardian reference is not a plain field —
 * see below.
 *
 * REQUIRED headers: `name`, `species`, `sex`. Those three are what
 * `createPatientBody` needs on every row (`name` 1..200, `speciesId` a catalog id,
 * `sex` one of three values); the file names a species by CODE OR NAME and a sex by
 * word, and `patient-row.ts` resolves both before the create contract sees them.
 *
 * THE GUARDIAN REFERENCE IS A COLUMN GROUP, NOT A COLUMN: exactly one of
 * `guardian_document`, `guardian_phone`, `guardian_email` must be filled on every
 * row, and none of the three is individually required. So a file with no guardian
 * column is a legal FILE whose every row is refused, which is what the row contract
 * reports — a file-level refusal would tell the operator their header is broken when
 * the real mistake is that the file does not say who owns the pets ([[DEC-070]]).
 *
 * OPTIONAL headers: `breed`, `birth_date`. A patient without a breed and without a
 * known birth date is a valid patient.
 */

import { normalizeHeader, resolveColumns } from "./columns.js";
import type {
  ColumnContract,
  ColumnLayout,
  ColumnsFailure,
  ColumnsResult,
  ColumnsSuccess,
} from "./columns.js";

/** The field a column fills. */
export type PatientColumnDestination =
  | "name"
  | "species"
  | "sex"
  | "breed"
  | "birthDate"
  | "guardianDocument"
  | "guardianPhone"
  | "guardianEmail";

/**
 * THE CONTRACT. Normalized header → destination field.
 *
 * `species` and `breed` carry the OPERATOR'S WORD, not a UUID: resolving a word to a
 * global catalog id is the row contract's job (`patient-row.ts`), and keeping the
 * file's shape human-typed is what makes the preview's error messages nameable.
 */
export const PATIENT_COLUMNS = {
  name: "name",
  species: "species",
  sex: "sex",
  breed: "breed",
  birth_date: "birthDate",
  guardian_document: "guardianDocument",
  guardian_phone: "guardianPhone",
  guardian_email: "guardianEmail",
} as const satisfies Record<string, PatientColumnDestination>;

export type PatientColumnHeader = keyof typeof PATIENT_COLUMNS;

/**
 * The headers every file must carry. Derived FROM the contract above rather than
 * typed again, so a second list cannot drift from it.
 *
 * The guardian columns are deliberately NOT here: exactly one of them must be
 * FILLED on each row, which the row contract decides, and listing any of them as
 * required would refuse a file that references guardians by a different one.
 */
export const REQUIRED_PATIENT_COLUMNS: readonly PatientColumnHeader[] = ["name", "species", "sex"];

/** Every accepted header, in contract order, for the refusal messages. */
export const PATIENT_COLUMN_HEADERS: readonly PatientColumnHeader[] = Object.keys(
  PATIENT_COLUMNS
) as PatientColumnHeader[];

/** Stable reason codes the caller maps to its own surface. Never re-worded in place. */
export const PATIENT_COLUMNS_REJECTION_CODES = {
  /** A column is not part of the contract. */
  UNKNOWN_HEADER: "PATIENT_HEADER_UNKNOWN",
  /** Two columns normalize to the same header. */
  DUPLICATE_HEADER: "PATIENT_HEADER_DUPLICATE",
  /** A required column is absent. */
  MISSING_REQUIRED_HEADER: "PATIENT_HEADER_REQUIRED_MISSING",
} as const;

export type PatientColumnsRejectionCode =
  (typeof PATIENT_COLUMNS_REJECTION_CODES)[keyof typeof PATIENT_COLUMNS_REJECTION_CODES];

/** Where each contract field sits in one file. */
export type PatientColumnLayout = ColumnLayout<PatientColumnDestination>;

export type PatientColumnsSuccess = ColumnsSuccess<PatientColumnDestination>;
export type PatientColumnsFailure = ColumnsFailure<PatientColumnsRejectionCode>;
export type PatientColumnsResult = ColumnsResult<
  PatientColumnDestination,
  PatientColumnsRejectionCode
>;

/** This entity's declaration, in the shape the shared resolver takes. */
const PATIENT_COLUMN_CONTRACT: ColumnContract<
  PatientColumnDestination,
  PatientColumnsRejectionCode
> = {
  columns: PATIENT_COLUMNS,
  required: REQUIRED_PATIENT_COLUMNS,
  requiredSubject: "patient",
  codes: {
    unknown: PATIENT_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER,
    duplicate: PATIENT_COLUMNS_REJECTION_CODES.DUPLICATE_HEADER,
    missingRequired: PATIENT_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER,
  },
};

/** Trim, collapse internal whitespace runs to `_`, lowercase. */
export function normalizePatientHeader(header: string): string {
  return normalizeHeader(header);
}

/** Resolves one patient file's headers against the contract above. */
export function resolvePatientColumns(headers: readonly string[]): PatientColumnsResult {
  return resolveColumns(headers, PATIENT_COLUMN_CONTRACT);
}
