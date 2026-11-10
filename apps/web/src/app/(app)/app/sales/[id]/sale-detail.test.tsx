import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
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

    expect(screen.getByTestId("sale-loading")).toHaveTextContent("Cargando venta…");
  });

  it("renders the shared not-found state for a 404", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "Sale was not found." } }, 404)
    );

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No encontrada");
    expect(alert).toHaveTextContent("No encontramos la venta.");
  });

  it("renders the permission-denied UX branch for a 403", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403)
    );

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sin permiso");
    expect(alert).toHaveTextContent("No tenés permiso para gestionar ventas.");
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
    expect(alert).toHaveTextContent("Ventas no habilitadas");
  });

  it("reopens a draft with its lines, no payments and the honest status", async () => {
    installFetch(() => jsonResponse(DRAFT_SALE));

    renderDetail();

    expect(await screen.findByText("Venta #22222222")).toBeInTheDocument();
    expect(screen.getByText("Venta borrador. El estado proviene del sistema.")).toBeInTheDocument();
    expect(await screen.findByText("Antibiotic")).toBeInTheDocument();
    expect(screen.getByText("Venta directa (sin cliente)")).toBeInTheDocument();
    expect(screen.getByTestId("no-payments")).toHaveTextContent(
      "Este borrador todavía no tiene pagos confirmados."
    );
    expect(screen.getByRole("button", { name: "Revisar venta" })).toBeInTheDocument();
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
    await screen.findByRole("button", { name: "Revisar venta" });
    await confirmSale();

    expect(await screen.findByText("Venta completada")).toBeInTheDocument();
    expect(screen.getByText("Efectivo")).toBeInTheDocument();
    expect(screen.getByTestId("payment-amount")).toHaveTextContent("Gs. 1.500");
    expect(screen.queryByTestId("no-payments")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar venta" })).not.toBeInTheDocument();
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
    await screen.findByRole("button", { name: "Revisar venta" });
    await confirmSale();

    expect(await screen.findByText("Los pagos no coinciden con el total")).toBeInTheDocument();
    expect(screen.queryByText("Venta completada")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar venta" })).toBeInTheDocument();
  });

  it("offers no edit, delete, refund or reversal affordance", async () => {
    installFetch(() => jsonResponse(DRAFT_SALE));

    renderDetail();
    await screen.findByText("Antibiotic");

    expect(
      screen.queryByRole("button", {
        name: /delete|refund|reverse|cancel sale|eliminar|reembolsar|revertir|cancelar venta/i,
      })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit|editar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/discount|invoice|fiscal|change/i)).not.toBeInTheDocument();
  });
});

describe("SaleDetail actions follow the caller's capabilities (UX-037)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderDetailAs(capabilities: Capabilities): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <CapabilitiesProvider value={capabilities}>
        <QueryClientProvider client={client}>
          <SaleDetail />
        </QueryClientProvider>
      </CapabilitiesProvider>
    );
  }

  const READER: Capabilities = { permissions: ["sales.read"], features: ["sales"] };

  it("hides the draft completion without sales.complete", async () => {
    installFetch(() => jsonResponse(DRAFT_SALE));
    renderDetailAs(READER);
    expect(await screen.findByText("Antibiotic")).toBeInTheDocument();
    expect(screen.queryByText("Completar este borrador")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar venta" })).not.toBeInTheDocument();
  });

  it("offers the draft completion with sales.complete and the sales feature", async () => {
    installFetch(() => jsonResponse(DRAFT_SALE));
    renderDetailAs({ permissions: ["sales.read", "sales.complete"], features: ["sales"] });
    expect(await screen.findByRole("button", { name: "Revisar venta" })).toBeInTheDocument();
  });

  it("hides the reversal of a completed sale without sales.reverse", async () => {
    installFetch(() => jsonResponse(COMPLETED_SALE));
    renderDetailAs(READER);
    expect(await screen.findByText("Antibiotic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
  });

  it("offers the reversal with sales.reverse", async () => {
    installFetch(() => jsonResponse(COMPLETED_SALE));
    renderDetailAs({ permissions: ["sales.read", "sales.reverse"], features: ["sales"] });
    expect(await screen.findByRole("button", { name: "Anular venta" })).toBeInTheDocument();
  });

  it("offers the reversal while capabilities are unknown", async () => {
    installFetch(() => jsonResponse(COMPLETED_SALE));
    renderDetail();
    expect(await screen.findByRole("button", { name: "Anular venta" })).toBeInTheDocument();
  });
});

async function confirmSale(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Revisar venta" }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Revisar y confirmar venta" })).getByRole(
      "button",
      { name: "Confirmar venta" }
    )
  );
}
beforeEach(() => {
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
