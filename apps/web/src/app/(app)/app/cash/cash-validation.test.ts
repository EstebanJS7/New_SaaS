import { describe, expect, it } from "vitest";
import { CASH_REGISTER_NAME_MAX_LENGTH, CASH_MOVEMENT_TYPES } from "./cash-api";
import {
  CASH_MOVEMENT_REASON_MAX_LENGTH,
  cashCountedAmountError,
  cashMovementAmountError,
  cashMovementDirectionError,
  cashMovementDraftError,
  cashMovementReasonError,
  cashOpeningAmountError,
  cashRegisterNameError,
  isCashDirectionRequired,
  isCashReasonRequired,
} from "./cash-validation";

describe("cashRegisterNameError", () => {
  it("requires a non-blank name", () => {
    expect(cashRegisterNameError("")).toBe("A cash register name is required.");
    expect(cashRegisterNameError("   ")).toBe("A cash register name is required.");
  });

  it("accepts the column maximum and refuses one character more", () => {
    expect(cashRegisterNameError("a".repeat(CASH_REGISTER_NAME_MAX_LENGTH))).toBeNull();
    expect(cashRegisterNameError("a".repeat(CASH_REGISTER_NAME_MAX_LENGTH + 1))).toBe(
      `A cash register name must be at most ${CASH_REGISTER_NAME_MAX_LENGTH} characters.`
    );
  });

  it("trims before measuring", () => {
    expect(cashRegisterNameError("  Front desk  ")).toBeNull();
  });
});

describe("cashOpeningAmountError and cashCountedAmountError", () => {
  it("accepts an empty drawer and both zero spellings", () => {
    expect(cashOpeningAmountError("0")).toBeNull();
    expect(cashOpeningAmountError("0.00")).toBeNull();
    expect(cashCountedAmountError("0")).toBeNull();
    expect(cashCountedAmountError("0.00")).toBeNull();
  });

  it("requires a value", () => {
    expect(cashOpeningAmountError("")).toBe("An opening amount is required.");
    expect(cashCountedAmountError("   ")).toBe("A counted amount is required.");
  });

  it("refuses a sign, a third decimal and an oversized integer part", () => {
    expect(cashOpeningAmountError("-1.00")).not.toBeNull();
    expect(cashOpeningAmountError("1.234")).not.toBeNull();
    expect(cashOpeningAmountError("1".repeat(13))).not.toBeNull();
    expect(cashCountedAmountError("-1.00")).not.toBeNull();
    expect(cashCountedAmountError("1.234")).not.toBeNull();
  });

  it("accepts the widest in-contract literal", () => {
    expect(cashOpeningAmountError("999999999999.99")).toBeNull();
    expect(cashCountedAmountError("999999999999.99")).toBeNull();
  });
});

describe("cashMovementAmountError", () => {
  it("requires a value", () => {
    expect(cashMovementAmountError("")).toBe("An amount is required.");
  });

  it("refuses a sign and a third decimal", () => {
    expect(cashMovementAmountError("-5.00")).toBe(
      "The movement amount must be an exact positive decimal with at most 2 decimals."
    );
    expect(cashMovementAmountError("1.234")).toBe(
      "The movement amount must be an exact positive decimal with at most 2 decimals."
    );
  });

  it("refuses every spelling of the literal zero", () => {
    expect(cashMovementAmountError("0")).toBe("The movement amount must be greater than zero.");
    expect(cashMovementAmountError("0.00")).toBe("The movement amount must be greater than zero.");
  });

  it("accepts a positive exact literal", () => {
    expect(cashMovementAmountError("1500.00")).toBeNull();
  });
});

describe("isCashReasonRequired and cashMovementReasonError", () => {
  it("requires a reason for every kind but INCOME", () => {
    for (const type of CASH_MOVEMENT_TYPES) {
      expect(isCashReasonRequired(type)).toBe(type !== "INCOME");
    }
  });

  it("refuses a blank reason on the kinds that require one", () => {
    for (const type of ["REFUND", "EXPENSE", "WITHDRAWAL", "DEPOSIT", "ADJUSTMENT"] as const) {
      expect(cashMovementReasonError(type, "")).toBe(
        "A reason is required for this movement kind."
      );
      expect(cashMovementReasonError(type, "   ")).toBe(
        "A reason is required for this movement kind."
      );
    }
  });

  it("allows a blank reason on INCOME", () => {
    expect(cashMovementReasonError("INCOME", "")).toBeNull();
    expect(cashMovementReasonError("INCOME", "   ")).toBeNull();
  });

  it("refuses a reason beyond the column bound", () => {
    expect(
      cashMovementReasonError("INCOME", "a".repeat(CASH_MOVEMENT_REASON_MAX_LENGTH))
    ).toBeNull();
    expect(cashMovementReasonError("INCOME", "a".repeat(CASH_MOVEMENT_REASON_MAX_LENGTH + 1))).toBe(
      `A reason must be at most ${CASH_MOVEMENT_REASON_MAX_LENGTH} characters.`
    );
  });
});

describe("isCashDirectionRequired and cashMovementDirectionError", () => {
  it("requires a direction exactly for ADJUSTMENT", () => {
    for (const type of CASH_MOVEMENT_TYPES) {
      expect(isCashDirectionRequired(type)).toBe(type === "ADJUSTMENT");
    }
  });

  it("requires a direction for ADJUSTMENT", () => {
    expect(cashMovementDirectionError("ADJUSTMENT", "")).toBe(
      "An adjustment direction is required."
    );
    expect(cashMovementDirectionError("ADJUSTMENT", "INCREASE")).toBeNull();
    expect(cashMovementDirectionError("ADJUSTMENT", "DECREASE")).toBeNull();
  });

  it("forbids a direction for every other kind", () => {
    expect(cashMovementDirectionError("INCOME", "")).toBeNull();
    expect(cashMovementDirectionError("INCOME", "INCREASE")).toBe(
      "A direction is only allowed for an adjustment."
    );
    expect(cashMovementDirectionError("EXPENSE", "DECREASE")).toBe(
      "A direction is only allowed for an adjustment."
    );
  });
});

describe("cashMovementDraftError", () => {
  it("reports the amount first, then the reason, then the direction", () => {
    expect(cashMovementDraftError({ type: "EXPENSE", amount: "", reason: "", direction: "" })).toBe(
      "An amount is required."
    );
    expect(
      cashMovementDraftError({ type: "EXPENSE", amount: "10.00", reason: "", direction: "" })
    ).toBe("A reason is required for this movement kind.");
    expect(
      cashMovementDraftError({
        type: "ADJUSTMENT",
        amount: "10.00",
        reason: "Recount",
        direction: "",
      })
    ).toBe("An adjustment direction is required.");
  });

  it("accepts an INCOME movement without a reason or direction", () => {
    expect(
      cashMovementDraftError({ type: "INCOME", amount: "10.00", reason: "", direction: "" })
    ).toBeNull();
  });

  it("accepts a fully specified ADJUSTMENT", () => {
    expect(
      cashMovementDraftError({
        type: "ADJUSTMENT",
        amount: "10.00",
        reason: "Recount",
        direction: "DECREASE",
      })
    ).toBeNull();
  });
});
