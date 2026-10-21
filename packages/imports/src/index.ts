/**
 * The NewSaaS import pipeline boundary (EPIC-19 [[IMP-002]]).
 *
 * It owns one thing: turning a CSV artefact into a VERDICT PER ROW without
 * writing anything. The reader (`csv.ts`), the customer header contract
 * (`customer-columns.ts`), the row verdict (`customer-row.ts`), the
 * suspected-duplicate heuristic (`duplicates.ts`) and the planner (`preview.ts`)
 * are all pure functions over text and plain values.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN, each for a reason:
 *
 * - **No queue and no worker.** Triggering an import and consuming it is
 *   [[DEC-072]]'s pipeline in the `worker` deployable; this package is the part
 *   that can be unit-tested without either.
 * - **No persistence and no database.** A preview's only durable artefact is one
 *   `import_row_outcome` per row ([[DEC-071]]), and the caller writes it. This
 *   package holds no client and no connection.
 * - **No HTTP.** There is no `DomainError` from `@newsaas/shared` here either:
 *   every refusal is a STABLE CODE the caller maps to its own surface, because
 *   this code runs in a worker with no request and no status to answer with.
 * - **No validation rule of its own.** The customer and contact rules are
 *   IMPORTED from `@newsaas/customers` ([[DEC-073]]), so a row the import refuses
 *   is refused by `POST /customers` for the same reason.
 * - **No updates and no deletions.** Imports are create-only ([[DEC-069]]), so
 *   there is no update path to own.
 *
 * A suspected duplicate is a WARNING attached to a row and never a rule
 * ([[DEC-069]]): `suspectedDuplicate` is independent of `status`, a flagged row is
 * still `CREATE`, and nothing this package returns can change what the import
 * writes.
 */

export { CSV_REJECTION_CODES, parseCsv } from "./csv.js";
export type { CsvParseFailure, CsvParseResult, CsvParseSuccess, CsvRejectionCode } from "./csv.js";

export {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMNS_REJECTION_CODES,
  CUSTOMER_COLUMN_HEADERS,
  normalizeCustomerHeader,
  REQUIRED_CUSTOMER_COLUMNS,
  resolveCustomerColumns,
} from "./customer-columns.js";
export type {
  CustomerColumnDestination,
  CustomerColumnHeader,
  CustomerColumnLayout,
  CustomerColumnsFailure,
  CustomerColumnsRejectionCode,
  CustomerColumnsResult,
  CustomerColumnsSuccess,
} from "./customer-columns.js";

export { CUSTOMER_ROW_REJECTION_CODES, toCustomerRow } from "./customer-row.js";
export type {
  CustomerRowContact,
  CustomerRowFailure,
  CustomerRowRejectionCode,
  CustomerRowResult,
  CustomerRowSuccess,
} from "./customer-row.js";

export { detectSuspectedDuplicate } from "./duplicates.js";
export type { DuplicateLookup } from "./duplicates.js";

export { planCustomerPreview, PREVIEW_MESSAGE_MAX_LENGTH } from "./preview.js";
export type {
  CustomerPreviewFileError,
  CustomerPreviewPlan,
  CustomerPreviewRow,
  PlanCustomerPreviewArgs,
} from "./preview.js";
