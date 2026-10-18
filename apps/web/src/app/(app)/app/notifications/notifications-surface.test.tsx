import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationDelivery } from "./notifications-api";
import { NotificationsSurface } from "./notifications-surface";

const DELIVERY: NotificationDelivery = {
  id: "99999999-9999-4999-8999-999999999999",
  channel: "EMAIL",
  status: "SCHEDULED",
  sourceType: "APPOINTMENT",
  sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  recipientType: "CUSTOMER",
  recipientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  scheduledAt: "2026-10-18T10:00:00.000Z",
  attemptCount: 0,
  lastAttemptAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  providerReference: null,
  sentAt: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: "2026-10-17T10:00:00.000Z",
  updatedAt: "2026-10-17T10:00:00.000Z",
};

const BASE = "/api/notifications/deliveries";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function installFetch(handler: (url: string) => Response): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(resolveUrl(input))));
}

function renderSurface(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationsSurface />
    </QueryClientProvider>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("NotificationsSurface — the five states", () => {
  it("shows loading, then the list, and reads a selected delivery", async () => {
    // Held on an object: a local assigned inside the fetch callback is narrowed to
    // `null` by control-flow analysis at the call site.
    const pending: { resolveList: ((value: Response) => void) | null } = { resolveList: null };
    global.fetch = vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          const url = resolveUrl(input);
          if (url === BASE) pending.resolveList = resolve;
          else resolve(jsonResponse(DELIVERY));
        })
    );

    renderSurface();
    expect(screen.getByTestId("notification-list-loading")).toBeInTheDocument();
    pending.resolveList?.(jsonResponse({ deliveries: [DELIVERY] }));

    expect(await screen.findByTestId("notification-list-item")).toBeInTheDocument();
    expect(screen.getByTestId("notification-detail-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByTestId("notification-detail")).toHaveTextContent("Scheduled");
  });

  it("shows the empty state when nothing matches", async () => {
    installFetch(() => jsonResponse({ deliveries: [] }));
    renderSurface();
    expect(await screen.findByTestId("notification-list-empty")).toHaveTextContent(
      "No deliveries match these filters."
    );
  });

  it("shows a permission denial as its own state, never as a retryable error", async () => {
    installFetch(() => jsonResponse({ error: { code: "FORBIDDEN", message: "no" } }, 403));
    renderSurface();
    expect(await screen.findByTestId("notification-permission-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-list-error")).not.toBeInTheDocument();
  });

  it("shows a load failure as an error", async () => {
    installFetch(() => jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500));
    renderSurface();
    expect(await screen.findByTestId("notification-list-error")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-permission-denied")).not.toBeInTheDocument();
  });

  it("sends only the selected filters to the read route", async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      return jsonResponse({ deliveries: [] });
    });
    renderSurface();
    await screen.findByTestId("notification-list-empty");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "FAILED" } });
    await waitFor(() => expect(calls).toContain(`${BASE}?status=FAILED`));
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "WHATSAPP" } });
    await waitFor(() => expect(calls).toContain(`${BASE}?status=FAILED&channel=WHATSAPP`));
  });

  it("shows a denied detail as a denial, never as 'select a delivery'", async () => {
    installFetch((url) =>
      url === BASE
        ? jsonResponse({ deliveries: [DELIVERY] })
        : jsonResponse({ error: { code: "FORBIDDEN", message: "no" } }, 403)
    );
    renderSurface();
    await screen.findByTestId("notification-list-item");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByTestId("notification-detail-permission-denied")).toBeInTheDocument();
    // The empty state would tell the reader to select a delivery they just selected.
    expect(screen.queryByTestId("notification-detail-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notification-detail-error")).not.toBeInTheDocument();
  });

  it("renders a failure reason without inventing message content", async () => {
    installFetch(() =>
      jsonResponse({
        deliveries: [
          {
            ...DELIVERY,
            status: "FAILED",
            attemptCount: 3,
            lastAttemptAt: "2026-10-17T10:05:00.000Z",
            lastErrorCode: "PROVIDER_REJECTED",
            lastErrorMessage: "Provider refused the address.",
          },
        ],
      })
    );
    renderSurface();
    const item = await screen.findByTestId("notification-list-item");
    expect(item).toHaveTextContent("Failed");
    expect(item).toHaveTextContent("Provider refused the address.");
    // The message the platform would SEND is never fetched or rendered: only the
    // recorded reason and the references are.
    expect(item.textContent).not.toContain("Your appointment");
  });
});
