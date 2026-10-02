import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

interface DeferredResponse {
  readonly promise: Promise<Response>;
  readonly resolve: (value: Response) => void;
}

/** A command response the test releases only when it decides the command settles. */
function deferredResponse(): DeferredResponse {
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
  fireEvent.click(await screen.findByRole("button", { name: "Select invoice" }));
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

    expect(screen.getByTestId("invoice-total")).toHaveTextContent("1,500.00");
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

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "DRAFT" } });

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

    expect(await screen.findByTestId("invoices-error")).toHaveTextContent("Permission denied");
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
      "Billing features are not enabled for this tenant"
    );
    // The UX gate hides the surface; the backend remains the authority.
    expect(screen.queryByLabelText("Status filter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Completed sale id")).not.toBeInTheDocument();
  });

  it("renders a backend 404 on the detail read as an error state, never as data", async () => {
    installFetch({
      list: () => jsonResponse([DRAFT_INVOICE]),
      detail: () => errorResponse("NOT_FOUND", "Invoice was not found.", 404),
    });

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Select invoice" }));

    expect(await screen.findByTestId("invoice-error")).toHaveTextContent("Invoice not found");
    expect(screen.queryByTestId("invoice-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-total")).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText("Completed sale id"), { target: { value: SALE_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(await screen.findByTestId("invoice-created")).toHaveTextContent("Draft invoice created");

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

    fireEvent.click(screen.getByRole("button", { name: "Confirm invoice" }));

    const confirmed = await screen.findByTestId("invoice-confirmed");
    expect(confirmed).toHaveTextContent("Invoice confirmed");
    expect(confirmed).toHaveTextContent("numbered A-12");
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Confirmed");
    // No second allocation and no second confirmation are claimed.
    expect(confirmed).toHaveTextContent("no second number is allocated");
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

    fireEvent.click(screen.getByRole("button", { name: "Confirm invoice" }));

    expect(await screen.findByTestId("invoice-confirm-error")).toHaveTextContent(
      "Only a draft invoice can be confirmed"
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

    fireEvent.change(screen.getByLabelText("Completed sale id"), { target: { value: SALE_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(await screen.findByTestId("invoice-create-error")).toHaveTextContent(
      "This sale already has an invoice"
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

    fireEvent.change(screen.getByLabelText("Completed sale id"), { target: { value: SALE_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(await screen.findByTestId("invoice-create-error")).toHaveTextContent(
      "This tenant requires a customer before an invoice can be issued"
    );
  });

  it("requires a reason and shows the cancel representation the API returned, including a replay", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([CONFIRMED_INVOICE]),
      detail: () => jsonResponse(CONFIRMED_INVOICE),
      cancel: () => jsonResponse(CANCELLED_INVOICE),
    });

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Select invoice" }));
    await screen.findByTestId("invoice-line");

    // A blank reason never reaches the API.
    fireEvent.click(screen.getByRole("button", { name: "Cancel invoice" }));
    expect(screen.getByTestId("invoice-cancel-validation-error")).toHaveTextContent(
      "An invoice cancel reason is required."
    );
    expect(
      callsTo(fetchMock, BASE).filter((call) => resolveUrl(call[0]).endsWith("/cancel"))
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Cancellation reason"), {
      target: { value: "Duplicated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel invoice" }));

    const cancelled = await screen.findByTestId("invoice-cancelled");
    expect(cancelled).toHaveTextContent("Invoice cancelled");
    expect(cancelled).toHaveTextContent("Cancelled is terminal");
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Cancelled");

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
    fireEvent.click(await screen.findByRole("button", { name: "Select invoice" }));
    await screen.findByTestId("invoice-line");

    fireEvent.change(screen.getByLabelText("Cancellation reason"), {
      target: { value: "Duplicated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel invoice" }));

    expect(await screen.findByTestId("invoice-cancel-error")).toHaveTextContent(
      "Only a draft or confirmed invoice can be cancelled"
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

  /**
   * Selects the first invoice of a two-invoice list and starts its confirm.
   * Returns once that confirm is in flight.
   */
  async function startPendingConfirm(): Promise<void> {
    const selectButtons = await screen.findAllByRole("button", { name: "Select invoice" });
    fireEvent.click(selectButtons[0]);
    await screen.findByTestId("invoice-line");
    fireEvent.click(screen.getByRole("button", { name: "Confirm invoice" }));
    await screen.findByRole("button", { name: "Confirming invoice..." });
  }

  /** Moves the selection to the invoice that is not currently selected. */
  async function switchInvoice(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Select invoice" }));
    await screen.findByTestId("invoice-line");
  }

  it("keeps an in-flight confirm off the invoice the operator switched to", async () => {
    const pendingConfirm = deferredResponse();
    installFetch({
      list: () => jsonResponse([DRAFT_INVOICE, SECOND_DRAFT_INVOICE]),
      detail: (url) =>
        jsonResponse(url.endsWith(DRAFT_INVOICE.id) ? DRAFT_INVOICE : SECOND_DRAFT_INVOICE),
      confirm: () => pendingConfirm.promise,
    });

    renderSurface();
    await startPendingConfirm();
    await switchInvoice();

    // The second invoice shows neither the first invoice's pending label nor its
    // outcome, and its own confirm action is offered and enabled.
    expect(screen.queryByRole("button", { name: "Confirming invoice..." })).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-confirmed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm invoice" })).toBeEnabled();
  });

  it("keeps a refused cancel off the invoice the operator switched to", async () => {
    installFetch({
      list: () => jsonResponse([CONFIRMED_INVOICE, SECOND_DRAFT_INVOICE]),
      detail: (url) =>
        jsonResponse(url.endsWith(DRAFT_INVOICE.id) ? CONFIRMED_INVOICE : SECOND_DRAFT_INVOICE),
      cancel: () => errorResponse("CONFLICT", INVOICE_NOT_CANCELLABLE_MESSAGE, 409),
    });

    renderSurface();
    const selectButtons = await screen.findAllByRole("button", { name: "Select invoice" });
    fireEvent.click(selectButtons[0]);
    await screen.findByTestId("invoice-line");
    fireEvent.change(screen.getByLabelText("Cancellation reason"), {
      target: { value: "Duplicated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel invoice" }));
    expect(await screen.findByTestId("invoice-cancel-error")).toHaveTextContent(
      "Only a draft or confirmed invoice can be cancelled"
    );

    await switchInvoice();

    expect(screen.queryByTestId("invoice-cancel-error")).not.toBeInTheDocument();
  });

  it("does not carry a late confirm outcome onto another invoice, and keeps it on its own", async () => {
    const pendingConfirm = deferredResponse();
    let confirmed = false;
    installFetch({
      list: () =>
        jsonResponse(
          confirmed
            ? [CONFIRMED_INVOICE, SECOND_DRAFT_INVOICE]
            : [DRAFT_INVOICE, SECOND_DRAFT_INVOICE]
        ),
      detail: (url) => {
        if (!url.endsWith(DRAFT_INVOICE.id)) {
          return jsonResponse(SECOND_DRAFT_INVOICE);
        }
        return jsonResponse(confirmed ? CONFIRMED_INVOICE : DRAFT_INVOICE);
      },
      confirm: () => pendingConfirm.promise,
    });

    renderSurface();
    await startPendingConfirm();
    await switchInvoice();

    // The first invoice's command succeeds only after the operator moved on.
    confirmed = true;
    pendingConfirm.resolve(jsonResponse(CONFIRMED_INVOICE));

    // Its success settles while the second invoice is selected: that invoice
    // never renders the first one's outcome.
    await screen.findByText(/Confirmed invoice A-12/);
    expect(screen.queryByTestId("invoice-confirmed")).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Draft");

    // Returning to the first invoice shows its own settled outcome.
    await switchInvoice();
    expect(await screen.findByTestId("invoice-confirmed")).toHaveTextContent("numbered A-12");
  });
});
