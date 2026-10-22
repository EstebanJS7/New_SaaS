/**
 * The NewSaaS import pipeline boundary (EPIC-19 [[IMP-002]]/[[IMP-004]]).
 *
 * It owns two things, and the second is the first one wired up:
 *
 * 1. Turning a CSV artefact into a VERDICT PER ROW without writing anything. The
 *    reader (`csv.ts`), the header resolver (`columns.ts`) and its two declarations
 *    (`customer-columns.ts`, `patient-columns.ts`), the two row contracts
 *    (`customer-row.ts`, `patient-row.ts`), the suspected-duplicate heuristic
 *    (`duplicates.ts`) and the two planners (`preview.ts`, `patient-preview.ts`) are
 *    pure functions over text and plain values.
 * 2. The PASS over that plan (`preview-runner.ts`), the COMMIT of an accepted plan
 *    (`commit-runner.ts`, [[IMP-003]]) and the transport that starts both
 *    (`queue.ts`, `queue.producer.ts`). Both runners are entity-agnostic orchestration:
 *    the database is a persistence interface, the object store is an artefact
 *    interface, the entity's rules are a PLANNER and the business write is a writer
 *    interface, all supplied by the caller — which is why "claim first" and the
 *    partial-success loop exist once for both entities ([[IMP-004]]).
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
 *   IMPORTED from `@newsaas/customers` and the patient rules from
 *   `@newsaas/patients` ([[DEC-073]]), so a row the import refuses is refused by
 *   `POST /customers` or `POST /patients` for the same reason.
 * - **No updates, no deletions.** Imports are create-only ([[DEC-069]]), and
 *   [[IMP-003]] owns committing a previewed file: the commit pass lives here too
 *   (`commit.ts`, `commit-runner.ts`, `commit-writer.ts`, and for patients
 *   `patient-commit.ts`, `patient-commit-writer.ts`), and it writes records by
 *   CALLING the owning domain, never by writing a table of its own.
 *
 * A suspected duplicate is a WARNING attached to a row and never a rule
 * ([[DEC-069]]): `suspectedDuplicate` is independent of `status`, a flagged row is
 * still `CREATE`, and nothing this package returns can change what the import
 * writes.
 */

export { IMPORT_AUDIT_ACTION, IMPORT_AUDIT_TARGET_TYPE } from "./audit.js";

export { CSV_REJECTION_CODES, parseCsv } from "./csv.js";
export type { CsvParseFailure, CsvParseResult, CsvParseSuccess, CsvRejectionCode } from "./csv.js";

export { normalizeHeader, readColumnCell, resolveColumns } from "./columns.js";
export type {
  ColumnContract,
  ColumnLayout,
  ColumnsFailure,
  ColumnsResult,
  ColumnsSuccess,
} from "./columns.js";

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

export {
  PATIENT_COLUMNS,
  PATIENT_COLUMNS_REJECTION_CODES,
  PATIENT_COLUMN_HEADERS,
  normalizePatientHeader,
  REQUIRED_PATIENT_COLUMNS,
  resolvePatientColumns,
} from "./patient-columns.js";
export type {
  PatientColumnDestination,
  PatientColumnHeader,
  PatientColumnLayout,
  PatientColumnsFailure,
  PatientColumnsRejectionCode,
  PatientColumnsResult,
  PatientColumnsSuccess,
} from "./patient-columns.js";

export { CUSTOMER_ROW_REJECTION_CODES, toCustomerRow } from "./customer-row.js";
export type {
  CustomerRowContact,
  CustomerRowFailure,
  CustomerRowRejectionCode,
  CustomerRowResult,
  CustomerRowSuccess,
} from "./customer-row.js";

export {
  createPatientCatalogIndex,
  PATIENT_ROW_REJECTION_CODES,
  toPatientRow,
} from "./patient-row.js";
export type {
  GuardianLookup,
  PatientBreedCatalogRow,
  PatientCatalogIndex,
  PatientCatalogLookup,
  PatientCatalogSnapshot,
  PatientRowContext,
  PatientRowFailure,
  PatientRowInput,
  PatientRowRejectionCode,
  PatientRowResult,
  PatientRowSuccess,
  PatientSpeciesCatalogRow,
} from "./patient-row.js";

