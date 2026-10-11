/**
 * FISC-015 WU-D — the currencies.
 *
 * Written against `Monedas_v150.xsd`: the count is its `cMondT` enumeration
 * count, the pairs are the `CodeName` values it publishes, and the bound is the
 * one `dDesMoneOpe`'s own type imposes.
 */

import { describe, expect, it } from "vitest";
import {
  currencyFor,
  describeCurrency,
  DTE_CURRENCIES,
  DTE_CURRENCY_DESCRIPTION_MAX_LENGTH,
} from "./dte.currencies.js";
import { DteCatalogueError } from "./dte.catalogues.js";

/** `cMondT`'s enumeration count in the artifact. */
const ARTIFACT_CURRENCY_COUNT = 200;

/**
 * How many of those names do NOT fit `tdDMoneTiPag` (3..20 characters), so
 * `dDesMoneOpe` cannot carry them: counted from the artifact's own bytes.
 */
const ARTIFACT_NAMES_OVER_20 = 15;

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

describe("the currencies hold what Monedas_v150.xsd enumerates", () => {
  it("counts them as the artifact does", () => {
    expect(DTE_CURRENCIES.size).toBe(ARTIFACT_CURRENCY_COUNT);
    expect(DTE_CURRENCIES.size).toBe(200);
  });

  it("answers the names the artifact publishes", () => {
    // The guaraní first, because it is the currency every document in this
    // Story is issued in, and `PYG -> "Guarani"` is the artifact's own spelling
    // (no accent), not a translation.
    expect(describeCurrency("PYG")).toBe("Guarani");
    expect(currencyFor("PYG")).toEqual({ code: "PYG", description: "Guarani" });
    expect(describeCurrency("USD")).toBe("US Dollar");
    expect(describeCurrency("ARS")).toBe("Argentine Peso");
    expect(describeCurrency("BRL")).toBe("Brazilian Real");
  });

  it("keys every entry by its own ISO 4217 code", () => {
    for (const [key, entry] of DTE_CURRENCIES) {
      expect(entry.code).toBe(key);
      expect(key).toMatch(/^[A-Z]{3}$/);
      expect(entry.description.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("pins the names dDesMoneOpe cannot carry, and the published bound", () => {
    const over = [...DTE_CURRENCIES.values()].filter(
      (entry) => entry.description.length > DTE_CURRENCY_DESCRIPTION_MAX_LENGTH
    );

    // `tdDMoneTiPag` is 3..20. The artifact's own list is longer for these, and
    // the table stays faithful to it: the refusal belongs to the caller that
    // would emit the value, which is why the bound is exported.
    expect(DTE_CURRENCY_DESCRIPTION_MAX_LENGTH).toBe(20);
    expect(over).toHaveLength(ARTIFACT_NAMES_OVER_20);
    expect(over.map((entry) => entry.code)).toContain("XXX");
    expect(describeCurrency("XXX")).toBe(
      "The codes assigned for transactions where no currency is involved"
    );
  });

  it("refuses a code the artifact does not publish", () => {
    expect(failureOf(() => currencyFor("ZZZ"))).toBe("UNKNOWN_CODE");
    // ISO 4217 codes are upper case and the artifact spells them that way.
    expect(failureOf(() => currencyFor("pyg"))).toBe("UNKNOWN_CODE");
    expect(failureOf(() => currencyFor(""))).toBe("UNKNOWN_CODE");
  });
});
