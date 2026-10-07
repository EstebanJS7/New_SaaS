import { describe, expect, it } from "vitest";
import {
  CDC_CHECK_DIGIT_BASE_MAX,
  CDC_FIELD_WIDTHS,
  composeCdc,
  computeCdcCheckDigit,
  type DteCdcFields,
} from "./dte.cdc.js";
import { DteValidationError } from "./dte.rules.js";

/**
 * The evidence for this module is the Manual's own worked example plus the RUC
 * check digits of every example document this vault holds — and, just as
 * deliberately, the two published CDCs that do NOT reproduce.
 */

/** The Manual's §10.1 example, field by field, and the CDC it composes to. */
const MANUAL_EXAMPLE: DteCdcFields = {
  iTiDE: 1,
  dRucEm: "44444401",
  dDVEmi: "7",
  dEst: "001",
  dPunExp: "001",
  dNumDoc: "0014528",
  iTipCont: 2,
  dFeEmiDE: "20170125",
  iTipEmi: 1,
  dCodSeg: "587326098",
};
const MANUAL_CDC = "01444444017001001001452822017012515873260988";

describe("computeCdcCheckDigit — Pa_Calcular_Dv_11_A", () => {
  it("reproduces the Manual's own worked CDC", () => {
    expect(computeCdcCheckDigit(MANUAL_CDC.slice(0, 43))).toBe(8);
  });

  it("uses weights 2..11 from the right and restarts", () => {
    // p_basemax is 11, so a digit can be multiplied by 10 or 11. A search that
    // only tried weights up to 9 never entered this space, which is why the
    // algorithm looked unpinnable for a while (baseline §22.9).
    expect(CDC_CHECK_DIGIT_BASE_MAX).toBe(11);
    // Ten digits, so the tenth from the right carries weight 11, not 2.
    expect(computeCdcCheckDigit("1000000000")).toBe(computeCdcCheckDigit("1000000000", 11));
    expect(computeCdcCheckDigit("1000000000")).not.toBe(computeCdcCheckDigit("1000000000", 9));
  });

  it("reproduces the RUC check digit in every example document held here", () => {
    // Four independent RUCs, from the Manual, the Guía de Mejores Prácticas and
    // the Estructura xml_DE bundle. This is the corroboration that the
    // algorithm is right, and it is what shows the two CDC mismatches below are
    // about the examples rather than about the rule.
    expect(computeCdcCheckDigit("44444401")).toBe(7);
    expect(computeCdcCheckDigit("80025298")).toBe(5);
    expect(computeCdcCheckDigit("02805208")).toBe(0);
    expect(computeCdcCheckDigit("00000001")).toBe(9);
  });

  it("replaces a non-digit by its ASCII value, as the PL/SQL does", () => {
    // "Cambia la ultima letra por ascii en caso que la cedula termine en letra".
    expect(computeCdcCheckDigit("A")).toBe(computeCdcCheckDigit(String("A".charCodeAt(0))));
  });

  it("refuses a base below two instead of dividing by something meaningless", () => {
    expect(() => computeCdcCheckDigit("123", 1)).toThrow(DteValidationError);
  });
});

describe("composeCdc", () => {
  it("composes the Manual's example into the KuDE specimen, byte for byte", () => {
    const composed = composeCdc(MANUAL_EXAMPLE);

    expect(composed.cdc).toBe(MANUAL_CDC);
    expect(composed.cdc).toHaveLength(44);
    expect(composed.prefix).toHaveLength(43);
    expect(composed.dDVId).toBe("8");
    // The KuDE groups it in fours; that is the same value.
    expect(composed.cdc.replace(/(.{4})/g, "$1 ").trim()).toBe(
      "0144 4444 0170 0100 1001 4528 2201 7012 5158 7326 0988"
    );
  });

  it("pads the fields the Manual says to pad, and takes only the date part", () => {
    const composed = composeCdc({
      ...MANUAL_EXAMPLE,
      iTiDE: 1,
      dRucEm: "1",
      dEst: "1",
      dPunExp: "1",
      dNumDoc: "14528",
      dCodSeg: "1",
      dFeEmiDE: "2017-01-25T09:35:30",
    });

    // Asserted by shape rather than by a hand-copied string: each field lands at
    // its own width.
    const widths = Object.values(CDC_FIELD_WIDTHS);
    let cursor = 0;
    const slices = widths.map((width) => {
      const slice = composed.prefix.slice(cursor, cursor + width);
      cursor += width;
      return slice;
    });
    expect(slices).toEqual([
      "01",
      "00000001",
      "7",
      "001",
      "001",
      "0014528",
      "2",
      "20170125",
      "1",
      "000000001",
    ]);
  });

  it("does not reproduce the two illustrative CDCs, and says why", () => {
    // Both are published as CDCs and both were written by hand: their RUC digit
    // checks out and their CDC digit does not. Recorded so a reader who finds
    // them does not conclude the algorithm is ambiguous.
    const illustrative = [
      { cdc: "01028052080001001000013622023100111644108186", ruc: "02805208", rucDv: 0 },
      { cdc: "01000000019001001100005022020050710000000231", ruc: "00000001", rucDv: 9 },
    ];
    for (const example of illustrative) {
      expect(computeCdcCheckDigit(example.ruc)).toBe(example.rucDv);
      expect(computeCdcCheckDigit(example.cdc.slice(0, 43))).not.toBe(Number(example.cdc[43]));
    }
    // And the one from the Guía that IS computed does reproduce.
    expect(computeCdcCheckDigit("07800252985001001000311822024021016361562161".slice(0, 43))).toBe(
      1
    );
  });

  it("refuses a field that is too long rather than truncating an identity", () => {
    expect(() => composeCdc({ ...MANUAL_EXAMPLE, dRucEm: "123456789" })).toThrow(
      DteValidationError
    );
    expect(() => composeCdc({ ...MANUAL_EXAMPLE, dNumDoc: "12345678" })).toThrow(
      DteValidationError
    );
  });

  it("refuses a non-numeric field and a date that is not a date", () => {
    expect(() => composeCdc({ ...MANUAL_EXAMPLE, dCodSeg: "12345678A" })).toThrow(
      DteValidationError
    );
    expect(() => composeCdc({ ...MANUAL_EXAMPLE, dFeEmiDE: "25/01/2017" })).toThrow(
      DteValidationError
    );
  });

  it("keeps the check digit consistent with the field widths", () => {
    // The widths sum to 43 before the check digit, and 44 with it. That is the
    // only length claim the composition makes.
    const sum = Object.values(CDC_FIELD_WIDTHS).reduce((total, width) => total + width, 0);
    expect(sum).toBe(43);
    expect(composeCdc(MANUAL_EXAMPLE).cdc.length).toBe(sum + 1);
  });
});
