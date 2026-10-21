/**
 * The NewSaaS import pipeline boundary (EPIC-19 [[IMP-002]]).
 *
 * It owns two things, and the second is the first one wired up:
 *
 * 1. Turning a CSV artefact into a VERDICT PER ROW without writing anything. The
 *    reader (`csv.ts`), the customer header contract (`customer-columns.ts`), the
 *    row verdict (`customer-row.ts`), the suspected-duplicate heuristic
 *    (`duplicates.ts`) and the planner (`preview.ts`) are pure functions over text
 *    and plain values.
 * 2. The PASS over that plan (`preview-runner.ts`) and the transport that starts it
 *    (`queue.ts`, `queue.producer.ts`). The runner is still orchestration only: the
 *    database is a `PreviewPersistence` and the object store is a
 *    `PreviewArtefact`, both supplied by the caller.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN, each for a reason:
 *
 * - **No database.** A preview's only durable artefact is one `import_row_outcome`
 *   per row ([[DEC-071]]), and the caller writes it: the runner holds no client
 *   and no connection, and the `PreviewPersistence` it takes is three methods
 *   wide.
 * - **No HTTP.** There is no `DomainError` from `@newsaas/shared` here either:
 *   every refusal is a STABLE CODE the caller maps to its own surface, because
 *   this code runs in a worker with no request and no status to answer with.
 * - **No Nest.** The producer is a plain class the API module provides through a
 *   factory; Nest still calls its `onModuleDestroy` hook on shutdown because the
 *   hook is looked up by name on the instance. Keeping the package
 *   framework-free is what lets the worker, the API and a test all use it.
 * - **No validation rule of its own.** The customer and contact rules are
 *   IMPORTED from `@newsaas/customers` ([[DEC-073]]), so a row the import refuses
 *   is refused by `POST /customers` for the same reason.
 * - **No updates, no deletions and no commit.** Imports are create-only
 *   ([[DEC-069]]), and [[IMP-003]] owns committing a previewed file.
 *
 * A suspected duplicate is a WARNING attached to a row and never a rule
 * ([[DEC-069]]): `suspectedDuplicate` is independent of `status`, a flagged row is
 * still `CREATE`, and nothing this package returns can change what the import
 * writes.
 */

export { IMPORT_AUDIT_ACTION, IMPORT_AUDIT_TARGET_TYPE } from "./audit.js";

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

export {
  IMPORT_PREVIEW_BACKOFF_DELAY_MS,
  IMPORT_PREVIEW_JOB,
  IMPORT_PREVIEW_MAX_ATTEMPTS,
  IMPORT_PROCESSING_QUEUE,
  importPreviewJobId,
  importPreviewJobOptions,
} from "./queue.js";
export type { ImportPreviewJob } from "./queue.js";

export {
  BullMqImportPreviewProducer,
  createBullMqImportPreviewProducer,
  IMPORT_PREVIEW_ENQUEUE_TIMEOUT_MS,
  IMPORT_PREVIEW_PRODUCER,
  IMPORT_PREVIEW_PRODUCER_REDIS_OPTIONS,
} from "./queue.producer.js";
export type { ImportPreviewProducer } from "./queue.producer.js";

export {
  PREVIEW_FAILURE_CODE,
  PREVIEW_FAILURE_MESSAGE,
  PREVIEW_FAILURE_REASON_MAX_LENGTH,
  runCustomerPreview,
} from "./preview-runner.js";
export type {
  PreviewArtefact,
  PreviewPersistence,
  PreviewRunOutcome,
  RunCustomerPreviewArgs,
} from "./preview-runner.js";
