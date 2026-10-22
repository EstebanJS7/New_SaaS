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
 *
 * THE PLAN ITSELF IS NOT CUSTOMER-SPECIFIC. `ImportPlan`, `ImportPreviewRow` and
 * `ImportFileError` live in `plan.ts` with the message bound, because [[IMP-004]]
 * added a second entity whose preview produces the same shape; the names below are
 * this entity's aliases for them, so a customer call site still reads as one.
 */

import { parseCsv } from "./csv.js";
import { resolveCustomerColumns } from "./customer-columns.js";
import { toCustomerRow } from "./customer-row.js";
import { detectSuspectedDuplicate } from "./duplicates.js";
import type { DuplicateLookup } from "./duplicates.js";
import { boundImportMessage, PREVIEW_MESSAGE_MAX_LENGTH, planFileRefusal } from "./plan.js";
import type { ImportFileError, ImportPlan, ImportPreviewRow } from "./plan.js";

/**
 * The ceiling for a row message, re-exported from the shared plan module: BOTH
 * entities' previews write into the same bounded column, so the bound is one
 * policy and this is the name the customer suite already reads.
 */
export { PREVIEW_MESSAGE_MAX_LENGTH };

/** This entity's names for the shared plan shapes (`plan.ts`). */
export type CustomerPreviewRow = ImportPreviewRow;
export type CustomerPreviewFileError = ImportFileError;
export type CustomerPreviewPlan = ImportPlan;

export interface PlanCustomerPreviewArgs {
  /** The artefact's decoded text. */
  csvText: string;
  /** The tenant-scoped existing-record questions the heuristic may ask. */
  duplicates: DuplicateLookup;
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
    return planFileRefusal(parsed.code, parsed.message);
  }

  const columns = resolveCustomerColumns(parsed.headers);

  if (!columns.ok) {
    return planFileRefusal(columns.code, columns.message);
  }

  const rows = parsed.rows.map((cells, offset): CustomerPreviewRow => {
    const rowNumber = offset + 1;
    const verdict = toCustomerRow(cells, columns.layout);

    if (!verdict.ok) {
      return {
        rowNumber,
        status: "FAILED",
        code: verdict.code,
        message: boundImportMessage(verdict.message),
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
