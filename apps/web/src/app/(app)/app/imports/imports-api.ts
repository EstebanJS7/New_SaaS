import type { QueryClient } from "@tanstack/react-query";

/**
 * The staff imports client ([[IMP-005]], EPIC-19).
 *
 * Deliberately NOT a `"use client"` module: it holds no component and no hook,
 * only DTO mirrors, pure path builders and the fetch functions the surfaces call,
 * so a test can import it without a React tree.
 *
 * ## What this module is
 *
 * A mirror of the API's imports response contract
 * (`apps/api/src/imports/imports.dto.ts`) plus the one place the web app turns a
 * selection into a URL. There is no shared package between `apps/api` and
 * `apps/web`, so the DTOs are restated here exactly, as `reports-api.ts` restates
 * the reporting document — a mirror is cheaper than a package and honest as long
 * as it is a MIRROR.
 *
 * ## The four rules this module keeps
 *
 * 1. **The UI computes no verdict.** Every state, count, reason code and message
 *    rendered anywhere on this surface came from the API. Nothing here derives a
 *    row's outcome, and nothing invents a phase: the two triggers take the state
 *    the API answered with (`PREVIEWING` / `COMMITTING`) because that literal is
 *    the API's own acceptance of the command, not a guess about the row.
 * 2. **The file is uploaded once.** Preview and commit are commands against the
 *    stored artefact, so neither of them carries bytes — the browser never
 *    re-uploads the file between them ([[DEC-072]]).
 * 3. **No request carries a tenant.** Every path here is tenant-free: the BFF
 *    refuses a `tenantId` query key outright and the API resolves the tenant from
 *    the forwarded session ([[DEC-072]]).
 * 4. **Counts and instants are printed, never reformatted.** `createdCount`,
 *    `failedCount` and `suspectedDuplicateCount` are numbers and `createdAt` is
 *    the API's ISO instant; the surface renders them as given.
 */

// ---------------------------------------------------------------------------
// Enumerations, mirrored from `imports.repository.ts`.
// ---------------------------------------------------------------------------

/** The two entities a file can name ([[IMP-004]]). Both are committable. */
export const IMPORT_ENTITIES = ["CUSTOMER", "PATIENT"] as const;

export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

/** Human labels for the selector and the history. Presentation only; never sent. */
export const IMPORT_ENTITY_LABELS: Readonly<Record<ImportEntity, string>> = {
  CUSTOMER: "Customers",
  PATIENT: "Patients",
};

/** Every lifecycle value, in the order the machine moves through them. */
export const IMPORT_JOB_STATES = [
  "UPLOADED",
  "PREVIEWING",
  "PREVIEWED",
  "COMMITTING",
  "COMMITTED",
  "FAILED",
  "EXPIRED",
] as const;

export type ImportJobState = (typeof IMPORT_JOB_STATES)[number];

/** The per-row verdict values: a row produced a record or it did not ([[DEC-071]]). */
export const IMPORT_ROW_STATUSES = ["CREATE", "FAILED"] as const;

export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

// ---------------------------------------------------------------------------
// Bounds and timing. Mirrored from `imports.zod.ts`; the API owns both ceilings.
// ---------------------------------------------------------------------------

/**
 * How often the detail screen re-reads an import while it is running.
 *
 * Polling is the consequence of [[DEC-072]] making every import asynchronous: a
 * trigger returns an accepted PHASE, and the row reaches it when the worker
 * claims it, so the surface watches instead of blocking. Two seconds is the
 * compromise between a preview that finishes in ~200ms feeling instant and a
 * long commit not hammering the API; it is also short enough that an operator
 * never wonders whether the page is alive.
 *
 * Exported and documented because a test needs to observe both halves of the
 * contract — that it polls, and that it STOPS — without waiting two seconds per
 * interval and without asserting on a wall clock.
 */
export const IMPORT_POLL_INTERVAL_MS = 2_000;

/**
 * The page size of the summary's row table: the API's own default (`limit`
 * defaults to 100) and well inside its 500-row ceiling.
 *
 * The table is BOUNDED by construction: a 5 000-row file is 5 000 stored
 * outcomes and exactly one page of them is rendered, so the surface never depends
 * on the file having been small ([[TD-026]], the Story's bounded-table criterion).
 */
export const IMPORT_SUMMARY_PAGE_SIZE = 100;

/** The summary's ceiling, mirrored so the surface cannot ask for more than it. */
export const IMPORT_SUMMARY_MAX_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Response DTOs, mirrored from `imports.dto.ts`.
// ---------------------------------------------------------------------------

