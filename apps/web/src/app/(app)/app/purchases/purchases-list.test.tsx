import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PurchaseList } from "./purchases-list";

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const PURCHASE_ID = "22222222-2222-4222-8222-222222222222";

const SUPPLIER = {
  id: SUPPLIER_ID,
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: null,
  taxId: null,
  email: null,
  phone: null,
  address: null,
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

const CATALOG_ITEM = {
  id: ITEM_ID,
  tenantId: "tenant-a",
  kind: "SUPPLY",
  name: "Gauze roll",
  taxRateId: "rate-1",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "10.00" },
  referencePriceAmount: null,
  referencePriceCurrency: null,
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

const DRAFT_PURCHASE = {
  id: PURCHASE_ID,
  tenantId: "tenant-a",
  supplierId: SUPPLIER_ID,
  status: "DRAFT",
  lines: [{ id: "line-1", catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" }],
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

interface FetchOptions {
  readonly purchases: (url: string) => Response;
  readonly suppliers?: () => Response;
  readonly catalog?: () => Response;
}

function installFetch(options: FetchOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = resolveUrl(input);
    if (url.startsWith("/api/suppliers")) {
      return Promise.resolve(options.suppliers?.() ?? jsonResponse([SUPPLIER]));
    }
    if (url.startsWith("/api/catalog")) {
      return Promise.resolve(options.catalog?.() ?? jsonResponse([CATALOG_ITEM]));
    }
    return Promise.resolve(options.purchases(url));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function purchaseRequestUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => resolveUrl(call[0] as RequestInfo | URL))
    .filter((url) => url.startsWith("/api/purchases"));
}

function renderList(): void {
  render(
    <TestWrapper>
      <PurchaseList />
    </TestWrapper>
  );
}

describe("PurchaseList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    installFetch({
      purchases: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    renderList();

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(screen.getByText("You do not have permission to manage purchases.")).toBeInTheDocument();
    // A refusal is never rendered as an empty list.
    expect(screen.queryByText("No purchases yet")).not.toBeInTheDocument();
  });

  it("renders an unauthenticated UX message when the API returns 401", async () => {
    installFetch({
      purchases: () =>
        jsonResponse(
          { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
          401
        ),
    });

    renderList();

    expect(await screen.findByText("You must be signed in to view purchases.")).toBeInTheDocument();
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
  });

  it("renders an explicit loading state while the list is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderList();

    expect(screen.getByText("Loading purchases...")).toBeInTheDocument();
  });

  it("renders the empty state when the tenant has no purchases", async () => {
    installFetch({ purchases: () => jsonResponse([]) });

    renderList();

    expect(await screen.findByText("No purchases yet")).toBeInTheDocument();
  });

  it("renders a filtered empty state that names the filter", async () => {
    installFetch({ purchases: () => jsonResponse([]) });

    renderList();

    await screen.findByText("No purchases yet");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "RECEIVED" } });

    expect(await screen.findByText("No purchases match this filter")).toBeInTheDocument();
  });

  it("renders the purchase reference, status and resolved supplier name", async () => {
    installFetch({ purchases: () => jsonResponse([DRAFT_PURCHASE]) });

    renderList();

    expect(await screen.findByRole("link", { name: "Purchase #22222222" })).toHaveAttribute(
      "href",
      `/app/purchases/${PURCHASE_ID}`
    );
    expect(screen.getByText("Draft", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/Distribuidora Central/)).toBeInTheDocument();
  });

  it("serializes the lifecycle filter as status", async () => {
    const fetchMock = installFetch({ purchases: () => jsonResponse([DRAFT_PURCHASE]) });

    renderList();

    await screen.findByText(/Distribuidora Central/);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "RECEIVED" } });

    await waitFor(() => {
      expect(
        purchaseRequestUrls(fetchMock).some((url) => url === "/api/purchases?status=RECEIVED")
      ).toBe(true);
    });
  });

  it("degrades to a short id fragment when the supplier list is not readable", async () => {
    installFetch({
      purchases: () => jsonResponse([DRAFT_PURCHASE]),
      suppliers: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    renderList();

    // The page still renders; the unreadable supplier name becomes a fragment.
    expect(await screen.findByText(/^#11111111/)).toBeInTheDocument();
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
  });

  it("offers Edit only for a draft and no delete or status affordance", async () => {
    const fetchMock = installFetch({ purchases: () => jsonResponse([DRAFT_PURCHASE]) });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();

    await screen.findByText(/Distribuidora Central/);
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/app/purchases/${PURCHASE_ID}/edit`
    );
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /receive|cancel/i })).not.toBeInTheDocument();

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method ?? "GET").not.toBe("DELETE");
      expect(init?.method ?? "GET").not.toBe("PATCH");
    }
  });

  it("hides Edit for a purchase that is no longer a draft", async () => {
    installFetch({
      purchases: () => jsonResponse([{ ...DRAFT_PURCHASE, status: "RECEIVED" }]),
    });

    renderList();

    await screen.findByText(/Distribuidora Central/);
    expect(screen.getByText("Received", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});
