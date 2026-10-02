import { describe, expect, it } from "vitest";
import {
  INVOICE_STATUS_LABELS,
  billingInputClassName,
  billingTextareaClassName,
  formatInvoiceAmount,
  formatQuantity,
  formatTimestamp,
  invoiceNumberLabel,
  shortId,
} from "./billing-display";

describe("billing-display labels", () => {
  it("labels every pinned invoice status", () => {
    expect(INVOICE_STATUS_LABELS).toEqual({
      DRAFT: "Draft",
      CONFIRMED: "Confirmed",
      CANCELLED: "Cancelled",
    });
  });

  it("labels the allocated number only once the API has allocated one", () => {
    expect(invoiceNumberLabel("A", null)).toBe("No number yet");
    expect(invoiceNumberLabel("A", 12)).toBe("A-12");
  });
});

describe("billing-display control classes", () => {
  it("uses semantic tokens only, with no brand literal", () => {
    for (const className of [billingInputClassName, billingTextareaClassName]) {
      expect(className).toContain("border-input");
      expect(className).toContain("bg-background");
      expect(className).toContain("text-foreground");
      // No hex colour, no arbitrary value and no tenant-specific literal.
      expect(className).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(className).not.toMatch(/\[[^\]]+\]/);
    }
  });
});

describe("formatInvoiceAmount", () => {
  it("groups an exact wire amount without parsing it", () => {
    expect(formatInvoiceAmount("10.50")).toBe("10.50");
    expect(formatInvoiceAmount("1500.00")).toBe("1,500.00");
    expect(formatInvoiceAmount("1000000.00")).toBe("1,000,000.00");
    expect(formatInvoiceAmount("0.95")).toBe("0.95");
  });

  it("returns a literal the wire did not produce unchanged", () => {
    expect(formatInvoiceAmount("not-an-amount")).toBe("not-an-amount");
    expect(formatInvoiceAmount("-1.00")).toBe("-1.00");
  });
});

describe("formatQuantity", () => {
  it("strips redundant trailing zeros textually", () => {
    expect(formatQuantity("2.000")).toBe("2");
    expect(formatQuantity("0.500")).toBe("0.5");
    expect(formatQuantity("1.250")).toBe("1.25");
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity("0.000")).toBe("0");
  });

  it("returns a literal the wire did not produce unchanged", () => {
    expect(formatQuantity("two")).toBe("two");
    expect(formatQuantity("")).toBe("");
  });
});

describe("formatTimestamp", () => {
  it("renders an API ISO timestamp explicitly in UTC", () => {
    expect(formatTimestamp("2026-10-01T09:30:00.000Z")).toBe("2026-10-01 09:30 UTC");
    expect(formatTimestamp("2026-10-01T09:30Z")).toBe("2026-10-01 09:30 UTC");
  });

  it("returns a literal the API did not produce unchanged", () => {
    expect(formatTimestamp("not-a-timestamp")).toBe("not-a-timestamp");
    expect(formatTimestamp("")).toBe("");
  });
});

describe("shortId", () => {
  it("shows a short, stable fragment of an identifier", () => {
    expect(shortId("99999999-9999-4999-8999-999999999999")).toBe("99999999");
  });
});
