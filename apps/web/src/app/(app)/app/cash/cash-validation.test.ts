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
    expect(cashRegisterNameError("")).toBe("Ingresá un nombre para la caja.");
    expect(cashRegisterNameError("   ")).toBe("Ingresá un nombre para la caja.");
  });

  it("accepts the column maximum and refuses one character more", () => {
    expect(cashRegisterNameError("a".repeat(CASH_REGISTER_NAME_MAX_LENGTH))).toBeNull();
    expect(cashRegisterNameError("a".repeat(CASH_REGISTER_NAME_MAX_LENGTH + 1))).toBe(
      `El nombre de la caja admite hasta ${CASH_REGISTER_NAME_MAX_LENGTH} caracteres.`
    );
  });

  it("trims before measuring", () => {
    expect(cashRegisterNameError("  Front desk  ")).toBeNull();
  });
});

describe("cashOpeningAmountError and cashCountedAmountError", () => {
  it("accepts an empty drawer and both zero spellings", () => {
    expect(cashOpeningAmountError("0")).toBeNull();
    expect(cashOpeningAmountError("0,00")).toBeNull();
    expect(cashCountedAmountError("0")).toBeNull();
    expect(cashCountedAmountError("0,00")).toBeNull();
  });

  it("requires a value", () => {
    expect(cashOpeningAmountError("")).toBe("Ingresá el importe inicial.");
    expect(cashCountedAmountError("   ")).toBe("Ingresá el importe contado.");
  });

  it("refuses a sign, a third decimal and an oversized integer part", () => {
    expect(cashOpeningAmountError("-1,00")).not.toBeNull();
    expect(cashOpeningAmountError("1,234")).not.toBeNull();
    expect(cashOpeningAmountError("1".repeat(13))).not.toBeNull();
    expect(cashCountedAmountError("-1,00")).not.toBeNull();
    expect(cashCountedAmountError("1,234")).not.toBeNull();
  });

  it("accepts the widest in-contract literal", () => {
    expect(cashOpeningAmountError("999999999999,99")).toBeNull();
    expect(cashCountedAmountError("999999999999,99")).toBeNull();
  });
});

describe("cashMovementAmountError", () => {
  it("requires a value", () => {
    expect(cashMovementAmountError("")).toBe("Ingresá el importe.");
  });

  it("refuses a sign and a third decimal", () => {
    expect(cashMovementAmountError("-5,00")).toBe(
      "Ingresá un importe positivo con hasta dos decimales, usando coma decimal."
    );
    expect(cashMovementAmountError("1,234")).toBe(
      "Ingresá un importe positivo con hasta dos decimales, usando coma decimal."
    );
  });

  it("refuses every spelling of the literal zero", () => {
    expect(cashMovementAmountError("0")).toBe("El importe del movimiento debe ser mayor que cero.");
    expect(cashMovementAmountError("0,00")).toBe(
      "El importe del movimiento debe ser mayor que cero."
    );
  });

  it("accepts a positive exact literal", () => {
    expect(cashMovementAmountError("1500,00")).toBeNull();
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
        "Ingresá un motivo para este tipo de movimiento."
      );
      expect(cashMovementReasonError(type, "   ")).toBe(
        "Ingresá un motivo para este tipo de movimiento."
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
      `El motivo admite hasta ${CASH_MOVEMENT_REASON_MAX_LENGTH} caracteres.`
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
    expect(cashMovementDirectionError("ADJUSTMENT", "")).toBe("Elegí el sentido del ajuste.");
    expect(cashMovementDirectionError("ADJUSTMENT", "INCREASE")).toBeNull();
    expect(cashMovementDirectionError("ADJUSTMENT", "DECREASE")).toBeNull();
  });

  it("forbids a direction for every other kind", () => {
    expect(cashMovementDirectionError("INCOME", "")).toBeNull();
    expect(cashMovementDirectionError("INCOME", "INCREASE")).toBe(
      "El sentido solo corresponde a un ajuste."
    );
    expect(cashMovementDirectionError("EXPENSE", "DECREASE")).toBe(
      "El sentido solo corresponde a un ajuste."
    );
  });
});

describe("cashMovementDraftError", () => {
  it("reports the amount first, then the reason, then the direction", () => {
    expect(cashMovementDraftError({ type: "EXPENSE", amount: "", reason: "", direction: "" })).toBe(
      "Ingresá el importe."
    );
    expect(
      cashMovementDraftError({ type: "EXPENSE", amount: "10,00", reason: "", direction: "" })
    ).toBe("Ingresá un motivo para este tipo de movimiento.");
    expect(
      cashMovementDraftError({
        type: "ADJUSTMENT",
        amount: "10,00",
        reason: "Recount",
        direction: "",
      })
    ).toBe("Elegí el sentido del ajuste.");
  });

  it("accepts an INCOME movement without a reason or direction", () => {
    expect(
      cashMovementDraftError({ type: "INCOME", amount: "10,00", reason: "", direction: "" })
    ).toBeNull();
  });

  it("accepts a fully specified ADJUSTMENT", () => {
    expect(
      cashMovementDraftError({
        type: "ADJUSTMENT",
        amount: "10,00",
        reason: "Recount",
        direction: "DECREASE",
      })
    ).toBeNull();
  });
});
