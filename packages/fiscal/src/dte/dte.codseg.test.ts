import { describe, expect, it } from "vitest";
import {
  generateSecurityCode,
  SECURITY_CODE_DIGITS,
  SECURITY_CODE_MAX_ATTEMPTS,
} from "./dte.codseg.js";
import { DteValidationError } from "./dte.rules.js";

/** A deterministic stand-in for `crypto.randomInt(0, 10)`. */
function digitsFrom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    if (value === undefined) {
      throw new Error("the stub ran out of digits");
    }
    index += 1;
    return value;
  };
}

describe("generateSecurityCode (§10.3)", () => {
  it("draws nine digits and zero-pads them", () => {
    // Nine draws, most of them zero: the Manual's "completar con 0 a la izquierda".
    const { dCodSeg, attempts } = generateSecurityCode({
      randomDigit: digitsFrom([0, 0, 0, 0, 0, 0, 0, 0, 1]),
      documentNumber: "0000002",
    });

    expect(dCodSeg).toBe("000000001");
    expect(dCodSeg).toHaveLength(SECURITY_CODE_DIGITS);
    expect(attempts).toBe(1);
  });

  it("produces a different value on every call with a real-shaped source", () => {
    // Not a proof of randomness — that is the source's job — but it pins that the
    // function does not derive the value from the document or the issuer: the
    // same inputs with a different draw give a different code.
    const first = generateSecurityCode({
      randomDigit: digitsFrom([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      documentNumber: "0000002",
    });
    const second = generateSecurityCode({
      randomDigit: digitsFrom([9, 8, 7, 6, 5, 4, 3, 2, 1]),
      documentNumber: "0000002",
    });

    expect(first.dCodSeg).toBe("123456789");
    expect(second.dCodSeg).toBe("987654321");
    expect(first.dCodSeg).not.toBe(second.dCodSeg);
  });

  it("cannot collide with a well-formed dNumDoc, because seven digits is not nine", () => {
    // The Manual states the rule, so it is implemented — but this is why it
    // almost never fires: `tdNumDoc` is exactly seven digits and `tdCodSeg`
    // exactly nine, so a valid pair can never be equal. The rule is a safety net
    // for a caller that is out of contract, and the guard is exercised below.
    const { dCodSeg, attempts } = generateSecurityCode({
      randomDigit: digitsFrom([0, 0, 0, 0, 0, 0, 2, 1, 1]),
      documentNumber: "0000002",
    });

    expect(attempts).toBe(1);
    expect(dCodSeg).toBe("000000211");
    expect(dCodSeg).not.toBe("0000002");
  });

  it("redraws when the draw does equal the supplied document number", () => {
    // Nine digits, so this value is out of contract for `dNumDoc` — which is
    // exactly the case the guard exists for. First draw collides, second does not.
    const { dCodSeg, attempts } = generateSecurityCode({
      randomDigit: digitsFrom([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
      documentNumber: "111111111",
    });

    expect(dCodSeg).toBe("222222222");
    expect(attempts).toBe(2);
  });

  it("fails loudly when the source keeps colliding, instead of spinning", () => {
    // A source that always yields the document number is not random, and the
    // bounded retry is what turns that into an error rather than a hang.
    expect(() =>
      generateSecurityCode({
        randomDigit: digitsFrom([1, 1, 1, 1, 1, 1, 1, 1, 1]),
        documentNumber: "111111111",
      })
    ).toThrow(DteValidationError);
    expect(SECURITY_CODE_MAX_ATTEMPTS).toBeGreaterThan(1);
  });

  it("refuses a source that is not returning digits", () => {
    for (const bad of [-1, 10, 1.5, Number.NaN]) {
      expect(() =>
        generateSecurityCode({ randomDigit: digitsFrom([bad]), documentNumber: "0000002" })
      ).toThrow(DteValidationError);
    }
  });

  it("is never equal to a nine-digit document number across many draws", () => {
    // A sweep over a deterministic sequence, with the document number set to a
    // value the draw lands on: every draw that collides must be redrawn.
    const sequence = [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 4, 5, 6, 7, 8, 9, 0, 1];
    let index = 0;
    const { dCodSeg } = generateSecurityCode({
      randomDigit: () => {
        const value = sequence[index % sequence.length] ?? 0;
        index += 1;
        return value;
      },
      documentNumber: "111111111",
    });

    expect(dCodSeg).not.toBe("111111111");
    expect(dCodSeg).toMatch(/^[0-9]{9}$/);
  });
});
