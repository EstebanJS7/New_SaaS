/**
 * FISC-015 WU-D — the units of measure, and the one catalogue this unit also
 * added to `dte.catalogues.ts`.
 *
 * The suite is written against the ARTIFACT rather than against the
 * implementation: the count is `Unidades_Medida_v141.xsd`'s own enumeration
 * count, the pairs are the strings that artifact publishes, and the refusals are
 * the failures a caller branches on. The receptor identity block at the end
 * lives here because this unit added
 * `DTE_RECEPTOR_IDENTITY_TYPE_DESCRIPTIONS` to `dte.catalogues.ts` and that
 * module's own suite is outside this work unit's edit surfaces.
 */

import { describe, expect, it } from "vitest";
import { DteCatalogueError, describeReceptorIdentityType } from "./dte.catalogues.js";
import {
  describeUnitOfMeasure,
  DTE_UNITS_OF_MEASURE,
  unitOfMeasureFor,
  unitOfMeasureSymbol,
} from "./dte.units.js";

/**
 * `tcUniMed`'s and `tdDesUniMed`'s count in the artifact, read from the
 * enumeration tags themselves: 64 pairs, in the artifact's own order.
 */
const ARTIFACT_UNIT_COUNT = 64;

/** The failure code a call raises, which is the part a caller branches on. */
function failureOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof DteCatalogueError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

describe("the units of measure hold what Unidades_Medida_v141.xsd enumerates", () => {
  it("counts them as the artifact does", () => {
    expect(DTE_UNITS_OF_MEASURE.size).toBe(ARTIFACT_UNIT_COUNT);
    expect(DTE_UNITS_OF_MEASURE.size).toBe(64);
  });

  it("answers the pairs the artifact publishes", () => {
    // `tcUniMed` documents each code as "<name> - <symbol>"; `tdDesUniMed`
    // enumerates the symbols. Both sides of the first pair are pinned here so a
    // reordering of the artifact cannot pass unnoticed.
    expect(describeUnitOfMeasure("77")).toBe("Unidad - UNI");
    expect(unitOfMeasureSymbol("77")).toBe("UNI");
    expect(describeUnitOfMeasure("87")).toBe("Metros - m");
    expect(unitOfMeasureSymbol("87")).toBe("m");
    expect(describeUnitOfMeasure("2366")).toBe("Costo Por Mil - CPM");
    expect(describeUnitOfMeasure("2329")).toBe("Unidad Internacional - UI");
    expect(unitOfMeasureFor("77")).toEqual({
      code: "77",
      description: "Unidad - UNI",
      symbol: "UNI",
    });
  });

  it("keys every entry by its own code, in the artifact's numeric alphabet", () => {
    for (const [key, entry] of DTE_UNITS_OF_MEASURE) {
      expect(entry.code).toBe(key);
      // `tcUniMed` is `xs:integer`; the recorded examples are digits, and
      // WU-C's `catalog_item.unit_of_measure_code` is VARCHAR(4).
      expect(key).toMatch(/^[0-9]{1,4}$/);
      expect(key.startsWith("0")).toBe(false);
    }
  });

  it("keeps every symbol inside tdDesUniMed's own length", () => {
    // `dDesUniMed`'s type is `tdDesUniMed`: minLength 1, maxLength 10. The
    // documentation string is NOT the emitted value — "Unidad - UNI" is 12
    // characters and would be schema-invalid — so this bound is the reason
    // `symbol` exists beside `description`.
    for (const entry of DTE_UNITS_OF_MEASURE.values()) {
      expect(entry.symbol.length).toBeGreaterThanOrEqual(1);
      expect(entry.symbol.length).toBeLessThanOrEqual(10);
      // The pairing the artifact states, from the code's own side: the
      // documentation is the symbol's name followed by its symbol.
      expect(entry.description.endsWith(` - ${entry.symbol}`)).toBe(true);
    }
  });

  it("refuses a code the artifact does not publish", () => {
    expect(failureOf(() => unitOfMeasureFor("999"))).toBe("UNKNOWN_CODE");
    expect(failureOf(() => describeUnitOfMeasure("9999"))).toBe("UNKNOWN_CODE");
    // Exact match, as the artifact spells the code: `077` is not an enumeration
    // value, and a caller holding one holds a code the protocol does not publish.
    expect(failureOf(() => unitOfMeasureFor("077"))).toBe("UNKNOWN_CODE");
    expect(failureOf(() => unitOfMeasureSymbol(""))).toBe("UNKNOWN_CODE");
  });

  it("refuses without answering undefined, and names the count it searched", () => {
    try {
      unitOfMeasureFor("999");
      throw new Error("expected the call to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DteCatalogueError);
      expect((error as DteCatalogueError).message).toContain("64 codes");
    }
  });
});

describe("the receptor identity types §22.11 pins", () => {
  it("answers the strings the schema's own enumeration carries", () => {
    // `tdDtipDocRec` (DE_Types_v150.xsd) enumerates six descriptions; five of
    // them say nothing useful without their code, so all six are pinned.
    expect(describeReceptorIdentityType(1)).toBe("Cédula paraguaya");
    expect(describeReceptorIdentityType(4)).toBe("Carnet de residencia");
    expect(describeReceptorIdentityType(5)).toBe("Innominado");
    expect(describeReceptorIdentityType(6)).toBe("Tarjeta Diplomática de exoneración fiscal");
  });

  it("refuses code 9, whose published name the schema cannot carry", () => {
    // §22.11 names it "Otro"; `tdDtipDocRec` omits that string from its
    // enumeration and its free branch demands 9..41 characters, so the code is
    // known and the ANSWER is unusable — a different failure from unknown code.
    expect(failureOf(() => describeReceptorIdentityType(9))).toBe("UNSUPPORTED_DESCRIPTION");
    expect(failureOf(() => describeReceptorIdentityType(7))).toBe("UNKNOWN_CODE");
  });
});
