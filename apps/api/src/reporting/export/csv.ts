/**
 * The CSV serializer (EPIC-18 REP-007, [[DEC-066]]).
 *
 * WHY THIS IS HAND-WRITTEN: the repository has no CSV code at all (no
 * `text/csv`, no `.csv`, no `toCsv` anywhere) and `AGENTS.md` makes a new
 * dependency a decision, not a convenience. RFC 4180 is a fourteen-line rule
 * and every library that implements it also implements a dozen renderers the
 * one contract below must not have.
 *
 * THE CONTRACT, in the order it matters:
 *
 * 1. **No number is reformatted.** A cell value IS the value the report
 *    produced: a `string` stays a string and is emitted verbatim, so
 *    `"1234.50"` reaches the file as `1234.50` and never as `1234.5`, `1,234.50`
 *    or a float. A `number` is rendered by `String(n)`, which is the exact
 *    shortest round-trip representation of the integer counts the reports
 *    carry — never a locale-formatted one. A CSV that rounds money is a
 *    business defect (the Story says so in exactly those words).
 * 2. **RFC 4180 quoting.** A field is quoted when it contains `,`, `"`, `\n`
 *    or `\r`, and an embedded `"` is doubled. Nothing else is escaped: no
 *    backslashes, no HTML entities, no leading-`=` mitigation, none of which
 *    RFC 4180 defines and each of which would corrupt a value.
 * 3. **`\n` line endings, UTF-8, NO BOM.** A BOM breaks `a,b` in some older
 *    consumers and nothing here depends on Excel's heuristic; UTF-8 is the
 *    default of the response media type, so no byte-order marker is needed to
 *    decode it.
 * 4. **An explicit header row, always.** It comes from the column definitions
 *    rather than from the first row's keys, so it is present for an EMPTY row
 *    set — an empty period is a file with headers and no data rows, never an
 *    empty body and never an error.
 * 5. **A `null` (or absent) value is an EMPTY field**, never the text `null` or
 *    `undefined`. `cashMovementRow.direction` is `null` for every kind that
 *    does not own a direction, and a file that said `null` there would be
 *    asserting a value the report does not have.
 */

/**
 * One value a report row can contribute to a field.
 *
 * Deliberately a closed set: a column cannot point at a nested object, at a
 * `Date` or at a `Decimal`, because those have no honest single-field
 * rendering and each would force this module to invent a format. The reports
 * hand over only strings (already fixed-scale for money and quantities),
 * integer counts and the occasional `null`.
 */
export type CsvValue = string | number | null | undefined;

/**
 * One column: the header text and the reader that produces the cell.
 *
 * The reader returns a {@link CsvValue}, so a column pointing at a nested
 * object is a COMPILE error rather than a cell that renders `[object Object]`.
 * Money and quantities therefore arrive as the report's own fixed-scale string
 * and pass through untouched — this module never formats, rounds or localizes.
 */
export interface CsvColumn<Row> {
  /** The header text, emitted verbatim in the header row. */
  readonly header: string;
  /** Reads the row's own value. Never formats it. */
  readonly value: (row: Row) => CsvValue;
}

/** The field separator RFC 4180 defines. */
export const CSV_FIELD_SEPARATOR = ",";

/** The record separator: `\n`, always — never the platform's, never `\r\n`. */
export const CSV_LINE_ENDING = "\n";

/** The four characters that force a field to be quoted (RFC 4180 §2.6/2.7). */
const NEEDS_QUOTING = /[",\n\r]/;

/**
 * Renders ONE field, quoting it only when it must be quoted.
 *
 * The order of the two branches is load-bearing: a `null` is answered BEFORE
 * the string forms are considered, so it becomes an empty field and never the
 * four characters `null`. A number is stringified with `String(n)`, which for
 * the integer counts on this surface is the exact value; no `toFixed`, no
 * `Number.prototype.toLocaleString`, no thousands separator.
 */
export function encodeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "number" ? String(value) : value;
  if (!NEEDS_QUOTING.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Renders one record: every field through {@link encodeCsvField}, joined by the
 * separator. Exported so a suite can pin the separator without building a whole
 * document.
 */
export function encodeCsvLine(values: readonly CsvValue[]): string {
  return values.map((value) => encodeCsvField(value)).join(CSV_FIELD_SEPARATOR);
}

/**
 * Renders a whole CSV document: the header row from the column definitions, then
 * one line per row.
 *
 * An EMPTY row set returns the header line and nothing else — the case the Story
 * calls out explicitly, because an empty body is indistinguishable from a
 * failure and a caller would have no way to tell "no sales in this period" from
 * "the export broke".
 *
 * The document always ends with a record separator: a text file whose last line
 * is unterminated is a great many parsers' off-by-one.
 */
export function renderCsv<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  const lines: string[] = [encodeCsvLine(columns.map((column) => column.header))];
  for (const row of rows) {
    lines.push(encodeCsvLine(columns.map((column) => column.value(row))));
  }
  return `${lines.join(CSV_LINE_ENDING)}${CSV_LINE_ENDING}`;
}
