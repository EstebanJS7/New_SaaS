import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { formatEsPyDateOnly } from "@/lib/es-py-format";
import { PurchaseDetail } from "./purchase-detail";

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const PURCHASE_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "22222222-2222-4222-8222-222222222222" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

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
  branchId: "77777777-7777-4777-8777-777777777777",
  status: "DRAFT",
  lines: [
    { id: "line-1", catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" },
    {
      id: "line-2",
      catalogItemId: "44444444-4444-4444-8444-444444444444",
      quantity: "1.000",
      unitCost: null,
    },
  ],
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
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

type Responder = () => Response | Promise<Response>;

interface DetailFetchOptions {
  readonly read: Responder;
  readonly receive?: Responder;
  readonly cancel?: Responder;
  readonly suppliers?: Responder;
  readonly catalog?: Responder;
}

function installFetch(options: DetailFetchOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = resolveUrl(input);
    const respond = (fn: Responder): Promise<Response> => Promise.resolve().then(fn);
    if (url.startsWith("/api/suppliers")) {
      return respond(options.suppliers ?? (() => jsonResponse([SUPPLIER])));
    }
    if (url.startsWith("/api/catalog")) {
      return respond(options.catalog ?? (() => jsonResponse([CATALOG_ITEM])));
    }
    if (url.endsWith("/receive")) {
      return respond(
        options.receive ?? (() => jsonResponse({ ...DRAFT_PURCHASE, status: "RECEIVED" }, 201))
      );
    }
    if (url.endsWith("/cancel")) {
      return respond(
        options.cancel ?? (() => jsonResponse({ ...DRAFT_PURCHASE, status: "CANCELLED" }, 201))
      );
    }
    return respond(options.read);
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function callsTo(
  fetchMock: ReturnType<typeof vi.fn>,
  suffix: string
): [RequestInfo | URL, RequestInit?][] {
  return fetchMock.mock.calls.filter((call) =>
    resolveUrl(call[0] as RequestInfo | URL).endsWith(suffix)
  ) as [RequestInfo | URL, RequestInit?][];
}

function renderDetail(): void {
  render(
    <TestWrapper>
      <PurchaseDetail />
    </TestWrapper>
  );
}

async function openReceiveConfirmation(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Recibir compra" }));
  return screen.findByRole("dialog", { name: "Recibir compra" });
}

/** Confirms the receive and returns the page-level outcome, not the dialog's own error copy. */
async function clickReceive(): Promise<HTMLElement> {
  const dialog = await openReceiveConfirmation();
  fireEvent.click(within(dialog).getByRole("button", { name: "Recibir compra" }));
  return waitFor(() => {
    const alert = screen
      .getAllByRole("alert")
      .find((element) => element.closest("dialog") === null);
    if (alert === undefined) throw new Error("No page-level alert rendered yet");
    return alert;
  });
}

describe("PurchaseDetail", () => {
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

  it("renders an explicit loading state while the purchase is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderDetail();

    expect(screen.getByText("Cargando compra…")).toBeInTheDocument();
  });

  it("renders a permission-denied state when the read is refused with 403", async () => {
    installFetch({
      read: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
    });

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sin permiso");
    expect(alert).toHaveTextContent("No tenés permiso para gestionar compras.");
  });

  it("renders a not-found state when the read is refused with 404", async () => {
    installFetch({
      read: () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "Purchase was not found." } }, 404),
    });

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No encontrada");
    expect(alert).toHaveTextContent("No encontramos la compra.");
  });

  it("renders the purchase, its lines and resolved display names", async () => {
    installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Compra #22222222" })).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Central")).toBeInTheDocument();
    expect(screen.getByText("Gauze roll")).toBeInTheDocument();
    // Quantities and costs use es-PY grouping and drop zero-only decimals.
    expect(screen.getByText("Cant. 2")).toBeInTheDocument();
    expect(screen.getByText("Costo unitario 1.500")).toBeInTheDocument();
    expect(screen.getByText("Cant. 1")).toBeInTheDocument();
    expect(screen.getByText("Sin costo unitario")).toBeInTheDocument();
    expect(screen.queryByText(/1500\.00|2\.000/)).not.toBeInTheDocument();
    // Created and updated dates use the es-PY calendar format, not the ISO prefix.
    expect(screen.getAllByText(formatEsPyDateOnly("2026-09-26"))).toHaveLength(2);
    expect(screen.getAllByText("26 sept. 2026")).toHaveLength(2);
    expect(screen.queryByText("2026-09-26")).not.toBeInTheDocument();
  });

  it("degrades to short id fragments when a referenced record is not readable", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      suppliers: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
      catalog: () => jsonResponse({ error: { code: "NOT_FOUND", message: "Missing." } }, 404),
    });

    renderDetail();

    expect(await screen.findByText("#11111111")).toBeInTheDocument();
    expect(screen.getByText("#33333333")).toBeInTheDocument();
    expect(screen.getByText("#44444444")).toBeInTheDocument();
  });

  it("does not receive when the confirmation is declined", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    const dialog = await openReceiveConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Volver" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Recibir compra" })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, "/receive")).toHaveLength(0);
  });

  it("receives after confirmation, showing success and the RECEIVED status", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    const dialog = await openReceiveConfirmation();
    // The confirmation states the stock effect before the command runs.
    expect(dialog).toHaveAccessibleDescription(/Se registrará el ingreso de stock/);
    expect(dialog).toHaveAccessibleDescription(/La compra recibida no se puede modificar/);
    expect(callsTo(fetchMock, "/receive")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Recibir compra" }));

    expect(await screen.findByText("Recepción registrada")).toBeInTheDocument();
    expect(screen.getByText(/Se registró el stock de todas las líneas/)).toBeInTheDocument();
    expect(await screen.findByText("Compra recibida")).toBeInTheDocument();

    const receiveCalls = callsTo(fetchMock, "/receive");
    expect(receiveCalls).toHaveLength(1);
    expect(receiveCalls[0]?.[1]?.method).toBe("POST");
    // The receive button is gone once the purchase is no longer a draft.
    expect(screen.queryByRole("button", { name: "Recibir compra" })).not.toBeInTheDocument();
  });

  it("renders a non-draft 409 as a terminal conflict, not a transient failure", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "Only a draft purchase can be changed." } },
          409
        ),
    });

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("Esta compra ya no es un borrador");
    expect(alert).toHaveTextContent("Solo se puede modificar una compra en borrador.");
    expect(alert).toHaveTextContent(/repetir la recepción no la va a cambiar/);
    // No blind retry control is offered for a conflict.
    expect(
      screen.queryByRole("button", { name: /reintentar|volver a intentar/i })
    ).not.toBeInTheDocument();
  });

  it("renders an inactive-item 409 as its own distinct outcome", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "The catalog item is inactive." } },
          409
        ),
    });

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("El artículo de una línea está inactivo");
    expect(alert).toHaveTextContent("Una línea usa un artículo del catálogo que está inactivo.");
  });

  it("renders an untracked-item 409 as its own distinct outcome", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "The catalog item does not track stock." } },
          409
        ),
    });

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("El artículo de una línea no controla stock");
    expect(alert).toHaveTextContent(
      "Una línea usa un artículo del catálogo que no controla stock."
    );
  });

  it("renders a permission denial when the receive is refused with 403", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
    });

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("Sin permiso");
    expect(alert).toHaveTextContent("No tenés permiso para gestionar compras.");
  });

  it("renders a not-found state when the receive is refused with 404", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "Purchase was not found." } }, 404),
    });

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("No encontramos la compra");
    expect(alert).toHaveTextContent("No encontramos la compra.");
  });

  it("renders a transport error when the receive never reaches the API", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("No se pudo conectar con el servidor");
    expect(alert).toHaveTextContent(
      "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar."
    );
  });

  it("never retries a failed receive silently", async () => {
    const fetchMock = installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "The catalog item is inactive." } },
          409
        ),
    });

    renderDetail();
    await clickReceive();

    await waitFor(() => {
      expect(callsTo(fetchMock, "/receive")).toHaveLength(1);
    });
  });

  it("cancels a draft only through the explicit command after confirmation", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar compra" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancelar borrador de compra" });
    // Opening the confirmation alone never sends the command.
    expect(callsTo(fetchMock, "/cancel")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar compra" }));

    expect(await screen.findByText("Compra cancelada")).toBeInTheDocument();
    const cancelCalls = callsTo(fetchMock, "/cancel");
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.[1]?.method).toBe("POST");
  });

  it("renders no delete affordance, no status control and never sends DELETE or PATCH", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    await screen.findByRole("heading", { name: "Compra #22222222" });
    expect(
      screen.queryByRole("button", { name: /eliminar|borrar|quitar/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /eliminar|borrar|quitar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method ?? "GET").not.toBe("DELETE");
      expect(init?.method ?? "GET").not.toBe("PATCH");
    }
  });

  it("offers no transition controls for a non-draft purchase", async () => {
    installFetch({ read: () => jsonResponse({ ...DRAFT_PURCHASE, status: "RECEIVED" }) });

    renderDetail();

    await screen.findByText("Compra recibida");
    expect(screen.queryByRole("button", { name: "Recibir compra" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar compra" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
  });
});

describe("PurchaseDetail actions follow the caller's capabilities (UX-037)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderDetailAs(capabilities: Capabilities): void {
    render(
      <CapabilitiesProvider value={capabilities}>
        <TestWrapper>
          <PurchaseDetail />
        </TestWrapper>
      </CapabilitiesProvider>
    );
  }

  it("hides Edit, Cancel and Receive from a read-only caller", async () => {
    installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });
    renderDetailAs({ permissions: ["purchases.read"], features: [] });
    await screen.findByRole("heading", { name: /Compra #/ });
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar compra" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recibir compra" })).not.toBeInTheDocument();
  });

  it("offers only the transition the caller holds", async () => {
    installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });
    renderDetailAs({ permissions: ["purchases.read", "purchases.receive"], features: [] });
    expect(await screen.findByRole("button", { name: "Recibir compra" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar compra" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("offers every draft action when granted", async () => {
    installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });
    renderDetailAs({
      permissions: ["purchases.read", "purchases.update", "purchases.cancel", "purchases.receive"],
      features: [],
    });
    expect(await screen.findByRole("button", { name: "Recibir compra" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar compra" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
  });

  it("offers every draft action while capabilities are unknown", async () => {
    installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });
    renderDetail();
    expect(await screen.findByRole("button", { name: "Recibir compra" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar compra" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
  });
});
