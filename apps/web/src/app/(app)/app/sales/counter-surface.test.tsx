vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CounterSurface } from "./counter-surface";

const SALE_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

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

const CUSTOMER = {
  id: CUSTOMER_ID,
  tenantId: "tenant-a",
  kind: "INDIVIDUAL",
  displayName: "Ana Pérez",
  legalName: null,
  taxId: null,
  firstName: "Ana",
  lastName: "Pérez",
  documentNumber: null,
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

function TestWrapper({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

type Responder = (init?: RequestInit) => Response;

interface FetchOptions {
  readonly catalog?: Responder;
  readonly customers?: Responder;
  readonly sales: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

function installFetch(options: FetchOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url.startsWith("/api/catalog")) {
      return Promise.resolve((options.catalog ?? (() => jsonResponse([ITEM])))(init));
    }
    if (url.startsWith("/api/customers")) {
      return Promise.resolve((options.customers ?? (() => jsonResponse([CUSTOMER])))(init));
    }
    return Promise.resolve(options.sales(url, init));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function typedCalls(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit?][] {
  return fetchMock.mock.calls as [RequestInfo | URL, RequestInit?][];
}

function renderCounter(): void {
  render(
    <TestWrapper>
      <CounterSurface />
    </TestWrapper>
  );
}

async function addFirstItem(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Agregar a la venta" }));
}

async function checkout(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
  await screen.findByRole("button", { name: "Revisar venta" });
}

function salesCalls(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit?][] {
  return typedCalls(fetchMock).filter((call) => resolveUrl(call[0]).startsWith("/api/sales"));
}

describe("CounterSurface", () => {
  it.each(["transport", "server", "receipt"])(
    "locks an uncertain %s creation without replay or private details",
    async (mode) => {
      const fetchMock = installFetch({
        sales: () => {
          if (mode === "transport") throw new Error("PRIVATE lost response");
          if (mode === "server") return errorResponse("INTERNAL_ERROR", "PRIVATE database", 503);
          return jsonResponse({ ...DRAFT_SALE, id: "invalid" }, 201);
        },
      });
      renderCounter();
      await addFirstItem();
      fireEvent.change(screen.getByLabelText("Precio unitario aplicado"), {
        target: { value: "123456,78" },
      });
      fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: "2,125" } });
      fireEvent.change(screen.getByLabelText("Cliente (opcional)"), {
        target: { value: CUSTOMER_ID },
      });
      const send = screen.getByRole("button", { name: "Continuar al pago" });
      fireEvent.click(send);
      const alert = await screen.findByTestId("create-error");
      expect(alert).toHaveTextContent("carrito bloqueado");
      expect(alert).not.toHaveTextContent("PRIVATE");
      expect(screen.getByLabelText("Precio unitario aplicado")).toHaveValue("123456,78");
      expect(screen.getByLabelText(/Cantidad/)).toHaveValue("2,125");
      expect(screen.getByLabelText("Cliente (opcional)")).toHaveValue(CUSTOMER_ID);
      expect(send).toBeDisabled();
      expect(screen.getByLabelText("Precio unitario aplicado")).toBeDisabled();
      fireEvent.click(send);
      expect(salesCalls(fetchMock).filter((call) => call[1]?.method === "POST")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Iniciar otra venta" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Revisar venta" })).not.toBeInTheDocument();
    }
  );

  it("keeps a rejected cart editable without exposing the backend payload", async () => {
    installFetch({ sales: () => errorResponse("VALIDATION_ERROR", "PRIVATE rejected", 400) });
    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    expect(await screen.findByTestId("create-error")).toHaveTextContent("creación fue rechazada");
    expect(screen.getByTestId("create-error")).not.toHaveTextContent("PRIVATE");
    expect(screen.getByLabelText("Precio unitario aplicado")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continuar al pago" })).toBeEnabled();
  });

  it("warns before unload and keeps the cart when leaving is cancelled", async () => {
    installFetch({ sales: () => jsonResponse([]) });
    renderCounter();
    await addFirstItem();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Listado de ventas" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Salir del punto de venta?" });
    expect(within(dialog).getByRole("button", { name: "Permanecer en el POS" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Permanecer en el POS" }));
    expect(screen.getByLabelText("Precio unitario aplicado")).toHaveValue("1500,00");
  });

  it("blocks synchronous duplicate checkout and leaving while its command is pending", async () => {
    const fetchMock = installFetch({ sales: () => new Promise<Response>(() => undefined) });
    renderCounter();
    await addFirstItem();
    const send = screen.getByRole("button", { name: "Continuar al pago" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(salesCalls(fetchMock)).toHaveLength(1));
    fireEvent.click(screen.getByRole("link", { name: "Listado de ventas" }));
    const dialog = await screen.findByRole("dialog", { name: "Hay una operación pendiente" });
    expect(
      within(dialog).getByRole("button", { name: "Salir y descartar copia local" })
    ).toBeDisabled();
    expect(screen.getByLabelText("Precio unitario aplicado")).toBeDisabled();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps an unauthenticated attempt blocked and sanitizes its response", async () => {
    const fetchMock = installFetch({
      sales: () => errorResponse("UNAUTHENTICATED", "PRIVATE session", 401),
    });
    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    expect(await screen.findByTestId("create-error")).not.toHaveTextContent("PRIVATE");
    expect(screen.getByRole("button", { name: "Continuar al pago" })).toBeDisabled();
    expect(screen.getByLabelText("Cliente (opcional)")).toBeDisabled();
    expect(salesCalls(fetchMock).filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("does not warn before unload for an untouched cart, but protects a customer-only selection", async () => {
    installFetch({ sales: () => jsonResponse([]) });
    renderCounter();
    await screen.findByRole("option", { name: "Ana Pérez" });
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText("Cliente (opcional)"), {
      target: { value: CUSTOMER_ID },
    });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    fireEvent.change(screen.getByLabelText("Cliente (opcional)"), { target: { value: "" } });
    const cleared = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleared);
    expect(cleared.defaultPrevented).toBe(false);
  });

  it("performs create-then-complete and only shows the API's confirmed completion", async () => {
    const fetchMock = installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return jsonResponse(COMPLETED_SALE, 201);
        }
        if (init?.method === "POST") {
          return jsonResponse(DRAFT_SALE, 201);
        }
        return jsonResponse([DRAFT_SALE]);
      },
    });

    renderCounter();
    await addFirstItem();
    expect(screen.getByLabelText("Precio unitario aplicado")).toHaveValue("1500,00");
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: "1,000" } });

    await checkout();
    await confirmSale();

    expect(await screen.findByText("Venta completada")).toBeInTheDocument();

    const calls = salesCalls(fetchMock);
    const createCall = calls.find(
      (call) => resolveUrl(call[0]) === "/api/sales" && call[1]?.method === "POST"
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall![1]?.body as string)).toEqual({
      customerId: null,
      lines: [{ catalogItemId: ITEM_ID, quantity: "1.000", unitPrice: "1500.00" }],
    });

    const completeCall = calls.find((call) => resolveUrl(call[0]).endsWith("/complete"));
    expect(completeCall).toBeDefined();
    expect(resolveUrl(completeCall![0])).toBe(`/api/sales/${SALE_ID}/complete`);
    expect(JSON.parse(completeCall![1]?.body as string)).toEqual({
      payments: [{ method: "CASH", amount: "1500.00" }],
    });
  });

  it("sends no lifecycle, currency or tenant field on create", async () => {
    const fetchMock = installFetch({
      sales: (_url, init) =>
        init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]),
    });

    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    await screen.findByRole("button", { name: "Revisar venta" });

    const createCall = salesCalls(fetchMock).find((call) => call[1]?.method === "POST");
    const body = JSON.parse(createCall![1]?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("currency");
    expect(body).not.toHaveProperty("total");
  });

  it("shows the API's authoritative total from the created draft", async () => {
    installFetch({
      sales: (_url, init) =>
        init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]),
    });

    renderCounter();
    await addFirstItem();
    await checkout();

    expect(screen.getByTestId("sale-total")).toHaveTextContent("Total: Gs. 1.500");
    expect(
      screen.getByText(/Borrador #22222222 creado. El total calculado es Gs\.\s1\.500/)
    ).toBeInTheDocument();
  });

  it("does not present a completion while the API has not answered", async () => {
    installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return new Promise<Response>(() => undefined);
        }
        return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
      },
    });

    renderCounter();
    await addFirstItem();
    await checkout();
    await confirmSale();

    expect(await screen.findByRole("button", { name: "Confirmando venta…" })).toBeDisabled();
    expect(screen.queryByText("Venta completada")).not.toBeInTheDocument();
  });

  it("leaves a real draft behind and links to it when create succeeded but complete failed", async () => {
    installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return errorResponse(
            "VALIDATION_FAILED",
            "The payments must sum exactly to the sale total.",
            400
          );
        }
        return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
      },
    });

    renderCounter();
    await addFirstItem();
    await checkout();
    await confirmSale();

    expect(await screen.findByText("Los pagos no coinciden con el total")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Consultar venta" })).toHaveAttribute(
      "href",
      `/app/sales/${SALE_ID}`
    );
    expect(screen.getByText(/La finalización de la venta/)).toBeInTheDocument();
    expect(screen.queryByText("Venta completada")).not.toBeInTheDocument();
  });

  it("surfaces an identical replay as already completed", async () => {
    installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return jsonResponse({ ...COMPLETED_SALE, replay: true }, 200);
        }
        return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
      },
    });

    renderCounter();
    await addFirstItem();
    await checkout();
    await confirmSale();

    expect(await screen.findByText("La venta ya estaba completada")).toBeInTheDocument();
  });

  it("surfaces a non-draft 409 as a terminal conflict", async () => {
    installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return errorResponse("CONFLICT", "Only a draft sale can be changed.", 409);
        }
        return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
      },
    });

    renderCounter();
    await addFirstItem();
    await checkout();
    await confirmSale();

    expect(await screen.findByText("La venta ya no es un borrador")).toBeInTheDocument();
  });

  it("surfaces a missing cash session distinctly from an ambiguous one", async () => {
    installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return errorResponse("CONFLICT", "A cash payment requires an open cash session.", 409);
        }
        return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
      },
    });

    renderCounter();
    await addFirstItem();
    await checkout();
    await confirmSale();

    expect(await screen.findByText("Se necesita una sesión de caja abierta")).toBeInTheDocument();
  });

  it("surfaces the shared 404", async () => {
    installFetch({
      sales: (url, init) => {
        if (url.endsWith("/complete")) {
          return errorResponse("NOT_FOUND", "Sale was not found.", 404);
        }
        return init?.method === "POST" ? jsonResponse(DRAFT_SALE, 201) : jsonResponse([]);
      },
    });

    renderCounter();
    await addFirstItem();
    await checkout();
    await confirmSale();

    expect(await screen.findByText("No encontramos la venta")).toBeInTheDocument();
  });

  it("maps a create permission refusal to the permission-denied UX branch", async () => {
    installFetch({
      sales: () => errorResponse("FORBIDDEN", "Access denied.", 403),
    });

    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));

    const alert = await screen.findByTestId("create-error");
    expect(alert).toHaveTextContent("Sin permiso");
    expect(alert).toHaveTextContent("No tenés permiso para gestionar ventas.");
    expect(screen.queryByText("Venta completada")).not.toBeInTheDocument();
  });

  it("hides the counter when the tenant lacks the sales capability", async () => {
    installFetch({
      sales: () =>
        errorResponse(
          "FEATURE_NOT_ENTITLED",
          "Sales features are not enabled for this tenant.",
          403
        ),
    });

    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));

    expect(await screen.findByTestId("entitlement-denied")).toHaveTextContent(
      "Ventas no habilitadas"
    );
    // The UX gate hides the surface; the backend remains the authority.
    expect(screen.queryByLabelText("Nombre del artículo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar al pago" })).not.toBeInTheDocument();
  });

  it("adds no scanner affordance and no out-of-scope control", async () => {
    installFetch({
      sales: () => jsonResponse([]),
    });

    renderCounter();
    await screen.findByRole("button", { name: "Agregar a la venta" });

    expect(
      screen.queryByRole("button", { name: /scan|barcode|escanear|código de barras/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(
        /scan|barcode|discount|invoice|fiscal|refund|escanear|descuento|factura|reembolso/i
      )
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /invoice|fiscal|refund|print|factura|reembolso|imprimir/i,
      })
    ).not.toBeInTheDocument();
  });

  it("searches the catalog by name and shows an empty result state", async () => {
    installFetch({
      sales: () => jsonResponse([]),
      catalog: () => jsonResponse([ITEM, { ...ITEM, id: "other", name: "Gauze roll" }]),
    });

    renderCounter();
    await screen.findAllByRole("button", { name: "Agregar a la venta" });
    expect(screen.getAllByRole("button", { name: "Agregar a la venta" })).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Nombre del artículo"), { target: { value: "gauze" } });

    expect(await screen.findByText("Gauze roll")).toBeInTheDocument();
    expect(screen.queryByText("Antibiotic")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre del artículo"), { target: { value: "zzz" } });

    await waitFor(() => {
      expect(screen.getByTestId("catalog-empty")).toHaveTextContent(
        "No encontramos artículos con esa búsqueda."
      );
    });
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
