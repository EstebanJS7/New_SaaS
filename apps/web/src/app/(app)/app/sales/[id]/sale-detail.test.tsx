import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SaleDetail } from "./sale-detail";

const SALE_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: SALE_ID }),
}));

const ITEM = {
  id: ITEM_ID,
  tenantId: "tenant-a",
  kind: "PRODUCT",
  name: "Antibiotic",
  taxRateId: "rate-1",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "10.00" },
  referencePriceAmount: "1500.00",
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

const DRAFT_SALE = {
  id: SALE_ID,
  tenantId: "tenant-a",
  customerId: null,
  currency: "PYG",
  status: "DRAFT",
  lines: [
    {
      id: "line-1",
      catalogItemId: ITEM_ID,
      rateCode: "IVA_10",
      unitPrice: "1500.00",
      quantity: "1.000",
      lineTotal: "1500.00",
      taxableBase: "1363.64",
      taxAmount: "136.36",
    },
  ],
  total: "1500.00",
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

const COMPLETED_SALE = {
  ...DRAFT_SALE,
  status: "COMPLETED",
  payments: [{ id: "pay-1", method: "CASH", amount: "1500.00" }],
  replay: false,
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

type SalesResponder = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch(sales: SalesResponder): void {
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url.startsWith("/api/catalog")) return Promise.resolve(jsonResponse([ITEM]));
    if (url.startsWith("/api/customers")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(sales(url, init));
  });
}

function renderDetail(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SaleDetail />
    </QueryClientProvider>
  );
}

describe("SaleDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an explicit loading state while the sale is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderDetail();

    expect(screen.getByTestId("sale-loading")).toHaveTextContent("Loading sale...");
  });

  it("renders the shared not-found state for a 404", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Sale was not found." } }, 404)
    );

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not found");
    expect(alert).toHaveTextContent("Sale not found.");
  });

  it("renders the permission-denied UX branch for a 403", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403)
    );

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage sales.");
  });

  it("renders the entitlement-denied UX branch for a 403 FEATURE_NOT_ENTITLED", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "FEATURE_NOT_ENTITLED", message: "Sales features are not enabled." } },
        403
      )
    );

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sales are not enabled for this tenant");
  });

  it("reopens a draft with its lines, no payments and the honest status", async () => {
    installFetch(() => jsonResponse(DRAFT_SALE));

    renderDetail();

    expect(await screen.findByText("Sale #22222222")).toBeInTheDocument();
    expect(
      screen.getByText("Draft sale. Status is read from the API and never inferred here.")
    ).toBeInTheDocument();
    expect(await screen.findByText("Antibiotic")).toBeInTheDocument();
    expect(screen.getByText("Walk-in (no customer)")).toBeInTheDocument();
    expect(screen.getByTestId("no-payments")).toHaveTextContent(
      "No payments are recorded for this sale."
    );
    expect(screen.getByRole("button", { name: "Complete sale" })).toBeInTheDocument();
  });

  it("shows the payments the completion command returned and the confirmed status", async () => {
    installFetch((url, init) =>
      url.endsWith("/complete")
        ? jsonResponse(COMPLETED_SALE, 201)
        : init?.method === "POST"
          ? jsonResponse(COMPLETED_SALE, 201)
          : jsonResponse(DRAFT_SALE)
    );

    renderDetail();
    await screen.findByRole("button", { name: "Complete sale" });
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("Sale completed")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByTestId("payment-amount")).toHaveTextContent("1,500.00 PYG");
    expect(screen.queryByTestId("no-payments")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete sale" })).not.toBeInTheDocument();
  });

  it("renders a refused completion honestly and leaves the draft completable", async () => {
    installFetch((url) =>
      url.endsWith("/complete")
        ? jsonResponse(
            {
              error: {
                code: "VALIDATION_FAILED",
                message: "The payments must sum exactly to the sale total.",
              },
            },
            400
          )
        : jsonResponse(DRAFT_SALE)
    );

    renderDetail();
    await screen.findByRole("button", { name: "Complete sale" });
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(
      await screen.findByText("The payments do not sum to the sale total")
    ).toBeInTheDocument();
    expect(screen.queryByText("Sale completed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete sale" })).toBeInTheDocument();
  });

  it("offers no edit, delete, refund or reversal affordance", async () => {
    installFetch(() => jsonResponse(DRAFT_SALE));

    renderDetail();
    await screen.findByText("Antibiotic");

    expect(
      screen.queryByRole("button", { name: /delete|refund|reverse|cancel sale/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/discount|invoice|fiscal|change/i)).not.toBeInTheDocument();
  });
});
