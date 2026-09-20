import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
