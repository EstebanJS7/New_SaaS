import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalAppointmentsView } from "./portal-appointments";

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

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

const REX_ID = "11111111-1111-4111-8111-111111111111";

const TIME_ZONE = "America/Asuncion";
const START = "2026-06-15T13:00:00.000Z";
const END = "2026-06-15T13:30:00.000Z";

/** The appointments envelope the API now returns: zone + rows with a name. */
function envelope(appointments: readonly Record<string, string>[]): Record<string, unknown> {
  return { timeZone: TIME_ZONE, appointments };
}

function appointment(id: string, status: string, patientName = "Rex"): Record<string, string> {
  return { id, patientId: REX_ID, patientName, status, startAt: START, endAt: END };
}

/** Empty booking-requests envelope so the composed section stays quiet. */
const EMPTY_BOOKINGS = { timeZone: TIME_ZONE, bookings: [] };

interface Route {
  readonly body: unknown;
  readonly status?: number;
}

/**
 * Fetch double that answers the two reads the appointments page makes by URL:
 * the appointments envelope and the booking-requests section. Availability and
 * pets are deliberately NOT routable: any call to them falls through to 404,
 * and the fetch-count test asserts they are never issued.
 */
function routeFetch(routes: {
  readonly appointments: Route;
  readonly bookings?: Route;
}): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = resolveRequestUrl(input);
    if (url.startsWith("/api/portal/appointments")) {
      return Promise.resolve(jsonResponse(routes.appointments.body, routes.appointments.status));
    }
    if (url.startsWith("/api/portal/bookings")) {
      const bookings = routes.bookings ?? { body: EMPTY_BOOKINGS };
      return Promise.resolve(jsonResponse(bookings.body, bookings.status));
    }
    return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND" } }, 404));
  });
}

function renderView(slug = "acme-clinic"): void {
  render(
    <TestWrapper>
      <PortalAppointmentsView slug={slug} />
    </TestWrapper>
  );
}

describe("PortalAppointmentsView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state while the read is in flight", () => {
    // A never-resolving read keeps the query in its loading state.
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderView();

    const loading = screen.getByTestId("portal-appointments-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute("role", "status");
  });

  it("treats an empty list as a normal state, not an error", async () => {
    global.fetch = routeFetch({ appointments: { body: envelope([]) } });

    renderView();

    expect(await screen.findByTestId("portal-appointments-empty")).toBeInTheDocument();
    expect(screen.getByText("No appointments yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("points the empty state at the pets list and keeps the tenant slug", async () => {
    global.fetch = routeFetch({ appointments: { body: envelope([]) } });

    renderView("acme-clinic");

    expect(await screen.findByTestId("portal-appointments-book-link")).toHaveAttribute(
      "href",
      "/acme-clinic/pets"
    );
  });

  it("renders a denied state when the API refuses access", async () => {
    global.fetch = routeFetch({
      appointments: {
        body: { error: { code: "FORBIDDEN", message: "Access denied" } },
        status: 403,
      },
    });

    renderView();

    const denied = await screen.findByTestId("portal-appointments-denied");
    expect(denied).toHaveAttribute("role", "alert");
    expect(denied).toHaveTextContent("You do not have access to this portal.");
  });

  it("renders an error state with generic copy for an unmapped failure", async () => {
    global.fetch = routeFetch({
      appointments: {
        body: { error: { code: "INTERNAL", message: "boom: upstream stack" } },
        status: 500,
      },
    });

    renderView();

    const error = await screen.findByTestId("portal-appointments-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Something went wrong. Please try again.");
    expect(error).not.toHaveTextContent("boom: upstream stack");
  });

  it("keeps a masked not-found cause-neutral and names no pet", async () => {
    global.fetch = routeFetch({
      appointments: {
        body: { error: { code: "NOT_FOUND", message: "appointment was not found upstream" } },
        status: 404,
      },
    });

    renderView();

    const error = await screen.findByTestId("portal-appointments-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(/appointment/i);
    expect(error).toHaveTextContent(/may not exist/i);
    expect(error).toHaveTextContent(/may not be linked to your account/i);
    // Never the raw server text, and never the pet-worded copy of another read.
    expect(error).not.toHaveTextContent("appointment was not found upstream");
    expect(error).not.toHaveTextContent(/that pet/i);
  });

  it("renders the envelope's patientName and clinic-local slot times with no join", async () => {
    global.fetch = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED")]) },
    });

    const { container } = render(
      <TestWrapper>
        <PortalAppointmentsView slug="acme-clinic" />
      </TestWrapper>
    );

    expect(await screen.findByText("Rex")).toBeInTheDocument();

    const petLink = screen.getByTestId("portal-appointment-pet");
    // Slug preserved on the pet link, so the holder never leaves the tenant.
    expect(petLink).toHaveAttribute("href", `/acme-clinic/pets/${REX_ID}`);

    // 13:00Z is 10:00 in America/Asuncion (UTC-3). The envelope's zone is what
    // makes this deterministic: a browser-zone render would differ.
    const time = screen.getByTestId("portal-appointment-time");
    expect(time).toHaveTextContent("15 Jun 2026");
    expect(time).toHaveTextContent("10:00");
    expect(time).toHaveTextContent("10:30");

    // No client-side identifier leaks into the row.
    expect(container.textContent).not.toContain(REX_ID);
  });

  it("loads the list in ONE read: no availability probe and no pets join", async () => {
    const fetchMock = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED")]) },
    });
    global.fetch = fetchMock;

    renderView();
    await screen.findByTestId("portal-appointments-list");

    const urls = (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][]).map(
      ([input]) => resolveRequestUrl(input)
    );
    // Exactly one appointments read; the booking-requests section owns its own.
    expect(urls.filter((url) => url.startsWith("/api/portal/appointments"))).toHaveLength(1);
    // The two reads this page used to issue purely for the zone and the name.
    expect(urls.some((url) => url.startsWith("/api/portal/availability"))).toBe(false);
    expect(urls.some((url) => url.startsWith("/api/portal/pets"))).toBe(false);
  });

  it("renders a distinct holder-facing label for every lifecycle status", async () => {
    const cases: readonly (readonly [string, string])[] = [
      ["SCHEDULED", "Scheduled"],
      ["CONFIRMED", "Confirmed"],
      ["ARRIVED", "Checked in"],
      ["IN_PROGRESS", "In progress"],
      ["COMPLETED", "Completed"],
      ["CANCELLED", "Cancelled"],
      ["NO_SHOW", "Missed"],
    ];

    global.fetch = routeFetch({
      appointments: {
        body: envelope(cases.map(([status], index) => appointment(`appt-${index}`, status))),
      },
    });

    const { container } = render(
      <TestWrapper>
        <PortalAppointmentsView slug="acme-clinic" />
      </TestWrapper>
    );

    await screen.findByTestId("portal-appointments-list");

    const labels = screen
      .getAllByTestId("portal-appointment-status")
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
