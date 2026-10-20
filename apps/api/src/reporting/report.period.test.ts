import { describe, expect, it } from "vitest";
import {
  REPORT_PERIOD_DATE_FORMAT_MESSAGE,
  REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
  REPORT_PERIOD_INVERTED_MESSAGE,
  REPORT_PERIOD_MAX_DAYS,
  REPORT_PERIOD_MISSING_MESSAGE,
  REPORT_PERIOD_PRESETS,
  REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE,
  REPORT_PERIOD_TOO_LONG_MESSAGE,
  REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE,
  REPORT_PERIOD_YEAR_RANGE_MESSAGE,
  resolveReportPeriod,
  startOfTenantDay,
  tenantCalendarDate,
} from "./report.period.js";

/**
 * The period rule's suite ([[REP-002]], [[DEC-063]]).
 *
 * Every assertion here is an EXACT instant, never "it works": the whole point of
 * the module is that a boundary is an instant in one zone, so an approximate
 * assertion would prove nothing about the thing under test. `America/Asuncion`
 * is `-03` after 2024-10-06 and `-04` before it, so a range crossing that
 * transition is the case where a 24-hour-block implementation gives the wrong
 * answer.
 */

/** A rejection captured as `{ code, message }` so two conditions can be compared. */
function rejection(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const shaped = error as { code?: unknown; message?: unknown };
    return { code: String(shaped.code), message: String(shaped.message) };
  }
  throw new Error("expected the resolver to refuse");
}

