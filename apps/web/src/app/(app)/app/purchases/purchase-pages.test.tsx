import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewPurchasePage from "./new/page";
import EditPurchasePage from "./[id]/edit/page";

const { PURCHASE_ID, pushMock, backMock } = vi.hoisted(() => ({
  PURCHASE_ID: "22222222-2222-4222-8222-222222222222",
  pushMock: vi.fn(),
  backMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useParams: () => ({ id: PURCHASE_ID }),
}));

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

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
  lines: [{ id: "line-1", catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" }],
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

function typedCalls(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit?][] {
  return fetchMock.mock.calls as [RequestInfo | URL, RequestInit?][];
}

type Responder = (init?: RequestInit) => Response;

interface PagesFetchOptions {
  readonly purchases: Responder;
  readonly suppliers?: Responder;
  readonly catalog?: Responder;
}

function installFetch(options: PagesFetchOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    const respond = (fn: Responder): Promise<Response> => Promise.resolve().then(() => fn(init));
    if (url.startsWith("/api/suppliers")) {
      return respond(options.suppliers ?? (() => jsonResponse([SUPPLIER])));
    }
    if (url.startsWith("/api/catalog")) {
      return respond(options.catalog ?? (() => jsonResponse([CATALOG_ITEM])));
    }
    return respond(options.purchases);
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function submitForm(): void {
  const form = screen.getByRole("button", { name: /Create purchase|Save changes/ }).closest("form");
  fireEvent.submit(form!);
}

async function fillNewPurchase(): Promise<void> {
  await screen.findByRole("option", { name: "Distribuidora Central" });
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: SUPPLIER_ID } });
  await screen.findByRole("option", { name: "Gauze roll" });
  fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: ITEM_ID } });
  fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2.000" } });
  fireEvent.change(screen.getByLabelText("Unit cost"), { target: { value: "1500.00" } });
}

function renderNewPage(): void {
  render(
    <TestWrapper>
      <NewPurchasePage />
    </TestWrapper>
  );
}

function renderEditPage(): void {
  render(
    <TestWrapper>
      <EditPurchasePage />
    </TestWrapper>
  );
}

describe("NewPurchasePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    backMock.mockReset();
  });

  it("creates the draft through the proxy and routes to its edit page on success", async () => {
    const fetchMock = installFetch({ purchases: () => jsonResponse(DRAFT_PURCHASE, 201) });

    renderNewPage();
    await fillNewPurchase();
    submitForm();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(`/app/purchases/${PURCHASE_ID}/edit`);
    });

    const createCall = typedCalls(fetchMock).find((call) => call[1]?.method === "POST");
    expect(createCall).toBeDefined();
    expect(resolveUrl(createCall![0])).toBe("/api/purchases");
    const body = JSON.parse(createCall![1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      supplierId: SUPPLIER_ID,
      lines: [{ catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" }],
    });
    // The create body carries no lifecycle or tenant field.
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("tenantId");
  });

  it("shows a pending, disabled form while the create is in flight", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = resolveUrl(input);
      if (url.startsWith("/api/suppliers")) return Promise.resolve(jsonResponse([SUPPLIER]));
      if (url.startsWith("/api/catalog")) return Promise.resolve(jsonResponse([CATALOG_ITEM]));
      if (init?.method === "POST") return new Promise<Response>(() => undefined);
      return Promise.resolve(jsonResponse([]));
    });

    renderNewPage();
    await fillNewPurchase();
    submitForm();

    expect(await screen.findByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByLabelText("Supplier")).toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders a permission-denied state when the create is refused with 403", async () => {
    installFetch({
      purchases: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
    });

    renderNewPage();
    await fillNewPurchase();
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage purchases.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the API validation message when the create is refused with 400", async () => {
    installFetch({
      purchases: () =>
        jsonResponse(
          { error: { code: "VALIDATION_FAILED", message: "Invalid purchase create body." } },
          400
        ),
    });

    renderNewPage();
    await fillNewPurchase();
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid purchase create body.");
  });
});

describe("EditPurchasePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    backMock.mockReset();
  });

  it("renders an explicit loading state while the purchase is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderEditPage();

    expect(screen.getByText("Loading purchase...")).toBeInTheDocument();
  });

  it("renders the not-found state when the purchase is missing", async () => {
    installFetch({
      purchases: () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "Purchase was not found." } }, 404),
    });

    renderEditPage();

    expect(await screen.findByText("Purchase not found.")).toBeInTheDocument();
  });

  it("renders a permission-denied state when the read is refused with 403", async () => {
    installFetch({
      purchases: () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403),
    });

    renderEditPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage purchases.");
  });

  it("updates the draft and returns to the list on success", async () => {
    const fetchMock = installFetch({
      purchases: (init) =>
        init?.method === "PUT" ? jsonResponse({ ...DRAFT_PURCHASE }) : jsonResponse(DRAFT_PURCHASE),
    });

    renderEditPage();

    const quantity = await screen.findByLabelText("Quantity");
    fireEvent.change(quantity, { target: { value: "3.000" } });
    submitForm();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/purchases");
    });

    const putCall = typedCalls(fetchMock).find((call) => call[1]?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(resolveUrl(putCall![0])).toBe(`/api/purchases/${PURCHASE_ID}`);
    const body = JSON.parse(putCall![1]?.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty("lines");
    expect(body).not.toHaveProperty("status");
  });

  it("renders a non-draft 409 as a conflict when the update is refused", async () => {
    installFetch({
      purchases: (init) =>
        init?.method === "PUT"
          ? jsonResponse(
              { error: { code: "CONFLICT", message: "Only a draft purchase can be changed." } },
              409
            )
          : jsonResponse(DRAFT_PURCHASE),
    });

    renderEditPage();

    await screen.findByLabelText("Quantity");
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This purchase is no longer a draft");
    expect(alert).toHaveTextContent("Only a draft purchase can be changed.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("offers no delete affordance on the edit page", async () => {
    installFetch({ purchases: () => jsonResponse(DRAFT_PURCHASE) });

    renderEditPage();

    await screen.findByLabelText("Quantity");
    expect(
      screen.queryByRole("button", { name: /delete|cancel purchase|receive/i })
    ).not.toBeInTheDocument();
  });
});
