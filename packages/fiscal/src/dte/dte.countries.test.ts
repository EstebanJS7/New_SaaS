/**
 * FISC-015 WU-D — the countries.
 *
 * Written against `Paises_v100.xsd`: the count is its `paisType` enumeration
 * count, the pairs are the names it publishes, and the duplicate it carries
 * (`MKD` twice) is pinned rather than smoothed over.
 */

import { describe, expect, it } from "vitest";
import { countryFor, describeCountry, DTE_COUNTRIES } from "./dte.countries.js";
import { DteCatalogueError } from "./dte.catalogues.js";

/**
 * `paisType` publishes **250 entries** and only **249 distinct codes**: `MKD`
 * appears twice, with two names, and the artifact never removed the old one.
 * One of the 249 is the artifact's own sentinel, `NN -> "NO EXISTE"`.
 */
const ARTIFACT_COUNTRY_ENTRIES = 250;
const ARTIFACT_DISTINCT_CODES = 249;

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

describe("the countries hold what Paises_v100.xsd enumerates", () => {
  it("counts the distinct codes the artifact publishes", () => {
    expect(DTE_COUNTRIES.size).toBe(ARTIFACT_DISTINCT_CODES);
    expect(DTE_COUNTRIES.size).toBe(249);
    // The entry count and the key count differ by exactly the one duplicate.
    expect(ARTIFACT_COUNTRY_ENTRIES - DTE_COUNTRIES.size).toBe(1);
  });

  it("answers the names the artifact publishes", () => {
    expect(describeCountry("PRY")).toBe("Paraguay");
    expect(countryFor("PRY")).toEqual({ code: "PRY", description: "Paraguay" });
    expect(describeCountry("ARG")).toBe("Argentina");
    expect(describeCountry("BRA")).toBe("Brasil");
    expect(describeCountry("USA")).toBe("Estados Unidos de América");
  });

  it("keys every entry by its own published code", () => {
    for (const [key, entry] of DTE_COUNTRIES) {
      expect(entry.code).toBe(key);
      // ISO 3166 alpha-3, plus `paisType`'s own two-character sentinel `NN`.
      expect(key).toMatch(/^[A-Z]{2,3}$/);
    }
  });

  it("keeps the artifact's own non-country sentinel", () => {
    // The artifact's last enum is `NN -> "NO EXISTE"`: two characters, not ISO
    // 3166's three. It is published, so it is kept — the protocol's list is the
    // source of record, and a value SIFEN accepts must not be refused by a table
    // of ours.
    expect(describeCountry("NN")).toBe("NO EXISTE");
  });

  it("keeps every name inside tDesPais' own length", () => {
    // `dDesPaisRe`'s type is `tDesPais`: minLength 4, maxLength 50, whitespace
    // preserved. Every published name fits, so no country needs a refusal the
    // way a currency name longer than 20 does.
    for (const entry of DTE_COUNTRIES.values()) {
      expect(entry.description.length).toBeGreaterThanOrEqual(4);
      expect(entry.description.length).toBeLessThanOrEqual(50);
      expect(entry.description).toBe(entry.description.trim());
    }
  });

  it("keeps the first name the artifact publishes for its one duplicated code", () => {
    // `MKD` is published twice: "Macedonia del Norte" first, then the historical
    // "ex República Yugoslava de Macedonia". A map keyed by the code holds one,
    // and the FIRST is kept — the artifact's own order — because the DE's
    // statement is the code and `tDesPais` accepts either label. Refusing the
    // code would make a legitimate receptor unissuable over a duplicate label.
    expect(describeCountry("MKD")).toBe("Macedonia del Norte");
    expect(describeCountry("MKD")).not.toBe("ex República Yugoslava de Macedonia");
  });

  it("refuses a code the artifact does not publish, including alpha-2", () => {
    expect(failureOf(() => countryFor("ZZZ"))).toBe("UNKNOWN_CODE");
    // This repository stores ISO 3166 ALPHA-2 in `customer_address.country_code`
    // (apps/api/src/customers/customer-address.zod.ts: `length(2)`), and
    // `cPaisRec` is `paisType`, which is alpha-3. A stored "PY" is therefore not
    // a code this table publishes, and the refusal is what stops the receptor
    // read from emitting a country SIFEN cannot place.
    expect(failureOf(() => countryFor("PY"))).toBe("UNKNOWN_CODE");
    expect(failureOf(() => describeCountry("pry"))).toBe("UNKNOWN_CODE");
  });
});
