import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SupplierList } from "./suppliers-list";

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

const SUPPLIER = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: "Distribuidora Central S.A.",
  taxId: "80012345-6",
  email: "compras@distribuidora.example",
  phone: "+595981123456",
  address: "Av. Mcal. López 1234, Asunción",
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

interface ListMockOptions {
  readonly listHandler: (url: string) => Response;
  readonly deactivateHandler?: () => Response;
}

function mockSuppliersFetch(options: ListMockOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = resolveUrl(input);
    if (url.includes("/deactivate")) {
      return Promise.resolve(
        options.deactivateHandler?.() ?? jsonResponse({ ...SUPPLIER, isActive: false })
      );
    }
    return Promise.resolve(options.listHandler(url));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function listRequestUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => resolveUrl(call[0] as RequestInfo | URL))
    .filter((url) => url.startsWith("/api/suppliers") && !url.includes("/deactivate"));
}

function renderList(): void {
  render(
    <TestWrapper>
      <SupplierList />
    </TestWrapper>
  );
}

describe("SupplierList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    mockSuppliersFetch({
      listHandler: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    renderList();

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(screen.getByText("You do not have permission to manage suppliers.")).toBeInTheDocument();
    // A refusal is never rendered as an empty list.
    expect(screen.queryByText("No active suppliers")).not.toBeInTheDocument();
  });

  it("renders an unauthenticated UX message when the API returns 401", async () => {
    mockSuppliersFetch({
      listHandler: () =>
        jsonResponse(
          { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
          401
        ),
    });

    renderList();

    expect(await screen.findByText("You must be signed in to view suppliers.")).toBeInTheDocument();
    expect(screen.queryByText("Permission denied")).not.toBeInTheDocument();
  });

  it("renders an explicit loading state while the list is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderList();

    expect(screen.getByText("Loading suppliers...")).toBeInTheDocument();
  });

  it("renders the active-only empty state when the tenant has no active suppliers", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([]) });

    renderList();

    expect(await screen.findByText("No active suppliers")).toBeInTheDocument();
  });

  it("renders the first-run empty state when deactivated suppliers are included", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([]) });

    renderList();

    await screen.findByText("No active suppliers");
    fireEvent.click(screen.getByLabelText("Include deactivated suppliers"));

    expect(await screen.findByText("No suppliers yet")).toBeInTheDocument();
  });

  it("links the supplier name to the read-only detail route and Edit to the edit route", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });

    renderList();

    expect(await screen.findByRole("link", { name: "Distribuidora Central" })).toHaveAttribute(
      "href",
      `/app/suppliers/${SUPPLIER.id}`
    );
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/app/suppliers/${SUPPLIER.id}/edit`
    );
  });

  it("defaults the status filter to active and includes deactivated suppliers on request", async () => {
    const fetchMock = mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(listRequestUrls(fetchMock).some((url) => url.includes("isActive=true"))).toBe(true);

    fireEvent.click(screen.getByLabelText("Include deactivated suppliers"));

    await waitFor(() => {
      expect(listRequestUrls(fetchMock).some((url) => url === "/api/suppliers")).toBe(true);
    });
  });

  it("deactivates a supplier only through the explicit command after confirmation", async () => {
    const fetchMock = mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderList();

    await screen.findByText("Distribuidora Central");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      const deactivateCall = fetchMock.mock.calls.find((call) =>
        resolveUrl(call[0] as RequestInfo | URL).includes("/deactivate")
      );
      expect(deactivateCall).toBeDefined();
      expect(resolveUrl(deactivateCall?.[0] as RequestInfo | URL)).toBe(
        `/api/suppliers/${SUPPLIER.id}/deactivate`
      );
      expect((deactivateCall?.[1] as RequestInit).method).toBe("POST");
    });
  });

  it("shows the inactive status after a successful deactivation invalidates the list", async () => {
    let deactivated = false;
    mockSuppliersFetch({
      listHandler: () => jsonResponse([{ ...SUPPLIER, isActive: !deactivated }]),
      deactivateHandler: () => {
        deactivated = true;
        return jsonResponse({ ...SUPPLIER, isActive: false });
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(await screen.findByText("Inactive")).toBeInTheDocument();
  });

  it("does not offer deactivation for an already inactive supplier", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([{ ...SUPPLIER, isActive: false }]) });

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeDisabled();
  });

  it("renders a permission-denied state when a deactivation is refused with 403", async () => {
    mockSuppliersFetch({
      listHandler: () => jsonResponse([SUPPLIER]),
      deactivateHandler: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderList();

    await screen.findByText("Distribuidora Central");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage suppliers.");
  });

  it("offers no delete affordance and never sends a DELETE or PATCH request", async () => {
    const fetchMock = mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /delete|remove/i })).not.toBeInTheDocument();

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method ?? "GET").not.toBe("DELETE");
      expect(init?.method ?? "GET").not.toBe("PATCH");
    }
  });
});
