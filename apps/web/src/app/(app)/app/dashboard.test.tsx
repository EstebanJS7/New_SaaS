import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isReportCode, type ReportCode } from "@/app/api/reports/report-codes";
import { Dashboard } from "./dashboard";
import { ReportWorkspace } from "./reports/report-workspace";
import {
  REPORT_DEFAULT_PRESET,
  reportRequestPath,
  type ReportResponse,
} from "./reports/reports-api";

/**
 * The dashboard at `/app` ([[REP-008]], [[DEC-062]]).
 *
 * The cases are grouped by what a reader could get wrong:
 *
 * 1. **One aggregation path.** A card and the report view it links to must send
 *    the SAME request for the same period. That is [[DEC-062]]'s binding
 *    requirement, and it is asserted against the real URLs both surfaces send and
 *    against the shipped `reportRequestPath`, not against a convention.
 * 2. **The period.** It scopes the two period reports and must NOT touch the
 *    current-state one: `low-stock` takes no query, so a period change that
 *    refetched it would be claiming a period it does not have.
 * 3. **The cards.** Each value is the API's own field rendered verbatim — a
 *    fixed-scale decimal string stays at its scale, a negative difference keeps
 *    its sign — and each card links to its report.
 * 4. **Every state**, and the honest first-run low-stock answer that is not a
 *    zero.
 */

const PERIOD = {
  preset: "last30Days",
  fromDate: "2026-05-13",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: "2026-05-13T04:00:00.000Z",
  toInstant: "2026-06-12T04:00:00.000Z",
};

/** `totalGross` is a fixed-scale STRING; `saleCount` is a number. Both come from the DTO. */
const SALES_BY_PERIOD: ReportResponse = {
  report: "sales-by-period",
  period: PERIOD,
  currency: "PYG",
  saleCount: 3,
  totalNet: "1100.00",
  totalTax: "134.50",
  totalGross: "1234.50",
  rows: [
    { bucketDate: "2026-06-10", saleCount: 2, net: "1000.00", tax: "100.00", gross: "1234.50" },
    { bucketDate: "2026-06-11", saleCount: 1, net: "100.00", tax: "34.50", gross: "134.50" },
  ],
};

/** A drawer that closed SHORT: the difference is negative and the sign is the information. */
const CASH_SESSIONS: ReportResponse = {
  report: "cash-sessions",
  period: PERIOD,
  rows: [
    {
      sessionId: "b0000000-0000-0000-0000-000000000001",
      registerId: "b0000000-0000-0000-0000-000000000002",
      openedAt: "2026-06-10T08:00:00.000Z",
      closedAt: "2026-06-10T20:00:00.000Z",
      openingAmount: "100.00",
      expectedAmount: "500.00",
      countedAmount: "250.00",
      differenceAmount: "-250.00",
    },
  ],
  totals: { expected: "500.00", counted: "250.00", difference: "-250.00" },
};

const LOW_STOCK_CONFIGURED: ReportResponse = {
  report: "low-stock",
  thresholdsConfigured: true,
  rows: [
    {
      catalogItemId: "c0000000-0000-0000-0000-000000000001",
      name: "Amoxicillin 250mg",
      quantity: "2.000",
      threshold: "5.000",
      shortfall: "3.000",
    },
    {
      catalogItemId: "c0000000-0000-0000-0000-000000000002",
      name: "Gauze roll",
      quantity: "1.000",
      threshold: "4.000",
      shortfall: "3.000",
    },
  ],
};

/** The demo tenant's first-run state ([[DEC-065]]): no threshold exists, so nothing is monitored. */
const LOW_STOCK_NOT_CONFIGURED: ReportResponse = {
  report: "low-stock",
  thresholdsConfigured: false,
  rows: [],
};

const FIXTURES: Partial<Record<ReportCode, ReportResponse>> = {
  "sales-by-period": SALES_BY_PERIOD,
  "cash-sessions": CASH_SESSIONS,
  "low-stock": LOW_STOCK_CONFIGURED,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

type FetchHandler = (url: string) => Response;

function installFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(resolveUrl(input)))
  );
  global.fetch = fetchMock;
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
  return fetchMock.mock.calls.map((call) => resolveUrl(call[0] as RequestInfo | URL));
}

