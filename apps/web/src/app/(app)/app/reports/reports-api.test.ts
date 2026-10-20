/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultSelectionFor,
  fetchReport,
  isReportAccessDenied,
  isReportPeriodPreset,
  REPORT_DEFAULT_PRESET,
  REPORT_HORIZON_DEFAULT_DAYS,
  reportExportPath,
  reportQueryString,
  reportRequestPath,
  selectionMatchesCode,
  userFacingReportError,
} from "./reports-api";

/**
 * The reports client's query model ([[REP-008]], [[DEC-063]], [[DEC-065]]).
 *
 * These cases pin the ONE thing the surface can get wrong before a request is
 * even made: which query each report may be asked with. A period report takes a
 * preset OR a `from`/`to` pair and never both; a due report takes a horizon and no
 * period; `low-stock` takes nothing. The API refuses every other combination, so
 * building one here would be a surface defect dressed as a `400`.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Awaits a read that must FAIL, and hands back the error it threw. */
async function rejection(read: Promise<unknown>): Promise<Error> {
  try {
    await read;
  } catch (thrown: unknown) {
    if (thrown instanceof Error) return thrown;
    throw new Error(`The read failed with a non-Error value: ${String(thrown)}`);
  }
  throw new Error("Expected the report read to fail, and it resolved instead.");
}

describe("the reports client · the query each report accepts", () => {
  it("builds a preset query and never a half-typed range", () => {
    expect(reportQueryString("sales-by-period", { kind: "preset", preset: "last7Days" })).toBe(
      "preset=last7Days"
    );
  });

  it("builds a custom range from calendar dates, never from instants", () => {
    const query = reportQueryString("stock", {
      kind: "range",
      from: "2026-06-10",
      to: "2026-06-11",
    });

    expect(query).toBe("from=2026-06-10&to=2026-06-11");
    // The period's semantics — span bound, inverted range, tenant zone — are the
    // API's; this boundary only sends the two dates it was given.
    expect(query).not.toContain("T00:00");
  });

  it("builds a horizon query for the due reports", () => {
    expect(reportQueryString("vaccines-due", { kind: "horizon", horizonDays: 60 })).toBe(
      "horizonDays=60"
    );
  });

  it("sends NO query at all for the current-state report", () => {
    expect(reportQueryString("low-stock", { kind: "none" })).toBe("");
    expect(reportRequestPath("low-stock", { kind: "none" })).toBe("/api/reports/low-stock");
  });

  it("builds the read and export paths from the same query", () => {
    expect(reportRequestPath("sales-by-period", { kind: "preset", preset: "today" })).toBe(
      "/api/reports/sales-by-period?preset=today"
    );
    expect(reportExportPath("sales-by-period", { kind: "preset", preset: "today" })).toBe(
      "/api/reports/sales-by-period/export?preset=today"
    );
    expect(reportExportPath("low-stock", { kind: "none" })).toBe("/api/reports/low-stock/export");
  });

  it("refuses to build a query the report does not accept", () => {
    // Each of these is a programming error the surface cannot reach — its controls
    // are derived from the shape — so it fails here rather than as an API 400 that
    // looks like a server bug.
    expect(() => reportQueryString("low-stock", { kind: "preset", preset: "today" })).toThrow(
      /does not accept a "preset" selection/
    );
    expect(() =>
      reportQueryString("sales-by-period", { kind: "horizon", horizonDays: 30 })
    ).toThrow(/does not accept a "horizon" selection/);
    expect(() => reportQueryString("vaccines-due", { kind: "none" })).toThrow(
      /does not accept a "none" selection/
    );
  });

  it("opens each report on a selection its contract accepts", () => {
    expect(defaultSelectionFor("sales-by-period")).toEqual({
      kind: "preset",
      preset: REPORT_DEFAULT_PRESET,
    });
    expect(defaultSelectionFor("vaccines-due")).toEqual({
      kind: "horizon",
      horizonDays: REPORT_HORIZON_DEFAULT_DAYS,
    });
    expect(defaultSelectionFor("low-stock")).toEqual({ kind: "none" });

    for (const code of ["sales-by-period", "vaccines-due", "low-stock"] as const) {
      expect(selectionMatchesCode(code, defaultSelectionFor(code)), code).toBe(true);
    }
  });

  it("recognises only the five presets the API resolves", () => {
    for (const preset of ["today", "last7Days", "last30Days", "thisMonth", "lastMonth"]) {
      expect(isReportPeriodPreset(preset), preset).toBe(true);
    }
    for (const value of ["TODAY", "yesterday", "", "last 7 days"]) {
      expect(isReportPeriodPreset(value), value).toBe(false);
    }
  });
});

describe("the reports client · the read and its refusals", () => {
  it("reads through the BFF without caching, and never sends a tenant id", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ report: "low-stock", thresholdsConfigured: false, rows: [] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchReport("low-stock", { kind: "none" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/reports/low-stock");
    expect(init.cache).toBe("no-store");
    // Tenant and permission authority come from the session cookie the proxy
    // forwards; a query parameter claiming a tenant would be refused there.
    expect(url).not.toContain("tenantId");
  });

  it("surfaces the API's own validation sentence instead of a generic failure", async () => {
    const envelope = {
      error: {
        code: "VALIDATION_FAILED",
        message: "The report period spans more than 366 days.",
        requestId: "req-api",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(envelope), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
        )
      )
    );

    const error = await rejection(
      fetchReport("sales-by-period", {
        kind: "range",
        from: "1900-01-01",
        to: "2026-06-11",
      })
    );

    // The over-long range explains itself; the surface prints this verbatim.
    expect(userFacingReportError(error)).toBe("The report period spans more than 366 days.");
  });

  it("treats a 403 and a missing session as access denials, and a transport failure as neither", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "FORBIDDEN", message: "Insufficient permissions." } }),
            { status: 403, headers: { "content-type": "application/json" } }
          )
        )
      )
    );
    const forbidden = await rejection(fetchReport("stock", { kind: "preset", preset: "today" }));
    expect(isReportAccessDenied(forbidden)).toBe(true);
    expect(userFacingReportError(forbidden)).toBe("You do not have permission to read reports.");

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "UNAUTHENTICATED", message: "Authentication required." },
            }),
            { status: 401, headers: { "content-type": "application/json" } }
          )
        )
      )
    );
    const unauthenticated = await rejection(
      fetchReport("stock", { kind: "preset", preset: "today" })
    );
    expect(isReportAccessDenied(unauthenticated)).toBe(true);
    expect(userFacingReportError(unauthenticated)).toBe("You must be signed in to read reports.");

    const transport = new Error("network down");
    expect(isReportAccessDenied(transport)).toBe(false);
    expect(userFacingReportError(transport)).toBe(
      "The request could not reach the server. Check your connection and try again."
    );
  });
});
