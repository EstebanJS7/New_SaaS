import { describe, expect, it } from "vitest";
import { formatEsPyInstant, formatPygAmount } from "@/lib/es-py-format";
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
      DRAFT: "Borrador",
      CONFIRMED: "Confirmada",
      CANCELLED: "Anulada",
    });
  });

  it("labels the allocated number only once the API has allocated one", () => {
    expect(invoiceNumberLabel("A", null)).toBe("Sin número todavía");
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

/** Intl may print narrow or non-breaking spaces; compare the visible words. */
function visible(value: string): string {
  return value.replace(/\s+/g, " ");
}

describe("formatInvoiceAmount", () => {
  it("formats a guaraní wire amount in es-PY without parsing it", () => {
    expect(formatInvoiceAmount("10.50", "PYG")).toBe(formatPygAmount("10.50"));
    expect(visible(formatInvoiceAmount("10.50", "PYG"))).toBe("Gs. 10,50");
    expect(visible(formatInvoiceAmount("1500.00", "PYG"))).toBe("Gs. 1.500");
    expect(visible(formatInvoiceAmount("1000000.00", "PYG"))).toBe("Gs. 1.000.000");
    expect(visible(formatInvoiceAmount("0.95", "PYG"))).toBe("Gs. 0,95");
  });

  it("groups another currency's exact amount with es-PY punctuation and its code", () => {
    expect(formatInvoiceAmount("1500.25", "USD")).toBe("1.500,25 USD");
  });

  it("returns a literal the wire did not produce unchanged", () => {
    expect(formatInvoiceAmount("not-an-amount", "PYG")).toBe("not-an-amount");
  });
});

describe("formatQuantity", () => {
  it("strips redundant trailing zeros textually and uses es-PY punctuation", () => {
    expect(formatQuantity("2.000")).toBe("2");
    expect(formatQuantity("0.500")).toBe("0,5");
    expect(formatQuantity("1.250")).toBe("1,25");
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity("0.000")).toBe("0");
    expect(formatQuantity("1500.250")).toBe("1.500,25");
  });

  it("returns a literal the wire did not produce unchanged", () => {
    expect(formatQuantity("two")).toBe("two");
    expect(formatQuantity("")).toBe("");
  });
});

describe("formatTimestamp", () => {
  it("renders an API instant in the clinic's es-PY local time, never as UTC", () => {
    expect(formatTimestamp("2026-10-01T09:30:00.000Z")).toBe(
      formatEsPyInstant("2026-10-01T09:30:00.000Z")
    );
    expect(visible(formatTimestamp("2026-10-01T09:30:00.000Z"))).toBe("1 oct. 2026, 06:30 a. m.");
    expect(formatTimestamp("2026-10-01T09:30:00.000Z")).not.toContain("UTC");
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
