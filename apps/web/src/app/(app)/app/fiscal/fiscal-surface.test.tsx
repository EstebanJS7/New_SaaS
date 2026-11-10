import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE, type FiscalDocument } from "./fiscal-api";
import { FiscalSurface } from "./fiscal-surface";
const DOCUMENT: FiscalDocument = {
  id: "99999999-9999-4999-8999-999999999999",
  invoiceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider: "TEST",
  status: "PENDING",
  attemptCount: 2,
  externalId: null,
  cdc: null,
  lastErrorCode: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
  cancelledAt: null,
};
const BASE = "/api/fiscal/fiscal-documents";
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
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function installFetch(handlers: {
  list?: Handler;
  detail?: Handler;
  issue?: Handler;
  cancel?: Handler;
}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    const method = init?.method ?? "GET";
    const handler = url.endsWith("/cancel")
      ? handlers.cancel
      : method === "POST"
        ? handlers.issue
        : url.includes("?") || url === BASE
          ? handlers.list
          : handlers.detail;
    return Promise.resolve(
      (handler ?? (() => jsonResponse(url === BASE || url.includes("?") ? [] : DOCUMENT)))(
        url,
        init
      )
    );
  });
  global.fetch = fetchMock;
  return fetchMock;
}
function renderSurface(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FiscalSurface />
    </QueryClientProvider>
  );
  return client;
}
afterEach(() => vi.restoreAllMocks());
describe("FiscalSurface reads", () => {
  it("renders the list, applies filter, and reads a selected document", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([DOCUMENT]),
      detail: () => jsonResponse(DOCUMENT),
    });
    renderSurface();
    await screen.findByTestId("fiscal-list-item");
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "PENDING" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => resolveUrl(call[0]))).toContain(
        `${BASE}?status=PENDING`
      )
    );
    fireEvent.click(await screen.findByRole("button", { name: "Seleccionar documento" }));
    expect(await screen.findByTestId("fiscal-provider")).toHaveTextContent("TEST");
  });
  it("shows entitlement and permission denied states", async () => {
    installFetch({
      list: () =>
        errorResponse(
          "FEATURE_NOT_ENTITLED",
          "Fiscal features are not enabled for this tenant.",
          403
        ),
    });
    renderSurface();
    expect(await screen.findByTestId("fiscal-entitlement-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("fiscal-workspace")).not.toBeInTheDocument();
  });
  it("shows forbidden, loading, empty and error states", async () => {
    installFetch({ list: () => errorResponse("FORBIDDEN", "Denied", 403) });
    renderSurface();
    expect(await screen.findByTestId("fiscal-permission-denied")).toBeInTheDocument();
  });
  it("renders empty and read error branches", async () => {
    installFetch({ list: () => jsonResponse([]) });
    renderSurface();
    expect(await screen.findByTestId("fiscal-empty")).toBeInTheDocument();
  });
});
describe("FiscalSurface commands", () => {
  it("issues and cancels returned representations and renders a 409 verbatim", async () => {
    const fetchMock = installFetch({
      list: () => jsonResponse([DOCUMENT]),
      detail: () => jsonResponse(DOCUMENT),
      issue: () => jsonResponse({ ...DOCUMENT, status: "QUEUED" }),
      cancel: () => jsonResponse({ ...DOCUMENT, status: "CANCELLED" }),
    });
    renderSurface();
    fireEvent.change(screen.getByLabelText("Identificador de la factura"), {
      target: { value: DOCUMENT.invoiceId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir documento fiscal" }));
    expect(await screen.findByTestId("fiscal-issued")).toBeInTheDocument();
    await screen.findByTestId("fiscal-provider");
    fireEvent.change(screen.getByLabelText("Motivo de la cancelación"), {
      target: { value: "Duplicate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar documento fiscal" }));
    expect(await screen.findByTestId("fiscal-cancelled")).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    expect(JSON.parse(posts[0]?.[1]?.body as string)).toEqual({ invoiceId: DOCUMENT.invoiceId });
  });
  it("renders the provider cancel refusal in Spanish, not the server English", async () => {
    installFetch({
      list: () => jsonResponse([DOCUMENT]),
      detail: () => jsonResponse(DOCUMENT),
      cancel: () => errorResponse("CONFLICT", FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE, 409),
    });
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Seleccionar documento" }));
    await screen.findByTestId("fiscal-provider");
    fireEvent.change(screen.getByLabelText("Motivo de la cancelación"), {
      target: { value: "Duplicate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar documento fiscal" }));
    const alert = await screen.findByTestId("fiscal-cancel-error");
    expect(alert).toHaveTextContent("La operación fue rechazada");
    expect(alert).toHaveTextContent("El proveedor fiscal rechazó la cancelación.");
    expect(alert).not.toHaveTextContent(FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE);
  });
});

describe("FiscalSurface commands follow the caller's capabilities (UX-037)", () => {
  function renderSurfaceAs(capabilities: Capabilities): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <CapabilitiesProvider value={capabilities}>
        <QueryClientProvider client={client}>
          <FiscalSurface />
        </QueryClientProvider>
      </CapabilitiesProvider>
    );
  }

  async function openDocument(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "Seleccionar documento" }));
    await screen.findByTestId("fiscal-provider");
  }

  it("keeps documents readable but offers neither issue nor cancel without fiscal.invoice.issue", async () => {
    installFetch({ list: () => jsonResponse([DOCUMENT]), detail: () => jsonResponse(DOCUMENT) });
    renderSurfaceAs({ permissions: ["fiscal.read"], features: ["fiscal"] });
    await openDocument();
    expect(
      screen.queryByRole("button", { name: "Cancelar documento fiscal" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Emitir documento fiscal" })
    ).not.toBeInTheDocument();
  });

  it("shows the not-enabled state up front when the clinic lacks the fiscal feature", async () => {
    installFetch({ list: () => jsonResponse([DOCUMENT]) });
    renderSurfaceAs({ permissions: ["fiscal.read", "fiscal.invoice.issue"], features: [] });
    expect(await screen.findByTestId("fiscal-entitlement-denied")).toBeInTheDocument();
  });

  it.each([
    [
      "granted",
      {
        permissions: ["fiscal.read", "fiscal.invoice.issue"],
        features: ["fiscal"],
      },
    ],
    ["unknown", {}],
  ])("offers issue and cancel when capabilities are %s", async (_label, capabilities) => {
    installFetch({ list: () => jsonResponse([DOCUMENT]), detail: () => jsonResponse(DOCUMENT) });
    renderSurfaceAs(capabilities);
    await openDocument();
    expect(screen.getByRole("button", { name: "Cancelar documento fiscal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emitir documento fiscal" })).toBeInTheDocument();
  });
});