/** The report code a request URL names — `/api/reports/sales-by-period?preset=…` → `sales-by-period`. */
function reportCodeOfUrl(url: string): ReportCode | undefined {
  const path = url.split("?")[0] ?? url;
  const code = path.slice(path.lastIndexOf("/") + 1);
  return isReportCode(code) ? code : undefined;
}

/** Answers every report read from the fixtures, with optional per-report overrides. */
function installReports(
  overrides: Partial<Record<ReportCode, FetchHandler>> = {}
): ReturnType<typeof vi.fn> {
  return installFetch((url) => {
    const code = reportCodeOfUrl(url);
    const override = code === undefined ? undefined : overrides[code];
    if (override !== undefined) {
      return override(url);
    }
    const fixture = code === undefined ? undefined : FIXTURES[code];
    if (fixture === undefined) {
      // A request for a report this suite does not serve is a FAILURE, not an
      // empty answer: it is exactly what a second aggregation path would look
      // like from inside the mock.
      return jsonResponse({ error: { code: "NOT_FOUND", message: `No fixture for ${url}` } }, 404);
    }
    return jsonResponse(fixture);
  });
}

function installPendingFetch(): void {
  global.fetch = vi.fn(() => new Promise<Response>(() => undefined));
}

/**
 * Renders ONE surface with its OWN QueryClient.
 *
 * Separate clients on purpose: the point of the aggregation tests is to observe
 * two real requests. Sharing a client would let react-query dedupe the second
 * one, which would compare a URL against nothing.
 */
function renderWithClient(element: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

function renderDashboard(): void {
  renderWithClient(<Dashboard />);
}

function renderReportView(code: ReportCode): void {
  renderWithClient(<ReportWorkspace reportCode={code} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard · one aggregation path", () => {
  /**
   * The assertion [[DEC-062]] rests on, for the report two of the cards read.
   *
   * It fails on a second aggregation path in any of the shapes one could take: a
   * card that built its own URL (`/api/reports/sales-by-period/summary`, `?period=`,
   * `?preset=` spelled differently), a card whose period default drifted from the
   * report view's, or a card that fetched a "dashboard" endpoint the report view
   * does not use. In every one of those cases `dashboardUrls` and `reportViewUrls`
   * differ, and both differ from `reportRequestPath`.
   */
  it("sends the sales-by-period request the report view sends", async () => {
    const fetchMock = installReports();

    // The report VIEW first, with its own client, so its URL is a real request.
    renderReportView("sales-by-period");
    await screen.findByTestId("report-table");
    const reportViewUrls = requestedUrls(fetchMock).filter((url) =>
      url.startsWith("/api/reports/sales-by-period")
    );
    expect(reportViewUrls).toHaveLength(1);
    cleanup();

    // Then the dashboard, also with its own client. Its requests are the calls
    // this mock saw AFTER the report view's, so the two surfaces are compared as
    // two requests rather than as one repeated one.
    const seenBeforeDashboard = requestedUrls(fetchMock).length;
    renderDashboard();
    await screen.findByTestId("dashboard-card-gross-value");
    const dashboardUrls = requestedUrls(fetchMock)
      .slice(seenBeforeDashboard)
      .filter((url) => url.startsWith("/api/reports/sales-by-period"));

    // The dashboard requests it ONCE: the gross card and the sales card read the
    // same answer, so they are one question, not two.
    expect(dashboardUrls).toHaveLength(1);
    // Same URL as the report view's, and both are the one shipped builder's.
    expect(dashboardUrls).toEqual(reportViewUrls);
    expect(dashboardUrls).toEqual([
      reportRequestPath("sales-by-period", { kind: "preset", preset: REPORT_DEFAULT_PRESET }),
    ]);
  });

  it("sends the cash-sessions request the report view sends", async () => {
    const fetchMock = installReports();

    renderReportView("cash-sessions");
    await screen.findByTestId("report-table");
    const reportViewUrls = requestedUrls(fetchMock).filter((url) =>
      url.startsWith("/api/reports/cash-sessions")
    );
    expect(reportViewUrls).toHaveLength(1);
    cleanup();

    const seenBeforeDashboard = requestedUrls(fetchMock).length;
    renderDashboard();
    await screen.findByTestId("dashboard-card-cash-difference-value");
    const dashboardUrls = requestedUrls(fetchMock)
      .slice(seenBeforeDashboard)
      .filter((url) => url.startsWith("/api/reports/cash-sessions"));

    expect(dashboardUrls).toEqual(reportViewUrls);
    expect(dashboardUrls).toEqual([
      reportRequestPath("cash-sessions", { kind: "preset", preset: REPORT_DEFAULT_PRESET }),
    ]);
  });

  it("sends the low-stock request the report view sends, with NO query", async () => {
    const fetchMock = installReports();

    renderReportView("low-stock");
    await screen.findByTestId("report-table");
    const reportViewUrls = requestedUrls(fetchMock).filter((url) =>
      url.startsWith("/api/reports/low-stock")
    );
    expect(reportViewUrls).toHaveLength(1);
    cleanup();

    const seenBeforeDashboard = requestedUrls(fetchMock).length;
    renderDashboard();
    await screen.findByTestId("dashboard-card-low-stock-value");
    const dashboardUrls = requestedUrls(fetchMock)
      .slice(seenBeforeDashboard)
      .filter((url) => url.startsWith("/api/reports/low-stock"));

    expect(dashboardUrls).toEqual(reportViewUrls);
    // A current-state report refuses every query key, so the only correct URL is
    // the bare path — a `?preset=` here would be a `400` from the API.
    expect(dashboardUrls).toEqual([reportRequestPath("low-stock", { kind: "none" })]);
    expect(dashboardUrls).toEqual(["/api/reports/low-stock"]);
  });

  it("changes the period's request and leaves the low-stock card untouched", async () => {
    const fetchMock = installReports();
    renderDashboard();
    await screen.findByTestId("dashboard-card-gross-value");
    await screen.findByTestId("dashboard-card-low-stock-value");

    expect(requestedUrls(fetchMock)).toContain(
      reportRequestPath("sales-by-period", { kind: "preset", preset: "last30Days" })
    );
    expect(requestedUrls(fetchMock)).toContain(
      reportRequestPath("cash-sessions", { kind: "preset", preset: "last30Days" })
    );
    // One request so far, and it carries no query at all.
    expect(
      requestedUrls(fetchMock).filter((url) => url.includes("/api/reports/low-stock"))
    ).toEqual(["/api/reports/low-stock"]);

    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "last7Days" } });

    await waitFor(() => {
      expect(requestedUrls(fetchMock)).toContain(
        reportRequestPath("sales-by-period", { kind: "preset", preset: "last7Days" })
      );
    });
    // Both period-scoped cards follow the selector...
    expect(requestedUrls(fetchMock)).toContain(
      reportRequestPath("cash-sessions", { kind: "preset", preset: "last7Days" })
    );
    // ...and the current-state card does not: still exactly one request, still no
    // query. `low-stock` has no period, so refetching it would be the surface
    // inventing one.
    expect(
      requestedUrls(fetchMock).filter((url) => url.includes("/api/reports/low-stock"))
    ).toEqual(["/api/reports/low-stock"]);
  });
});

