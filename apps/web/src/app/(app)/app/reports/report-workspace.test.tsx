import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportWorkspace } from "./report-workspace";
import type { ReportResponse } from "./reports-api";

/**
 * The report view ([[REP-008]], [[DEC-062]], [[DEC-063]], [[DEC-065]]).
 *
 * The cases are grouped by what a reader could get wrong:
 *
 * 1. **The query.** Controls derive from the report's OWN contract, so a period
 *    report can send a preset or a complete range, a due report can send a
 *    horizon and no period, and `low-stock` sends nothing at all.
 * 2. **The numbers.** A fixed-scale decimal string is printed verbatim — the
 *    surface never converts `"1234.50"` into `1234.5` — and a total is never
 *    computed here ([[DEC-062]]: one aggregation path).
 * 3. **Every state**, including the three empty reports that are empty for a
 *    FIXABLE reason and therefore must say which fact is missing and link to where
 *    it is entered.
 */

const PERIOD = {
  preset: "last30Days",
  fromDate: "2026-05-13",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: "2026-05-13T04:00:00.000Z",
  toInstant: "2026-06-12T04:00:00.000Z",
};

const SALES_BY_PERIOD: ReportResponse = {
  report: "sales-by-period",
  period: PERIOD,
  currency: "PYG",
  saleCount: 3,
  totalNet: "1000.00",
  totalTax: "100.00",
  totalGross: "1234.50",
  rows: [
    {
      bucketDate: "2026-06-10",
      saleCount: 2,
      net: "1000.00",
      tax: "100.00",
      gross: "1234.50",
    },
  ],
};

const LOW_STOCK_EMPTY: ReportResponse = {
  report: "low-stock",
  thresholdsConfigured: false,
  rows: [],
};

const VACCINES_EMPTY: ReportResponse = {
  report: "vaccines-due",
  asOfDate: "2026-06-11",
  timeZone: "America/Asuncion",
  horizonDays: 30,
  overdueCount: 0,
  upcomingCount: 0,
  rows: [],
};

const DEWORMING_EMPTY: ReportResponse = {
  report: "deworming-due",
  asOfDate: "2026-06-11",
  timeZone: "America/Asuncion",
  horizonDays: 30,
  overdueCount: 0,
  upcomingCount: 0,
  rows: [],
};

const PERIOD_EMPTY: ReportResponse = { ...SALES_BY_PERIOD, saleCount: 0, rows: [] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function installFetch(
  handler: (url: string) => Response | Promise<Response>
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(resolveUrl(input)))
  );
  global.fetch = fetchMock;
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
  return fetchMock.mock.calls.map((call) => resolveUrl(call[0] as RequestInfo | URL));
}

function installPendingFetch(): void {
  global.fetch = vi.fn(() => new Promise<Response>(() => undefined));
}

