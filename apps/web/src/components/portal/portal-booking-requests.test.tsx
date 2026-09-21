import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalBookingRequests } from "./portal-booking-requests";

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TIME_ZONE = "America/Asuncion";
const START = "2026-06-15T13:00:00.000Z";
const END = "2026-06-15T13:30:00.000Z";

function booking(id: string, status: string, patientName = "Rex"): Record<string, string> {
  return {
    id,
    patientId: "11111111-1111-4111-8111-111111111111",
    patientName,
    status,
    startAt: START,
    endAt: END,
  };
}

function envelope(bookings: readonly Record<string, string>[]): Record<string, unknown> {
  return { timeZone: TIME_ZONE, bookings };
}

function renderSection(): void {
  render(
    <TestWrapper>
      <PortalBookingRequests />
    </TestWrapper>
  );
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

interface Route {
  readonly body: unknown;
  readonly status?: number;
}

/**
 * Fetch double for the requests section: the FIRST bookings read returns
 * `initial`, every later read returns `after` (so a refresh is observable), and
 * the cancel POST returns `cancel`.
 */
function cancelFetch(routes: {
  readonly initial: Route;
  readonly after?: Route;
  readonly cancel: Route;
}): ReturnType<typeof vi.fn> {
  let reads = 0;
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(jsonResponse(routes.cancel.body, routes.cancel.status));
    }
    const route = reads > 0 && routes.after ? routes.after : routes.initial;
    reads += 1;
    return Promise.resolve(jsonResponse(route.body, route.status));
  });
}

/** How many bookings reads the mock served (initial + each refresh). */
function bookingReads(fetchMock: ReturnType<typeof vi.fn>): number {
  return (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][]).filter(
    ([input, init]) =>
      (init?.method ?? "GET") === "GET" &&
      resolveRequestUrl(input).startsWith("/api/portal/bookings")
  ).length;
}

