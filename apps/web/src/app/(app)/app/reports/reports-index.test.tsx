import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportsIndex } from "./reports-index";

/**
 * The reports index ([[REP-008]], [[DEC-062]]).
 *
 * The twelve entries are static; the ACCESS is not. There is no feature code to
 * gate this destination on, so the index asks the API — through the one report
 * that takes no query parameter — and renders the three states that answer can
 * produce. What these cases pin is that the catalogue is complete and grouped,
 * that every entry is a real link, and that a refusal or an outage is shown as
 * itself rather than as an empty page.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

const LOW_STOCK_EMPTY = { report: "low-stock", thresholdsConfigured: false, rows: [] };

/** Installs a fetch double that answers every report read with one response. */
function installFetch(handler: () => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(handler()));
  global.fetch = fetchMock;
  return fetchMock;
}

/** A fetch double that never settles, so the loading state is observable. */
function installPendingFetch(): void {
  global.fetch = vi.fn(() => new Promise<Response>(() => undefined));
}

function renderIndex(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReportsIndex />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportsIndex", () => {
  it("lists all twelve reports, grouped Core and Veterinary, each one a link", async () => {
    const fetchMock = installFetch(() => jsonResponse(LOW_STOCK_EMPTY));
    renderIndex();

    await screen.findAllByTestId("report-index-entry");

    const groups = screen.getAllByTestId("reports-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText("Core")).toBeInTheDocument();
    expect(within(groups[1]).getByText("Veterinary")).toBeInTheDocument();

    const entries = screen.getAllByTestId("report-index-entry");
    expect(entries).toHaveLength(12);

    // The eight business reports and the four clinical ones: the grouping is the
    // product's own vocabulary (PRD §9), and a report may not drift between them.
    expect(within(groups[0]).getAllByTestId("report-index-entry")).toHaveLength(8);
    expect(within(groups[1]).getAllByTestId("report-index-entry")).toHaveLength(4);

    for (const code of [
      "sales-by-period",
      "payment-methods",
      "sales-by-product-service",
      "cash-sessions",
      "cash-movements",
      "purchases",
      "stock",
      "low-stock",
      "consultations",
      "new-patients",
      "vaccines-due",
      "deworming-due",
    ]) {
      expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toContain(
        `/app/reports/${code}`
      );
    }

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/app/reports/sales-by-period",
      "/app/reports/payment-methods",
      "/app/reports/sales-by-product-service",
      "/app/reports/cash-sessions",
      "/app/reports/cash-movements",
      "/app/reports/purchases",
      "/app/reports/stock",
      "/app/reports/low-stock",
      "/app/reports/consultations",
      "/app/reports/new-patients",
      "/app/reports/vaccines-due",
      "/app/reports/deworming-due",
    ]);

    // The probe is the ONE report with no query contract: checking access must not
    // cost a period, and it uses the same aggregation path the workspace does.
    expect(resolveUrl(fetchMock.mock.calls[0]?.[0] as string)).toBe("/api/reports/low-stock");
  });

  it("shows the checking state while the access probe is in flight", () => {
    installPendingFetch();
    renderIndex();

    expect(screen.getByTestId("reports-loading")).toHaveTextContent("Checking your report access");
    // The catalogue is not hidden behind the probe: an unusable link is still a
    // report the product ships.
    expect(screen.getAllByTestId("report-index-entry")).toHaveLength(12);
  });

  it("renders the permission-denied state when the caller lacks reports.read", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "Insufficient permissions." } }, 403)
    );
    renderIndex();

    const denied = await screen.findByTestId("reports-permission-denied");
    expect(denied).toHaveTextContent("You do not have permission to read reports.");
    expect(screen.queryByTestId("reports-error")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("report-index-entry")).toHaveLength(12);
  });

  it("renders the error state with the API's own message", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "Reporting is temporarily unavailable." } },
        500
      )
    );
    renderIndex();

    const error = await screen.findByTestId("reports-error");
    expect(error).toHaveTextContent("Reporting is temporarily unavailable.");
    expect(screen.queryByTestId("reports-permission-denied")).not.toBeInTheDocument();
  });
});
