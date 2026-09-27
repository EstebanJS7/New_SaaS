import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

async function clickReceive(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Receive purchase" }));
  return screen.findByRole("alert");
}

describe("PurchaseDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an explicit loading state while the purchase is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderDetail();

    expect(screen.getByText("Loading purchase...")).toBeInTheDocument();
  });

  it("renders a permission-denied state when the read is refused with 403", async () => {
    installFetch({
      read: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
    });

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage purchases.");
  });

  it("renders a not-found state when the read is refused with 404", async () => {
    installFetch({
      read: () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "Purchase was not found." } }, 404),
    });

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not found");
    expect(alert).toHaveTextContent("Purchase not found.");
  });

  it("renders the purchase, its lines and resolved display names", async () => {
    installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Purchase #22222222" })).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Central")).toBeInTheDocument();
    expect(screen.getByText("Gauze roll")).toBeInTheDocument();
    expect(screen.getByText("Qty 2.000")).toBeInTheDocument();
    expect(screen.getByText("Unit cost 1500.00")).toBeInTheDocument();
    expect(screen.getByText("No unit cost")).toBeInTheDocument();
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
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Receive purchase" }));

    expect(callsTo(fetchMock, "/receive")).toHaveLength(0);
  });

  it("receives after confirmation, showing success and the RECEIVED status", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Receive purchase" }));

    expect(await screen.findByText("Purchase received")).toBeInTheDocument();
    expect(screen.getByText(/Stock has been written for every line/)).toBeInTheDocument();
    expect(await screen.findByText("Received purchase")).toBeInTheDocument();

    const receiveCalls = callsTo(fetchMock, "/receive");
    expect(receiveCalls).toHaveLength(1);
    expect(receiveCalls[0]?.[1]?.method).toBe("POST");
    // The confirmation stated the stock effect before the command ran.
    expect(confirmSpy.mock.calls[0]?.[0]).toMatch(/writes the purchase into stock/);
    expect(confirmSpy.mock.calls[0]?.[0]).toMatch(/cannot be undone by editing/);
    // The receive button is gone once the purchase is no longer a draft.
    expect(screen.queryByRole("button", { name: "Receive purchase" })).not.toBeInTheDocument();
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
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("This purchase is no longer a draft");
    expect(alert).toHaveTextContent("Only a draft purchase can be changed.");
    expect(alert).toHaveTextContent(/retrying the same receive will not change it/);
    // No blind retry control is offered for a conflict.
    expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
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
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("A line's catalog item is inactive");
    expect(alert).toHaveTextContent("The catalog item is inactive.");
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
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("A line's catalog item does not track stock");
    expect(alert).toHaveTextContent("The catalog item does not track stock.");
  });

  it("renders a permission denial when the receive is refused with 403", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage purchases.");
  });

  it("renders a not-found state when the receive is refused with 404", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "Purchase was not found." } }, 404),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("Purchase not found");
    expect(alert).toHaveTextContent("Purchase not found.");
  });

  it("renders a transport error when the receive never reaches the API", async () => {
    installFetch({
      read: () => jsonResponse(DRAFT_PURCHASE),
      receive: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    const alert = await clickReceive();

    expect(alert).toHaveTextContent("Could not reach the server");
    expect(alert).toHaveTextContent(/could not reach the server/);
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
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();
    await clickReceive();

    await waitFor(() => {
      expect(callsTo(fetchMock, "/receive")).toHaveLength(1);
    });
  });

  it("cancels a draft only through the explicit command after confirmation", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel purchase" }));

    expect(await screen.findByText("Cancelled purchase")).toBeInTheDocument();
    const cancelCalls = callsTo(fetchMock, "/cancel");
    expect(cancelCalls).toHaveLength(1);
    expect(cancelCalls[0]?.[1]?.method).toBe("POST");
  });

  it("renders no delete affordance, no status control and never sends DELETE or PATCH", async () => {
    const fetchMock = installFetch({ read: () => jsonResponse(DRAFT_PURCHASE) });

    renderDetail();

    await screen.findByRole("heading", { name: "Purchase #22222222" });
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /delete|remove/i })).not.toBeInTheDocument();
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

    await screen.findByText("Received purchase");
    expect(screen.queryByRole("button", { name: "Receive purchase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel purchase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});
