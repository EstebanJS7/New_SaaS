/**
 * FISC-011 WU-B — the Manual's series order, asserted against the order the
 * Manual prints rather than against the implementation's own arithmetic.
 */

import { describe, expect, it } from "vitest";
import {
  FIRST_SERIES,
  LAST_SERIES,
  SERIES_COUNT,
  TimbradoError,
  assertSeriesSuccession,
  assertValidSeries,
  nextSeries,
  seriesFromOrdinal,
  seriesOrdinal,
} from "./series.js";

/** The Manual's own order, spelled out far enough to cross both boundaries. */
const MANUAL_ORDER_HEAD = ["AA", "AB", "AC", "AD", "AE"];

describe("the series order is the Manual's", () => {
  it("starts at AA, and the seriesless range advances to it", () => {
    expect(FIRST_SERIES).toBe("AA");
    expect(nextSeries(null)).toBe("AA");
  });

  it("walks the Manual's printed order across the first-letter boundary", () => {
    const walked = [nextSeries(null)];
    for (let step = 0; step < 27; step += 1) {
      walked.push(nextSeries(walked[walked.length - 1] ?? null));
    }
    expect(walked.slice(0, MANUAL_ORDER_HEAD.length)).toEqual(MANUAL_ORDER_HEAD);
    // `AZ -> BA` is the boundary the Manual prints as "… , AZ …BA, BB, …".
    expect(walked[25]).toBe("AZ");
    expect(walked[26]).toBe("BA");
    expect(walked[27]).toBe("BB");
  });

  it("ends at ZZ, and ZZ is terminal rather than wrapping", () => {
    expect(LAST_SERIES).toBe("ZZ");
    expect(seriesOrdinal("ZZ")).toBe(SERIES_COUNT - 1);
    expect(nextSeries("ZZ")).toBeNull();
  });

  it("is exactly the 676 two-letter combinations of A-Z, with no Ñ anywhere", () => {
    const all: string[] = [];
    let current: string | null = null;
    while ((current = nextSeries(current)) !== null) {
      all.push(current);
    }
    expect(all).toHaveLength(SERIES_COUNT);
    expect(new Set(all).size).toBe(SERIES_COUNT);
    expect(all[0]).toBe("AA");
    expect(all[all.length - 1]).toBe("ZZ");
    // The Manual excludes Ñ because it is not in A-Z, and tdSerieNum is [A-Z]{2}.
    // Both are asserted, so a hand-written "skip Ñ" rule cannot creep in.
    for (const series of all) {
      expect(series, series).toMatch(/^[A-Z]{2}$/);
      expect(series).not.toContain("Ñ");
    }
  });
});

describe("ordinals are the inverse of the order", () => {
  it("maps the boundaries", () => {
    expect(seriesOrdinal("AA")).toBe(0);
    expect(seriesOrdinal("AZ")).toBe(25);
    expect(seriesOrdinal("BA")).toBe(26);
    expect(seriesOrdinal("ZZ")).toBe(675);
  });

  it("round-trips every series", () => {
    for (let ordinal = 0; ordinal < SERIES_COUNT; ordinal += 1) {
      expect(seriesOrdinal(seriesFromOrdinal(ordinal))).toBe(ordinal);
    }
  });

  it("refuses an ordinal outside the alphabet", () => {
    for (const ordinal of [-1, SERIES_COUNT, 1.5]) {
      expect(() => seriesFromOrdinal(ordinal)).toThrow(TimbradoError);
      expect(() => seriesFromOrdinal(ordinal)).toThrow(/ordinal is 0\.\.675/);
    }
  });
});

describe("skipping a series is refused, not merely avoided", () => {
  it("accepts the successor", () => {
    expect(() => assertSeriesSuccession("AA", "AB")).not.toThrow();
    expect(() => assertSeriesSuccession(null, "AA")).not.toThrow();
    expect(() => assertSeriesSuccession("AZ", "BA")).not.toThrow();
  });

  it("refuses a skip", () => {
    expect(() => assertSeriesSuccession("AA", "AC")).toThrow(TimbradoError);
    expect(() => assertSeriesSuccession("AA", "AC")).toThrow(/the next series is AB, not AC/);
  });

  it("refuses a series that goes backwards", () => {
    expect(() => assertSeriesSuccession("BA", "AZ")).toThrow(/the next series is BB/);
  });

  it("refuses any successor of ZZ, because there is none", () => {
    expect(() => assertSeriesSuccession("ZZ", "AA")).toThrow(TimbradoError);
    expect(() => assertSeriesSuccession("ZZ", "AA")).toThrow(/has no successor/);
  });
});

describe("the series pattern", () => {
  it("accepts every well-formed series", () => {
    for (const series of ["AA", "AZ", "BA", "ZZ"]) {
      expect(() => assertValidSeries(series)).not.toThrow();
    }
  });

  it.each([["ÑA"], ["AÑ"], ["aa"], ["A1"], ["A"], ["AAA"], [""], ["A "]])(
    "refuses %s",
    (series) => {
      expect(() => assertValidSeries(series)).toThrow(TimbradoError);
      expect(() => assertValidSeries(series)).toThrow(/\[A-Z\]\{2\}/);
    }
  );

  it("refuses an invalid series before computing its ordinal", () => {
    expect(() => seriesOrdinal("ÑA")).toThrow(/\[A-Z\]\{2\}/);
  });
});
