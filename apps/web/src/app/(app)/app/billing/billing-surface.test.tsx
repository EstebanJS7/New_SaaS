import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import {
  INVOICE_CUSTOMER_REQUIRED_MESSAGE,
  INVOICE_NOT_CANCELLABLE_MESSAGE,
  INVOICE_NOT_DRAFT_MESSAGE,
  INVOICE_SALE_ALREADY_INVOICED_MESSAGE,
  type Invoice,
  type InvoiceLine,
} from "./billing-api";
import { BillingSurface } from "./billing-surface";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const LINE: InvoiceLine = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  catalogItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  position: 0,
  description: "Consultation",
  rateCode: "IVA_10",
  unitPrice: "750.00",
  quantity: "2.000",
  lineTotal: "1500.00",
  taxableBase: "1363.64",
  taxAmount: "136.36",
};

const DRAFT_INVOICE: Invoice = {
  id: "99999999-9999-4999-8999-999999999999",
  saleId: SALE_ID,
  customerId: null,
  currency: "PYG",
  status: "DRAFT",
  series: "A",
  number: null,
  confirmedAt: null,
  cancelledAt: null,
  cancelReason: null,
  lines: [LINE],
  total: "1500.00",
  taxTotal: "136.36",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};

const CONFIRMED_INVOICE: Invoice = {
  ...DRAFT_INVOICE,
  status: "CONFIRMED",
  number: 12,
  confirmedAt: "2026-10-01T09:30:00.000Z",
};

const CANCELLED_INVOICE: Invoice = {
  ...CONFIRMED_INVOICE,
  status: "CANCELLED",
  cancelledAt: "2026-10-01T10:15:00.000Z",
  cancelReason: "Duplicated",
};

/** A second live invoice, so a selection switch has somewhere else to go. */
const SECOND_DRAFT_INVOICE: Invoice = {
  ...DRAFT_INVOICE,
  id: "88888888-8888-4888-8888-888888888888",
  saleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

/** A command response the test settles only when it decides the command does. */
function deferredResponse(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

interface FetchHandlers {
  readonly list?: Responder;
  readonly create?: Responder;
  readonly detail?: Responder;
  readonly confirm?: Responder;
  readonly cancel?: Responder;
}

const BASE = "/api/billing/invoices";

function installFetch(handlers: FetchHandlers): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (!url.startsWith(BASE)) {
      return Promise.resolve(jsonResponse({}, 404));
    }
    const rest = url.slice(BASE.length);
    const method = init?.method ?? "GET";
    if (rest.endsWith("/confirm")) {
      return Promise.resolve(
        (handlers.confirm ?? (() => jsonResponse(CONFIRMED_INVOICE)))(url, init)
      );
    }
    if (rest.endsWith("/cancel")) {
      return Promise.resolve(
        (handlers.cancel ?? (() => jsonResponse(CANCELLED_INVOICE)))(url, init)
      );
    }
    if (method === "POST") {
      return Promise.resolve(
        (handlers.create ?? (() => jsonResponse(DRAFT_INVOICE, 201)))(url, init)
      );
    }
    if (rest.startsWith("/")) {
      return Promise.resolve((handlers.detail ?? (() => jsonResponse(DRAFT_INVOICE)))(url, init));
    }
    return Promise.resolve((handlers.list ?? (() => jsonResponse([])))(url, init));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function typedCalls(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit?][] {
  return fetchMock.mock.calls as [RequestInfo | URL, RequestInit?][];
}

function callsTo(
  fetchMock: ReturnType<typeof vi.fn>,
  prefix: string
): [RequestInfo | URL, RequestInit?][] {
  return typedCalls(fetchMock).filter((call) => resolveUrl(call[0]).startsWith(prefix));
}

function renderSurface(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BillingSurface />
    </QueryClientProvider>
  );
}

async function selectFirstInvoice(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Seleccionar factura" }));
  await screen.findByTestId("invoice-line");
}

describe("BillingSurface reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the invoice list and the selected invoice's snapshot through the billing client", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
      detail: () => jsonResponse(DRAFT_INVOICE),
    });

    renderSurface();
    await selectFirstInvoice();

    expect(screen.getByTestId("invoice-total")).toHaveTextContent("Gs. 1.500");
    const urls = typedCalls(fetchMock).map((call) => resolveUrl(call[0]));
    expect(urls).toContain(BASE);
    expect(urls).toContain(`${BASE}/${DRAFT_INVOICE.id}`);
  });

  it("asks the API for the chosen status filter", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
    });

    renderSurface();
    await screen.findByTestId("invoice-list-item");

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "DRAFT" } });

    await waitFor(() => {
      expect(typedCalls(fetchMock).map((call) => resolveUrl(call[0]))).toContain(
        `${BASE}?status=DRAFT`
      );
    });
  });

  it("renders the permission branch when the list read is forbidden", async () => {
    installFetch({
      list: () => errorResponse("FORBIDDEN", "Access denied.", 403),
    });

    renderSurface();

    expect(await screen.findByTestId("invoices-error")).toHaveTextContent("Sin permiso");
  });

  it("hides the workspace when the tenant lacks the billing capability", async () => {
    installFetch({
      list: () =>
        errorResponse(
          "FEATURE_NOT_ENTITLED",
          "Billing features are not enabled for this tenant.",
          403
        ),
    });

    renderSurface();

    expect(await screen.findByTestId("billing-entitlement-denied")).toHaveTextContent(
      "Facturación no habilitada"
    );
    // The UX gate hides the surface; the backend remains the authority.
    expect(screen.queryByLabelText("Status filter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Identificador de la venta completada")).not.toBeInTheDocument();
  });

  it("renders a backend 404 on the detail read as an error state, never as data", async () => {
    installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
      detail: () => errorResponse("NOT_FOUND", "Invoice was not found.", 404),
    });

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Seleccionar factura" }));

    expect(await screen.findByTestId("invoice-error")).toHaveTextContent(
      "No encontramos la factura"
    );
    expect(screen.queryByTestId("invoice-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-total")).not.toBeInTheDocument();
  });
});

