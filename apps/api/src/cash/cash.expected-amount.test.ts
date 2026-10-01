import { describe, expect, it } from "vitest";
import {
  CASH_MONEY_SCALE,
  cashMovementSign,
  computeCashCloseAmounts,
  type CashCloseMovementLike,
} from "./cash.expected-amount.js";

/** Builds one movement of the given kind/direction with a positive amount. */
function movement(
  type: CashCloseMovementLike["type"],
  amount: string,
  direction: CashCloseMovementLike["direction"] = null
): CashCloseMovementLike {
  return { type, direction, amount };
}

describe("cash expected-amount arithmetic (DEC-030/DEC-031)", () => {
  it("keeps money at the column scale and never coerces to a float", () => {
    expect(CASH_MONEY_SCALE).toBe(2);
    const { expectedAmount, differenceAmount } = computeCashCloseAmounts({
      openingAmount: "0.00",
      countedAmount: "0.00",
      movements: [],
    });
    expect(expectedAmount.toFixed(2)).toBe("0.00");
    expect(differenceAmount.toFixed(2)).toBe("0.00");
  });

  it("closes a ZERO-movement session at the opening amount", () => {
    const { expectedAmount, differenceAmount } = computeCashCloseAmounts({
      openingAmount: "250.00",
      countedAmount: "250.00",
      movements: [],
    });
    expect(expectedAmount.toFixed(2)).toBe("250.00");
    expect(differenceAmount.toFixed(2)).toBe("0.00");
  });

  it("adds SALE, INCOME and DEPOSIT and subtracts REFUND, EXPENSE and WITHDRAWAL", () => {
    const { expectedAmount, differenceAmount } = computeCashCloseAmounts({
      openingAmount: "100.00",
      countedAmount: "210.00",
      movements: [
        movement("SALE", "50.00"),
        movement("INCOME", "25.00"),
        movement("DEPOSIT", "80.00"),
        movement("REFUND", "10.00"),
        movement("EXPENSE", "20.00"),
        movement("WITHDRAWAL", "15.00"),
      ],
    });
    // 100 + 50 + 25 + 80 - 10 - 20 - 15 = 210
    expect(expectedAmount.toFixed(2)).toBe("210.00");
    expect(differenceAmount.toFixed(2)).toBe("0.00");
  });

  it("adds an INCREASE adjustment and subtracts a DECREASE one", () => {
    const increase = computeCashCloseAmounts({
      openingAmount: "100.00",
      countedAmount: "100.00",
      movements: [movement("ADJUSTMENT", "30.00", "INCREASE")],
    });
    expect(increase.expectedAmount.toFixed(2)).toBe("130.00");

    const decrease = computeCashCloseAmounts({
      openingAmount: "100.00",
      countedAmount: "100.00",
      movements: [movement("ADJUSTMENT", "30.00", "DECREASE")],
    });
    expect(decrease.expectedAmount.toFixed(2)).toBe("70.00");
  });

  it("computes a NEGATIVE difference when the drawer is short (counted - expected)", () => {
    const { expectedAmount, differenceAmount } = computeCashCloseAmounts({
      openingAmount: "100.00",
      countedAmount: "90.50",
      movements: [movement("SALE", "25.00"), movement("EXPENSE", "15.00")],
    });
    // expected = 100 + 25 - 15 = 110; difference = 90.50 - 110 = -19.50
    expect(expectedAmount.toFixed(2)).toBe("110.00");
    expect(differenceAmount.toFixed(2)).toBe("-19.50");
  });

  it("computes a POSITIVE difference when the drawer holds extra cash", () => {
    const { differenceAmount } = computeCashCloseAmounts({
      openingAmount: "0.00",
      countedAmount: "5.00",
      movements: [],
    });
    expect(differenceAmount.toFixed(2)).toBe("5.00");
  });

  it("accepts Decimal inputs and returns exact scale-2 Decimals", () => {
    const { expectedAmount, differenceAmount } = computeCashCloseAmounts({
      openingAmount: "0.10",
      countedAmount: "0.30",
      movements: [
        movement("SALE", "0.20"),
        movement("EXPENSE", "0.05"),
        movement("ADJUSTMENT", "0.01", "DECREASE"),
      ],
    });
    // 0.10 + 0.20 - 0.05 - 0.01 = 0.24 exactly, with no binary-float drift.
    expect(expectedAmount.toFixed(2)).toBe("0.24");
    expect(differenceAmount.toFixed(2)).toBe("0.06");
  });

  it.each([
    ["SALE", null, 1],
    ["INCOME", null, 1],
    ["DEPOSIT", null, 1],
    ["REFUND", null, -1],
    ["EXPENSE", null, -1],
    ["WITHDRAWAL", null, -1],
    ["ADJUSTMENT", "INCREASE", 1],
    ["ADJUSTMENT", "DECREASE", -1],
  ] as const)("maps %s/%s to sign %i", (type, direction, expectedSign) => {
    expect(cashMovementSign(type, direction)).toBe(expectedSign);
  });
});
