import { describe, expect, it } from "vitest";
import { completeSaleBody } from "./sales.zod.js";
import { paymentDetail, saleCompletionFingerprint } from "./sales.service.js";

/** PAY-DET-001 / DEC-091: the payment detail the factura electrónica needs. */
const SALE = "33333333-3333-4333-8333-333333333333";

function parse(payment: Record<string, unknown>) {
  return completeSaleBody.safeParse({ payments: [{ amount: "100.00", ...payment }] });
}

describe("completeSaleBody — payment detail per method (PAY-DET-001)", () => {
  it.each([
    ["cash, with nothing else", { method: "CASH" }],
    ["a transfer, with nothing else", { method: "BANK_TRANSFER" }],
    ["a credit Visa", { method: "CARD", card: { type: "CREDIT", brand: "VISA" } }],
    [
      "a debit card of another brand, named",
      { method: "CARD", card: { type: "DEBIT", brand: "OTHER", brandName: "Bancard" } },
    ],
    ["a wallet QR", { method: "QR", qrKind: "WALLET" }],
    ["a cheque", { method: "CHECK", check: { number: "1234", bank: "Banco Basa" } }],
    ["an 'other' payment, described", { method: "OTHER", otherDescription: "Canje de puntos" }],
  ])("accepts %s", (_label, payment) => {
    expect(parse(payment).success).toBe(true);
  });

  it.each([
    ["a card without its detail", { method: "CARD" }],
    [
      "a card of another brand without its name",
      { method: "CARD", card: { type: "CREDIT", brand: "OTHER" } },
    ],
    [
      "a named brand that is not OTHER",
      { method: "CARD", card: { type: "CREDIT", brand: "VISA", brandName: "Visa" } },
    ],
    ["a QR without its kind", { method: "QR" }],
    [
      "a cheque number longer than 8 digits",
      { method: "CHECK", check: { number: "123456789", bank: "Banco Basa" } },
    ],
    [
      "a cheque bank shorter than 4 characters",
      { method: "CHECK", check: { number: "1", bank: "BB" } },
    ],
    ["an 'other' payment without a description", { method: "OTHER" }],
    ["cash carrying card detail", { method: "CASH", card: { type: "CREDIT", brand: "VISA" } }],
    ["a transfer carrying a QR kind", { method: "BANK_TRANSFER", qrKind: "WALLET" }],
    ["an unknown detail key", { method: "CASH", tip: "10" }],
  ])("refuses %s", (_label, payment) => {
    expect(parse(payment).success).toBe(false);
  });
});

describe("paymentDetail and the completion fingerprint", () => {
  it("zero-pads a cheque number to the eight digits dNumCheq requires", () => {
    const body = completeSaleBody.parse({
      payments: [
        { method: "CHECK", amount: "1.00", check: { number: "1234", bank: "Banco Basa" } },
      ],
    });
    const [payment] = body.payments;
    if (payment === undefined) throw new Error("parsed one payment");
    expect(paymentDetail(payment)).toEqual({ checkNumber: "00001234", checkBank: "Banco Basa" });
  });

  it("keeps the fingerprint of a detail-less payment unchanged", () => {
    expect(saleCompletionFingerprint(SALE, [{ method: "CASH", amount: "10" }])).toBe(
      saleCompletionFingerprint(SALE, [{ method: "CASH", amount: "10.00", detail: undefined }])
    );
  });

  it("tells two cards apart by their detail", () => {
    const credit = saleCompletionFingerprint(SALE, [
      { method: "CARD", amount: "10", detail: { cardType: "CREDIT", cardBrand: "VISA" } },
    ]);
    const debit = saleCompletionFingerprint(SALE, [
      { method: "CARD", amount: "10", detail: { cardType: "DEBIT", cardBrand: "VISA" } },
    ]);
    expect(credit).not.toBe(debit);
  });
});
