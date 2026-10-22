/**
 * The preview pass over one stored artefact (EPIC-19 [[IMP-002]], generalised by
 * [[IMP-004]]).
 *
 * ONE PASS, EVERY ENTITY. The file's entity decides only WHICH PLANNER runs
 * (`plan: ImportPlanner` — the customer planner, the patient planner, or anything
 * that returns a verdict per row); the claim, the file-refusal handling, the settle
 * and the failure path below are the same code for all of them. That is deliberate
 * and it is the whole of [[IMP-004]]'s generalisation: two runners would be two
 * chances for "claim first" or "a refused file writes no rows" to hold for one
 * entity and not the other.
 *
 * ORCHESTRATION ONLY. This module knows the ORDER the steps must happen in and
 * nothing about how any of them is done: the database is a `PreviewPersistence`, the
 * object store is a `PreviewArtefact`, and the entity's rules are its `ImportPlanner`.
 * So the package still needs neither Prisma, nor storage, nor a queue, and the worker
 * that supplies all three can be tested without a database.
 *
 * THE ORDER IS THE CONTRACT, and one line of it matters more than the rest:
 *
 * ```text
 * claim()  →  read artefact  →  plan(artefact)  →  complete(rows) | fail(reason)
 * ```
 *
 * `claim()` FIRST, AND NOTHING TOUCHED WHEN IT REFUSES. `UPLOADED → PREVIEWING` is
 * a compare-and-swap the caller performs; `false` means another runner won the
 * row, or its state already moved. A replayed job or a lost race therefore writes
 * no second set of outcomes, and returns `SKIPPED` rather than pretending to have
 * previewed anything. Every line after the claim runs only when this runner owns
 * the phase.
 *
 * A CLAIM MUST NEVER BE LEFT DANGLING SILENTLY. Once claimed, the row is
 * `PREVIEWING` and `claim` can never take it again — so a path that throws out of
 * here without settling would leave an import that no operator can retry and no
 * state machine can advance. That is why a thrown error is turned into
 * `fail(...)` + return `"FAILED"` rather than propagating: the row states what
 * happened, the queue stops retrying something that can never succeed, and the
 * reason names the failure without quoting the file.
 *
 * THE ONE RESIDUAL CASE, stated rather than hidden: a process killed mid-run — a
 * restart, an OOM kill, a reschedule — leaves the row `PREVIEWING` with no writer,
 * because no code ran to settle it. Nothing in this unit recovers it; a recovery
 * sweep and the `EXPIRED` transition the TTL sweep already performs are what an
 * operator has until then.
 *
 * THE FAILURE REASON NEVER CARRIES ROW CONTENT. A file-level refusal stores the
 * package's own stable code and message (they name a column or a row NUMBER, never
 * a value). A thrown error stores ONE fixed sentence, because an arbitrary
 * error's text is exactly the field most likely to quote what it was working on.
 */

import type { ImportPlanner, ImportPreviewRow } from "./plan.js";

/**
 * The ceiling for a failure reason. The column is `VARCHAR(500)` and the writer
 * bounds again at that width; this bound is the package's own so the sentence it
 * builds is short by construction rather than truncated at the database.
 */
export const PREVIEW_FAILURE_REASON_MAX_LENGTH = 400;

/** Stable code prefix for a failure that was thrown rather than planned. */
export const PREVIEW_FAILURE_CODE = "IMPORT_PREVIEW_FAILED";

/** The ONE sentence stored when the failure is not a file-level refusal. */
export const PREVIEW_FAILURE_MESSAGE =
  "The preview failed before it could produce a verdict. Nothing was written.";

/** What a preview pass did, as the caller reports it. */
export type PreviewRunOutcome = "PREVIEWED" | "FAILED" | "SKIPPED";

/**
 * The durable side of one preview, supplied by the caller.
 *
 * Three methods because the machine has three writes: take the phase, finish it,
 * or settle it as failed. There is deliberately no fourth "reset": a preview that
 * cannot finish is a `FAILED` import, not a retried one ([[DEC-071]]'s summary is
 * the result of one pass).
 */
export interface PreviewPersistence {
  /**
   * `UPLOADED → PREVIEWING`. `false` means another runner won, or the state moved.
   *
   * A caller MUST make this a conditional write that pins `UPLOADED`; a plain
   * update would let this runner believe it owns a phase it does not.
   */
  claim(): Promise<boolean>;

  /** Replaces this job's outcomes and moves it to `PREVIEWED`, with the counters. */
  complete(rows: readonly ImportPreviewRow[]): Promise<void>;

  /** Moves it to `FAILED` with a bounded reason. */
  fail(reason: string): Promise<void>;
}

/** The object-store side of one preview, supplied by the caller. */
export interface PreviewArtefact {
  /** The decoded CSV text. */
  read(): Promise<string>;
}

/**
 * The three things one preview pass needs.
 *
 * `plan` is a FUNCTION rather than a precomputed plan because the plan is a function
 * of the artefact's text, and the text is read AFTER the claim: a pass that lost the
 * claim must not have parsed anything, and a planner's prefetched lookups (a
 * duplicate lookup, a taxonomy, resolved references) are captured in its closure by
 * the caller. `ImportPlan`/`ImportPlanner` are shared with the commit plan shape, so
 * both entities' planners and both runners agree on what a plan is.
 */
export interface RunImportPreviewArgs {
  readonly persistence: PreviewPersistence;
  readonly artefact: PreviewArtefact;
  readonly plan: ImportPlanner;
}

/**
 * Runs one preview pass.
 *
 * Pure orchestration: no clock, no random, no direct I/O. Everything it needs is
 * one of the three arguments, which is what lets the whole state machine of this
 * pass be tested with three tiny fakes.
 */
export async function runImportPreview({
  persistence,
  artefact,
  plan,
}: RunImportPreviewArgs): Promise<PreviewRunOutcome> {
  if (!(await persistence.claim())) {
    return "SKIPPED";
  }

  try {
    const planned = plan(await artefact.read());

    if (planned.fileError !== undefined) {
      // A file-level refusal yields no rows at all (the plan's contract), so
      // there is nothing to persist but the reason it was refused.
      await persistence.fail(
        boundReason(`${planned.fileError.code}: ${planned.fileError.message}`)
      );
      return "FAILED";
    }

    await persistence.complete(planned.rows);
    return "PREVIEWED";
  } catch {
    // The claim is already committed: settle it, or the row stays `PREVIEWING`
    // forever with no writer (see the header). The error's own text is NOT
    // stored — it could quote the row that provoked it.
    await persistence.fail(boundReason(`${PREVIEW_FAILURE_CODE}: ${PREVIEW_FAILURE_MESSAGE}`));
    return "FAILED";
  }
}

const ELLIPSIS = "…";

/** Newline-flattened and bounded: a reason is a coordinate, not a payload. */
function boundReason(reason: string): string {
  const flattened = reason.replace(/[\r\n\t]+/g, " ");
  if (flattened.length <= PREVIEW_FAILURE_REASON_MAX_LENGTH) {
    return flattened;
  }
  return `${flattened.slice(0, PREVIEW_FAILURE_REASON_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}
