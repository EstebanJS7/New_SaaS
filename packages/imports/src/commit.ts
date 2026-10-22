/**
 * The commit's row payloads (EPIC-19 [[IMP-003]]).
 *
 * WHAT IT DOES, AND DELIBERATELY DOES NOT DO. It reads the SAME artefact the
 * preview read, through the SAME reader, header contract and row contract, and
 * returns one create payload per data row. It does NOT decide what will be
 * created: that decision was made by the preview and persisted as
 * `import_row_outcome` ([[DEC-071]]), and the commit reads it from there. This
 * module only answers "what are the payloads of the rows the file carries", so a
 * row the preview refused cannot be resurrected by re-reading the file: nothing
 * here is consulted for a row the preview did not accept.
 *
 * WHY THE FILE IS READ AGAIN AT ALL. [[DEC-072]] bound the commit to the
 * artefact the preview read — the bytes are the same object under the same key —
 * but the preview persisted a VERDICT, never a payload: `import_row_outcome`
 * holds no name, phone, e-mail or document number ([[DEC-071]]), so the commit
 * has no other place to get them from. Re-reading is therefore the only way to
 * write the record without storing personal data twice.
 *
 * THE SAME CONTRACT, NOT A SECOND ONE. `toCustomerRow` is the preview's own row
 * contract, imported from the same module, so a row the preview accepted yields
 * the same payload here — the file and the rules are identical. A row that no
 * longer yields one (it cannot, for an unchanged artefact and unchanged code, but
 * the possibility is a value rather than an exception) is simply absent from
 * `rows`, and the runner records it as a commit-time failure for that row.
 *
 * A FILE-LEVEL REFUSAL IS CARRIED, NOT INVENTED. `parseCsv` and
 * `resolveCustomerColumns` can refuse the file itself; that refusal is returned
 * as `fileError` with the package's own stable code, exactly as the preview
 * reports it, and the runner settles the job with it.
 */

import { parseCsv } from "./csv.js";
import { resolveCustomerColumns } from "./customer-columns.js";
import { toCustomerRow, type CustomerRowContact } from "./customer-row.js";
import type { ImportPayloadPlan, ImportRowPayload } from "./plan.js";
import type { CreateCustomerInput } from "@newsaas/customers";

/**
 * One row's business records, ready to be written: exactly what
 * `createCustomer` takes, plus the row number the summary reports.
 *
 * Deliberately NOT `CustomerPreviewRow`: that is a verdict and carries no
 * personal data, which is precisely why the commit needs this second shape. The
 * payload never leaves the runner's call frame — it is handed to the writer and
 * to nothing else, and no part of it is stored or logged.
 */
export interface CustomerRowReady extends ImportRowPayload {
  /** Exactly what `createCustomer` takes; validated by the row contract. */
  readonly input: CreateCustomerInput;
  /** Zero, one or two contacts, in the order phone then e-mail. */
  readonly contacts: readonly CustomerRowContact[];
}

/** This entity's plan, in the shape every entity's commit planner returns. */
export type CustomerCommitPlan = ImportPayloadPlan<CustomerRowReady>;

export interface PlanCustomerCommitArgs {
  /** The artefact's decoded text. */
  readonly csvText: string;
}

/**
 * Reads one file into the payloads a commit would write.
 *
 * Pure: same text, same plan. No clock, no random, no I/O, no tenant — the
 * tenant belongs to the row the caller loaded, not to the file.
 */
export function planCustomerCommit({ csvText }: PlanCustomerCommitArgs): CustomerCommitPlan {
  const parsed = parseCsv(csvText);

  if (!parsed.ok) {
    return { fileError: { code: parsed.code, message: parsed.message }, rows: [] };
  }

  const columns = resolveCustomerColumns(parsed.headers);

  if (!columns.ok) {
    return { fileError: { code: columns.code, message: columns.message }, rows: [] };
  }

  const rows: CustomerRowReady[] = [];

  parsed.rows.forEach((cells, offset) => {
    const verdict = toCustomerRow(cells, columns.layout);
    // A row the row-contract refuses yields no payload. It is absent rather than
    // recorded as failed here: whether that row is committed at all is the
    // PREVIEW's verdict, and this module does not get a second opinion on it.
    if (!verdict.ok) return;

    rows.push({ rowNumber: offset + 1, input: verdict.input, contacts: verdict.contacts });
  });

  return { rows };
}
