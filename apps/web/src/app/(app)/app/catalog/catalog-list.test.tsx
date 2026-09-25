import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogList } from "./catalog-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "item-1" }),
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
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-a",
  kind: "SERVICE",
  name: "Consulta clínica",
  taxRateId: "22222222-2222-4222-8222-222222222222",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "0.1" },
  referencePriceAmount: "150000.00",
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

function mockCatalogFetch(listHandler: (url: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = resolveUrl(input);
    if (url.includes("/deactivate")) {
      return Promise.resolve(jsonResponse({ ...ITEM, isActive: false }));
    }
    return Promise.resolve(listHandler(url));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function listRequestUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => resolveUrl(call[0] as RequestInfo | URL))
    .filter((url) => url.startsWith("/api/catalog") && !url.includes("/deactivate"));
}

describe("CatalogList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    mockCatalogFetch(() =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403)
    );

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(
      screen.getByText("You do not have permission to manage catalog items.")
    ).toBeInTheDocument();
  });

  it("renders the entitlement copy when the API returns 403 FEATURE_NOT_ENTITLED", async () => {
    mockCatalogFetch(() =>
      jsonResponse({ error: { code: "FEATURE_NOT_ENTITLED", message: "Not entitled" } }, 403)
    );

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    expect(
      await screen.findByText("The catalog is not enabled for this tenant.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
  });

  it("renders an unauthenticated UX message when the API returns 401", async () => {
    mockCatalogFetch(() =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401)
    );

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    expect(
      await screen.findByText("You must be signed in to view the catalog.")
    ).toBeInTheDocument();
  });

  it("renders the active-only empty state when the tenant has no active items", async () => {
    mockCatalogFetch(() => jsonResponse([]));

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    expect(await screen.findByText("No active catalog items")).toBeInTheDocument();
  });

  it("links the item name to the read-only detail route and Edit to the edit route", async () => {
    mockCatalogFetch(() => jsonResponse([ITEM]));

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    expect(await screen.findByRole("link", { name: "Consulta clínica" })).toHaveAttribute(
      "href",
      `/app/catalog/${ITEM.id}`
    );
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/app/catalog/${ITEM.id}/edit`
    );
  });

  it("defaults the status filter to active and includes deactivated items on request", async () => {
    const fetchMock = mockCatalogFetch(() => jsonResponse([ITEM]));

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    await screen.findByText("Consulta clínica");
    expect(listRequestUrls(fetchMock).some((url) => url.includes("isActive=true"))).toBe(true);

    fireEvent.click(screen.getByLabelText("Include deactivated items"));

    await waitFor(() => {
      expect(listRequestUrls(fetchMock).some((url) => url === "/api/catalog")).toBe(true);
    });
  });

  it("sends the selected kind filter alongside the default active status", async () => {
    const fetchMock = mockCatalogFetch(() => jsonResponse([ITEM]));

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    await screen.findByText("Consulta clínica");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "PRODUCT" } });

    await waitFor(() => {
      expect(listRequestUrls(fetchMock).some((url) => url.includes("kind=PRODUCT"))).toBe(true);
    });
    expect(
      listRequestUrls(fetchMock).some(
        (url) => url.includes("kind=PRODUCT") && url.includes("isActive=true")
      )
    ).toBe(true);
  });

  it("deactivates an item only through the explicit command after confirmation", async () => {
    const fetchMock = mockCatalogFetch(() => jsonResponse([ITEM]));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    await screen.findByText("Consulta clínica");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      const deactivateCall = fetchMock.mock.calls.find((call) =>
        resolveUrl(call[0] as RequestInfo | URL).includes("/deactivate")
      );
      expect(deactivateCall).toBeDefined();
      expect(resolveUrl(deactivateCall?.[0] as RequestInfo | URL)).toBe(
        `/api/catalog/${ITEM.id}/deactivate`
      );
      expect((deactivateCall?.[1] as RequestInit).method).toBe("POST");
    });
  });

  it("does not offer deactivation for an already inactive item", async () => {
    mockCatalogFetch(() => jsonResponse([{ ...ITEM, isActive: false }]));

    render(
      <TestWrapper>
        <CatalogList />
      </TestWrapper>
    );

    await screen.findByText("Consulta clínica");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeDisabled();
  });
});
