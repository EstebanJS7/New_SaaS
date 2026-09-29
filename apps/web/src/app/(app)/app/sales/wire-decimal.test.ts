/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  addWireDecimals,
  isWireDecimal,
  paymentsSumExactly,
  wireDecimalsEqual,
} from "./wire-decimal";

describe("isWireDecimal", () => {
  it("accepts exact non-negative decimal literals", () => {
    expect(isWireDecimal("0")).toBe(true);
    expect(isWireDecimal("1500")).toBe(true);
    expect(isWireDecimal("1500.00")).toBe(true);
    expect(isWireDecimal("0.001")).toBe(true);
    expect(isWireDecimal(" 42.50 ")).toBe(true);
  });

  it("rejects a sign, an exponent and a malformed literal", () => {
    expect(isWireDecimal("-1.00")).toBe(false);
    expect(isWireDecimal("1e3")).toBe(false);
    expect(isWireDecimal("1,500.00")).toBe(false);
    expect(isWireDecimal("")).toBe(false);
    expect(isWireDecimal("1.")).toBe(false);
    expect(isWireDecimal(".5")).toBe(false);
  });
});

describe("addWireDecimals", () => {
  it("adds exact decimals without binary floating-point drift", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754; exact addition is 0.30.
    expect(addWireDecimals(["0.10", "0.20"])).toBe("0.30");
    expect(addWireDecimals(["0.1", "0.2"])).toBe("0.3");
  });

  it("keeps the widest input scale and carries across places", () => {
    expect(addWireDecimals(["9.99", "0.01"])).toBe("10.00");
    expect(addWireDecimals(["999999999999.99", "0.01"])).toBe("1000000000000.00");
    expect(addWireDecimals(["1.5", "2.25"])).toBe("3.75");
  });

  it("sums many small amounts exactly", () => {
    expect(addWireDecimals(["0.01", "0.01", "0.01", "0.01", "0.01"])).toBe("0.05");
  });

  it("returns zero for an empty set and null for an invalid member", () => {
    expect(addWireDecimals([])).toBe("0");
    expect(addWireDecimals(["1.00", "oops"])).toBeNull();
  });
});

describe("wireDecimalsEqual", () => {
  it("compares by value, not by spelling", () => {
    expect(wireDecimalsEqual("10.5", "10.50")).toBe(true);
    expect(wireDecimalsEqual("0010.50", "10.5")).toBe(true);
    expect(wireDecimalsEqual("10.50", "10.51")).toBe(false);
  });

  it("is false when either literal is not exact", () => {
    expect(wireDecimalsEqual("10.50", "nope")).toBe(false);
    expect(wireDecimalsEqual("nope", "10.50")).toBe(false);
  });
});

describe("paymentsSumExactly", () => {
  it("accepts a single payment equal to the total", () => {
    expect(paymentsSumExactly(["1500.00"], "1500.00")).toBe(true);
    expect(paymentsSumExactly(["1500"], "1500.00")).toBe(true);
  });

  it("accepts several payments that sum exactly across methods", () => {
    expect(paymentsSumExactly(["1000.00", "400.00", "100.00"], "1500.00")).toBe(true);
    expect(paymentsSumExactly(["0.10", "0.20"], "0.30")).toBe(true);
  });

  it("refuses a set that is off by the smallest unit and never rounds it away", () => {
    expect(paymentsSumExactly(["1499.99"], "1500.00")).toBe(false);
    expect(paymentsSumExactly(["0.01", "0.01"], "0.03")).toBe(false);
  });

  it("refuses an invalid or empty set", () => {
    expect(paymentsSumExactly([], "0.00")).toBe(false);
    expect(paymentsSumExactly(["1500.00", "x"], "1500.00")).toBe(false);
  });
});
