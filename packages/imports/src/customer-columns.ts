/**
 * The customer header contract (EPIC-19 [[IMP-002]]).
 *
 * ONE DECLARATION, ONE HOME: {@link CUSTOMER_COLUMNS} is the whole contract — a
 * record from a NORMALIZED header to the field it fills. Nothing else in the
 * repository may re-state which columns an imported customer file carries, and
 * nothing may add a column by accepting it silently.
 *
 * STRICT ABOUT HEADERS, deliberately: an unknown column is a refusal, not a
 * skip. This repository is strict everywhere else for the same reason — a column
 * that is silently ignored is data the operator exported, believed was imported
 * and never sees again. A duplicate is a refusal for the mirror reason: two
 * columns mapping to one field has no defined winner, and picking the first is
 * an invisible policy.
 *
 * HEADER NORMALIZATION: trim, collapse internal whitespace runs to `_`, and
 * lowercase. So `Display Name`, ` display  name ` and `DISPLAY_NAME` are the same
 * column. Order in the file is irrelevant — matching is by name, so a
 * spreadsheet that re-ordered the columns imports exactly the same.
 */

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

/**
 * Where each contract field sits in one file.
 *
 * `index` carries a column position only for the fields the file actually
 * carries, which is what lets the row contract distinguish "absent column" from
 * "empty cell": both become `undefined`, but a missing `legal_name` column and an
 * empty `legal_name` cell are the same thing to the row, by design.
 */
export interface CustomerColumnLayout {
  /** The normalized header per file column, in file order. */
  readonly headers: string[];
  readonly index: Partial<Record<CustomerColumnDestination, number>>;
}

export interface CustomerColumnsSuccess {
  readonly ok: true;
  readonly layout: CustomerColumnLayout;
}

export interface CustomerColumnsFailure {
  readonly ok: false;
  readonly code: CustomerColumnsRejectionCode;
  readonly message: string;
}

export type CustomerColumnsResult = CustomerColumnsSuccess | CustomerColumnsFailure;

/** Trim, collapse internal whitespace runs to `_`, lowercase. */
export function normalizeCustomerHeader(header: string): string {
  return header.trim().replace(/\s+/g, "_").toLowerCase();
}

/**
 * Resolves one file's headers against the contract.
 *
 * Duplicate first, then unknown, then missing: a duplicated required column is
 * reported as a duplicate (the actionable fact), and an unknown column is
 * reported before a missing one because removing the stray column is what an
 * operator does first — the missing `display_name` is usually the same mistake.
 */
export function resolveCustomerColumns(headers: readonly string[]): CustomerColumnsResult {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const header of headers) {
    const key = normalizeCustomerHeader(header);
    if (seen.has(key)) {
      return {
        ok: false,
        code: CUSTOMER_COLUMNS_REJECTION_CODES.DUPLICATE_HEADER,
        message: `The file has two columns that normalize to "${key}". Keep one of them.`,
      };
    }
    seen.add(key);
    normalized.push(key);
  }

  const index: Partial<Record<CustomerColumnDestination, number>> = {};

  for (const [column, key] of normalized.entries()) {
    const destination = Object.hasOwn(CUSTOMER_COLUMNS, key)
      ? CUSTOMER_COLUMNS[key as CustomerColumnHeader]
      : undefined;
    if (destination === undefined) {
      return {
        ok: false,
        code: CUSTOMER_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER,
        message: `The file has a column this import does not understand: "${key}". Accepted columns are: ${CUSTOMER_COLUMN_HEADERS.join(", ")}.`,
      };
    }
    index[destination] = column;
  }

  for (const required of REQUIRED_CUSTOMER_COLUMNS) {
    if (!seen.has(required)) {
      return {
        ok: false,
        code: CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER,
        message: `The file has no "${required}" column, which every imported customer needs.`,
      };
    }
  }

  return { ok: true, layout: { headers: normalized, index } };
}
