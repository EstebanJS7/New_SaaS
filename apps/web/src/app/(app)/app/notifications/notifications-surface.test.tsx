import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationDelivery, NotificationDeliveryDetail } from "./notifications-api";
import { NotificationsSurface } from "./notifications-surface";
import { deliveryFailureReason, formatTimestamp } from "./notifications-display";

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

/** A detail response: the delivery PLUS the attempt list the DTO always sends. */
const DETAIL: NotificationDeliveryDetail = { ...DELIVERY, attempts: [] };

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
          else resolve(jsonResponse(DETAIL));
        })
    );

    renderSurface();
    expect(screen.getByRole("heading", { name: "Notificaciones" })).toBeInTheDocument();
    expect(screen.getByTestId("notification-list-loading")).toHaveTextContent("Cargando entregas…");
    pending.resolveList?.(jsonResponse({ deliveries: [DELIVERY] }));

    const item = await screen.findByTestId("notification-list-item");
    expect(item).toHaveTextContent("Programada · Correo electrónico · Turno");
    // es-PY instant in the clinic's zone, never the browser locale or raw ISO.
    expect(item).toHaveTextContent("18 oct. 2026, 07:00");
    expect(item).toHaveTextContent("0 intentos");
    expect(screen.getByTestId("notification-detail-empty")).toHaveTextContent(
      "Seleccioná una entrega para ver su detalle."
    );
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle" }));
    const detail = await screen.findByTestId("notification-detail");
    expect(detail).toHaveTextContent("Programada");
    expect(detail).toHaveTextContent("Canal");
    expect(detail).toHaveTextContent("Turno #aaaaaaaa");
    expect(detail).toHaveTextContent("Cliente #cccccccc");
    expect(detail).toHaveTextContent("Fecha programada18 oct. 2026, 07:00");
    expect(screen.getByRole("button", { name: "Seleccionada" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("shows the empty state when nothing matches", async () => {
    installFetch(() => jsonResponse({ deliveries: [] }));
    renderSurface();
    expect(await screen.findByTestId("notification-list-empty")).toHaveTextContent(
      "Ninguna entrega coincide con estos filtros."
    );
  });

  it("shows a permission denial as its own state, never as a retryable error", async () => {
    installFetch(() => jsonResponse({ error: { code: "FORBIDDEN", message: "no" } }, 403));
    renderSurface();
    expect(await screen.findByTestId("notification-permission-denied")).toHaveTextContent(
      "No tenés permiso para ver las entregas de notificaciones."
    );
    expect(screen.queryByTestId("notification-list-error")).not.toBeInTheDocument();
  });

  it("shows a load failure as an error", async () => {
    installFetch(() => jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500));
    renderSurface();
    expect(await screen.findByTestId("notification-list-error")).toHaveTextContent(
      "No se pudieron cargar las entregas. Volvé a intentar."
    );
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
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "FAILED" } });
    await waitFor(() => expect(calls).toContain(`${BASE}?status=FAILED`));
    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "WHATSAPP" } });
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
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle" }));
    expect(await screen.findByTestId("notification-detail-permission-denied")).toHaveTextContent(
      "No tenés permiso para ver esta entrega."
    );
    // The empty state would tell the reader to select a delivery they just selected.
    expect(screen.queryByTestId("notification-detail-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notification-detail-error")).not.toBeInTheDocument();
  });

  it("shows the attempt SEQUENCE, which the delivery's own row cannot", async () => {
    installFetch((url) =>
      url === BASE
        ? jsonResponse({ deliveries: [{ ...DELIVERY, status: "FAILED" }] })
        : jsonResponse({
            ...DETAIL,
            status: "FAILED",
            attempts: [
              {
                attemptNumber: 1,
                outcome: "FAILED",
                reasonCode: "TIMEOUT",
                reasonMessage: "Attempt 1.",
                occurredAt: "2026-10-17T10:01:00.000Z",
              },
              {
                attemptNumber: 2,
                outcome: "FAILED",
                reasonCode: "TIMEOUT",
                reasonMessage: "Attempt 2.",
                occurredAt: "2026-10-17T10:02:00.000Z",
              },
              {
                attemptNumber: 3,
                outcome: "FAILED",
                reasonCode: "PROVIDER_REJECTED",
                reasonMessage: "Attempt 3.",
                occurredAt: "2026-10-17T10:03:00.000Z",
              },
            ],
          })
    );
    renderSurface();
    await screen.findByTestId("notification-list-item");
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle" }));

    const history = await screen.findByTestId("delivery-attempts");
    // Three tries, three reasons — where the row remembers only the last one.
    expect(history.textContent).toContain("#1");
    expect(history.textContent).toContain("#3");
    expect(history.textContent).toContain("Attempt 2.");
    expect(history.textContent).toContain("Intentos");
    expect(history.textContent).toContain("#2 · Fallido · 17 oct. 2026, 07:02");
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
    expect(item).toHaveTextContent("Fallida");
    expect(item).toHaveTextContent("3 intentos");
    expect(item).toHaveTextContent("Provider refused the address.");
    // The message the platform would SEND is never fetched or rendered: only the
    // recorded reason and the references are.
    expect(item.textContent).not.toContain("Your appointment");
  });
});

describe("notifications display helpers", () => {
  it("formats instants in es-PY in the clinic's zone and keeps unparseable input", () => {
    expect(formatTimestamp("2026-10-18T10:00:00.000Z")).toBe("18 oct. 2026, 07:00 a. m.");
    expect(formatTimestamp("not-a-timestamp")).toBe("not-a-timestamp");
  });

  it("returns the recorded reason, or nothing when none was recorded", () => {
    expect(deliveryFailureReason({ lastErrorCode: null, lastErrorMessage: null })).toBeNull();
    expect(
      deliveryFailureReason({ lastErrorCode: "PROVIDER_REJECTED", lastErrorMessage: null })
    ).toBe("PROVIDER_REJECTED");
  });
});
