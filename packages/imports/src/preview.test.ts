import { describe, expect, it } from "vitest";
import { CSV_REJECTION_CODES } from "./csv.js";
import { CUSTOMER_COLUMNS_REJECTION_CODES } from "./customer-columns.js";
import { CUSTOMER_ROW_REJECTION_CODES } from "./customer-row.js";
import type { DuplicateLookup } from "./duplicates.js";
import { planCustomerPreview, PREVIEW_MESSAGE_MAX_LENGTH } from "./preview.js";

const NOTHING_EXISTS: DuplicateLookup = {
  existsByDocumentNumber: () => false,
  existsByContactValue: () => false,
};

const HEADERS = "display_name,kind,legal_name,tax_id,document_number,phone,email";

/** One CREATE, one FAILED, one CREATE that is a suspected duplicate. */
const MIXED_CSV = [
  HEADERS,
  // Row 1: a valid individual whose document number already exists.
  'Ana Pérez,,,,"DOC-1",,ana@example.com',
  // Row 2: a COMPANY with no tax id — the create contract refuses it.
  "Vet Co SA,COMPANY,Vet Co SA,,,0981123456,",
  // Row 3: a valid individual nobody has seen before.
  "Beto,,,,,,",
].join("\n");

const DOCUMENT_EXISTS: DuplicateLookup = {
  existsByDocumentNumber: (value) => value === "DOC-1",
  existsByContactValue: () => false,
};

function counts(plan: ReturnType<typeof planCustomerPreview>): {
  create: number;
  failed: number;
  suspected: number;
} {
  return {
    create: plan.rows.filter((row) => row.status === "CREATE").length,
    failed: plan.rows.filter((row) => row.status === "FAILED").length,
    suspected: plan.rows.filter((row) => row.suspectedDuplicate).length,
  };
}

describe("planCustomerPreview", () => {
  it("plans one row per data row, in file order, with three counts", () => {
    const plan = planCustomerPreview({ csvText: MIXED_CSV, duplicates: DOCUMENT_EXISTS });

    expect(plan.fileError).toBeUndefined();
    expect(plan.rows.map((row) => [row.rowNumber, row.status, row.suspectedDuplicate])).toEqual([
      [1, "CREATE", true],
      [2, "FAILED", false],
      [3, "CREATE", false],
    ]);
    expect(counts(plan)).toEqual({ create: 2, failed: 1, suspected: 1 });
  });

  it("keeps a row number aligned with the file, header excluded", () => {
    const plan = planCustomerPreview({ csvText: MIXED_CSV, duplicates: DOCUMENT_EXISTS });

    expect(plan.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3]);
    expect(plan.rows[0].message).toBeUndefined();
    expect(plan.rows[1].code).toBe(CUSTOMER_ROW_REJECTION_CODES.CREATE_CONTRACT);
    expect(plan.rows[1].message).toContain("taxId");
  });

  it("keeps a suspected duplicate as CREATE: the warning can never become a skip", () => {
    const plan = planCustomerPreview({
      csvText: [HEADERS, 'Ana Pérez,,,,"DOC-1",,ana@example.com'].join("\n"),
      duplicates: DOCUMENT_EXISTS,
    });

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].status).toBe("CREATE");
    expect(plan.rows[0].suspectedDuplicate).toBe(true);
    expect(plan.rows[0].code).toBeUndefined();
  });

  it("keeps every row message within the bound", () => {
    const plan = planCustomerPreview({ csvText: MIXED_CSV, duplicates: DOCUMENT_EXISTS });

    for (const row of plan.rows) {
      if (row.message === undefined) continue;
      expect(row.message.length).toBeLessThanOrEqual(PREVIEW_MESSAGE_MAX_LENGTH);
    }
  });

  it("refuses the whole file with no rows when the CSV cannot be read", () => {
    const plan = planCustomerPreview({
      csvText: `${HEADERS}\n"Ana,INDIVIDUAL`,
      duplicates: NOTHING_EXISTS,
    });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(CSV_REJECTION_CODES.UNTERMINATED_QUOTED_FIELD);
  });

  it("refuses the whole file with no rows when a header is unknown", () => {
    const plan = planCustomerPreview({
      csvText: "display_name,favourite_colour\nAna,red\n",
      duplicates: NOTHING_EXISTS,
    });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(CUSTOMER_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER);
    expect(plan.fileError?.message).toContain("favourite_colour");
  });

  it("refuses the whole file with no rows when a required header is missing", () => {
    const plan = planCustomerPreview({
      csvText: "kind,phone\nINDIVIDUAL,0981123456\n",
      duplicates: NOTHING_EXISTS,
    });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER);
    expect(plan.fileError?.message).toContain("display_name");
  });

  it("refuses an empty file with its own code", () => {
    const plan = planCustomerPreview({ csvText: "", duplicates: NOTHING_EXISTS });

    expect(plan.rows).toEqual([]);
    expect(plan.fileError?.code).toBe(CSV_REJECTION_CODES.EMPTY_FILE);
  });

  it("plans a header-only file as zero rows and no file error", () => {
    const plan = planCustomerPreview({ csvText: `${HEADERS}\n\n`, duplicates: NOTHING_EXISTS });

    expect(plan.fileError).toBeUndefined();
    expect(plan.rows).toEqual([]);
  });

  it("bounds the file-error message of a hostile header", () => {
    const plan = planCustomerPreview({
      csvText: `display_name,${"x".repeat(400)}\nAna,red\n`,
      duplicates: NOTHING_EXISTS,
    });

    const message = plan.fileError?.message ?? "";
    expect(message.length).toBeLessThanOrEqual(PREVIEW_MESSAGE_MAX_LENGTH);
    expect(message.endsWith("…")).toBe(true);
  });
});
