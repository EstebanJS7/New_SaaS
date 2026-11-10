vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
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
  /** MB-002: the caller's working branches (default: none offered). */
  readonly branches?: readonly { id: string; name: string }[];
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
    if (url === "/api/memberships/me/branches") {
      return Promise.resolve(jsonResponse({ branches: options.branches ?? [] }));
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

afterEach(() => {
  window.sessionStorage.clear();
});

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

  it("MB-002: asks for the branch when the person works at several, and sends it", async () => {
    const fetchMock = installFetch({
      branches: [
        { id: "b-1", name: "Casa central" },
        { id: "b-2", name: "Norte" },
      ],
      sales: () => jsonResponse(DRAFT_SALE, 201),
    });
    renderCounter();
    await addFirstItem();
    const select = await screen.findByLabelText("Sucursal de la venta");
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    expect(await screen.findByText("Elegí la sucursal de la venta.")).toBeInTheDocument();
    expect(salesCalls(fetchMock)).toHaveLength(0);

    fireEvent.change(select, { target: { value: "b-2" } });
    await checkout();
    const create = salesCalls(fetchMock).find((call) => call[1]?.method === "POST");
    expect(JSON.parse(create?.[1]?.body as string)).toMatchObject({ branchId: "b-2" });
  });

  it("MB-002: sends no branch when the person works at one", async () => {
    const fetchMock = installFetch({
      branches: [{ id: "b-1", name: "Casa central" }],
      sales: () => jsonResponse(DRAFT_SALE, 201),
    });
    renderCounter();
    await addFirstItem();
    await checkout();
    expect(screen.queryByLabelText("Sucursal de la venta")).toBeNull();
    const create = salesCalls(fetchMock).find((call) => call[1]?.method === "POST");
    expect(JSON.parse(create?.[1]?.body as string)).not.toHaveProperty("branchId");
  });

  it("UX-035: sends the create with a key and recovers a lost answer by asking with it", async () => {
    let lost = true;
    const fetchMock = installFetch({
      sales: (url, init) => {
        if (init?.method === "POST" && url === "/api/sales") {
          if (lost) throw new Error("lost response");
          return jsonResponse(DRAFT_SALE, 200);
        }
        if (url.startsWith("/api/sales/attempts/")) return jsonResponse(DRAFT_SALE);
        return jsonResponse([]);
      },
    });
    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    await screen.findByTestId("create-error");

    const post = salesCalls(fetchMock).find((call) => call[1]?.method === "POST");
    const key = (post?.[1]?.headers as Record<string, string>)["idempotency-key"];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.sessionStorage.getItem("newsaas.pending-attempts.v1")).toContain(key);

    fireEvent.click(screen.getByRole("button", { name: "Consultar si se creó" }));
    // Found by key: the draft continues to payment, nothing was re-sent.
    await screen.findByRole("button", { name: "Revisar venta" });
    expect(
      salesCalls(fetchMock).some((call) => resolveUrl(call[0]) === `/api/sales/attempts/${key}`)
    ).toBe(true);
    expect(salesCalls(fetchMock).filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(window.sessionStorage.getItem("newsaas.pending-attempts.v1") ?? "").not.toContain(key);
    lost = false;
  });

  it("UX-035: when the attempt recorded nothing, the retry re-sends the SAME key", async () => {
    let posts = 0;
    const fetchMock = installFetch({
      sales: (url, init) => {
        if (init?.method === "POST" && url === "/api/sales") {
          posts += 1;
          if (posts === 1) throw new Error("lost response");
          return jsonResponse(DRAFT_SALE, 201);
        }
        if (url.startsWith("/api/sales/attempts/")) {
          return errorResponse("NOT_FOUND", "No sale was created under that Idempotency-Key.", 404);
        }
        return jsonResponse([]);
      },
    });
    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    await screen.findByTestId("create-error");
    fireEvent.click(screen.getByRole("button", { name: "Consultar si se creó" }));
    expect(await screen.findByTestId("attempt-absent")).toHaveTextContent("misma clave");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "Revisar venta" });

    const keys = salesCalls(fetchMock)
      .filter((call) => call[1]?.method === "POST")
      .map((call) => (call[1]?.headers as Record<string, string>)["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("UX-035: after a reload, offers to look up a previous page's unanswered attempt", async () => {
    const key = "44444444-4444-4444-8444-444444444444";
    window.sessionStorage.setItem(
      "newsaas.pending-attempts.v1",
      JSON.stringify([{ kind: "sale.create", key, startedAt: new Date().toISOString() }])
    );
    installFetch({
      sales: (url) =>
        url === `/api/sales/attempts/${key}` ? jsonResponse(DRAFT_SALE) : jsonResponse([]),
    });
    renderCounter();
    const panel = await screen.findByTestId("pending-sale-attempts");
    fireEvent.click(within(panel).getByRole("button", { name: "Consultar" }));
    expect(
      await within(panel).findByRole("link", { name: "Se creó: abrir la venta" })
    ).toHaveAttribute("href", `/app/sales/${SALE_ID}`);
    expect(window.sessionStorage.getItem("newsaas.pending-attempts.v1")).toBeNull();
  });

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

describe("CounterSurface follows the caller's capabilities (UX-037)", () => {
  function renderCounterAs(capabilities: Capabilities): void {
    render(
      <CapabilitiesProvider value={capabilities}>
        <TestWrapper>
          <CounterSurface />
        </TestWrapper>
      </CapabilitiesProvider>
    );
  }

  it("shows a no-permission state instead of the counter without sales.create and sales.complete", async () => {
    const fetchMock = installFetch({ sales: () => jsonResponse({}) });
    renderCounterAs({ permissions: ["sales.read", "sales.create"], features: ["sales"] });
    expect(await screen.findByTestId("permission-denied")).toHaveTextContent(
      "No tenés permiso para registrar ventas."
    );
    expect(screen.queryByLabelText("Nombre del artículo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar al pago" })).not.toBeInTheDocument();
    expect(salesCalls(fetchMock)).toHaveLength(0);
  });

  it("shows the not-enabled state up front when the clinic lacks the sales feature", async () => {
    installFetch({ sales: () => jsonResponse({}) });
    renderCounterAs({ permissions: ["sales.create", "sales.complete"], features: [] });
    expect(await screen.findByTestId("entitlement-denied")).toHaveTextContent(
      "Ventas no habilitadas"
    );
    expect(screen.queryByRole("button", { name: "Continuar al pago" })).not.toBeInTheDocument();
  });

  it("offers the counter to a caller who can sell", async () => {
    installFetch({ sales: () => jsonResponse({}) });
    renderCounterAs({ permissions: ["sales.create", "sales.complete"], features: ["sales"] });
    expect(await screen.findByRole("button", { name: "Agregar a la venta" })).toBeInTheDocument();
    expect(screen.queryByTestId("permission-denied")).not.toBeInTheDocument();
  });
});
