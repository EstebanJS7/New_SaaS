/**
 * One CSV row's verdict (EPIC-19 [[IMP-002]]).
 *
 * THE ROW IS VALIDATED BY THE SAME SCHEMA THE ENDPOINT USES. `createCustomerBody`
 * and `createCustomerContactBody` are IMPORTED from `@newsaas/customers`
 * ([[DEC-073]]); this module contains no length, enum, pattern or conditional
 * rule of its own. That is not a style preference — [[IMP-002]]'s acceptance
 * criterion is that "a row rejected by the import is rejected by the endpoint
 * with the same reason", which can only hold if there is one rule, and a row
 * refused here surfaces the schema's OWN message so the two really are the same
 * sentence.
 *
 * WHAT THIS MODULE ADDS, and nothing more: the mapping of cells to payload keys
 * (a blank cell is ABSENT, never `""` or `undefined`), the `kind` default, and
 * the one refusal the schema cannot express on its own — the kind/company-field
 * conflict below.
 *
 * CELLS ARE TRIMMED, by the shared reader (`columns.ts`'s `readColumnCell`), and a
 * blank cell is ABSENT rather than `""`. Leading and trailing whitespace in a CSV
 * cell is an artefact of the export in essentially every case, and
 * `createCustomerBody`'s `min(1)` would otherwise accept a `display_name` of three
 * spaces as a name.
 *
 * `kind` IS NOT CASE-FOLDED. The cell is handed to the create contract
 * unchanged, so the contract's enum decides: `company` is refused with the enum's
 * own message rather than quietly becoming `COMPANY`. Folding case here would
 * make the import accept a value `POST /customers` refuses — a second, weaker
 * rule, which is the thing this module exists not to have.
 */

import { createCustomerBody, createCustomerContactBody } from "@newsaas/customers";
import type { CreateCustomerInput } from "@newsaas/customers";
import { readColumnCell } from "./columns.js";
import type { CustomerColumnLayout } from "./customer-columns.js";

/** Stable reason codes the caller maps to its own surface. Never re-worded in place. */
export const CUSTOMER_ROW_REJECTION_CODES = {
  /** `kind` is absent/INDIVIDUAL but the row carries a company's legal name or tax id. */
  KIND_CONFLICT: "CUSTOMER_ROW_KIND_CONFLICT",
  /** The assembled payload failed `createCustomerBody`. */
  CREATE_CONTRACT: "CUSTOMER_ROW_INVALID",
  /** The `phone` cell failed `createCustomerContactBody`. */
  INVALID_PHONE: "CUSTOMER_ROW_INVALID_PHONE",
  /** The `email` cell failed `createCustomerContactBody`. */
  INVALID_EMAIL: "CUSTOMER_ROW_INVALID_EMAIL",
} as const;

export type CustomerRowRejectionCode =
  (typeof CUSTOMER_ROW_REJECTION_CODES)[keyof typeof CUSTOMER_ROW_REJECTION_CODES];

/**
 * The primary contact a row asks to create.
 *
 * Deliberately NOT `CreateCustomerContactInput`: a row creates a PRIMARY contact
 * from a column and never sets a label, so the narrower shape is what the row
 * can honestly produce. The `value` carried here is the one
 * `createCustomerContactBody` accepted, not the raw cell.
 */
export interface CustomerRowContact {
  readonly kind: "PHONE" | "EMAIL";
  readonly value: string;
  readonly isPrimary: true;
}

export interface CustomerRowSuccess {
  readonly ok: true;
  /** Exactly what `createCustomer` takes; validated, never re-derived. */
  readonly input: CreateCustomerInput;
  /** Zero, one or two contacts, in the order phone then e-mail. */
  readonly contacts: CustomerRowContact[];
}

export interface CustomerRowFailure {
  readonly ok: false;
  readonly code: CustomerRowRejectionCode;
  /** Bounded, human readable, and safe to surface to an operator. */
  readonly message: string;
}

export type CustomerRowResult = CustomerRowSuccess | CustomerRowFailure;