describe("Dashboard · the cards render the API's own values", () => {
  it("prints the gross total as the fixed-scale string it is, and never as a decimal the API did not send", async () => {
    installReports();
    renderDashboard();

    const gross = await screen.findByTestId("dashboard-card-gross-value");
    // `"1234.50"` is the value. `Number()` here would print `1234.5`, a different
    // number at a scale the report never chose.
    expect(within(gross).getByText("1234.50")).toBeInTheDocument();
    expect(screen.queryByText("1234.5")).not.toBeInTheDocument();
    // The currency comes from the same response, so the figure is unambiguous.
    expect(gross).toHaveTextContent("PYG");
  });

  it("prints the sale count as a number from the same response the gross total came from", async () => {
    installReports();
    renderDashboard();

    const sales = await screen.findByTestId("dashboard-card-sales-value");
    expect(within(sales).getByText("3")).toBeInTheDocument();
  });

  it("keeps the sign of a negative cash difference", async () => {
    installReports();
    renderDashboard();

    const difference = await screen.findByTestId("dashboard-card-cash-difference-value");
    // A drawer that closed SHORT: dropping the minus sign would turn a shortfall
    // into an overage, which is the opposite fact.
    expect(within(difference).getByText("-250.00")).toBeInTheDocument();
    expect(within(difference).queryByText("250.00")).not.toBeInTheDocument();
  });

  it("counts the low-stock rows the API returned when thresholds ARE configured", async () => {
    installReports();
    renderDashboard();

    const lowStock = await screen.findByTestId("dashboard-card-low-stock-value");
    expect(within(lowStock).getByText("2")).toBeInTheDocument();
    expect(lowStock).toHaveTextContent("items are at or below their own threshold");
  });

  it("links every card to its report's route", async () => {
    installReports();
    renderDashboard();
    await screen.findByTestId("dashboard-card-gross-value");

    expect(screen.getByTestId("dashboard-card-gross-link")).toHaveAttribute(
      "href",
      "/app/reports/sales-by-period"
    );
    expect(screen.getByTestId("dashboard-card-sales-link")).toHaveAttribute(
      "href",
      "/app/reports/sales-by-period"
    );
    expect(screen.getByTestId("dashboard-card-cash-difference-link")).toHaveAttribute(
      "href",
      "/app/reports/cash-sessions"
    );
    expect(screen.getByTestId("dashboard-card-low-stock-link")).toHaveAttribute(
      "href",
      "/app/reports/low-stock"
    );
  });
});

