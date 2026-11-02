import { describe, expect, it } from "vitest";
import {
  CASH_MOVEMENT_DIRECTION_LABELS,
  CASH_MOVEMENT_TYPE_LABELS,
  CASH_SESSION_STATUS_LABELS,
  cashDifferenceLabel,
  cashDifferenceOutcome,
  formatCashAmount,
  formatDate,
  formatSignedWireAmount,
  shortId,
} from "./cash-display";

describe("cash-display labels", () => {
  it("labels every pinned session status", () => {
    expect(CASH_SESSION_STATUS_LABELS).toEqual({ OPEN: "Abierta", CLOSED: "Cerrada" });
  });

  it("labels every movement kind the standalone command accepts", () => {
    expect(CASH_MOVEMENT_TYPE_LABELS).toEqual({
      REFUND: "Devolución",
      INCOME: "Ingreso",
      EXPENSE: "Gasto",
      WITHDRAWAL: "Retiro",
      DEPOSIT: "Depósito",
      ADJUSTMENT: "Ajuste",
    });
    // A sale-generated movement is never offered by the surface.
    expect(Object.keys(CASH_MOVEMENT_TYPE_LABELS)).not.toContain("SALE");
  });

  it("labels both explicit adjustment directions", () => {
    expect(CASH_MOVEMENT_DIRECTION_LABELS).toEqual({
      INCREASE: "Aumentar efectivo esperado",
      DECREASE: "Disminuir efectivo esperado",
    });
  });
});

describe("cash-display formatting", () => {
  it("groups an exact wire amount without parsing it", () => {
    expect(formatCashAmount("1500.00")).toBe("1.500");
    expect(formatCashAmount("500000")).toBe("500.000");
    expect(formatCashAmount("9007199254740993.50")).toBe("9.007.199.254.740.993,50");
    expect(formatCashAmount("0.01")).toBe("0,01");
    expect(formatCashAmount("not-an-amount")).toBe("not-an-amount");
  });

  it("shortens an id and a timestamp for display", () => {
    expect(shortId("22222222-2222-4222-8222-222222222222")).toBe("22222222");
    expect(formatDate("2026-09-27T08:00:00.000Z")).toBe("27 sept. 2026, 05:00 a. m.");
  });
});

describe("formatSignedWireAmount", () => {
  it("renders a negative difference with an explicit minus sign", () => {
    expect(formatSignedWireAmount("-1500.00")).toBe("-1.500");
    expect(formatSignedWireAmount("-0.50")).toBe("-0,50");
    expect(formatSignedWireAmount("-9007199254740993.50")).toBe("-9.007.199.254.740.993,50");
  });

  it("renders a positive difference with an explicit plus sign", () => {
    expect(formatSignedWireAmount("1500.00")).toBe("+1.500");
  });

  it("renders an arithmetically zero difference without a sign", () => {
    expect(formatSignedWireAmount("0.00")).toBe("0");
    expect(formatSignedWireAmount("0")).toBe("0");
    expect(formatSignedWireAmount("-0.00")).toBe("0");
  });

  it("returns a literal the wire did not produce unchanged", () => {
    expect(formatSignedWireAmount("not-an-amount")).toBe("not-an-amount");
    expect(formatSignedWireAmount("")).toBe("");
  });
});

describe("cashDifferenceOutcome", () => {
  it("reads a negative difference as a short drawer", () => {
    expect(cashDifferenceOutcome("-1500.00")).toBe("SHORT");
  });

  it("reads a positive difference as an over drawer", () => {
    expect(cashDifferenceOutcome("1500.00")).toBe("OVER");
  });

  it("reads any spelling of zero as balanced", () => {
    expect(cashDifferenceOutcome("0")).toBe("BALANCED");
    expect(cashDifferenceOutcome("0.00")).toBe("BALANCED");
    expect(cashDifferenceOutcome("-0.00")).toBe("BALANCED");
  });

  it("does not guess an outcome for a literal the wire did not produce", () => {
    expect(cashDifferenceOutcome("abc")).toBeNull();
    expect(cashDifferenceOutcome("")).toBeNull();
  });
});

describe("cashDifferenceLabel", () => {
  it("describes a short drawer as short, never as an error", () => {
    expect(cashDifferenceLabel("-1500.00")).toBe("Faltante de 1.500");
  });

  it("describes an over drawer as over", () => {
    expect(cashDifferenceLabel("1500.00")).toBe("Sobrante de 1.500");
  });

  it("describes a zero difference as balanced", () => {
    expect(cashDifferenceLabel("0.00")).toBe("Sin diferencia");
  });

  it("does not invent a reading for an unproduced literal", () => {
    expect(cashDifferenceLabel("abc")).toBe("Diferencia no disponible");
  });
});

it("formats the prior tenant day near UTC midnight and preserves invalid input", () => {
  expect(formatDate("2026-09-14T02:30:00Z")).toBe("13 sept. 2026, 11:30 p. m.");
  expect(formatDate("invalid-instant")).toBe("invalid-instant");
});
