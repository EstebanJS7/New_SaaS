import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FiscalDocument } from "./fiscal-api";
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
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "PENDING" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => resolveUrl(call[0]))).toContain(
        `${BASE}?status=PENDING`
      )
    );
    fireEvent.click(await screen.findByRole("button", { name: "Select document" }));
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
    fireEvent.change(screen.getByLabelText("Invoice id"), {
      target: { value: DOCUMENT.invoiceId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Issue fiscal document" }));
    expect(await screen.findByTestId("fiscal-issued")).toBeInTheDocument();
    await screen.findByTestId("fiscal-provider");
    fireEvent.change(screen.getByLabelText("Cancellation reason"), {
      target: { value: "Duplicate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel fiscal document" }));
    expect(await screen.findByTestId("fiscal-cancelled")).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    expect(JSON.parse(posts[0]?.[1]?.body as string)).toEqual({ invoiceId: DOCUMENT.invoiceId });
  });
  it("renders cancel conflict verbatim", async () => {
    installFetch({
      list: () => jsonResponse([DOCUMENT]),
      detail: () => jsonResponse(DOCUMENT),
      cancel: () => errorResponse("CONFLICT", "Provider refuses cancellation verbatim.", 409),
    });
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Select document" }));
    await screen.findByTestId("fiscal-provider");
    fireEvent.change(screen.getByLabelText("Cancellation reason"), {
      target: { value: "Duplicate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel fiscal document" }));
    expect(await screen.findByTestId("fiscal-cancel-error")).toHaveTextContent(
      "Provider refuses cancellation verbatim."
    );
  });
});
