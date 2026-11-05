/**
 * PAY-DET-001 / DEC-091 — a sale's payment rows in the DE's vocabulary
 * (`gPaConEIni`, Manual Técnico v150 E605–E632).
 *
 * The one place the application's payment vocabulary meets SIFEN's:
 *
 * ```text
 * CASH                         iTiPago 1  Efectivo
 * CHECK          + number/bank iTiPago 2  Cheque               gPagCheq
 * CARD CREDIT    + brand       iTiPago 3  Tarjeta de crédito   gPagTarCD
 * CARD DEBIT     + brand       iTiPago 4  Tarjeta de débito    gPagTarCD
 * BANK_TRANSFER                iTiPago 5  Transferencia
 * QR WALLET                    iTiPago 7  Billetera electrónica
 * QR BANK_APP                  iTiPago 21 Pago Electrónico
 * OTHER          + description iTiPago 99 (the description)
 * ```
 *
 * A payment written before the detail existed lacks what SIFEN needs and is
 * refused by name rather than guessed: a card cannot be assumed credit or debit.
 */

import type { DtePaymentSnapshot } from "@newsaas/fiscal";

/** One `payment` row, in the columns this mapping needs. */
export interface PaymentSnapshotRow {
  readonly method: string;
  readonly amount: { toFixed(digits: number): string };
  readonly cardType: string | null;
  readonly cardBrand: string | null;
  readonly cardBrandName: string | null;
  readonly qrKind: string | null;
  readonly checkNumber: string | null;
  readonly checkBank: string | null;
  readonly otherDescription: string | null;
}

export class PaymentSnapshotError extends Error {
  readonly refusal = "PAYMENT_DETAIL_MISSING" as const;

  constructor(message: string) {
    super(message);
    this.name = "PaymentSnapshotError";
  }
}

const CARD_BRAND_CODES: Readonly<Record<string, number>> = Object.freeze({
  VISA: 1,
  MASTERCARD: 2,
  AMERICAN_EXPRESS: 3,
  MAESTRO: 4,
  PANAL: 5,
  CABAL: 6,
  OTHER: 99,
});

/** `payment.amount` is `DECIMAL(14,2)`. */
const MONEY_SCALE = 2;

export function paymentSnapshot(row: PaymentSnapshotRow): DtePaymentSnapshot {
  const amount = row.amount.toFixed(MONEY_SCALE);
  switch (row.method) {
    case "CASH":
      return { iTiPago: 1, amount };
    case "BANK_TRANSFER":
      return { iTiPago: 5, amount };
    case "CHECK":
      if (row.checkNumber === null || row.checkBank === null) {
        throw new PaymentSnapshotError(
          "A cheque payment was recorded without its number and bank, which gPagCheq requires."
        );
      }
      return { iTiPago: 2, amount, cheque: { number: row.checkNumber, bank: row.checkBank } };
    case "CARD": {
      const brand = row.cardBrand === null ? undefined : CARD_BRAND_CODES[row.cardBrand];
      if (row.cardType === null || brand === undefined) {
        throw new PaymentSnapshotError(
          "A card payment was recorded without credit/debit and brand, which iTiPago (3 or 4) " +
            "and gPagTarCD require; neither is guessed."
        );
      }
      return {
        iTiPago: row.cardType === "DEBIT" ? 4 : 3,
        amount,
        card: {
          iDenTarj: brand,
          ...(brand === 99 && row.cardBrandName !== null ? { brandName: row.cardBrandName } : {}),
        },
      };
    }
    case "QR":
      if (row.qrKind === null) {
        throw new PaymentSnapshotError(
          "A QR payment was recorded without its kind (wallet or bank app), which iTiPago needs."
        );
      }
      return { iTiPago: row.qrKind === "WALLET" ? 7 : 21, amount };
    case "OTHER":
      if (row.otherDescription === null) {
        throw new PaymentSnapshotError(
          "An 'other' payment was recorded without a description, which dDesTiPag (99) needs."
        );
      }
      return { iTiPago: 99, amount, otherDescription: row.otherDescription };
    default:
      throw new PaymentSnapshotError(`Payment method "${row.method}" has no iTiPago mapping.`);
  }
}
