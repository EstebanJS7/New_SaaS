import { describe, expect, it } from "vitest";
import {
  CSV_LINE_ENDING,
  encodeCsvField,
  encodeCsvLine,
  renderCsv,
  type CsvColumn,
} from "./csv.js";

/**
 * The CSV serializer ([[REP-007]], [[DEC-066]]).
 *
 * The assertions are on the exact BYTES the serializer produces, never on "it
 * looks like CSV": the whole point of the module is that a comma, a quote, a
 * newline and a decimal string each have one representation, and any test that
 * accepted a variant would be accepting the defect the Story names.
 */

interface MoneyRow {
  readonly label: string;
  readonly gross: string | null;
  readonly saleCount: number;
}

const MONEY_COLUMNS: readonly CsvColumn<MoneyRow>[] = [
  { header: "label", value: (row) => row.label },
  { header: "gross", value: (row) => row.gross },
  { header: "saleCount", value: (row) => row.saleCount },
];

describe("encodeCsvField · RFC 4180 quoting", () => {
  it("quotes a field containing a comma", () => {
    expect(encodeCsvField("García, Ana")).toBe('"García, Ana"');
  });

  it("quotes a field containing a double quote and doubles the quote", () => {
    expect(encodeCsvField('Royal "Canin" 3kg')).toBe('"Royal ""Canin"" 3kg"');
  });

  it("quotes a field containing a newline and keeps the newline", () => {
    expect(encodeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a carriage return, so CRLF input cannot break the record", () => {
    expect(encodeCsvField("line one\rline two")).toBe('"line one\rline two"');
  });

  it("leaves a plain field untouched — spaces, accents and apostrophes are not special", () => {
    expect(encodeCsvField("Antiparasitario O'Brien 5 ml")).toBe("Antiparasitario O'Brien 5 ml");
    expect(encodeCsvField("CASH")).toBe("CASH");
  });

  it("renders a null or absent value as an EMPTY field, never the word null", () => {
    // A cash-movement row's `direction` is null for every type-owned kind.
    expect(encodeCsvField(null)).toBe("");
    expect(encodeCsvField(undefined)).toBe("");
    expect(encodeCsvField("")).toBe("");
  });

  it("renders an integer count with String(n) — no separators, no locale", () => {
    expect(encodeCsvField(0)).toBe("0");
    expect(encodeCsvField(1_234)).toBe("1234");
  });

  it("keeps a decimal STRING verbatim: 1234.50 is never 1234.5 and 0.10 is never 0.1", () => {
    // The trap the Story names outright: any coercion to a number would round
    // the stored scale away, and any formatting would add a thousands separator.
    expect(encodeCsvField("1234.50")).toBe("1234.50");
    expect(encodeCsvField("0.10")).toBe("0.10");
    expect(encodeCsvField("0.000")).toBe("0.000");
    expect(encodeCsvField("-5.00")).toBe("-5.00");
  });
});

describe("encodeCsvLine · the record separator", () => {
  it("joins fields with a comma and nothing else", () => {
    expect(encodeCsvLine(["a", 1, null])).toBe("a,1,");
  });
});

describe("renderCsv · the document", () => {
  it("writes the header row from the column definitions, in definition order", () => {
    const csv = renderCsv(MONEY_COLUMNS, []);

    expect(csv).toBe(`label,gross,saleCount${CSV_LINE_ENDING}`);
  });

  it("produces the header line and NOTHING else for an empty row set", () => {
    // An empty period is a file with headers: an empty body would be
    // indistinguishable from a broken export.
    const csv = renderCsv(MONEY_COLUMNS, []);

    expect(csv.split(CSV_LINE_ENDING)).toEqual(["label,gross,saleCount", ""]);
    expect(csv.startsWith("label,gross,saleCount\n")).toBe(true);
    expect(csv.replace(CSV_LINE_ENDING, "")).not.toContain("\n");
  });

  it("writes one line per row, each ending in \n, with no BOM and no CR", () => {
    const csv = renderCsv(MONEY_COLUMNS, [
      { label: "day one", gross: "1234.50", saleCount: 2 },
      { label: "day, two", gross: null, saleCount: 0 },
    ]);

    expect(csv).toBe(
      ["label,gross,saleCount", "day one,1234.50,2", '"day, two",,0', ""].join(CSV_LINE_ENDING)
    );
    // No byte-order marker: a BOM breaks `a,b` in some older consumers.
    expect(csv.charCodeAt(0)).toBe(0x6c);
    expect(csv).not.toContain("\ufeff");
    expect(csv).not.toContain("\r");
  });

  it("does not reformat the money string it is handed", () => {
    const csv = renderCsv(MONEY_COLUMNS, [{ label: "x", gross: "1234.50", saleCount: 1 }]);

    expect(csv).toContain("1234.50");
    expect(csv).not.toContain("1234.5,");
    expect(csv).not.toContain("1,234");
  });
});
