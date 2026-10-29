import { describe, expect, it } from "vitest";
import { formatEsPyDecimalInput, normalizeEsPyDecimalInput } from "./es-py-format";

describe("editable Paraguay decimal boundary", () => {
  it.each(["120000.00", "1.500", "9007199254740993.12", "0.01"])(
    "preserves magnitude and scale for API value %s",
    (wire) => {
      expect(normalizeEsPyDecimalInput(formatEsPyDecimalInput(wire))).toBe(wire);
    }
  );

  it.each([
    ["120.000", "120000"],
    ["1.234,50", "1234.50"],
    ["1,500", "1.500"],
    ["1.000", "1000"],
    [" 0,10 ", "0.10"],
  ])("normalizes local %s to exact wire %s", (local, wire) => {
    expect(normalizeEsPyDecimalInput(local)).toBe(wire);
  });

  it.each(["1.23", "12.34,50", "1,234.50", "1e3", "-1", "", "1,", "NaN"])(
    "rejects malformed or non-local input %s",
    (local) => expect(normalizeEsPyDecimalInput(local)).toBeNull()
  );
});
