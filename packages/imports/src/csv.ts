/**
 * The CSV reader (EPIC-19 [[IMP-002]], [[DEC-068]]).
 *
 * WHY HAND-WRITTEN: [[DEC-068]] ships CSV only and refuses an XLSX parser
 * dependency, and RFC 4180 is a short rule that this repository already
 * implements in the other direction (`apps/api/src/reporting/export/csv.ts`,
 * [[REP-007]]). The quoting rules are the same both ways, so a library would add
 * a dependency to reproduce a rule the export side already states.
 *
 * WHAT THIS MODULE IS NOT: it knows nothing about customers, headers of any
 * particular meaning, tenants or HTTP. It turns text into records and refuses a
 * file it cannot read with a STABLE code, so the caller maps the refusal to its
 * own surface. There is no `DomainError` here on purpose — this package has no
 * HTTP boundary, so it has no error type that implies one.
 *
 * THE CONTRACT, field by field:
 *
 * 1. **RFC 4180 quoting.** A field may be quoted. Inside a quoted field a
 *    doubled `""` is one literal `"`, and `,`, `\r` and `\n` are literal
 *    characters rather than separators.
 * 2. **Line endings.** `\r\n` and `\n` both end a record, and so does a LONE
 *    `\r` outside quotes (an old Mac export, and some Windows tools).
 * 3. **A UTF-8 BOM at the very start is stripped.** A spreadsheet export
 *    usually carries one, and left in place it becomes part of the first header
 *    — which would then not match the column contract for a reason nobody can
 *    see in a text editor.
 * 4. **An unterminated quoted field is its own refusal.** Continuing past it
 *    would swallow the rest of the file into one field and report the resulting
 *    row count as if it were true.
 * 5. **A data row whose field count differs from the header is refused, naming
 *    the row.** A short or long row means either the file or the export is
 *    broken; pairing cells by position then writes the wrong value into the
 *    wrong column.
 * 6. **A blank trailing line is ignored; a blank line in the middle is
 *    refused, naming its row.** A trailing blank is an artefact of every text
 *    editor and every export. A blank line in the middle is almost always a real
 *    mistake, and silently skipping it would shift the row number of everything
 *    after it — so an operator sent to "row 412" would land on the wrong line.
 * 7. **An empty file, and a header-only file, are distinct.** An empty file is a
 *    refusal (there is no header to read); a header-only file is a valid document
 *    with zero data rows — an empty period is not an error.
 *
 * LENIENCY, stated so it is not mistaken for an oversight: only the refusals
 * above exist. A `"` that does not start a field is a literal character, and text
 * following a closing quote continues the field. RFC 4180 defines neither, and
 * inventing a refusal for them would reject files other readers accept — while
 * the column contract and the create contract still decide what the values mean.
 */

/** Stable reason codes the caller maps to its own surface. Never re-worded in place. */
export const CSV_REJECTION_CODES = {
  /** The text has no header row at all (empty, or whitespace only). */
  EMPTY_FILE: "CSV_EMPTY_FILE",
  /** A quoted field is opened and never closed. */
  UNTERMINATED_QUOTED_FIELD: "CSV_UNTERMINATED_QUOTED_FIELD",
  /** A data row's field count differs from the header's. */
  FIELD_COUNT_MISMATCH: "CSV_FIELD_COUNT_MISMATCH",
  /** A blank line sits between the header and the last data row. */
  BLANK_LINE: "CSV_BLANK_LINE",
} as const;

export type CsvRejectionCode = (typeof CSV_REJECTION_CODES)[keyof typeof CSV_REJECTION_CODES];

export interface CsvParseSuccess {
  readonly ok: true;
  /** The header record, as written: normalization belongs to the column contract. */
  readonly headers: string[];
  /** One entry per data record, in file order, each aligned to the header. */
  readonly rows: string[][];
}

export interface CsvParseFailure {
  readonly ok: false;
  readonly code: CsvRejectionCode;
  /** Bounded, human readable, and safe to surface to an operator. */
  readonly message: string;
}

export type CsvParseResult = CsvParseSuccess | CsvParseFailure;

const BOM = "\uFEFF";

/**
 * A record that carries no value anywhere: one field, and that field blank.
 * `,` (two empty fields) is deliberately NOT blank — it is a data row whose
 * cells are all empty, which the row contract refuses by name instead of the
 * file being refused as malformed.
 */
function isBlankRecord(record: readonly string[]): boolean {
  return record.length === 1 && record[0].trim() === "";
}

/**
 * Reads one CSV document.
 *
 * Returns a tagged result rather than throwing: a refusal is an expected
 * outcome of reading a file an operator uploaded, not an exceptional one, and
 * the caller needs the CODE beside the message to tell an unreadable file from a
 * row it should report against.
 */
export function parseCsv(text: string): CsvParseResult {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  if (source.trim() === "") {
    return {
      ok: false,
      code: CSV_REJECTION_CODES.EMPTY_FILE,
      message: "The file is empty. It must start with a header row naming its columns.",
    };
  }

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field === "") {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (character === ",") {
      record.push(field);
      field = "";
      index += 1;
      continue;
    }

    if (character === "\r" || character === "\n") {
      index += character === "\r" && source[index + 1] === "\n" ? 2 : 1;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
      continue;
    }

    field += character;
    index += 1;
  }

  if (inQuotes) {
    return {
      ok: false,
      code: CSV_REJECTION_CODES.UNTERMINATED_QUOTED_FIELD,
      message:
        'A quoted field is never closed. A `"` inside a quoted field must be written as `""`.',
    };
  }

  // A file that does not end with a separator still carries its last record.
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Trailing blank records are an artefact of every editor and every export.
  // The header is never dropped, so `[[""], ...]` collapses to its first record.
  while (records.length > 1 && isBlankRecord(records[records.length - 1])) {
    records.pop();
  }

  const headers = records[0];
  const dataRecords = records.slice(1);

  for (const [offset, cells] of dataRecords.entries()) {
    const rowNumber = offset + 1;
    if (isBlankRecord(cells)) {
      return {
        ok: false,
        code: CSV_REJECTION_CODES.BLANK_LINE,
        message: `Row ${rowNumber} is blank. A blank line inside the file would shift the row number of everything after it, so the file is refused.`,
      };
    }
    if (cells.length !== headers.length) {
      return {
        ok: false,
        code: CSV_REJECTION_CODES.FIELD_COUNT_MISMATCH,
        message: `Row ${rowNumber} has ${cells.length} field(s) but the header has ${headers.length}.`,
      };
    }
  }

  return { ok: true, headers, rows: dataRecords };
}
