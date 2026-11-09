import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { formatStaffMoney } from "@/lib/es-py-format";
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

    expect(screen.getByText("Servicio · IVA 10%")).toBeInTheDocument();
    expect(screen.getByText("Tipo")).toBeInTheDocument();
    expect(screen.getByText("Impuesto")).toBeInTheDocument();
    expect(screen.getByText("IVA 10%")).toBeInTheDocument();
    expect(screen.getByText("Precio de referencia")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === formatStaffMoney("150000.00", "PYG") &&
          element.tagName === "SPAN"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Estado")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Editar artículo" })).toHaveAttribute(
      "href",
      `/app/catalog/${ITEM_ID}/edit`
    );
    // The read-only surface mutates nothing: no deactivate command is offered.
    expect(screen.queryByRole("button", { name: /Desactivar/ })).not.toBeInTheDocument();
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

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByText("Sin precio informado")).toBeInTheDocument();
  });

  it("renders a permission-denied state when the API returns 403 FORBIDDEN", async () => {
    mockFetch(() => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(
      screen.getByText("No tenés permiso para gestionar artículos del catálogo.")
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
      await screen.findByText("El catálogo no está habilitado para esta organización.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Acceso denegado")).not.toBeInTheDocument();
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

    expect(await screen.findByText("No encontramos el artículo del catálogo.")).toBeInTheDocument();
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

    expect(await screen.findByText("Iniciá sesión para ver el catálogo.")).toBeInTheDocument();
  });

  it("renders an explicit loading state while the item is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(screen.getByText("Cargando artículo…")).toBeInTheDocument();
  });
});

describe("Catalog exact detail", () => {
  afterEach(() => vi.restoreAllMocks());
  it("keeps maximum USD precision and a fractional threshold visible without arithmetic", async () => {
    mockFetch(() =>
      jsonResponse({
        ...ITEM,
        referencePriceAmount: "999999999999.99",
        referencePriceCurrency: "USD",
        lowStockThreshold: "9999999.999",
      })
    );
    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );
    expect(await screen.findByText("999.999.999.999,99 USD")).toBeInTheDocument();
    expect(screen.getByText("9.999.999,999")).toBeInTheDocument();
  });
  it("does not expose an arbitrary private error or offer edit after a failed read", async () => {
    mockFetch(() => jsonResponse({ error: { message: "PRIVATE" } }, 500));
    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar artículo" })).not.toBeInTheDocument();
  });

  it("shows the declared SIFEN unit by its es-PY label (FISC-020 T9)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        resolveUrl(input).endsWith("/api/catalog/units-of-measure")
          ? jsonResponse([{ code: "77", description: "Unidad - UNI", symbol: "UNI" }])
          : jsonResponse({ ...ITEM, unitOfMeasureCode: "77" })
      )
    );

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Unidad - UNI")).toBeInTheDocument();
    expect(screen.getByText("Unidad de medida")).toBeInTheDocument();
  });

  it("says no unit is declared without inventing one or reading the unit list", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ...ITEM, unitOfMeasureCode: null }));

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Sin unidad declarada")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bare code when the unit list is unavailable", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        resolveUrl(input).endsWith("/api/catalog/units-of-measure")
          ? jsonResponse({ error: { code: "INTERNAL" } }, 500)
          : jsonResponse({ ...ITEM, unitOfMeasureCode: "77" })
      )
    );

    render(
      <TestWrapper>
        <CatalogItemDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Código SIFEN 77")).toBeInTheDocument();
  });
});
