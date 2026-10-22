/**
 * The two PLAN shapes every import planner produces (EPIC-19 [[IMP-002]],
 * [[IMP-004]]).
 *
 * ONE PLANNER PER ENTITY, ONE RUNNER FOR ALL OF THEM. A planner is a pure function
 * from the artefact's text to a plan: the PREVIEW's plan is one VERDICT per data
 * row, the COMMIT's plan is one PAYLOAD per derivable row. The runners that walk a
 * plan (`preview-runner.ts`, `commit-runner.ts`) never learn which entity they are
 * walking, so the claim-first ordering and the partial-success loop exist ONCE
 * rather than once per entity — which is what [[IMP-004]] asked for instead of a
 * second copy.
 *
 * A FILE-LEVEL REFUSAL YIELDS NO ROWS, in both plans. When the CSV cannot be read
 * or its headers do not match the contract, every per-row verdict would be about a
 * file the caller is refusing anyway, and a preview that listed 4 000 failed rows
 * for a missing header is a preview that buries its own cause. `rows` is empty and
 * `fileError` carries the stable code.
 *
 * Everything here is a plain value or a function over plain values: no Prisma, no
 * storage, no HTTP, no clock, no random. That is what lets a whole entity's
 * pipeline be tested against three tiny fakes.
 */

/**
 * The ceiling for a ROW message. Messages surface in the preview UI and in the
 * import summary, and one paste-bomb cell must not become an unbounded render.
 * The create contracts' own messages are far shorter than this; the bound exists
 * for the file's text, which is operator-supplied.
 *
 * It is here rather than in a planner because BOTH entities' previews write into
 * the same bounded column (`import_row_outcome.message`) and a per-entity bound
 * would be two policies for one column.
 */
export const PREVIEW_MESSAGE_MAX_LENGTH = 280;

const ELLIPSIS = "…";

/** Newline-normalized and bounded: a message names a condition, never a payload. */
export function boundImportMessage(message: string): string {
  if (message.length <= PREVIEW_MESSAGE_MAX_LENGTH) {
    return message;
  }
  return `${message.slice(0, PREVIEW_MESSAGE_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * A refusal of the FILE itself: the reader refused the text, or the header
 * contract refused its columns. Both are stable codes the caller maps to its own
 * surface.
 */
export interface ImportFileError {
  readonly code: string;
  readonly message: string;
}

/**
 * One row's VERDICT, as the preview plans it and `import_row_outcome` stores it.
 *
 * It carries no name, phone, e-mail, document number, species or birth date: a
 * verdict is a coordinate plus a reason, and the personal data a row carries never
 * leaves the call frame that validated it ([[DEC-071]]).
 */
export interface ImportPreviewRow {
  /** 1-based over DATA rows: the header is excluded. */
  readonly rowNumber: number;
  readonly status: "CREATE" | "FAILED";
  /** Stable code, present exactly when `status` is `FAILED`. */
  readonly code?: string;
  /** Bounded and human readable, present exactly when `status` is `FAILED`. */
  readonly message?: string;
  /**
   * Whether the row LOOKS like a record that already exists ([[DEC-069]]).
   * Independent of `status`, and never a reason not to create: a flagged row is
   * still `CREATE`, and nothing about this flag changes what the import writes.
   *
   * Always `false` on a `FAILED` row: a row that creates nothing has no record to
   * be a duplicate OF, so the lookup is never consulted for one.
   */
  readonly suspectedDuplicate: boolean;
}

/** What a preview planner returns: the file's refusal, or one verdict per row. */
export interface ImportPlan {
  /** Present when the FILE is refused; `rows` is then empty. */
  readonly fileError?: ImportFileError;
  /** One entry per data row, in file order, when the file itself is readable. */
  readonly rows: readonly ImportPreviewRow[];
}

/**
 * A PREVIEW planner: the artefact's text to its verdicts.
 *
 * Prefetched facts a planner needs (a duplicate lookup, a catalog, the resolved
 * guardian references) are CAPTURED in the closure by whoever builds it, so this
 * signature stays a pure function of the text and the runner stays out of the
 * database.
 */
export type ImportPlanner = (csvText: string) => ImportPlan;

/**
 * The plan of a file the reader or the header contract refused, with the message
 * bounded exactly as a row message is.
 *
 * Both preview planners route their two file-level refusals through this, so a
 * refusal cannot arrive unbounded from one entity and bounded from the other.
 */
export function planFileRefusal(code: string, message: string): ImportPlan {
  return { fileError: { code, message: boundImportMessage(message) }, rows: [] };
}

/**
 * The one field every commit payload must carry: the row it belongs to.
 *
 * The commit writes the rows the PREVIEW accepted, keyed by this number, so it is
 * the join between a stored verdict and a freshly-read payload.
 */
export interface ImportRowPayload {
  /** 1-based over DATA rows, the same numbering the preview and the summary use. */
  readonly rowNumber: number;
}

/** What a commit planner returns: the file's refusal, or one payload per row. */
export interface ImportPayloadPlan<TRow extends ImportRowPayload> {
  /** Present when the FILE is refused; `rows` is then empty. */
  readonly fileError?: ImportFileError;
  /** One payload per derivable data row, in file order. */
  readonly rows: readonly TRow[];
}

/**
 * A COMMIT planner: the artefact's text to the payloads that would be written.
 *
 * Deliberately NOT the preview's `ImportPlan`: a verdict is not a payload. The
 * verdicts decide WHICH rows are written and are read from `import_row_outcome`;
 * the payloads carry the personal data the outcome table refuses to store, so they
 * exist only in the call frame that writes them ([[DEC-071]]).
 */
export type ImportPayloadPlanner<TRow extends ImportRowPayload> = (
  csvText: string
) => ImportPayloadPlan<TRow>;
