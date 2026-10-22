import {
  IMPORT_JOB_STATES,
  type ImportJobState,
  type ImportRowOutcome,
  type ImportSummaryPage,
  type ImportSummary,
} from "./imports-api";

/**
 * The imports surface's presentation rules, as pure functions ([[IMP-005]]).
 *
 * Everything here is a decision the two screens would otherwise each take
 * separately — which phase polls, which state has a next action, what a warning
 * SAYS — so the history and the detail cannot drift apart on the same import. No
 * function reads a verdict: the state, the counters and every row outcome are the
 * API's values, and this module only decides how to label them.
 *
 * Kept free of React and of `"use client"` so a test asserts the rules directly
 * instead of through a rendered tree.
 */

/**
 * The permission that reveals the upload form and the preview/commit commands.
 *
 * `imports.run` and not `imports.read`, because these are the actions that create
 * hundreds of records in one go (the module doc's table). UX only: the API
 * re-checks it on every trigger and on the upload, so a browser that rendered the
 * button anyway still gets a `403`.
 */
export const IMPORTS_RUN_PERMISSION = "imports.run";

/** The permission that reveals the history and one import's detail. UX only. */
export const IMPORTS_READ_PERMISSION = "imports.read";

/** True only for one of the seven lifecycle tokens. */
export function isImportJobState(value: unknown): value is ImportJobState {
  return typeof value === "string" && (IMPORT_JOB_STATES as readonly string[]).includes(value);
}

/**
 * The states that are IN FLIGHT, and therefore the only ones worth polling.
 *
 * Deliberately two literals rather than "not terminal": a `PREVIEWED` import is
 * waiting for an OPERATOR, not for a worker, so polling it would be a request per
 * interval that can never change. The dependency is the worker's claim
 * (`UPLOADED → PREVIEWING`, `PREVIEWED → COMMITTING`), and only those two phases
 * have one ([[DEC-072]]).
 */
const POLLING_STATES: ReadonlySet<ImportJobState> = new Set<ImportJobState>([
  "PREVIEWING",
  "COMMITTING",
]);

/** The states a finished import rests in; no command leaves one ([[DEC-071]]). */
const TERMINAL_STATES: ReadonlySet<ImportJobState> = new Set<ImportJobState>([
  "COMMITTED",
  "FAILED",
  "EXPIRED",
]);

/** True while a worker is expected to move the import. */
export function isPollingImportState(state: ImportJobState | undefined): boolean {
  return state !== undefined && POLLING_STATES.has(state);
}

/** True when the import has ended, successfully or not. */
export function isTerminalImportState(state: ImportJobState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * The interval to poll at, or `false` to stop — the exact pair TanStack Query's
 * `refetchInterval` consumes.
 *
 * Returning `false` at every other state is what CLEARS the timer: the surface
 * watches an import while it runs and stops the moment it stops, so a `PREVIEWED`
 * or `COMMITTED` row costs no further request. This is the whole polling contract
 * (the Story's "does not poll forever"), and it is a pure function so the stop is
 * provable without rendering anything.
 */
export function pollIntervalForState(
  state: ImportJobState | undefined,
  intervalMs: number
): number | false {
  return isPollingImportState(state) ? intervalMs : false;
}

/**
 * The command the state is waiting for, if any.
 *
 * `UPLOADED` can be previewed and `PREVIEWED` can be committed. Everything else
 * has NO next action: a phase already running is waited on, and a terminal import
 * has no exit — a re-run is a new upload, not a command on this one.
 */
export function nextImportAction(state: ImportJobState): "preview" | "commit" | null {
  switch (state) {
    case "UPLOADED":
      return "preview";
    case "PREVIEWED":
      return "commit";
    case "PREVIEWING":
    case "COMMITTING":
    case "COMMITTED":
    case "FAILED":
    case "EXPIRED":
      return null;
  }
}

/**
 * The sentence the live region announces while an import runs, or `null`.
 *
 * It states what the OPERATOR is waiting for, and it names the polling explicitly
 * — "watching for changes" — because the screen is deliberately not blocking. The
 * region disappears at a terminal state: the outcome is then the screen's subject,
 * not a progress notice.
 */
export function importPhaseNotice(state: ImportJobState | undefined): string | null {
  switch (state) {
    case "PREVIEWING":
      return "Previewing the file. Watching for changes...";
    case "COMMITTING":
      return "Committing the accepted rows. Watching for changes...";
    case "UPLOADED":
    case "PREVIEWED":
    case "COMMITTED":
    case "FAILED":
    case "EXPIRED":
    case undefined:
      return null;
  }
}

/**
 * What a row's `suspectedDuplicate` flag SAYS, in words.
 *
 * This is the Story's accessible-text requirement made concrete: a suspected
 * duplicate is a WARNING on a row that was still created, so it must read as one
 * rather than as a red cell. The distinction from an error is therefore in the
 * text itself — an errored row carries status `FAILED` and its reason code, a
 * flagged row carries status `CREATE` and this sentence — and a reader who cannot
 * see colour still learns two different facts. [[DEC-069]]: the record is created
 * and the suspicion is reported, never acted on.
 */
export function importRowWarningText(suspectedDuplicate: boolean): string {
  return suspectedDuplicate ? "Suspected duplicate (warning)" : "";
}

/**
 * The reason a row did not produce a record, as the table prints it.
 *
 * The status carries the verdict and the reason code plus message carry the why;
 * an accepted row has neither and prints an em dash rather than the word "null".
 */
export function importRowReasonText(row: ImportRowOutcome): string {
  return row.reasonCode ?? "—";
}

/** The supplementary sentence a row carries, or an em dash when it has none. */
export function importRowMessageText(row: ImportRowOutcome): string {
  return row.message ?? "—";
}

/**
 * How many row outcomes the summary has in total.
 *
 * The two counters are the API's own, written by the transition that produced
 * them, and every data row the preview saw has exactly one outcome — so this is
 * the stored row count, and it is only ever used to bound the pager. It is NOT a
 * recomputation of any verdict: no row is counted here, and the totals shown on
 * screen are printed from `totals` unchanged.
 */
export function summaryRowTotal(totals: ImportSummary["totals"]): number {
  return totals.createdCount + totals.failedCount;
}

/**
 * The page's own caption: which stored rows are on screen, out of how many.
 *
 * An empty import says so instead of printing "Rows 1–0 of 0", because a range
 * that runs backwards is a defect in the caption and not a fact about the file.
 */
export function summaryPageLabel(
  page: ImportSummaryPage,
  totals: ImportSummary["totals"],
  visibleRowCount: number
): string {
  const total = summaryRowTotal(totals);
  if (total === 0) {
    return "No row outcomes are stored for this import.";
  }
  const first = visibleRowCount === 0 ? 0 : page.offset + 1;
  const last = page.offset + visibleRowCount;
  return `Rows ${String(first)}–${String(last)} of ${String(total)}`;
}

/**
 * Whether an action guarded by `required` may be shown.
 *
 * `undefined` means the surface was not told the caller's claims, so the action is
 * shown and the API stays authoritative — the convention the reports workspace,
 * the clinical records surface and the staff nav already use. An explicit list
 * without the key HIDES it (the Story asks for hidden, not disabled), and the
 * backend refuses regardless: this is UX, never authorization.
 */
export function permissionGranted(
  permissions: readonly string[] | undefined,
  required: string
): boolean {
  return permissions === undefined || permissions.includes(required);
}