describe("BillingSurface commands follow the caller's capabilities (UX-037)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderSurfaceAs(capabilities: Capabilities): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <CapabilitiesProvider value={capabilities}>
        <QueryClientProvider client={client}>
          <BillingSurface />
        </QueryClientProvider>
      </CapabilitiesProvider>
    );
  }

  const ALL = ["billing.read", "billing.create", "billing.confirm", "billing.cancel"];

  it("keeps invoices readable but offers no command to a read-only caller", async () => {
    installFetch({ list: () => jsonResponse([DRAFT_INVOICE]) });
    renderSurfaceAs({ permissions: ["billing.read"], features: ["billing"] });
    await selectFirstInvoice();
    expect(screen.queryByRole("button", { name: "Confirmar factura" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Identificador de la venta completada")).not.toBeInTheDocument();
  });

  it("shows the not-enabled state up front when the clinic lacks the billing feature", async () => {
    installFetch({ list: () => jsonResponse([DRAFT_INVOICE]) });
    renderSurfaceAs({ permissions: ALL, features: [] });
    expect(await screen.findByTestId("billing-entitlement-denied")).toBeInTheDocument();
  });

  it.each([
    ["granted", { permissions: ALL, features: ["billing"] }],
    ["unknown", {}],
  ])("offers every command when capabilities are %s", async (_label, capabilities) => {
    installFetch({ list: () => jsonResponse([DRAFT_INVOICE]) });
    renderSurfaceAs(capabilities);
    await selectFirstInvoice();
    expect(screen.getByRole("button", { name: "Confirmar factura" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular factura" })).toBeInTheDocument();
    expect(screen.getByLabelText("Identificador de la venta completada")).toBeInTheDocument();
  });
});

describe("BillingSurface commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a draft from a completed sale id and selects it", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([]),
      create: () => jsonResponse(DRAFT_INVOICE, 201),
      detail: () => jsonResponse(DRAFT_INVOICE),
    });

    renderSurface();
    await screen.findByTestId("invoices-empty");

    fireEvent.change(screen.getByLabelText("Identificador de la venta completada"), {
      target: { value: SALE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear factura" }));

    expect(await screen.findByTestId("invoice-created")).toHaveTextContent(
      "Borrador de factura creado"
    );

    const post = callsTo(fetchMock, BASE).find((call) => call[1]?.method === "POST");
    expect(post).toBeDefined();
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ saleId: SALE_ID });
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("currency");
    expect(body).not.toHaveProperty("customerId");
    expect(body).not.toHaveProperty("lines");
    expect(body).not.toHaveProperty("total");
  });

  it("shows the confirm representation the API returned, including a replay", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
      detail: () => jsonResponse(DRAFT_INVOICE),
      // The already-confirmed representation is what the API returns for a retry.
      confirm: () => jsonResponse(CONFIRMED_INVOICE),
    });

    renderSurface();
    await selectFirstInvoice();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar factura" }));

    const confirmed = await screen.findByTestId("invoice-confirmed");
    expect(confirmed).toHaveTextContent("Factura confirmada");
    expect(confirmed).toHaveTextContent("con el número A-12");
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Confirmada");
    // No second allocation and no second confirmation are claimed.
    expect(confirmed).toHaveTextContent("no se asigna un segundo número");
    expect(screen.queryByTestId("invoice-confirm-error")).not.toBeInTheDocument();

    const post = callsTo(fetchMock, BASE).find((call) => resolveUrl(call[0]).endsWith("/confirm"));
    expect(post).toBeDefined();
    expect(post?.[1]?.body).toBeUndefined();
  });

  it("renders a confirm refused for a non-draft invoice by its stable outcome", async () => {
    installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
      detail: () => jsonResponse(DRAFT_INVOICE),
      confirm: () => errorResponse("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE, 409),
    });

    renderSurface();
    await selectFirstInvoice();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar factura" }));

    expect(await screen.findByTestId("invoice-confirm-error")).toHaveTextContent(
      "Solo se puede confirmar una factura en borrador"
    );
    expect(screen.queryByTestId("invoice-confirmed")).not.toBeInTheDocument();
  });

  it("renders the conflict for a sale that already has an invoice", async () => {
    installFetch({
      list: () => jsonResponse([]),
      create: () => errorResponse("CONFLICT", INVOICE_SALE_ALREADY_INVOICED_MESSAGE, 409),
    });

    renderSurface();
    await screen.findByTestId("invoices-empty");

    fireEvent.change(screen.getByLabelText("Identificador de la venta completada"), {
      target: { value: SALE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear factura" }));

    expect(await screen.findByTestId("invoice-create-error")).toHaveTextContent(
      "Esta venta ya tiene una factura"
    );
    expect(screen.queryByTestId("invoice-created")).not.toBeInTheDocument();
  });

  it("renders the conflict for a create blocked by the customer policy", async () => {
    installFetch({
      list: () => jsonResponse([]),
      create: () => errorResponse("CONFLICT", INVOICE_CUSTOMER_REQUIRED_MESSAGE, 409),
    });

    renderSurface();
    await screen.findByTestId("invoices-empty");

    fireEvent.change(screen.getByLabelText("Identificador de la venta completada"), {
      target: { value: SALE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear factura" }));

    expect(await screen.findByTestId("invoice-create-error")).toHaveTextContent(
      "Esta organización exige un cliente para emitir una factura"
    );
  });

  it("requires a reason and shows the cancel representation the API returned, including a replay", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([CONFIRMED_INVOICE]),
      detail: () => jsonResponse(CONFIRMED_INVOICE),
      cancel: () => jsonResponse(CANCELLED_INVOICE),
    });

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Seleccionar factura" }));
    await screen.findByTestId("invoice-line");

    // A blank reason never reaches the API.
    fireEvent.click(screen.getByRole("button", { name: "Anular factura" }));
    expect(screen.getByTestId("invoice-cancel-validation-error")).toHaveTextContent(
      "Ingresá el motivo de la anulación."
    );
    expect(
      callsTo(fetchMock, BASE).filter((call) => resolveUrl(call[0]).endsWith("/cancel"))
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), {
      target: { value: "Duplicated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anular factura" }));

    const cancelled = await screen.findByTestId("invoice-cancelled");
    expect(cancelled).toHaveTextContent("Factura anulada");
    expect(cancelled).toHaveTextContent("La anulación es definitiva");
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Anulada");

    const post = callsTo(fetchMock, BASE).find((call) => resolveUrl(call[0]).endsWith("/cancel"));
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ reason: "Duplicated" });
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("cancelledAt");
    expect(body).not.toHaveProperty("tenantId");
  });

  it("renders a cancel refused on a terminal invoice by its stable outcome", async () => {
    installFetch({
      list: () => jsonResponse([CONFIRMED_INVOICE]),
      detail: () => jsonResponse(CONFIRMED_INVOICE),
      cancel: () =>
        errorResponse("CONFLICT", "Only a draft or confirmed invoice can be cancelled.", 409),
    });

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Seleccionar factura" }));
    await screen.findByTestId("invoice-line");

    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), {
      target: { value: "Duplicated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anular factura" }));

    expect(await screen.findByTestId("invoice-cancel-error")).toHaveTextContent(
      "Solo se puede anular una factura en borrador o confirmada"
    );
  });

  it("sends no tenant authority in any query the surface issues", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
      detail: () => jsonResponse(DRAFT_INVOICE),
    });

    renderSurface();
    await selectFirstInvoice();

    for (const call of typedCalls(fetchMock)) {
      expect(resolveUrl(call[0])).not.toMatch(/tenant/i);
      const body = call[1]?.body;
      if (typeof body === "string") {
        expect(body).not.toMatch(/tenantId/);
      }
    }
  });
});

