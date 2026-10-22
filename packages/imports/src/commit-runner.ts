/**
 * The commit pass over one previewed artefact (EPIC-19 [[IMP-003]]).
 *
 * ORCHESTRATION ONLY. This module knows the ORDER the steps must happen in and
 * nothing about how any of them is done: the database is a `CommitPersistence`,
 * the object store is a `PreviewArtefact`, and the business write is a
 * `CommitWriter`. So the package still needs neither Prisma, nor storage, nor the
 * customer service, and the worker that supplies all three can be tested without a
 * database.
 *
 * THE ORDER IS THE CONTRACT, and the first line of it is the same one the preview
 * runner states:
 *
 * ```text
 * claim()  →  read outcomes  →  read artefact  →  per accepted row: create | failRow
 *                                              →  complete(counts) | fail(reason)
 * ```
 *
 * `claim()` FIRST, AND NOTHING TOUCHED WHEN IT REFUSES. `PREVIEWED → COMMITTING`
 * is a compare-and-swap the caller performs; `false` means another runner won, or
 * the row already moved. That is what makes a replayed job a no-op: an import
 * that is already `COMMITTING` or terminal cannot be claimed again, so no record is
 * written twice and nothing returns `SKIPPED` while having written anything.
 *
 * THE PREVIEW'S VERDICTS ARE AUTHORITATIVE. The rows to write are read from the
 * outcomes the PREVIEW persisted, and only those marked `CREATE` are written. A row
 * the preview refused is never retried, and a row it accepted is never re-validated
 * into a different answer — the commit re-reads the artefact only to recover the
 * PAYLOADS, which the outcome table deliberately does not store. That is what makes
 * "commit what you saw" literally true, rather than a promise that the second
 * validation happens to agree.
 *
 * ONE TRANSACTION PER ROW ([[DEC-071]]). `writer.create` is called once per accepted
 * row and each call owns its own transaction — the customer, its contacts and their
 * audit rows commit together or not at all. A failure on row N therefore leaves rows
 * 1..N-1 committed, records row N as failed through `failRow`, and CONTINUES to
 * N+1: a dirty line late in a real file must not cost the operator the 1 239 rows
 * before it. There is no rollback of committed rows anywhere in this unit, and no
 * attempt to undo one.
 *
 * ZERO ACCEPTED ROWS IS NOT A PARTIAL SUCCESS. A file whose every row the preview
 * refused commits nothing and ends `FAILED`, naming that reason
 * ([[DEC-071]]). The check happens BEFORE the artefact is read, so a refused file
 * costs no object-store call either.
 *
 * A CLAIM IS NEVER LEFT DANGLING SILENTLY. Once claimed the row is `COMMITTING` and
 * `claim` can never take it again, so every path out of here settles it: a thrown
 * error — an unreadable artefact, a persistence write that fails — is turned into
 * `fail(...)` plus `"FAILED"` rather than propagating, exactly as the preview runner
 * does. The residual case is stated rather than hidden: a process killed mid-run
 * leaves the row `COMMITTING` with no writer, and nothing in this unit recovers it.
 *
 * NO ROW PAYLOAD AND NO ERROR TEXT IS STORED. A per-row failure stores ONE fixed
 * sentence, because an arbitrary error's text — a driver's, a constraint's — is the
 * field most likely to quote the values it was writing, and those values are the
 * customer's name, phone and document number. Every reason this module writes is
 * bounded and newline-flattened for the same reason: a reason is a coordinate, not
 * a payload.
 */

import type { PreviewArtefact } from "./preview-runner.js";
import { planCustomerCommit, type CustomerRowReady } from "./commit.js";

/**
 * The ceiling for a failure reason. The column is `VARCHAR(500)` and the worker
 * bounds again at that width; this bound is the package's own, so the sentence it
 * builds is short by construction rather than truncated at the database. It is the
 * preview runner's bound, repeated rather than shared: the preview's constant is
 * about the preview's messages and this one is about the commit's, and neither may
 * be re-worded by the other's future edit.
 */
export const COMMIT_FAILURE_REASON_MAX_LENGTH = 400;

