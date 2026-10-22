/**
 * The patient preview planner (EPIC-19 [[IMP-004]]).
 *
 * THE SAME SHAPE AS THE CUSTOMER PLANNER, and the same reader and the same header
 * resolver underneath it: one verdict per data row, `CREATE` or `FAILED`, plus a
 * suspected-duplicate flag that is INDEPENDENT of the verdict. It writes nothing and
 * returns a plain value, so the caller decides what to persist ([[DEC-071]]'s
 * `import_row_outcome`) and where. That is the whole point of [[IMP-004]]'s
 * generalisation: `runImportPreview` is one function, and this is what a patient
 * file hands it.
 *
 * EVERY ROW CARRIES `suspectedDuplicate: false`, deliberately. There is no patient
 * duplicate heuristic in this unit: a patient has no natural unique key a file could
 * compare — a name plus a species is not one, two pets of the same name in one
 * household are ordinary — so a heuristic here would produce warnings an operator
 * has no way to act on. The field is still reported because the outcome row, the
 * summary and the counters are shared with the customer import, and inventing a
 * second row shape for the sake of one always-false boolean would fork them.
 */

import { parseCsv } from "./csv.js";
import { resolvePatientColumns } from "./patient-columns.js";
import { toPatientRow } from "./patient-row.js";
import type { GuardianLookup, PatientCatalogLookup } from "./patient-row.js";
import { planFileRefusal } from "./plan.js";
import { boundImportMessage } from "./plan.js";
import type { ImportPlan, ImportPreviewRow } from "./plan.js";

export interface PlanPatientPreviewArgs {
  /** The artefact's decoded text. */
  readonly csvText: string;
  /** The GLOBAL species/breed taxonomy, prefetched by the caller. */
  readonly catalog: PatientCatalogLookup;
  /** The tenant's existing-customer references, prefetched by the caller. */
  readonly guardians: GuardianLookup;
}

/**
 * Plans the preview for one patient file.
 *
 * Pure: same text, same prefetched lookups, same plan. No clock, no random, no I/O,
 * no tenant — the tenant belongs to the rows the caller read the lookups from, and
 * this function never sees it.
 */
export function planPatientPreview({
  csvText,
  catalog,
  guardians,
}: PlanPatientPreviewArgs): ImportPlan {
  const parsed = parseCsv(csvText);

  if (!parsed.ok) {
    return planFileRefusal(parsed.code, parsed.message);
  }

  const columns = resolvePatientColumns(parsed.headers);

  if (!columns.ok) {
    return planFileRefusal(columns.code, columns.message);
  }

  const context = { catalog, guardians };

  const rows = parsed.rows.map((cells, offset): ImportPreviewRow => {
    const rowNumber = offset + 1;
    const verdict = toPatientRow(cells, columns.layout, context);

    if (!verdict.ok) {
      return {
        rowNumber,
        status: "FAILED",
        code: verdict.code,
        message: boundImportMessage(verdict.message),
        suspectedDuplicate: false,
      };
    }

    return { rowNumber, status: "CREATE", suspectedDuplicate: false };
  });

  return { rows };
}
