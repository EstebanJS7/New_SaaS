import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** Opens the native confirmation and confirms the explicit deactivation command. */
async function confirmDeactivation(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Desactivar proveedor" })).getByRole(
      "button",
      { name: "Desactivar proveedor" }
    )
  );
}

function deactivateCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter((call) =>
    resolveUrl(call[0] as RequestInfo | URL).includes("/deactivate")
  );
}

describe("SupplierList", () => {
  beforeEach(() => {
    // jsdom does not implement the native modal API the confirmation dialog uses.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    mockSuppliersFetch({
      listHandler: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    renderList();

    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
    expect(screen.getByText("No tenés permiso para gestionar proveedores.")).toBeInTheDocument();
    // A refusal is never rendered as an empty list.
    expect(screen.queryByText("No hay proveedores activos")).not.toBeInTheDocument();
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

    expect(await screen.findByText("Iniciá sesión para ver los proveedores.")).toBeInTheDocument();
    expect(screen.queryByText("Sin permiso")).not.toBeInTheDocument();
  });

  it("renders an explicit loading state while the list is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderList();

    expect(screen.getByText("Cargando proveedores…")).toBeInTheDocument();
  });

  it("renders the active-only empty state when the tenant has no active suppliers", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([]) });

    renderList();

    expect(await screen.findByText("No hay proveedores activos")).toBeInTheDocument();
  });

  it("renders the first-run empty state when deactivated suppliers are included", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([]) });

    renderList();

    await screen.findByText("No hay proveedores activos");
    fireEvent.click(screen.getByLabelText("Incluir proveedores desactivados"));

    expect(await screen.findByText("Todavía no hay proveedores")).toBeInTheDocument();
  });

  it("links the supplier name to the read-only detail route and Edit to the edit route", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });

    renderList();

    expect(await screen.findByRole("link", { name: "Distribuidora Central" })).toHaveAttribute(
      "href",
      `/app/suppliers/${SUPPLIER.id}`
    );
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/app/suppliers/${SUPPLIER.id}/edit`
    );
    expect(screen.getByText("RUC 80012345-6")).toBeInTheDocument();
  });

  it("defaults the status filter to active and includes deactivated suppliers on request", async () => {
    const fetchMock = mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(listRequestUrls(fetchMock).some((url) => url.includes("isActive=true"))).toBe(true);

    fireEvent.click(screen.getByLabelText("Incluir proveedores desactivados"));

    await waitFor(() => {
      expect(listRequestUrls(fetchMock).some((url) => url === "/api/suppliers")).toBe(true);
    });
  });

  it("deactivates a supplier only through the explicit command after confirmation", async () => {
    const fetchMock = mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });

    renderList();

    await screen.findByText("Distribuidora Central");
    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
    await screen.findByRole("dialog", { name: "Desactivar proveedor" });
    // Opening the confirmation alone never sends the command.
    expect(deactivateCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Desactivar proveedor" })).getByRole("button", {
        name: "Desactivar proveedor",
      })
    );

    await waitFor(() => {
      const deactivateCall = deactivateCalls(fetchMock)[0];
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

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(screen.queryByText("Inactivo")).not.toBeInTheDocument();

    await confirmDeactivation();

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
  });

  it("does not offer deactivation for an already inactive supplier", async () => {
    mockSuppliersFetch({ listHandler: () => jsonResponse([{ ...SUPPLIER, isActive: false }]) });

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeDisabled();
  });

  it("renders a permission-denied state when a deactivation is refused with 403", async () => {
    mockSuppliersFetch({
      listHandler: () => jsonResponse([SUPPLIER]),
      deactivateHandler: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    renderList();

    await screen.findByText("Distribuidora Central");
    await confirmDeactivation();

    // The card keeps the distinct permission-denied outcome beside the dialog's own error copy.
    const alert = (await screen.findByText("Sin permiso")).closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent("Sin permiso");
    expect(alert).toHaveTextContent("No tenés permiso para gestionar proveedores.");
  });

  it("offers no delete affordance and never sends a DELETE or PATCH request", async () => {
    const fetchMock = mockSuppliersFetch({ listHandler: () => jsonResponse([SUPPLIER]) });

    renderList();

    await screen.findByText("Distribuidora Central");
    expect(
      screen.queryByRole("button", { name: /eliminar|borrar|quitar/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /eliminar|borrar|quitar/i })).not.toBeInTheDocument();

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method ?? "GET").not.toBe("DELETE");
      expect(init?.method ?? "GET").not.toBe("PATCH");
    }
  });
});