describe("resolveReportPeriod · presets ([[DEC-063]])", () => {
  /**
   * 18:30Z is 15:30 on 2026-03-15 in Asunción (`-03`), so "today" is unambiguous
   * and well inside the month: every preset resolves without touching a month or
   * a year edge.
   */
  const now = new Date("2026-03-15T18:30:00.000Z");

  it("resolves `today` to the tenant's today, one calendar day", () => {
    const period = resolveReportPeriod({ preset: "today" }, now);
    expect(period).toMatchObject({
      preset: "today",
      fromDate: "2026-03-15",
      toDate: "2026-03-15",
      timeZone: "America/Asuncion",
      dayCount: 1,
    });
    expect(period.fromInstant.toISOString()).toBe("2026-03-15T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-03-16T03:00:00.000Z");
  });

  it("resolves `last7Days` to the seven days ENDING today, inclusive", () => {
    const period = resolveReportPeriod({ preset: "last7Days" }, now);
    expect(period).toMatchObject({
      preset: "last7Days",
      fromDate: "2026-03-09",
      toDate: "2026-03-15",
      dayCount: 7,
    });
    expect(period.fromInstant.toISOString()).toBe("2026-03-09T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-03-16T03:00:00.000Z");
  });

  it("resolves `last30Days` to the thirty days ENDING today, inclusive", () => {
    const period = resolveReportPeriod({ preset: "last30Days" }, now);
    expect(period).toMatchObject({
      preset: "last30Days",
      // 2026 is not a leap year, so 2026-03-15 minus 29 days is 2026-02-14.
      fromDate: "2026-02-14",
      toDate: "2026-03-15",
      dayCount: 30,
    });
    expect(period.fromInstant.toISOString()).toBe("2026-02-14T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-03-16T03:00:00.000Z");
  });

  it("resolves `thisMonth` to month-to-date", () => {
    const period = resolveReportPeriod({ preset: "thisMonth" }, now);
    expect(period).toMatchObject({
      preset: "thisMonth",
      fromDate: "2026-03-01",
      toDate: "2026-03-15",
      dayCount: 15,
    });
    expect(period.fromInstant.toISOString()).toBe("2026-03-01T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-03-16T03:00:00.000Z");
  });

  it("resolves `lastMonth` to the whole previous calendar month", () => {
    const period = resolveReportPeriod({ preset: "lastMonth" }, now);
    expect(period).toMatchObject({
      preset: "lastMonth",
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
      dayCount: 28,
    });
    expect(period.fromInstant.toISOString()).toBe("2026-02-01T03:00:00.000Z");
    // EXCLUSIVE: the first instant of the day after 2026-02-28.
    expect(period.toInstant.toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("resolves `lastMonth` across a year boundary (January -> previous December)", () => {
    const period = resolveReportPeriod(
      { preset: "lastMonth" },
      new Date("2026-01-10T12:00:00.000Z")
    );
    expect(period).toMatchObject({
      fromDate: "2025-12-01",
      toDate: "2025-12-31",
      dayCount: 31,
    });
    expect(period.fromInstant.toISOString()).toBe("2025-12-01T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  it("resolves `lastMonth` by the month's real length, not by a fixed 30 or 31", () => {
    const february = resolveReportPeriod(
      { preset: "lastMonth" },
      new Date("2026-03-10T12:00:00.000Z")
    );
    expect(february).toMatchObject({ fromDate: "2026-02-01", toDate: "2026-02-28", dayCount: 28 });

    const leapFebruary = resolveReportPeriod(
      { preset: "lastMonth" },
      new Date("2024-03-10T12:00:00.000Z")
    );
    expect(leapFebruary).toMatchObject({
      fromDate: "2024-02-01",
      toDate: "2024-02-29",
      dayCount: 29,
    });
    expect(leapFebruary.toInstant.toISOString()).toBe("2024-03-01T03:00:00.000Z");
  });

  it("resolves `thisMonth` on the 1st to a single day", () => {
    const period = resolveReportPeriod(
      { preset: "thisMonth" },
      new Date("2026-05-01T15:00:00.000Z")
    );
    expect(period.fromDate).toBe("2026-05-01");
    expect(period.toDate).toBe("2026-05-01");
    expect(period.dayCount).toBe(1);
    expect(period.fromInstant.toISOString()).toBe("2026-05-01T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-05-02T03:00:00.000Z");
  });

  it("resolves the preset from the TENANT's today, not the UTC day", () => {
    // 02:00Z on 2026-05-01 is 23:00 on 2026-04-30 in Asunción (`-03`), so "today"
    // is still April there. A UTC-based resolver would answer 2026-05-01.
    const period = resolveReportPeriod({ preset: "today" }, new Date("2026-05-01T02:00:00.000Z"));
    expect(tenantCalendarDate(new Date("2026-05-01T02:00:00.000Z"))).toBe("2026-04-30");
    expect(period.fromDate).toBe("2026-04-30");
    expect(period.toDate).toBe("2026-04-30");
    expect(period.fromInstant.toISOString()).toBe("2026-04-30T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-05-01T03:00:00.000Z");
  });

  it("publishes exactly the five documented preset tokens", () => {
    expect(REPORT_PERIOD_PRESETS).toEqual([
      "today",
      "last7Days",
      "last30Days",
      "thisMonth",
      "lastMonth",
    ]);
  });
});

describe("resolveReportPeriod · custom range and the Asunción DST transition", () => {
  /**
   * tzdata has `America/Asuncion` switching from `-04` to `-03` at
   * 2024-10-06T04:00:00Z (Paraguay adopted `-03` permanently from that date, so
   * this is the last transition the zone has). The range below starts two days
   * before it and ends two days after it, so its two boundaries are computed
   * under DIFFERENT offsets.
   *
   * `fromDate` 2024-10-04 00:00 at `-04` = 2024-10-04T04:00Z
   * `toDate`   2024-10-08, so the exclusive end is 2024-10-09 00:00 at `-03`
   *            = 2024-10-09T03:00Z
   *
   * Elapsed time is 119 hours, not 5 x 24 = 120: 2024-10-06 is a 23-hour day.
   * That difference is exactly what proves the resolver converted each boundary
   * in its own offset instead of assuming one.
   */
  const from = "2024-10-04";
  const to = "2024-10-08";

  it("resolves a range spanning the transition to the correct instants on BOTH sides", () => {
    const period = resolveReportPeriod({ from, to }, new Date("2024-11-01T12:00:00.000Z"));
    expect(period.preset).toBeNull();
    expect(period.fromDate).toBe(from);
    expect(period.toDate).toBe(to);
    expect(period.timeZone).toBe("America/Asuncion");
    expect(period.fromInstant.toISOString()).toBe("2024-10-04T04:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2024-10-09T03:00:00.000Z");
  });

  it("counts CALENDAR days across the transition, not 24-hour blocks", () => {
    const period = resolveReportPeriod({ from, to }, new Date("2024-11-01T12:00:00.000Z"));
    expect(period.dayCount).toBe(5);
    const elapsedHours =
      (period.toInstant.getTime() - period.fromInstant.getTime()) / (60 * 60 * 1000);
    expect(elapsedHours).toBe(119);
    expect(elapsedHours).not.toBe(period.dayCount * 24);
  });

  it("starts a spring-forward day at the transition, not an hour early", () => {
    // Local midnight of 2024-10-06 does not exist: the clock jumped 00:00 -> 01:00,
    // so the day begins at the transition instant itself.
    expect(startOfTenantDay("2024-10-06").toISOString()).toBe("2024-10-06T04:00:00.000Z");
    expect(startOfTenantDay("2024-10-05").toISOString()).toBe("2024-10-05T04:00:00.000Z");
    expect(startOfTenantDay("2024-10-07").toISOString()).toBe("2024-10-07T03:00:00.000Z");
  });

  it("resolves a range entirely inside one offset", () => {
    const period = resolveReportPeriod(
      { from: "2026-02-01", to: "2026-02-28" },
      new Date("2026-03-15T18:30:00.000Z")
    );
    expect(period).toMatchObject({ fromDate: "2026-02-01", toDate: "2026-02-28", dayCount: 28 });
    expect(period.fromInstant.toISOString()).toBe("2026-02-01T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-03-01T03:00:00.000Z");
  });

  it("counts a single calendar day as one day, from date equal to to date", () => {
    const period = resolveReportPeriod(
      { from: "2026-06-10", to: "2026-06-10" },
      new Date("2026-06-15T12:00:00.000Z")
    );
    expect(period.dayCount).toBe(1);
    expect(period.fromInstant.toISOString()).toBe("2026-06-10T03:00:00.000Z");
    expect(period.toInstant.toISOString()).toBe("2026-06-11T03:00:00.000Z");
  });
});

describe("resolveReportPeriod · the span bound ([[DEC-063]])", () => {
  const now = new Date("2026-03-15T18:30:00.000Z");

  it("accepts a range of exactly the 366-day maximum", () => {
    // 2026-01-01 through 2027-01-01 inclusive is 366 calendar days.
    const period = resolveReportPeriod({ from: "2026-01-01", to: "2027-01-01" }, now);
    expect(period.dayCount).toBe(REPORT_PERIOD_MAX_DAYS);
    expect(REPORT_PERIOD_MAX_DAYS).toBe(366);
  });

  it("refuses a range one day over the maximum instead of truncating it", () => {
    expect(
      rejection(() => resolveReportPeriod({ from: "2026-01-01", to: "2027-01-02" }, now))
    ).toMatchObject({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_TOO_LONG_MESSAGE });
  });
});

describe("resolveReportPeriod · rejections carry their own stable message", () => {
  const now = new Date("2026-03-15T18:30:00.000Z");

  it("refuses an unknown preset", () => {
    expect(rejection(() => resolveReportPeriod({ preset: "quarter" }, now))).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE,
    });
  });

  it("refuses a preset combined with a range", () => {
    expect(
      rejection(() => resolveReportPeriod({ preset: "today", from: "2026-03-01" }, now))
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE });
    expect(
      rejection(() =>
        resolveReportPeriod({ preset: "today", from: "2026-03-01", to: "2026-03-02" }, now)
      )
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE });
  });

  it("refuses a request with neither a preset nor a range", () => {
    expect(rejection(() => resolveReportPeriod({}, now))).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_MISSING_MESSAGE,
    });
  });

  it("refuses half a range", () => {
    expect(rejection(() => resolveReportPeriod({ from: "2026-03-01" }, now))).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
    });
    expect(rejection(() => resolveReportPeriod({ to: "2026-03-01" }, now))).toEqual({
      code: "VALIDATION_FAILED",
      message: REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
    });
  });

  it("refuses a malformed calendar date, including an ISO instant", () => {
    for (const [from, to] of [
      ["2026-3-01", "2026-03-02"],
      ["2026-03-01", "01-03-2026"],
      ["2026-02-30", "2026-03-02"],
      ["2026-03-01", "2026-13-01"],
      // The raw-instant refusal: a caller must not be able to choose instants and
      // so bypass the span bound ([[DEC-063]]).
      ["2026-01-01T00:00:00Z", "2026-03-02"],
      ["2026-03-01", "2026-03-02T23:59:59.000Z"],
    ] as const) {
      expect(rejection(() => resolveReportPeriod({ from, to }, now))).toEqual({
        code: "VALIDATION_FAILED",
        message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
      });
    }
  });

  it("refuses a range that starts after it ends, and never swaps it", () => {
    expect(
      rejection(() => resolveReportPeriod({ from: "2026-03-02", to: "2026-03-01" }, now))
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_INVERTED_MESSAGE });
  });

  it("refuses a date whose year predates the supported range, closing the two-digit-year hole", () => {
    // REGRESSION (found by independent verification). `Date.UTC(99, 0, 1)` is
    // 1999, not year 99: `0099-01-01`..`1999-01-01` once serialised to the SAME
    // instant, counted as ONE day, passed the span bound and answered a 1999
    // report while echoing `0099-01-01`. One request, two different periods.
    expect(
      rejection(() => resolveReportPeriod({ from: "0099-01-01", to: "1999-01-01" }, now))
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_YEAR_RANGE_MESSAGE });

    expect(
      rejection(() => resolveReportPeriod({ from: "1899-06-01", to: "1899-06-10" }, now))
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_YEAR_RANGE_MESSAGE });
  });

  it("counts a multi-year span correctly, so the bound sees the real day count", () => {
    // The year-correct serial is what makes this a DAY-COUNT rejection rather than
    // the one-day acceptance the two-digit remap produced.
    expect(
      rejection(() => resolveReportPeriod({ from: "1900-01-01", to: "9999-12-31" }, now))
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_TOO_LONG_MESSAGE });
  });

  it("resolves the leap day and refuses a day the month does not have", () => {
    const leap = resolveReportPeriod({ from: "2024-02-29", to: "2024-02-29" }, now);
    expect(leap.dayCount).toBe(1);
    expect(leap.fromInstant.toISOString()).toBe("2024-02-29T03:00:00.000Z");

    expect(
      rejection(() => resolveReportPeriod({ from: "2026-02-30", to: "2026-03-01" }, now))
    ).toEqual({ code: "VALIDATION_FAILED", message: REPORT_PERIOD_DATE_FORMAT_MESSAGE });
  });

  it("keeps every rejection message distinct, so a caller can tell them apart", () => {
    const messages = [
      REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE,
      REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE,
      REPORT_PERIOD_MISSING_MESSAGE,
      REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE,
      REPORT_PERIOD_DATE_FORMAT_MESSAGE,
      REPORT_PERIOD_INVERTED_MESSAGE,
      REPORT_PERIOD_TOO_LONG_MESSAGE,
      REPORT_PERIOD_YEAR_RANGE_MESSAGE,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});
