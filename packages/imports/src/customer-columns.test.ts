import { describe, expect, it } from "vitest";
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMNS_REJECTION_CODES,
  CUSTOMER_COLUMN_HEADERS,
  normalizeCustomerHeader,
  REQUIRED_CUSTOMER_COLUMNS,
  resolveCustomerColumns,
} from "./customer-columns.js";

/**
 * The header contract ([[IMP-002]]): ONE declaration, and a refusal for every
 * header it cannot place.
 */
describe("normalizeCustomerHeader", () => {
  it("trims, collapses internal whitespace runs and lowercases", () => {
    expect(normalizeCustomerHeader(" Display   Name ")).toBe("display_name");
    expect(normalizeCustomerHeader("TAX_ID")).toBe("tax_id");
    expect(normalizeCustomerHeader("E-mail")).toBe("e-mail");
  });

  it("strips a BOM that survived to a header", () => {
    expect(normalizeCustomerHeader("\uFEFFdisplay_name")).toBe("display_name");
  });
});

describe("resolveCustomerColumns", () => {
  it("declares the contract once, with one required column", () => {
    expect(Object.keys(CUSTOMER_COLUMNS)).toEqual([
      "display_name",
      "kind",
      "first_name",
      "last_name",
      "document_number",
      "legal_name",
      "tax_id",
      "phone",
      "email",
    ]);
    expect(REQUIRED_CUSTOMER_COLUMNS).toEqual(["display_name"]);
    expect(CUSTOMER_COLUMN_HEADERS).toEqual(Object.keys(CUSTOMER_COLUMNS));
  });

  it("normalizes the file's headers before matching them", () => {
    const result = resolveCustomerColumns([" Display   Name ", "KIND", "\uFEFFPHONE"]);

    expect(result).toEqual({
      ok: true,
      layout: {
        headers: ["display_name", "kind", "phone"],
        index: { displayName: 0, kind: 1, phone: 2 },
      },
    });
  });

  it("matches by header name, so a re-ordered file resolves to the right columns", () => {
    const result = resolveCustomerColumns(["email", "display_name", "kind"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.index).toEqual({ email: 0, displayName: 1, kind: 2 });
  });

  it("refuses an unknown header, naming it", () => {
    const result = resolveCustomerColumns(["display_name", "favourite_colour"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_COLUMNS_REJECTION_CODES.UNKNOWN_HEADER);
    expect(result.message).toContain("favourite_colour");
    expect(result.message).toContain("display_name");
  });

  it("refuses two headers that normalize to the same column, naming it", () => {
    const result = resolveCustomerColumns(["display_name", "Display Name"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_COLUMNS_REJECTION_CODES.DUPLICATE_HEADER);
    expect(result.message).toContain("display_name");
  });

  it("refuses a file with no required header, naming it", () => {
    const result = resolveCustomerColumns(["kind", "phone", "email"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(CUSTOMER_COLUMNS_REJECTION_CODES.MISSING_REQUIRED_HEADER);
    expect(result.message).toContain("display_name");
  });
});