function renderWorkspace(
  reportCode: Parameters<typeof ReportWorkspace>[0]["reportCode"],
  options: { readonly permissions?: readonly string[] } = {}
): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReportWorkspace reportCode={reportCode} permissions={options.permissions} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportWorkspace · the period query", () => {
  it("renders the rows with the headers derived from the response and sends the preset it shows", async () => {
    const fetchMock = installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period");

    await screen.findByTestId("report-table");
    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Gross" })).toBeInTheDocument();

    // The opening selection is the preset the select shows, so the first request
    // and the visible control cannot disagree.
    expect(requestedUrls(fetchMock)).toEqual(["/api/reports/sales-by-period?preset=last30Days"]);

    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "last7Days" } });

    await screen.findByTestId("report-table");
    expect(requestedUrls(fetchMock)).toContain("/api/reports/sales-by-period?preset=last7Days");
  });

  it("sends a custom range only once BOTH dates are set, and never half of one", async () => {
    const fetchMock = installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period");
    await screen.findByTestId("report-table");

    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "custom" } });
    expect(screen.getByLabelText("From")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-10" } });
    // Half a range is ambiguous and the API refuses it, so it is not sent: the
    // surface says what is missing instead of asking for a period it cannot name.
    expect(screen.getByTestId("report-control-notice")).toHaveTextContent("both a start date");
    expect(
      requestedUrls(fetchMock).some((url) => url === "/api/reports/sales-by-period?from=2026-06-10")
    ).toBe(false);
    expect(
      requestedUrls(fetchMock).some((url) => url.includes("from=") && !url.includes("to="))
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-11" } });

    await screen.findByTestId("report-table");
    expect(requestedUrls(fetchMock)).toContain(
      "/api/reports/sales-by-period?from=2026-06-10&to=2026-06-11"
    );
  });

  it("offers the horizon control on the due reports and no period at all", async () => {
    const fetchMock = installFetch(() => jsonResponse(VACCINES_EMPTY));
    renderWorkspace("vaccines-due");

    await screen.findByTestId("report-empty-due");
    expect(screen.getByLabelText("Horizon (days)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Period")).not.toBeInTheDocument();
    expect(requestedUrls(fetchMock)).toEqual(["/api/reports/vaccines-due?horizonDays=30"]);

    fireEvent.change(screen.getByLabelText("Horizon (days)"), { target: { value: "60" } });

    await screen.findByTestId("report-empty-due");
    expect(requestedUrls(fetchMock)).toContain("/api/reports/vaccines-due?horizonDays=60");
  });

  it("offers NEITHER control on the current-state report and sends no query", async () => {
    const fetchMock = installFetch(() => jsonResponse(LOW_STOCK_EMPTY));
    renderWorkspace("low-stock");

    await screen.findByTestId("report-empty-low-stock-thresholds");
    expect(screen.queryByLabelText("Period")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Horizon (days)")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-no-query")).toBeInTheDocument();
    // `low-stock` refuses every query key, so the request carries none.
    expect(requestedUrls(fetchMock)).toEqual(["/api/reports/low-stock"]);
  });
});

describe("ReportWorkspace · the export action", () => {
  it("points at the export route with the very query the table is showing", async () => {
    installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period", { permissions: ["reports.read", "reports.export"] });

    await screen.findByTestId("report-table");
    expect(screen.getByTestId("report-export").getAttribute("href")).toBe(
      "/api/reports/sales-by-period/export?preset=last30Days"
    );

    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "thisMonth" } });

    await screen.findByTestId("report-table");
    expect(screen.getByTestId("report-export").getAttribute("href")).toBe(
      "/api/reports/sales-by-period/export?preset=thisMonth"
    );
  });

  it("hides the export action from a caller without reports.export, and keeps it when permissions are unknown", async () => {
    installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period", { permissions: ["reports.read"] });

    await screen.findByTestId("report-table");
    // UX only: the API refuses that caller regardless of what the browser renders.
    expect(screen.queryByTestId("report-export")).not.toBeInTheDocument();
  });

  it("shows the export action when the shell does not know the caller's permissions", async () => {
    installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period");

    await screen.findByTestId("report-table");
    expect(screen.getByTestId("report-export")).toHaveAttribute(
      "href",
      "/api/reports/sales-by-period/export?preset=last30Days"
    );
  });

  it("exports the current-state report with no query", async () => {
    installFetch(() => jsonResponse(LOW_STOCK_EMPTY));
    renderWorkspace("low-stock", { permissions: ["reports.read", "reports.export"] });

    await screen.findByTestId("report-empty-low-stock-thresholds");
    expect(screen.getByTestId("report-export").getAttribute("href")).toBe(
      "/api/reports/low-stock/export"
    );
  });
});