export { detectSuspectedDuplicate } from "./duplicates.js";
export type { DuplicateLookup } from "./duplicates.js";

export { boundImportMessage, planFileRefusal, PREVIEW_MESSAGE_MAX_LENGTH } from "./plan.js";
export type {
  ImportFileError,
  ImportPayloadPlan,
  ImportPayloadPlanner,
  ImportPlan,
  ImportPlanner,
  ImportPreviewRow,
  ImportRowPayload,
} from "./plan.js";

export { planCustomerPreview } from "./preview.js";
export type {
  CustomerPreviewFileError,
  CustomerPreviewPlan,
  CustomerPreviewRow,
  PlanCustomerPreviewArgs,
} from "./preview.js";

export { planPatientPreview } from "./patient-preview.js";
export type { PlanPatientPreviewArgs } from "./patient-preview.js";

export {
  IMPORT_COMMIT_BACKOFF_DELAY_MS,
  IMPORT_COMMIT_JOB,
  IMPORT_COMMIT_MAX_ATTEMPTS,
  IMPORT_PREVIEW_BACKOFF_DELAY_MS,
  IMPORT_PREVIEW_JOB,
  IMPORT_PREVIEW_MAX_ATTEMPTS,
  IMPORT_PROCESSING_QUEUE,
  importCommitJobId,
  importCommitJobOptions,
  importPreviewJobId,
  importPreviewJobOptions,
} from "./queue.js";
export type { ImportCommitJob, ImportPreviewJob } from "./queue.js";

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
  runImportPreview,
} from "./preview-runner.js";
export type {
  PreviewArtefact,
  PreviewPersistence,
  PreviewRunOutcome,
  RunImportPreviewArgs,
} from "./preview-runner.js";

export { planCustomerCommit } from "./commit.js";
export type { CustomerCommitPlan, CustomerRowReady, PlanCustomerCommitArgs } from "./commit.js";

export { planPatientCommit } from "./patient-commit.js";
export type {
  PatientCommitPlan,
  PatientRowReady,
  PlanPatientCommitArgs,
} from "./patient-commit.js";

export {
  COMMIT_FAILURE_CODE,
  COMMIT_FAILURE_MESSAGE,
  COMMIT_FAILURE_REASON_MAX_LENGTH,
  COMMIT_NO_VALID_ROWS_CODE,
  COMMIT_NO_VALID_ROWS_MESSAGE,
  COMMIT_ROW_FAILURE_CODE,
  COMMIT_ROW_FAILURE_MESSAGE,
  runImportCommit,
} from "./commit-runner.js";
export type {
  CommitCounts,
  CommitPersistence,
  CommitRunOutcome,
  CommitWriter,
  RunImportCommitArgs,
  StoredOutcome,
} from "./commit-runner.js";

export { createCustomerCommitWriter } from "./commit-writer.js";
export type { CustomerCommitWriterArgs } from "./commit-writer.js";

export { createPatientCommitWriter } from "./patient-commit-writer.js";
export type { PatientCommitWriterArgs } from "./patient-commit-writer.js";

// Re-exported TYPES ONLY, so a caller implementing a `CommitWriter` (the worker) can
// name the client and audit handles `createCustomer`/`createPatient` declare without
// declaring a dependency on a package it only ever hands back to this one. The
// definitions stay owned by `@newsaas/customers` and `@newsaas/patients` — this is a
// pass-through, not a second one.
export type {
  CustomerAuditAppender,
  CustomerContactCreateDelegate,
  CustomerCreateDb,
  CustomerCreateDelegate,
  CustomerCreateTransaction,
} from "@newsaas/customers";
export type {
  PatientAuditAppender,
  PatientCatalog,
  PatientCustomerDelegate,
  PatientCreateDb,
  PatientCreateTransaction,
} from "@newsaas/patients";