describe("Dashboard · the honest first-run low-stock answer", () => {
  it("says no threshold is set and links to the catalog instead of rendering a confident zero", async () => {
    installReports({ "low-stock": () => jsonResponse(LOW_STOCK_NOT_CONFIGURED) });
    renderDashboard();

    // The answer itself, awaited: the card root exists while it is still loading.
    await screen.findByTestId("dashboard-card-low-stock-not-configured");
    const card = screen.getByTestId("dashboard-card-low-stock");
    expect(screen.getByTestId("dashboard-card-low-stock-not-configured")).toHaveTextContent(
      "No item has a low-stock threshold yet"
    );
    // The missing fact is entered there, and it is the same destination the
    // report workspace's empty state points at.
    expect(screen.getByTestId("dashboard-card-low-stock-configure")).toHaveAttribute(
      "href",
      "/app/catalog"
    );
    // "Unmonitored" is not "healthy": a `0` here would be a claim nobody made.
    expect(within(card).queryByText("0")).not.toBeInTheDocument();
  });
});

describe("Dashboard · every state", () => {
  it("shows a loading state on every card while the reads are in flight", () => {
    installPendingFetch();
    renderDashboard();

    for (const testId of [
      "dashboard-card-gross",
      "dashboard-card-sales",
      "dashboard-card-cash-difference",
      "dashboard-card-low-stock",
    ]) {
      expect(screen.getByTestId(`${testId}-loading`)).toHaveTextContent("Loading");
    }
  });

  it("shows the API's own message on the card whose read failed, and values on the others", async () => {
    installReports({
      "sales-by-period": () =>
        jsonResponse(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "The report period spans more than 366 days.",
            },
          },
          400
        ),
    });
    renderDashboard();

    const error = await screen.findByTestId("dashboard-card-gross-error");
    expect(error).toHaveTextContent("The report period spans more than 366 days.");
    // The failure is per card: one unreadable report does not blank the surface.
    expect(screen.getByTestId("dashboard-card-sales-error")).toBeInTheDocument();
    expect(await screen.findByTestId("dashboard-card-cash-difference-value")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-card-gross-permission-denied")).not.toBeInTheDocument();
  });

  it("shows permission-denied on every card when the API refuses the caller", async () => {
    installReports({
      "sales-by-period": () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Insufficient permissions." } }, 403),
      "cash-sessions": () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Insufficient permissions." } }, 403),
      "low-stock": () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Insufficient permissions." } }, 403),
    });
    renderDashboard();

    const denied = await screen.findByTestId("dashboard-card-gross-permission-denied");
    expect(denied).toHaveTextContent("You do not have permission to read reports.");
    expect(
      screen.getByTestId("dashboard-card-cash-difference-permission-denied")
    ).toHaveTextContent("You do not have permission to read reports.");
    expect(screen.getByTestId("dashboard-card-low-stock-permission-denied")).toBeInTheDocument();
    // A refusal is NOT a generic failure, and the two must not be confused.
    expect(screen.queryByTestId("dashboard-card-gross-error")).not.toBeInTheDocument();
  });

  it("shows the success state with the cards' values once the reads answer", async () => {
    installReports();
    renderDashboard();

    expect(await screen.findByTestId("dashboard-card-gross-value")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-sales-value")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-cash-difference-value")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-card-low-stock-value")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-card-gross-loading")).not.toBeInTheDocument();
  });
});