/** Stable code prefix for a failure that was thrown rather than settled per row. */
export const COMMIT_FAILURE_CODE = "IMPORT_COMMIT_FAILED";

/**
 * The ONE sentence stored when the failure is not a per-row one. It says what is
 * true and stops: rows already committed were kept, and the summary is what lists
 * them.
 */
export const COMMIT_FAILURE_MESSAGE =
  "The commit stopped before it could finish. Rows already committed were kept.";

/** Stable code for a row the preview accepted that could not be written. */
export const COMMIT_ROW_FAILURE_CODE = "IMPORT_ROW_COMMIT_FAILED";

/** The ONE sentence stored on a row that failed at commit time. Quotes nothing. */
export const COMMIT_ROW_FAILURE_MESSAGE =
  "The row could not be created, so nothing was committed for it.";

/** Stable code for a file with no accepted row at all. */
export const COMMIT_NO_VALID_ROWS_CODE = "IMPORT_COMMIT_NO_VALID_ROWS";

/** Why a file that commits nothing is refused (`FAILED`, never a partial success). */
export const COMMIT_NO_VALID_ROWS_MESSAGE =
  "No row in this file passed the preview, so nothing was committed. Fix the file and upload it again.";

/** What a commit pass did, as the caller reports it. */
export type CommitRunOutcome = "COMMITTED" | "FAILED" | "SKIPPED";

/**
 * One row's verdict as the PREVIEW persisted it ([[DEC-071]]'s
 * `import_row_outcome`), projected to the three fields the commit reads.
 *
 * Deliberately not the whole row: the commit needs the verdict, the row number and
 * the duplicate flag, and nothing else — there is no customer id here, because the
 * outcome table has none.
 */
export interface StoredOutcome {
  /** 1-based over DATA rows, in file order. */
  readonly rowNumber: number;
  readonly status: "CREATE" | "FAILED";
  /** Present exactly when the row is `FAILED`; a stable code, never re-worded. */
  readonly reasonCode: string | null;
  /** Bounded and human readable, present exactly when the row is `FAILED`. */
  readonly message: string | null;
  /** The preview's suspected-duplicate WARNING ([[DEC-069]]); never a rule. */
  readonly suspectedDuplicate: boolean;
}

/**
 * The three counters one finished commit writes ([[DEC-071]]).
 *
 * `failed` is the PREVIEW's refusals plus the rows that failed at commit time, so
 * `created + failed` is still the number of data rows the file carried.
 * `suspectedDuplicate` is carried over from the preview — a warning must survive
 * the commit so the summary can still report it — and counted only for rows the
 * commit actually created, which keeps it a SUBSET of `created` as the aggregate's
 * projection states. A flagged row that failed to write keeps its warning on its
 * own outcome row; it is not a duplicate of a record that does not exist.
 */
export interface CommitCounts {
  readonly created: number;
  readonly failed: number;
  readonly suspectedDuplicate: number;
}

/**
 * The durable side of one commit, supplied by the caller.
 *
 * Five methods because the machine has five writes: take the phase, read the
 * verdicts, fail one row, finish with the counters, or settle the whole job as
 * failed. There is deliberately no "reset": a commit that cannot finish is a
 * `FAILED` import, not a retried one — and the rows it already created are not
 * undone by anything here.
 */
export interface CommitPersistence {
  /** `PREVIEWED → COMMITTING`. `false` means another runner won or the state moved. */
  claim(): Promise<boolean>;

  /** The verdicts the PREVIEW persisted, in row order. */
  readOutcomes(): Promise<readonly StoredOutcome[]>;

  /**
   * Marks one row as failed at commit time, with a bounded reason.
   *
   * The row's own `suspectedDuplicate` flag is NOT touched: the warning was the
   * preview's observation and stays true on the row even when the write failed.
   */
  failRow(rowNumber: number, code: string, message: string): Promise<void>;

  /** `COMMITTING → COMMITTED` with the final counters, or `→ FAILED` with a reason. */
  complete(counts: CommitCounts): Promise<void>;

  /** Settles the job as `FAILED` with a bounded reason. */
  fail(reason: string): Promise<void>;
}

