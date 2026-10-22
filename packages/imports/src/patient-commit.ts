/**
 * The patient commit's row payloads (EPIC-19 [[IMP-004]]).
 *
 * THE SAME CONTRACT AS `commit.ts`, one entity over. It reads the SAME artefact the
 * preview read, through the SAME reader, header contract and row contract, and
 * returns one create payload per derivable data row. It does NOT decide what will be
 * created: that decision was made by the preview and persisted as
 * `import_row_outcome` ([[DEC-071]]), and the commit reads it from there. Nothing
 * here is consulted for a row the preview did not accept.
 *
 * WHY THE FILE IS READ AGAIN AT ALL: `import_row_outcome` stores no personal data —
 * no name, no birth date, no guardian reference — so the payloads have no other
 * place to come from ([[DEC-072]] bound the commit to the artefact the preview read,
 * so the bytes are the same object under the same key).
 *
 * THE SAME CONTRACT, NOT A SECOND ONE. `toPatientRow` is the preview's own row
 * contract, imported from the same module, and it resolves the guardian and the
 * catalog through the SAME prefetched lookups the preview used — so a row the preview
 * accepted yields the same payload here, INCLUDING the same `customerId`. A row that
 * no longer yields one is simply absent from `rows`, and the runner records it as a
 * commit-time failure for that row.
 */

import { parseCsv } from "./csv.js";
import { resolvePatientColumns } from "./patient-columns.js";
import { toPatientRow } from "./patient-row.js";
import type { GuardianLookup, PatientCatalogLookup, PatientRowInput } from "./patient-row.js";
import type { ImportPayloadPlan, ImportRowPayload } from "./plan.js";

/**
 * One patient row, ready to be written: exactly what `createPatient` takes, plus the
 * row number the summary reports.
 *
 * Deliberately NOT the preview's verdict: a verdict carries no personal data, which
 * is precisely why the commit needs this second shape. The payload never leaves the
 * runner's call frame — it is handed to the writer and to nothing else, and no part
 * of it is stored or logged.
 */
export interface PatientRowReady extends ImportRowPayload {
  /** Exactly what `createPatient` takes, guardian included; validated by the row. */
  readonly input: PatientRowInput;
}

export type PatientCommitPlan = ImportPayloadPlan<PatientRowReady>;

export interface PlanPatientCommitArgs {
  /** The artefact's decoded text. */
  readonly csvText: string;
  /**
   * The SAME prefetched taxonomy the preview resolved against. Passing it in rather
   * than re-resolving is what keeps the payload's `speciesId`/`breedId` equal to the
   * ids the preview's verdict was written for.
   */
  readonly catalog: PatientCatalogLookup;
  /** The SAME prefetched references the preview resolved against. */
  readonly guardians: GuardianLookup;
}

/**
 * Reads one patient file into the payloads a commit would write.
 *
 * Pure: same text and same lookups, same plan. No clock, no random, no I/O, no
 * tenant — the tenant belongs to the lookups the caller built.
 */
export function planPatientCommit({
  csvText,
  catalog,
  guardians,
}: PlanPatientCommitArgs): PatientCommitPlan {
  const parsed = parseCsv(csvText);

  if (!parsed.ok) {
    return { fileError: { code: parsed.code, message: parsed.message }, rows: [] };
  }

  const columns = resolvePatientColumns(parsed.headers);

  if (!columns.ok) {
    return { fileError: { code: columns.code, message: columns.message }, rows: [] };
  }

  const context = { catalog, guardians };
  const rows: PatientRowReady[] = [];

  parsed.rows.forEach((cells, offset) => {
    const verdict = toPatientRow(cells, columns.layout, context);
    // A row the row-contract refuses yields no payload. It is absent rather than
    // recorded as failed here: whether that row is committed at all is the
    // PREVIEW's verdict, and this module does not get a second opinion on it.
    if (!verdict.ok) return;

    rows.push({ rowNumber: offset + 1, input: verdict.input });
  });

  return { rows };
}
