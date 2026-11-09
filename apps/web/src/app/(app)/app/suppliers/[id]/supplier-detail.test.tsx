import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SupplierDetail } from "./supplier-detail";

/**
 * `useParams` is mocked with a canonical UUID because the proxy refuses a
 * malformed id; the fixture id and the route param stay the same value.
 */
const { SUPPLIER_ID } = vi.hoisted(() => ({
  SUPPLIER_ID: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: SUPPLIER_ID }),
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

const SUPPLIER = {
  id: SUPPLIER_ID,
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

function mockFetch(response: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(response()));
  global.fetch = fetchMock;
  return fetchMock;
}

describe("SupplierDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the supplier read-only, linking Edit to the separate edit route", async () => {
    const fetchMock = mockFetch(() => jsonResponse(SUPPLIER));

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Distribuidora Central" })
    ).toBeInTheDocument();
    expect(resolveUrl(fetchMock.mock.calls[0]?.[0] as RequestInfo | URL)).toBe(
      `/api/suppliers/${SUPPLIER_ID}`
    );

    expect(screen.getByText("Razón social")).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Central S.A.")).toBeInTheDocument();
    expect(screen.getByText("RUC")).toBeInTheDocument();
    expect(screen.getByText("80012345-6")).toBeInTheDocument();
    expect(screen.getByText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByText("compras@distribuidora.example")).toBeInTheDocument();
    expect(screen.getByText("Teléfono")).toBeInTheDocument();
    expect(screen.getByText("+595981123456")).toBeInTheDocument();
    expect(screen.getByText("Dirección")).toBeInTheDocument();
    expect(screen.getByText("Av. Mcal. López 1234, Asunción")).toBeInTheDocument();
    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/app/suppliers/${SUPPLIER_ID}/edit`
    );
    // The read-only surface mutates nothing: no deactivate and no delete command.
    expect(screen.queryByRole("button", { name: /Desactivar/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /eliminar|borrar|quitar/i })
    ).not.toBeInTheDocument();
  });

  it("shows an inactive supplier with absent fields without inventing a value", async () => {
    mockFetch(() =>
      jsonResponse({
        ...SUPPLIER,
        isActive: false,
        legalName: null,
        taxId: null,
        email: null,
        phone: null,
        address: null,
      })
    );

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    expect(screen.getAllByText("Sin definir")).toHaveLength(5);
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    mockFetch(() => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403));

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
    expect(screen.getByText("No tenés permiso para gestionar proveedores.")).toBeInTheDocument();
  });

  it("renders the mapped not-found copy when the supplier is missing", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Supplier was not found." } }, 404)
    );

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("No encontramos el proveedor.")).toBeInTheDocument();
  });

  it("renders the unauthenticated UX message when the API returns 401", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401)
    );

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Iniciá sesión para ver los proveedores.")).toBeInTheDocument();
  });

  it("renders an explicit loading state while the supplier is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    expect(screen.getByText("Cargando proveedor…")).toBeInTheDocument();
  });

  it("never writes the CONFIDENTIAL payload to the console", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ];
    mockFetch(() => jsonResponse(SUPPLIER));

    render(
      <TestWrapper>
        <SupplierDetail />
      </TestWrapper>
    );

    await screen.findByText("80012345-6");
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