/** One import job with its counters — `GET /imports/:id` and `GET /imports`. */
export interface ImportJob {
  readonly id: string;
  readonly entity: ImportEntity;
  readonly state: ImportJobState;
  readonly contentType: string;
  readonly byteSize: number;
  readonly createdCount: number;
  readonly failedCount: number;
  readonly suspectedDuplicateCount: number;
  readonly previewedAt: string | null;
  readonly committedAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
  readonly artefactExpiresAt: string;
  readonly artefactDeletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One row's verdict. There is deliberately no name, phone, e-mail or document
 * number here: the outcome is a verdict, and the payloads live in the records the
 * commit wrote ([[DEC-071]]).
 */
export interface ImportRowOutcome {
  readonly importId: string;
  readonly rowNumber: number;
  readonly status: ImportRowStatus;
  readonly reasonCode: string | null;
  readonly message: string | null;
  readonly suspectedDuplicate: boolean;
}

/** The page the summary answered with, echoed so a paged read can be reconciled. */
export interface ImportSummaryPage {
  readonly limit: number;
  readonly offset: number;
}

/** `GET /imports/:id/summary`: the totals for the WHOLE import plus one page. */
export interface ImportSummary {
  readonly importId: string;
  readonly state: ImportJobState;
  readonly totals: {
    readonly createdCount: number;
    readonly failedCount: number;
    readonly suspectedDuplicateCount: number;
  };
  readonly page: ImportSummaryPage;
  readonly rows: readonly ImportRowOutcome[];
}

/** `POST /imports`: an identifier to watch, never a result. */
export interface ImportUploadAccepted {
  readonly importId: string;
  readonly state: ImportJobState;
}

/**
 * The shape BOTH phase triggers answer with: the identifier and the phase the
 * command was accepted INTO.
 *
 * `state` is not a claim about the row — the worker's claim performs that
 * transition ([[DEC-072]]) — so the surface treats it as "the phase I am now
 * watching", never as the import's current state.
 */
export interface ImportPhaseAccepted {
  readonly importId: string;
  readonly state: "PREVIEWING" | "COMMITTING";
}

/** `POST /imports/:id/preview`: the phase the command was accepted INTO. */
export interface ImportPreviewAccepted extends ImportPhaseAccepted {
  readonly state: "PREVIEWING";
}

/** `POST /imports/:id/commit`: the phase the command was accepted INTO. */
export interface ImportCommitAccepted extends ImportPhaseAccepted {
  readonly state: "COMMITTING";
}

/**
 * The wire shape of the error envelope every API refusal uses. Parsed as
 * `unknown` and narrowed field by field — never cast to a DTO.
 */
interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ImportRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ImportRequestError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<ImportRequestError> {
  const raw: unknown = await response.json().catch(() => null);
  const envelope =
    typeof raw === "object" && raw !== null ? (raw as ApiErrorEnvelope) : ({} as ApiErrorEnvelope);
  return new ImportRequestError(
    envelope.error?.code ?? "UNKNOWN",
    envelope.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}

// ---------------------------------------------------------------------------
// Paths. One builder per route, so a URL is written once in the whole app.
// ---------------------------------------------------------------------------

/**
 * `GET /api/imports` — the history, oldest-last.
 *
 * The `entity` filter is the only parameter the surface sends: no `limit`, so the
 * list stays bounded by the API's own default page (50) instead of a size this
 * module would invent a second copy of.
 */
export function importListPath(entity: ImportEntity | ""): string {
  return entity === "" ? "/api/imports" : `/api/imports?entity=${encodeURIComponent(entity)}`;
}

/** `GET /api/imports/:id` — one import with its counters. */
export function importDetailPath(importId: string): string {
  return `/api/imports/${encodeURIComponent(importId)}`;
}

/** `GET /api/imports/:id/summary?limit=&offset=` — the stored row outcomes. */
export function importSummaryPath(importId: string, page: ImportSummaryPage): string {
  const params = new URLSearchParams({
    limit: String(page.limit),
    offset: String(page.offset),
  });
  return `/api/imports/${encodeURIComponent(importId)}/summary?${params.toString()}`;
}

/** `POST /api/imports/:id/preview` — the preview command. */
export function importPreviewPath(importId: string): string {
  return `/api/imports/${encodeURIComponent(importId)}/preview`;
}

/** `POST /api/imports/:id/commit` — the commit command. */
export function importCommitPath(importId: string): string {
  return `/api/imports/${encodeURIComponent(importId)}/commit`;
}

// ---------------------------------------------------------------------------
// Query keys, in one place so the surfaces and the invalidation agree.
// ---------------------------------------------------------------------------

/** The history's key, filtered by the entity the surface is showing. */
export function importsListQueryKey(entity: ImportEntity | ""): readonly unknown[] {
  return ["imports", "list", entity === "" ? "all" : entity];
}

/** One import's key. */
export function importDetailQueryKey(importId: string): readonly unknown[] {
  return ["imports", "detail", importId];
}

/**
 * One page of one import's summary.
 *
 * `state` is part of the key, and that is deliberate: the stored outcomes change
 * exactly when the import MOVES (`PREVIEWED` gains the preview's verdicts,
 * `COMMITTING` records the commit-time failures, a terminal state freezes them),
 * so a transition re-reads the summary instead of leaving a pre-transition page
 * on screen. Without it, an import previewed while the detail was open would keep
 * showing the empty page it read when it was still `UPLOADED`.
 */
export function importSummaryQueryKey(
  importId: string,
  page: ImportSummaryPage,
  state: ImportJobState | "UNKNOWN"
): readonly unknown[] {
  return ["imports", "summary", importId, state, page.limit, page.offset];
}

/**
 * Seeds the detail cache with the phase the API just ACCEPTED for `job`.
 *
 * A trigger answers `{ importId, state }` where `state` is the phase it queued —
 * not the row's current state, because the worker's claim performs that
 * transition ([[DEC-072]]). A read issued immediately after the trigger can
 * therefore still answer the PREVIOUS state, which would stop polling before it
 * started. Seeding the accepted phase makes the surface watch the import at once,
 * and the next poll replaces the seed with the row's own truth. Nothing is
 * invented: both the job and the phase are the API's own values.
 */
export function seedAcceptedPhase(
  client: QueryClient,
  job: ImportJob,
  accepted: ImportJobState
): void {
  client.setQueryData<ImportJob>(importDetailQueryKey(job.id), { ...job, state: accepted });
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/** Reads the caller tenant's imports, newest first. */
export async function fetchImports(entity: ImportEntity | ""): Promise<readonly ImportJob[]> {
  const response = await fetch(importListPath(entity), { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  // The mirror above is the contract this cast asserts; the BFF forwards the
  // API's own JSON unchanged, so the shape is the API's, not a copy of it.
  return (await response.json()) as readonly ImportJob[];
}

/** Reads one import. */
export async function fetchImport(importId: string): Promise<ImportJob> {
  const response = await fetch(importDetailPath(importId), { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ImportJob;
}

/** Reads one page of one import's stored row outcomes. */
export async function fetchImportSummary(
  importId: string,
  page: ImportSummaryPage
): Promise<ImportSummary> {
  const response = await fetch(importSummaryPath(importId, page), { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ImportSummary;
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

/**
 * Uploads one CSV artefact and creates the import job.
 *
 * The body is a `FormData` and the `content-type` header is deliberately NOT set:
 * the browser writes the multipart boundary, and the BFF relays the parsed form so
 * `fetch` writes a fresh one on the way to the API. The FILE is validated by the
 * API alone — size cap, CSV allowlist and the by-name spreadsheet refusal — which
 * is why an `.xlsx` here is not refused in the browser: its refusal is the
 * server's message, shown verbatim ([[DEC-068]]).
 */
export async function uploadImport(
  entity: ImportEntity,
  file: File
): Promise<ImportUploadAccepted> {
  const form = new FormData();
  form.set("entity", entity);
  form.set("file", file);

  const response = await fetch("/api/imports", { method: "POST", body: form });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ImportUploadAccepted;
}

/** Queues the preview of an uploaded import. */
export async function startImportPreview(importId: string): Promise<ImportPreviewAccepted> {
  const response = await fetch(importPreviewPath(importId), { method: "POST" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ImportPreviewAccepted;
}

/** Queues the commit of a previewed import. */
export async function startImportCommit(importId: string): Promise<ImportCommitAccepted> {
  const response = await fetch(importCommitPath(importId), { method: "POST" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ImportCommitAccepted;
}

// ---------------------------------------------------------------------------
// Errors, as the surfaces show them.
// ---------------------------------------------------------------------------

/** True when the failure was an authorization gate rather than the data. */
export function isImportAccessDenied(error: Error | null): boolean {
  return (
    error instanceof ImportRequestError &&
    (error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED")
  );
}

/**
 * The sentence a surface shows for a failed read or a refused command.
 *
 * An upload's refusals — the spreadsheet, the wrong content type, the size cap,
 * the entity field — return the API's OWN message verbatim. That sentence is the
 * explanation ("Spreadsheet uploads are not supported: export the data as
 * CSV..."), so this surface must not paraphrase it into "Something went wrong",
 * and it must not restate the rule as a client-side check either: the accepted
 * format is stated next to the picker, and WHICH formats are accepted is the
 * server's answer.
 */
export function userFacingImportError(error: Error): string {
  if (!(error instanceof ImportRequestError)) {
    return "The request could not reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to work with imports.";
    case "FORBIDDEN":
      return "You do not have permission to work with imports.";
    default:
      return error.message;
  }
}