describe("BillingSurface command isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Installs two invoices; `first` is the command target's current view. */
  function installPair(handlers: FetchHandlers, first: () => Invoice): void {
    installFetch({
      ...handlers,
      list: () => jsonResponse([first(), SECOND_DRAFT_INVOICE]),
      detail: (url) =>
        jsonResponse(url.endsWith(DRAFT_INVOICE.id) ? first() : SECOND_DRAFT_INVOICE),
    });
  }

  /** Selects the first of the two invoices and starts its confirm. */
  async function startPendingConfirm(): Promise<void> {
    fireEvent.click((await screen.findAllByRole("button", { name: "Seleccionar factura" }))[0]);
    await screen.findByTestId("invoice-line");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar factura" }));
    await screen.findByRole("button", { name: "Confirmando factura…" });
  }

  /** Moves the selection to the invoice that is not currently selected. */
  async function switchInvoice(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar factura" }));
    await screen.findByTestId("invoice-line");
  }

  it("keeps a refused cancel off the invoice the operator switched to", async () => {
    installPair(
      { cancel: () => errorResponse("CONFLICT", INVOICE_NOT_CANCELLABLE_MESSAGE, 409) },
      () => CONFIRMED_INVOICE
    );

    renderSurface();
    fireEvent.click((await screen.findAllByRole("button", { name: "Seleccionar factura" }))[0]);
    await screen.findByTestId("invoice-line");
    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), {
      target: { value: "Duplicated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anular factura" }));
    expect(await screen.findByTestId("invoice-cancel-error")).toHaveTextContent(
      "Solo se puede anular una factura en borrador o confirmada"
    );

    await switchInvoice();

    expect(screen.queryByTestId("invoice-cancel-error")).not.toBeInTheDocument();
  });

  it("keeps a confirm's pending state and late outcome on its own invoice", async () => {
    const pendingConfirm = deferredResponse();
    let confirmed = false;
    installPair({ confirm: () => pendingConfirm.promise }, () =>
      confirmed ? CONFIRMED_INVOICE : DRAFT_INVOICE
    );

    renderSurface();
    await startPendingConfirm();
    await switchInvoice();

    // While the confirm is in flight, the second invoice shows neither the first
    // invoice's pending label nor its outcome, and offers its own action.
    expect(screen.queryByRole("button", { name: "Confirmando factura…" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-confirmed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar factura" })).toBeEnabled();

    // The first invoice's command succeeds only after the operator moved on, and
    // settling late must not render its success on the second invoice.
    confirmed = true;
    pendingConfirm.resolve(jsonResponse(CONFIRMED_INVOICE));
    await screen.findByText(/Factura confirmada · A-12/);
    expect(screen.queryByTestId("invoice-confirmed")).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Borrador");

    // Returning to the first invoice shows its own settled outcome, not a stale one.
    await switchInvoice();
    expect(await screen.findByTestId("invoice-confirmed")).toHaveTextContent("con el número A-12");
  });
});