/** The business-write side of one commit, supplied by the caller. */
export interface CommitWriter {
  /** Creates ONE row's business records atomically, or throws. */
  create(row: CustomerRowReady): Promise<void>;
}

export interface RunCustomerCommitArgs {
  readonly persistence: CommitPersistence;
  readonly artefact: PreviewArtefact;
  readonly writer: CommitWriter;
}

/**
 * Runs one commit pass.
 *
 * Pure orchestration: no clock, no random, no direct I/O. Everything it needs is
 * one of the three arguments, which is what lets the partial-success rules of this
 * pass — the ones that decide whether records exist — be tested with three tiny
 * fakes and no database.
 */
export async function runCustomerCommit({
  persistence,
  artefact,
  writer,
}: RunCustomerCommitArgs): Promise<CommitRunOutcome> {
  if (!(await persistence.claim())) {
    return "SKIPPED";
  }

  try {
    const outcomes = await persistence.readOutcomes();
    const accepted = outcomes.filter((outcome) => outcome.status === "CREATE");

    if (accepted.length === 0) {
      // Nothing to write is not a partial success: the file is refused with a
      // reason an operator can act on, and the artefact is never even read.
      await persistence.fail(
        boundReason(`${COMMIT_NO_VALID_ROWS_CODE}: ${COMMIT_NO_VALID_ROWS_MESSAGE}`)
      );
      return "FAILED";
    }

    const plan = planCustomerCommit({ csvText: await artefact.read() });

    if (plan.fileError !== undefined) {
      // The file the preview read can no longer be read as the same file. That is
      // unrecoverable — there are no payloads to write — so the phase is settled
      // with the package's own stable code rather than a guess about which rows
      // might have been fine.
      await persistence.fail(boundReason(`${plan.fileError.code}: ${plan.fileError.message}`));
      return "FAILED";
    }

    const readyByRowNumber = new Map(plan.rows.map((row) => [row.rowNumber, row]));

    // The preview's refusals are already failures; they are carried, not re-derived.
    let created = 0;
    let failed = outcomes.length - accepted.length;
    let suspectedDuplicate = 0;

    for (const outcome of accepted) {
      const ready = readyByRowNumber.get(outcome.rowNumber);

      if (ready === undefined) {
        // The preview accepted a row the artefact no longer yields a payload for.
        // Nothing was written, so it is a commit-time failure of THAT row, and the
        // run continues: the other rows' payloads are unaffected.
        await persistence.failRow(
          outcome.rowNumber,
          COMMIT_ROW_FAILURE_CODE,
          COMMIT_ROW_FAILURE_MESSAGE
        );
        failed += 1;
        continue;
      }

      try {
        await writer.create(ready);
        created += 1;
        if (outcome.suspectedDuplicate) suspectedDuplicate += 1;
      } catch {
        // DEC-071's partial success: this row's transaction rolled back, the rows
        // before it are committed and stay committed, and the file continues. The
        // error's own text is NEVER stored — it is the field most likely to quote
        // the values it was writing.
        await persistence.failRow(
          outcome.rowNumber,
          COMMIT_ROW_FAILURE_CODE,
          COMMIT_ROW_FAILURE_MESSAGE
        );
        failed += 1;
      }
    }

    await persistence.complete({ created, failed, suspectedDuplicate });
    return "COMMITTED";
  } catch {
    // The claim is already committed: settle it, or the row stays `COMMITTING`
    // forever with no writer (see the header). One fixed sentence, no error text.
    await persistence.fail(boundReason(`${COMMIT_FAILURE_CODE}: ${COMMIT_FAILURE_MESSAGE}`));
    return "FAILED";
  }
}

const ELLIPSIS = "…";

/** Newline-flattened and bounded: a reason is a coordinate, not a payload. */
function boundReason(reason: string): string {
  const flattened = reason.replace(/[\r\n\t]+/g, " ");
  if (flattened.length <= COMMIT_FAILURE_REASON_MAX_LENGTH) {
    return flattened;
  }
  return `${flattened.slice(0, COMMIT_FAILURE_REASON_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}
