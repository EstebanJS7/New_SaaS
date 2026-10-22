import { describe, expect, it } from "vitest";
import { CSV_REJECTION_CODES, parseCsv } from "./csv.js";

/**
 * The reader's contract, one case at a time ([[IMP-002]]). No infra: the module
 * takes a string and returns a value.
 */
describe("parseCsv", () => {
  it("reads a header row and its data rows", () => {
    expect(parseCsv("display_name,kind\nAna,INDIVIDUAL\nBeto,COMPANY\n")).toEqual({
      ok: true,
      headers: ["display_name", "kind"],
      rows: [
        ["Ana", "INDIVIDUAL"],
        ["Beto", "COMPANY"],
      ],
    });
  });

  it("reads a last record that the file does not terminate with a separator", () => {
    expect(parseCsv("a,b\n1,2")).toEqual({ ok: true, headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual({
      ok: true,
      headers: ["a", "b"],
      rows: [["x,y", "z"]],
    });
  });

  it("decodes a doubled quote inside a quoted field as one literal quote", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual({
      ok: true,
      headers: ["a"],
      rows: [['say "hi"']],
    });
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"line 1\nline 2",z')).toEqual({
      ok: true,
      headers: ["a", "b"],
      rows: [["line 1\nline 2", "z"]],
    });
  });

  it("ends a record on CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual({
      ok: true,
      headers: ["a", "b"],
      rows: [["1", "2"]],
    });
  });

  it("ends a record on a lone CR outside quotes", () => {
    expect(parseCsv("a,b\r1,2")).toEqual({ ok: true, headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("preserves a CR inside a quoted field", () => {
    expect(parseCsv('a\r"x\ry"')).toEqual({ ok: true, headers: ["a"], rows: [["x\ry"]] });
  });

  it("strips a UTF-8 BOM from the first header", () => {
    expect(parseCsv("\uFEFFdisplay_name\nAna")).toEqual({
      ok: true,
      headers: ["display_name"],
      rows: [["Ana"]],
    });
  });

  it("ignores a blank trailing line", () => {
    expect(parseCsv("a\n1\n\n")).toEqual({ ok: true, headers: ["a"], rows: [["1"]] });
    expect(parseCsv("a\n1\n\n\n")).toEqual({ ok: true, headers: ["a"], rows: [["1"]] });
    expect(parseCsv("a\n1\n   \n")).toEqual({ ok: true, headers: ["a"], rows: [["1"]] });
  });

  it("refuses an unterminated quoted field with its own code", () => {
    const result = parseCsv('a,b\n"x,2');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CSV_REJECTION_CODES.UNTERMINATED_QUOTED_FIELD);
    expect(result.message).toContain("never closed");
  });

  it("refuses a row whose field count differs from the header, naming the row", () => {
    const short = parseCsv("a,b\n1,2\n3\n");

    expect(short.ok).toBe(false);
    if (short.ok) return;
    expect(short.code).toBe(CSV_REJECTION_CODES.FIELD_COUNT_MISMATCH);
    expect(short.message).toContain("Row 2");
    expect(short.message).toContain("1 field(s)");
    expect(short.message).toContain("header has 2");

    const long = parseCsv("a,b\n1,2,3\n");
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(long.code).toBe(CSV_REJECTION_CODES.FIELD_COUNT_MISMATCH);
    expect(long.message).toContain("Row 1");
    expect(long.message).toContain("3 field(s)");
  });

  it("refuses a blank line in the middle, naming its row", () => {
    const result = parseCsv("a,b\n1,2\n\n3,4\n");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CSV_REJECTION_CODES.BLANK_LINE);
    expect(result.message).toContain("Row 2");
  });

  it("treats a row of empty cells as data, not as a blank line", () => {
    expect(parseCsv("a,b\n,\n")).toEqual({
      ok: true,
      headers: ["a", "b"],
      rows: [["", ""]],
    });
  });

  it("refuses an empty file with its own code", () => {
    for (const text of ["", "   \n  \n", "\uFEFF"]) {
      const result = parseCsv(text);

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe(CSV_REJECTION_CODES.EMPTY_FILE);
      expect(result.message).toContain("header row");
    }
  });

  it("reads a header-only file as headers with no rows", () => {
    expect(parseCsv("display_name,kind\n")).toEqual({
      ok: true,
      headers: ["display_name", "kind"],
      rows: [],
    });
  });
});