/**
 * Turns one row's cells into a create payload.
 *
 * THE CONFLICT RULE. `legalName`/`taxId` belong to the COMPANY branch of the
 * create contract. When `kind` is absent or `INDIVIDUAL` and either of those
 * cells carries a value, the row is REFUSED — it is not coerced to `INDIVIDUAL`
 * (the payload would be refused by the strict schema anyway, but with a message
 * about an unrecognized key rather than about the operator's mistake) and it is
 * not coerced to `COMPANY` (that would create a company record out of a row that
 * never said it was one, and the person's own `display_name` would silently
 * become a legal name).
 *
 * The reverse direction — a COMPANY row carrying `first_name`, `last_name` or
 * `document_number` — is refused by `createCustomerBody` itself (each branch is
 * `.strict()`), so this module does not restate it.
 */
export function toCustomerRow(
  cells: readonly string[],
  layout: CustomerColumnLayout
): CustomerRowResult {
  const displayName = readColumnCell(cells, layout, "displayName");
  const kindCell = readColumnCell(cells, layout, "kind");
  const firstName = readColumnCell(cells, layout, "firstName");
  const lastName = readColumnCell(cells, layout, "lastName");
  const documentNumber = readColumnCell(cells, layout, "documentNumber");
  const legalName = readColumnCell(cells, layout, "legalName");
  const taxId = readColumnCell(cells, layout, "taxId");

  const effectiveKind = kindCell ?? "INDIVIDUAL";

  if (effectiveKind === "INDIVIDUAL") {
    const carried = [
      legalName === undefined ? undefined : "legal_name",
      taxId === undefined ? undefined : "tax_id",
    ].filter((name): name is string => name !== undefined);

    if (carried.length > 0) {
      const kindText =
        kindCell === undefined
          ? 'The "kind" column is absent, so the row is an INDIVIDUAL'
          : 'The "kind" column says INDIVIDUAL';
      const carriedText = carried.join(" and ");
      return {
        ok: false,
        code: CUSTOMER_ROW_REJECTION_CODES.KIND_CONFLICT,
        message: `${kindText}, but the row carries ${carriedText}. An individual record cannot hold a company's legal name or tax id: set "kind" to COMPANY, or clear ${carriedText}.`,
      };
    }
  }

  // Only DEFINED values are put into the payload. The create schema is strict,
  // and a key present with an `undefined` value is a different payload from an
  // absent key — it would be reported as an unrecognized key on the branch that
  // does not own it (e.g. `firstName` on a COMPANY row).
  const candidate: Record<string, string | undefined> = {
    kind: effectiveKind,
    displayName,
    firstName,
    lastName,
    documentNumber,
    legalName,
    taxId,
  };

  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  const parsedCustomer = createCustomerBody.safeParse(payload);
  if (!parsedCustomer.success) {
    const issue = parsedCustomer.error.issues[0];
    const path = issue.path.join(".");
    return {
      ok: false,
      code: CUSTOMER_ROW_REJECTION_CODES.CREATE_CONTRACT,
      message: `The row does not satisfy the customer create contract: ${path.length > 0 ? `${path}: ` : ""}${issue.message}`,
    };
  }

  const contacts: CustomerRowContact[] = [];

  const phone = readColumnCell(cells, layout, "phone");
  if (phone !== undefined) {
    const parsedPhone = createCustomerContactBody.safeParse({
      kind: "PHONE",
      value: phone,
      isPrimary: true,
    });
    if (!parsedPhone.success) {
      const issue = parsedPhone.error.issues[0];
      return {
        ok: false,
        code: CUSTOMER_ROW_REJECTION_CODES.INVALID_PHONE,
        message: `The "phone" column is not a valid contact value: ${issue.path.join(".")}: ${issue.message}`,
      };
    }
    contacts.push({ kind: "PHONE", value: parsedPhone.data.value, isPrimary: true });
  }

  const email = readColumnCell(cells, layout, "email");
  if (email !== undefined) {
    const parsedEmail = createCustomerContactBody.safeParse({
      kind: "EMAIL",
      value: email,
      isPrimary: true,
    });
    if (!parsedEmail.success) {
      const issue = parsedEmail.error.issues[0];
      return {
        ok: false,
        code: CUSTOMER_ROW_REJECTION_CODES.INVALID_EMAIL,
        message: `The "email" column is not a valid contact value: ${issue.path.join(".")}: ${issue.message}`,
      };
    }
    contacts.push({ kind: "EMAIL", value: parsedEmail.data.value, isPrimary: true });
  }

  return { ok: true, input: parsedCustomer.data, contacts };
}