describe("PortalBookingRequests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state while the read is in flight", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderSection();

    const loading = screen.getByTestId("portal-booking-requests-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute("role", "status");
  });

  it("treats an empty list as a normal state, not an error", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(envelope([]))));

    renderSection();

    expect(await screen.findByTestId("portal-booking-requests-empty")).toBeInTheDocument();
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a denied state when the API refuses access", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "nope" } }, 403))
    );

    renderSection();

    const denied = await screen.findByTestId("portal-booking-requests-denied");
    expect(denied).toHaveAttribute("role", "alert");
    expect(denied).toHaveTextContent("You do not have access to this portal.");
  });

  it("renders an error state with generic copy and never echoes the server", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "INTERNAL", message: "boom: upstream stack" } }, 500)
      )
    );

    renderSection();

    const error = await screen.findByTestId("portal-booking-requests-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Something went wrong. Please try again.");
    expect(error).not.toHaveTextContent("boom: upstream stack");
  });

  it("renders each request with its pet name and clinic-local requested time", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(envelope([booking("b1", "PENDING")]))));

    renderSection();

    expect(await screen.findByTestId("portal-booking-request")).toBeInTheDocument();
    expect(screen.getByTestId("portal-booking-request-pet")).toHaveTextContent("Rex");
    // Deliberately plain text, never a link: a request stays visible after the
    // guardian link to that pet is revoked, and the pet detail would then 404.
    // Pinning it here so an accidental link is caught rather than shipped.
    expect(screen.queryByRole("link", { name: "Rex" })).toBeNull();

    // 13:00Z is 10:00 in America/Asuncion (UTC-3): the envelope's zone, not the
    // browser's, names the day.
    const time = screen.getByTestId("portal-booking-request-time");
    expect(time).toHaveTextContent("15 Jun 2026");
    expect(time).toHaveTextContent("10:00");
    expect(time).toHaveTextContent("10:30");
  });

  it("renders a distinct holder-facing label for every request status", async () => {
    const cases: readonly (readonly [string, string])[] = [
      ["PENDING", "Awaiting approval"],
      ["APPROVED", "Approved"],
      ["REJECTED", "Not approved"],
      ["CANCELLED", "Cancelled"],
    ];

    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse(envelope(cases.map(([status], index) => booking(`b${index}`, status))))
      )
    );

    const { container } = render(
      <TestWrapper>
        <PortalBookingRequests />
      </TestWrapper>
    );

    await screen.findByTestId("portal-booking-requests-list");

    const labels = screen
      .getAllByTestId("portal-booking-request-status")
      .map((node) => node.textContent);
    expect(labels).toEqual(cases.map(([, label]) => label));
    // Distinct meanings must never collapse to the same words.
    expect(new Set(labels).size).toBe(cases.length);
    // No raw enum value reaches the holder.
    for (const [status] of cases) {
      expect(container.textContent).not.toContain(status);
    }
  });

  it("offers the cancel action for a PENDING request only", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          envelope([
            booking("b1", "PENDING"),
            booking("b2", "APPROVED"),
            booking("b3", "REJECTED"),
            booking("b4", "CANCELLED"),
          ])
        )
      )
    );

    renderSection();
    await screen.findByTestId("portal-booking-requests-list");

    // Exactly one action, and it belongs to the PENDING row: a decided request
    // is a PENDING compare-and-set miss, so it must offer nothing.
    const buttons = screen.getAllByTestId("portal-booking-request-cancel");
    expect(buttons).toHaveLength(1);
    const pendingRow = screen.getAllByTestId("portal-booking-request")[0];
    expect(within(pendingRow).getByTestId("portal-booking-request-cancel")).toBeInTheDocument();
  });

  it("cancels a PENDING request and refreshes so the new status is visible", async () => {
    const fetchMock = cancelFetch({
      initial: { body: envelope([booking("b1", "PENDING")]) },
      after: { body: envelope([booking("b1", "CANCELLED")]) },
      cancel: { body: booking("b1", "CANCELLED") },
    });
    global.fetch = fetchMock;

    renderSection();
    fireEvent.click(await screen.findByTestId("portal-booking-request-cancel"));

    await waitFor(() => {
      const post = (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][]).find(
        ([, init]) => init?.method === "POST"
      );
      expect(post).toBeDefined();
      expect(resolveRequestUrl(post![0])).toBe("/api/portal/bookings/b1/cancel");
    });

    // The refreshed read carries the stored status, AND the action reports a
    // distinct success rather than leaving the row looking untouched.
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(await screen.findByTestId("portal-booking-request-cancel-success")).toHaveTextContent(
      "Request cancelled."
    );
    expect(bookingReads(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it("maps a 409 to decided-request copy and refreshes the list", async () => {
    const fetchMock = cancelFetch({
      initial: { body: envelope([booking("b1", "PENDING")]) },
      after: { body: envelope([booking("b1", "APPROVED")]) },
      cancel: {
        body: {
          error: {
            code: "CONFLICT",
            message: "Only a pending booking request can be cancelled.",
          },
        },
        status: 409,
      },
    });
    global.fetch = fetchMock;

    renderSection();
    fireEvent.click(await screen.findByTestId("portal-booking-request-cancel"));

    const alert = await screen.findByTestId("portal-booking-request-cancel-error");
    expect(alert).toHaveAttribute("role", "alert");
    // The cancel command IS a PENDING compare-and-set, so the 409 may name it.
    expect(alert).toHaveTextContent("already have been decided");
    expect(alert).toHaveTextContent("refreshed");
    expect(alert).not.toHaveTextContent("Only a pending booking request can be cancelled.");

    // The list self-corrects to the server's decision.
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(bookingReads(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it("leaves the request actionable after a failed cancellation", async () => {
    const fetchMock = cancelFetch({
      initial: { body: envelope([booking("b1", "PENDING")]) },
      cancel: { body: { error: { code: "INTERNAL", message: "boom" } }, status: 500 },
    });
    global.fetch = fetchMock;

    renderSection();
    fireEvent.click(await screen.findByTestId("portal-booking-request-cancel"));

    expect(await screen.findByTestId("portal-booking-request-cancel-error")).toHaveAttribute(
      "role",
      "alert"
    );
    // Not settled: the holder can retry instead of the row looking done.
    expect(screen.getByTestId("portal-booking-request-cancel")).toBeEnabled();
    expect(screen.queryByTestId("portal-booking-request-cancel-success")).toBeNull();
  });
});
