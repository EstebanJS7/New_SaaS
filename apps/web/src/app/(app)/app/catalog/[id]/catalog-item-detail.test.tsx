import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogItemDetail } from "./catalog-item-detail";

/**
 * `useParams` is mocked with a canonical UUID because the proxy refuses a
 * malformed id; the fixture id and the route param stay the same value.
 */
const { ITEM_ID } = vi.hoisted(() => ({
  ITEM_ID: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: ITEM_ID }),
}));

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

const ITEM = {
  id: ITEM_ID,
  tenantId: "tenant-a",
  kind: "SERVICE",
  name: "Consulta clínica",
  taxRateId: "22222222-2222-4222-8222-222222222222",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "0.10" },
  referencePriceAmount: "150000.00",
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

function mockFetch(response: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(response()));
  global.fetch = fetchMock;
  return fetchMock;
}

describe("CatalogItemDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the item read-only, linking Edit to the separate edit route", async () => {
    const fetchMock = mockFetch(() => jsonResponse(ITEM));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Consulta clínica" })
    ).toBeInTheDocument();
    expect(resolveUrl(fetchMock.mock.calls[0]?.[0] as RequestInfo | URL)).toBe(
      `/api/catalog/${ITEM_ID}`
    );

    expect(screen.getByText("Service · IVA 10%")).toBeInTheDocument();
    expect(screen.getByText("Kind")).toBeInTheDocument();
    expect(screen.getByText("Tax rate")).toBeInTheDocument();
    expect(screen.getByText("IVA 10%")).toBeInTheDocument();
    expect(screen.getByText("Reference price")).toBeInTheDocument();
    expect(screen.getByText("150000.00 PYG")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/app/catalog/${ITEM_ID}/edit`
    );
    // The read-only surface mutates nothing: no deactivate command is offered.
    expect(screen.queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
  });

  it("shows an inactive item with no reference price without inventing a value", async () => {
    mockFetch(() =>
      jsonResponse({
        ...ITEM,
        isActive: false,
        referencePriceAmount: null,
        referencePriceCurrency: null,
      })
    );

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    mockFetch(() => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have permission to manage catalog items.")
    ).toBeInTheDocument();
  });

  it("keeps the entitlement copy when the API returns 403 FEATURE_NOT_ENTITLED", async () => {
    mockFetch(() => jsonResponse({ error: { code: "FEATURE_NOT_ENTITLED", message: "No" } }, 403));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(
      await screen.findByText("The catalog is not enabled for this tenant.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
  });

  it("renders the mapped not-found copy when the item is missing", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Catalog item not found" } }, 404)
    );

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Catalog item not found.")).toBeInTheDocument();
  });

  it("renders the unauthenticated UX message when the API returns 401", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401)
    );

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(
      await screen.findByText("You must be signed in to view the catalog.")
    ).toBeInTheDocument();
  });

  it("renders an explicit loading state while the item is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(screen.getByText("Loading catalog item...")).toBeInTheDocument();
  });
});
