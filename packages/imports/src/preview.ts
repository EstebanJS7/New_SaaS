/**
 * The customer preview planner (EPIC-19 [[IMP-002]]).
 *
 * WHAT IT DOES: turns one CSV document into one verdict per data row — `CREATE`
 * or `FAILED` — plus a suspected-duplicate warning that is INDEPENDENT of the
 * verdict. It writes nothing and returns a plain value, so the caller decides
 * what to persist ([[DEC-071]]'s `import_row_outcome`) and where.
 *
 * A FILE-LEVEL REFUSAL YIELDS NO ROWS. When the CSV cannot be read or its headers
 * do not match the contract, every per-row verdict would be about a file the
 * caller is refusing anyway, and a preview that listed 4 000 failed rows for a
 * missing header is a preview that buries its own cause. `rows` is empty and
 * `fileError` carries the stable code.
 *
 * A ROW-LEVEL FAILURE IS NOT A FILE FAILURE. One bad e-mail does not refuse 1 239
 * good customers; the row is `FAILED` with its own code and message, and the
 * operator fixes that one line.
 *
 * ROW NUMBERS ARE THE FILE'S OWN, 1-BASED OVER DATA ROWS. The header is not
 * row 1 — an operator opening the file in a spreadsheet sees the header on line
 * 1, so `rowNumber` matches the spreadsheet line only after adding one. The
 * number is stated that way (data rows) because it is what every message in this
 * package already uses, and because the header line shifts nothing: a refusal
 * says "row 412" and the reader knows it means the 412th customer in the file.
 */

import { parseCsv } from "./csv.js";
import { resolveCustomerColumns } from "./customer-columns.js";
import { toCustomerRow } from "./customer-row.js";
import { detectSuspectedDuplicate } from "./duplicates.js";
import type { DuplicateLookup } from "./duplicates.js";

/**
 * The ceiling for a row message. Messages surface in the preview UI and in the
 * import summary, and one paste-bomb cell must not become an unbounded render.
 * The create contract's own messages are far shorter than this; the bound exists
 * for the file's text, which is operator-supplied.
 */
export const PREVIEW_MESSAGE_MAX_LENGTH = 280;

const ELLIPSIS = "…";

export interface CustomerPreviewRow {
  /** 1-based over DATA rows: the header is excluded. */
  rowNumber: number;
  status: "CREATE" | "FAILED";
  /** Stable code, present exactly when `status` is `FAILED`. */
  code?: string;
  /** Bounded and human readable, present exactly when `status` is `FAILED`. */
  message?: string;
  /**
   * Whether the row LOOKS like a record that already exists ([[DEC-069]]).
   * Independent of `status`, and never a reason not to create: a flagged row is
   * still `CREATE`, and nothing about this flag changes what the import writes.
   *
   * Always `false` on a `FAILED` row: a row that creates nothing has no record
   * to be a duplicate OF, so the lookup is never consulted for one.
   */
  suspectedDuplicate: boolean;
}

export interface CustomerPreviewFileError {
  readonly code: string;
  readonly message: string;
}

export interface CustomerPreviewPlan {
  /** Present when the FILE is refused; `rows` is then empty. */
  fileError?: CustomerPreviewFileError;
  /** One entry per data row, in file order, when the file itself is readable. */
  rows: CustomerPreviewRow[];
}

export interface PlanCustomerPreviewArgs {
  /** The artefact's decoded text. */
  csvText: string;
  /** The tenant-scoped existing-record questions the heuristic may ask. */
  duplicates: DuplicateLookup;
}

function boundMessage(message: string): string {
  if (message.length <= PREVIEW_MESSAGE_MAX_LENGTH) {
    return message;
  }
  return `${message.slice(0, PREVIEW_MESSAGE_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * Plans the preview for one file.
 *
 * Pure: same text and same lookup, same plan. No clock, no random, no I/O.
 */
export function planCustomerPreview({
  csvText,
  duplicates,
}: PlanCustomerPreviewArgs): CustomerPreviewPlan {
  const parsed = parseCsv(csvText);

  if (!parsed.ok) {
    return { fileError: { code: parsed.code, message: boundMessage(parsed.message) }, rows: [] };
  }

  const columns = resolveCustomerColumns(parsed.headers);

  if (!columns.ok) {
    return { fileError: { code: columns.code, message: boundMessage(columns.message) }, rows: [] };
  }

  const rows = parsed.rows.map((cells, offset): CustomerPreviewRow => {
    const rowNumber = offset + 1;
    const verdict = toCustomerRow(cells, columns.layout);

    if (!verdict.ok) {
      return {
        rowNumber,
        status: "FAILED",
        code: verdict.code,
        message: boundMessage(verdict.message),
        suspectedDuplicate: false,
      };
    }

    return {
      rowNumber,
      status: "CREATE",
      suspectedDuplicate: detectSuspectedDuplicate(verdict.contacts, verdict.input, duplicates),
    };
  });

  return { rows };
}
