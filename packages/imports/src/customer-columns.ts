/**
 * The customer header contract (EPIC-19 [[IMP-002]]).
 *
 * ONE DECLARATION, ONE HOME: {@link CUSTOMER_COLUMNS} is the whole contract — a
 * record from a NORMALIZED header to the field it fills. Nothing else in the
 * repository may re-state which columns an imported customer file carries, and
 * nothing may add a column by accepting it silently.
 *
 * THE RESOLVER IS NOT HERE. The three refusals (unknown, duplicate, missing) and the
 * normalization rule live in `columns.ts`, which shipped with this contract and was
 * shared with [[IMP-004]]'s patient contract rather than copied. This module is the
 * declaration plus the names this entity's callers already use.
 */

import { normalizeHeader, resolveColumns } from "./columns.js";
import type {
  ColumnContract,
  ColumnLayout,
  ColumnsFailure,
  ColumnsResult,
  ColumnsSuccess,
} from "./columns.js";

/**
 * The field a column fills.
 *
 * `phone` and `email` are CONTACT fields, not customer columns: a valid row
 * creates a primary `customer_contact` from each (see `customer-row.ts`). They
 * belong to the same contract because they arrive in the same file and an
 * operator needs one place to read what the columns are.
 */
export type CustomerColumnDestination =
  | "displayName"
  | "kind"
  | "firstName"
  | "lastName"
  | "documentNumber"
  | "legalName"
  | "taxId"
  | "phone"
  | "email";

/**
 * THE CONTRACT. Normalized header → destination field.
 *
 * Required: `display_name` only — it is the one field the create contract needs
 * for both kinds (`createCustomerBody`: `displayName`, 1..200).
 * Optional: everything else. `kind` defaults to `INDIVIDUAL` (blank or absent),
 * and a customer with no contact and no address is valid ([[IMP-002]]).
 */
export const CUSTOMER_COLUMNS = {
  display_name: "displayName",
  kind: "kind",
  first_name: "firstName",
  last_name: "lastName",
  document_number: "documentNumber",
  legal_name: "legalName",
  tax_id: "taxId",
  phone: "phone",
  email: "email",
} as const satisfies Record<string, CustomerColumnDestination>;

export type CustomerColumnHeader = keyof typeof CUSTOMER_COLUMNS;

/**
 * The headers every file must carry. Derived FROM the contract above rather than
 * typed again, so a second list cannot drift from it.
 */
export const REQUIRED_CUSTOMER_COLUMNS: readonly CustomerColumnHeader[] = ["display_name"];

/** Every accepted header, in contract order, for the refusal messages. */
export const CUSTOMER_COLUMN_HEADERS: readonly CustomerColumnHeader[] = Object.keys(
  CUSTOMER_COLUMNS
) as CustomerColumnHeader[];

/** Stable reason codes the caller maps to its own surface. Never re-worded in place. */
export const CUSTOMER_COLUMNS_REJECTION_CODES = {
  /** A column is not part of the contract. */
  UNKNOWN_HEADER: "CUSTOMER_HEADER_UNKNOWN",
  /** Two columns normalize to the same header. */
  DUPLICATE_HEADER: "CUSTOMER_HEADER_DUPLICATE",
  /** A required column is absent. */
  MISSING_REQUIRED_HEADER: "CUSTOMER_HEADER_REQUIRED_MISSING",
} as const;

export type CustomerColumnsRejectionCode =
  (typeof CUSTOMER_COLUMNS_REJECTION_CODES)[keyof typeof CUSTOMER_COLUMNS_REJECTION_CODES];

/** Where each contract field sits in one file. */
export type CustomerColumnLayout = ColumnLayout<CustomerColumnDestination>;

export type CustomerColumnsSuccess = ColumnsSuccess<CustomerColumnDestination>;
export type CustomerColumnsFailure = ColumnsFailure<CustomerColumnsRejectionCode>;
export type CustomerColumnsResult = ColumnsResult<
  CustomerColumnDestination,
  CustomerColumnsRejectionCode
>;

/**
 * This entity's declaration, in the shape the shared resolver takes.
 *
 * `requiredSubject` is the noun the missing-column message names, so a customer
 * file and a patient file get the same sentence with the entity's own word in it.
 */
const CUSTOMER_COLUMN_CONTRACT: ColumnContract<
  CustomerColumnDestination,
  CustomerColumnsRejectionCode
> = {
  columns: CUSTOMER_COLUMNS,
  required: REQUIRED_CUSTOMER_COLUMNS,
  requiredSubject: "customer",
  codes: {
    unknown: CUSTOMER_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER,
    duplicate: CUSTOMER_COLUMNS_REJECTION_CODES.DUPLICATE_HEADER,
    missingRequired: CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER,
  },
};

/** Trim, collapse internal whitespace runs to `_`, lowercase. */
export function normalizeCustomerHeader(header: string): string {
  return normalizeHeader(header);
}

/** Resolves one customer file's headers against the contract above. */
export function resolveCustomerColumns(headers: readonly string[]): CustomerColumnsResult {
  return resolveColumns(headers, CUSTOMER_COLUMN_CONTRACT);
}
