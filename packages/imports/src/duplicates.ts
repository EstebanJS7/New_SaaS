/**
 * The suspected-duplicate heuristic (EPIC-19 [[IMP-002]], [[DEC-069]]).
 *
 * WHAT "DUPLICATE" MEANS HERE: **suspected**, and only suspected. `customer` has
 * no natural unique key in this database — the only unique index on the table is
 * `(tenant_id, id)`, `document_number` is nullable and non-unique, and
 * `customer_contact` has no unique index — so "does this row describe a customer
 * that already exists?" has NO authoritative answer an import could compute.
 * This function is a best-effort answer, and [[DEC-069]] says a best-effort
 * answer must never be a rule.
 *
 * WHY THE ASYMMETRY IS ACCEPTABLE: a false POSITIVE costs one warning nobody
 * acts on, while a false NEGATIVE costs nothing beyond a created record the
 * summary still reports as created. There is no silent data loss either way —
 * which is exactly why the heuristic may be wrong, and why it is stated as
 * suspected in the message and in the summary rather than as a fact.
 *
 * IT CAN NEVER CHANGE WHAT THE IMPORT WRITES. It returns a boolean; no caller is
 * told to skip a row, and a test asserts that a flagged row is still `CREATE`, so
 * a later "optimization" that turns the warning into a skip fails a test instead
 * of dropping a legitimate customer.
 *
 * THE LOOKUP IS AN INTERFACE, NOT A QUERY. This package is pure: it holds no
 * Prisma client, no connection and no tenant. The caller supplies a lookup that
 * is already scoped to the tenant it resolved from the `import_job` row, and this
 * module never sees a tenant id at all — so it cannot forget to pass one.
 */

import type { CreateCustomerInput } from "@newsaas/customers";
import type { CustomerRowContact } from "./customer-row.js";

/**
 * The existing-record questions the heuristic asks, already tenant-scoped by the
 * caller.
 *
 * Both methods answer "does ANY row in this tenant match?", so the answer is
 * exact about that and silent about everything else: it cannot say how many, and
 * it cannot say which. An import never updates or deletes anything ([[DEC-069]]),
 * so nothing more is ever needed.
 */
export interface DuplicateLookup {
  existsByDocumentNumber(tenantScopedValue: string): boolean;
  existsByContactValue(kind: "PHONE" | "EMAIL", value: string): boolean;
}

/**
 * Answers whether the row LOOKS like a record that already exists.
 *
 * Document number first — it is the strongest signal an import can compare, and a
 * row that matches on it does not need the contact lookups — then the row's
 * primary contact values.
 *
 * A row with no document number and no contact cannot be detected at all by this
 * heuristic. That is a documented limit, not an oversight: the same name spelled
 * two ways is not a duplicate anybody can prove.
 */
export function detectSuspectedDuplicate(
  contacts: readonly CustomerRowContact[],
  input: CreateCustomerInput,
  lookup: DuplicateLookup
): boolean {
  // Only the INDIVIDUAL branch of the create contract carries a document number;
  // the COMPANY branch has `taxId` instead, which has no comparable unique
  // meaning here ([[DEC-069]] — no natural key).
  if (
    input.kind === "INDIVIDUAL" &&
    input.documentNumber !== undefined &&
    lookup.existsByDocumentNumber(input.documentNumber)
  ) {
    return true;
  }

  return contacts.some((contact) => lookup.existsByContactValue(contact.kind, contact.value));
}
