import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CounterSurface } from "./counter-surface";

/**
 * The POS state coverage (EPIC-12 POS-004 acceptance criterion): loading, empty,
 * error, success, permission-denied and entitlement-denied, one focused case per
 * branch. The permission and entitlement branches are UX affordances only; the
 * backend still enforces both gates.
 */

const SALE_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

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

function installFetch(
  sales: SalesResponder,
  catalog: () => Response = () => jsonResponse([ITEM])
): void {
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url.startsWith("/api/catalog")) return Promise.resolve(catalog());
    if (url.startsWith("/api/customers")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(sales(url, init));
  });
}

function renderCounter(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CounterSurface />
    </QueryClientProvider>
  );
}

async function addAndCheckout(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Add to sale" }));
  fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
  await screen.findByRole("button", { name: "Complete sale" });
}

describe("POS state coverage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loading: shows the explicit loading state while the catalog read is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderCounter();

    expect(screen.getByText("Loading catalog items...")).toBeInTheDocument();
  });

  it("empty: shows the empty state when no catalog item matches and the cart is empty", async () => {
    installFetch(
      () => jsonResponse([]),
      () => jsonResponse([])
    );

    renderCounter();

    expect(await screen.findByTestId("catalog-empty")).toHaveTextContent(
      "No catalog items match this search."
    );
    expect(screen.getByTestId("cart-empty")).toHaveTextContent("No lines yet.");
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
  });

  it("error: shows the catalog failure as an error, never as an empty list", async () => {
    installFetch(
      () => jsonResponse([]),
      () =>
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Catalog unavailable." } }, 500)
    );

    renderCounter();

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog unavailable.");
    expect(screen.queryByTestId("catalog-empty")).not.toBeInTheDocument();
  });

  it("success: shows the API's confirmed completion after create-then-complete", async () => {
    installFetch((url, init) => {
      if (url.endsWith("/complete")) return jsonResponse(COMPLETED_SALE, 201);
      return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
    });

    renderCounter();
    await addAndCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("Sale completed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("permission-denied: renders the refusal as a UX branch without claiming completion", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403)
    );

    renderCounter();
    fireEvent.click(await screen.findByRole("button", { name: "Add to sale" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(await screen.findByTestId("create-error")).toHaveTextContent("Permission denied");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("entitlement-denied: hides the surface when the tenant lacks the sales capability", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "FEATURE_NOT_ENTITLED", message: "Sales features are not enabled." } },
        403
      )
    );

    renderCounter();
    fireEvent.click(await screen.findByRole("button", { name: "Add to sale" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(await screen.findByTestId("entitlement-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-empty")).not.toBeInTheDocument();
  });
});
