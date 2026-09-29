import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fireEvent.click(await screen.findByRole("button", { name: "Add to sale" }));
}

async function checkout(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
  await screen.findByRole("button", { name: "Complete sale" });
}

function salesCalls(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit?][] {
  return typedCalls(fetchMock).filter((call) => resolveUrl(call[0]).startsWith("/api/sales"));
}

describe("CounterSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(screen.getByLabelText("Applied unit price")).toHaveValue("1500.00");

    await checkout();
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("Sale completed")).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await screen.findByRole("button", { name: "Complete sale" });

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

    expect(screen.getByTestId("sale-total")).toHaveTextContent("Sale total 1,500.00 PYG");
    expect(
      screen.getByText(/Draft #22222222 created with the API's total 1,500.00 PYG/)
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
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByRole("button", { name: "Completing..." })).toBeDisabled();
    expect(screen.queryByText("Sale completed")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(
      await screen.findByText("The payments do not sum to the sale total")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the draft" })).toHaveAttribute(
      "href",
      `/app/sales/${SALE_ID}`
    );
    expect(screen.getByText(/A real DRAFT sale/)).toBeInTheDocument();
    expect(screen.queryByText("Sale completed")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("Sale already completed")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("This sale is no longer a draft")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(
      await screen.findByText("A cash payment needs an open cash session")
    ).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(await screen.findByText("Sale not found")).toBeInTheDocument();
  });

  it("maps a create permission refusal to the permission-denied UX branch", async () => {
    installFetch({
      sales: () => errorResponse("FORBIDDEN", "Access denied.", 403),
    });

    renderCounter();
    await addFirstItem();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    const alert = await screen.findByTestId("create-error");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage sales.");
    expect(screen.queryByText("Sale completed")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(await screen.findByTestId("entitlement-denied")).toHaveTextContent(
      "Sales are not enabled for this tenant"
    );
    // The UX gate hides the surface; the backend remains the authority.
    expect(screen.queryByLabelText("Item name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Checkout" })).not.toBeInTheDocument();
  });

  it("adds no scanner affordance and no out-of-scope control", async () => {
    installFetch({
      sales: () => jsonResponse([]),
    });

    renderCounter();
    await screen.findByRole("button", { name: "Add to sale" });

    expect(screen.queryByRole("button", { name: /scan|barcode/i })).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/scan|barcode|discount|invoice|fiscal|refund/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /invoice|fiscal|refund|print/i })
    ).not.toBeInTheDocument();
  });

  it("searches the catalog by name and shows an empty result state", async () => {
    installFetch({
      sales: () => jsonResponse([]),
      catalog: () => jsonResponse([ITEM, { ...ITEM, id: "other", name: "Gauze roll" }]),
    });

    renderCounter();
    await screen.findAllByRole("button", { name: "Add to sale" });
    expect(screen.getAllByRole("button", { name: "Add to sale" })).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "gauze" } });

    expect(await screen.findByText("Gauze roll")).toBeInTheDocument();
    expect(screen.queryByText("Antibiotic")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "zzz" } });

    await waitFor(() => {
      expect(screen.getByTestId("catalog-empty")).toHaveTextContent(
        "No catalog items match this search."
      );
    });
  });
});