describe("ReportWorkspace · decimal strings render verbatim", () => {
  it("prints 1234.50 as 1234.50 and never as 1234.5", async () => {
    installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period");

    await screen.findByTestId("report-table");

    // A fixed-scale decimal string IS the value. `Number()` here would print a
    // different number at a scale the report never chose.
    expect(screen.getByText("1234.50")).toBeInTheDocument();
    expect(screen.queryByText("1234.5")).not.toBeInTheDocument();
    // A count is a number in the DTO and may be printed as one.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("prints a negative and a zero-scale decimal exactly as the API sent them", async () => {
    installFetch(() =>
      jsonResponse({
        report: "cash-movements",
        period: PERIOD,
        net: "-10.00",
        rows: [
          { type: "REFUND", direction: null, movementCount: 1, signedAmount: "-10.00" },
          { type: "SALE", direction: null, movementCount: 4, signedAmount: "0.00" },
        ],
      })
    );
    renderWorkspace("cash-movements");

    await screen.findByTestId("report-table");
    expect(screen.getByText("-10.00")).toBeInTheDocument();
    expect(screen.getByText("0.00")).toBeInTheDocument();
    // A null direction is "no value", not the word null and not a zero.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});

describe("ReportWorkspace · every state", () => {
  it("shows the loading state", () => {
    installPendingFetch();
    renderWorkspace("sales-by-period");

    expect(screen.getByTestId("report-loading")).toHaveTextContent("Loading report");
  });

  it("shows the permission-denied state when the API refuses the read", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "Insufficient permissions." } }, 403)
    );
    renderWorkspace("sales-by-period");

    const denied = await screen.findByTestId("report-permission-denied");
    expect(denied).toHaveTextContent("You do not have permission to read reports.");
    expect(screen.queryByTestId("report-error")).not.toBeInTheDocument();
  });

  it("shows the API's own sentence for an over-long period, verbatim", async () => {
    installFetch(() =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "The report period spans more than 366 days.",
          },
        },
        400
      )
    );
    renderWorkspace("sales-by-period");

    // The Story requires the range refusal to surface the API's message rather
    // than a generic failure; this is where the surface could have swallowed it.
    const error = await screen.findByTestId("report-error");
    expect(error).toHaveTextContent("The report period spans more than 366 days.");
  });

  it("shows the success state with one row per API row", async () => {
    installFetch(() => jsonResponse(SALES_BY_PERIOD));
    renderWorkspace("sales-by-period");

    await screen.findByTestId("report-table");
    expect(screen.getAllByTestId("report-row")).toHaveLength(1);
    expect(screen.queryByTestId("report-empty-period")).not.toBeInTheDocument();
  });
});

describe("ReportWorkspace · the empty states that have a fix", () => {
  it("explains that no low-stock threshold is set and links to the catalog", async () => {
    installFetch(() => jsonResponse(LOW_STOCK_EMPTY));
    renderWorkspace("low-stock");

    const empty = await screen.findByTestId("report-empty-low-stock-thresholds");
    expect(empty).toHaveTextContent("No item has a low-stock threshold yet");
    // The link is the actionable half: the missing fact is entered there.
    expect(screen.getByTestId("report-empty-action")).toHaveAttribute("href", "/app/catalog");
  });

  it("distinguishes a configured-but-clear low-stock report from an unconfigured one", async () => {
    installFetch(() => jsonResponse({ report: "low-stock", thresholdsConfigured: true, rows: [] }));
    renderWorkspace("low-stock");

    const empty = await screen.findByTestId("report-empty-low-stock-clear");
    expect(empty).toHaveTextContent("No item is at or below its threshold");
    // Nothing to fix here, so there is no link to a fix.
    expect(screen.queryByTestId("report-empty-action")).not.toBeInTheDocument();
  });

  it("explains that no vaccination due date is recorded and links to the patients surface", async () => {
    installFetch(() => jsonResponse(VACCINES_EMPTY));
    renderWorkspace("vaccines-due");

    const empty = await screen.findByTestId("report-empty-due");
    expect(empty).toHaveTextContent("No vaccination has a due date");
    expect(empty).toHaveTextContent("2026-06-11");
    expect(screen.getByTestId("report-empty-action")).toHaveAttribute("href", "/app/patients");
  });

  it("explains the same for deworming, on its own rows", async () => {
    installFetch(() => jsonResponse(DEWORMING_EMPTY));
    renderWorkspace("deworming-due");

    const empty = await screen.findByTestId("report-empty-due");
    expect(empty).toHaveTextContent("No deworming treatment has a due date");
    expect(screen.getByTestId("report-empty-action")).toHaveAttribute("href", "/app/patients");
  });

  it("answers a period report's emptiness plainly, echoing the period the API resolved", async () => {
    installFetch(() => jsonResponse(PERIOD_EMPTY));
    renderWorkspace("sales-by-period");

    const empty = await screen.findByTestId("report-empty-period");
    expect(empty).toHaveTextContent("Nothing was recorded in this period");
    // The echo comes from the response, so it is the range that answered — not the
    // range the browser believes it asked for.
    expect(empty).toHaveTextContent("2026-05-13");
    expect(empty).toHaveTextContent("2026-06-11");
    expect(screen.queryByTestId("report-table")).not.toBeInTheDocument();
  });
});
