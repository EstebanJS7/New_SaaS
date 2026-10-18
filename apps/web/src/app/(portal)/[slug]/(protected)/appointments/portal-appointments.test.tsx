import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
function envelope(appointments: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { timeZone: TIME_ZONE, appointments };
}

function appointment(
  id: string,
  status: string,
  patientName = "Rex",
  version = 1
): Record<string, unknown> {
  return { id, patientId: REX_ID, patientName, status, startAt: START, endAt: END, version };
}

/** One availability slot as the picker's read returns it: `Z` UTC instants. */
const SLOT = { startAt: "2026-06-16T13:00:00.000Z", endAt: "2026-06-16T13:30:00.000Z" };

const AVAILABILITY = {
  date: "2026-06-16",
  timeZone: TIME_ZONE,
  durationMinutes: 30,
  stepMinutes: 30,
  slots: [SLOT],
};

/** Empty booking-requests envelope so the composed section stays quiet. */
const EMPTY_BOOKINGS = { timeZone: TIME_ZONE, bookings: [] };

interface Route {
  readonly body: unknown;
  readonly status?: number;
}

type Call = [RequestInfo | URL, RequestInit];

function calls(fetchMock: ReturnType<typeof vi.fn>): Call[] {
  return fetchMock.mock.calls as unknown as Call[];
}

/** How many appointments reads the mock served (initial + each refresh). */
function appointmentReads(fetchMock: ReturnType<typeof vi.fn>): number {
  return calls(fetchMock).filter(
    ([input, init]) =>
      (init?.method ?? "GET") === "GET" &&
      resolveRequestUrl(input).startsWith("/api/portal/appointments")
  ).length;
}

/**
 * Fetch double that answers the reads and writes the appointments page makes by
 * URL. `appointmentsAfter`, when given, is served from the SECOND appointments
 * read onward so a post-mutation refresh is observable. Availability and pets
 * are deliberately NOT routable by default: the fetch-count test asserts the
 * page never probes them just to render the list.
 */
function routeFetch(routes: {
  readonly appointments: Route;
  readonly appointmentsAfter?: Route;
  readonly bookings?: Route;
  readonly availability?: Route;
  readonly cancel?: Route;
  readonly move?: Route;
}): ReturnType<typeof vi.fn> {
  let appointmentsReadCount = 0;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/portal/availability")) {
      const availability = routes.availability ?? { body: AVAILABILITY };
      return Promise.resolve(jsonResponse(availability.body, availability.status));
    }
    if (method === "POST" && url.includes("/cancel")) {
      const cancel = routes.cancel ?? { body: { error: { code: "NOT_FOUND" } }, status: 404 };
      return Promise.resolve(jsonResponse(cancel.body, cancel.status));
    }
    if (method === "PUT") {
      const move = routes.move ?? { body: { error: { code: "NOT_FOUND" } }, status: 404 };
      return Promise.resolve(jsonResponse(move.body, move.status));
    }
    if (url.startsWith("/api/portal/appointments")) {
      const route =
        appointmentsReadCount > 0 && routes.appointmentsAfter
          ? routes.appointmentsAfter
          : routes.appointments;
      appointmentsReadCount += 1;
      return Promise.resolve(jsonResponse(route.body, route.status));
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

  it("offers cancel and move only for the two states the API accepts", async () => {
    const statuses = [
      "SCHEDULED",
      "CONFIRMED",
      "ARRIVED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ];
    global.fetch = routeFetch({
      appointments: {
        body: envelope(statuses.map((status, i) => appointment(`appt-${i}`, status))),
      },
    });

    renderView();
    await screen.findByTestId("portal-appointments-list");

    // Exactly the scheduled and confirmed rows offer an action; a decided or
    // finished visit renders nothing, so the UI never offers a guaranteed 409.
    expect(screen.getAllByTestId("portal-appointment-cancel")).toHaveLength(2);
    expect(screen.getAllByTestId("portal-appointment-move")).toHaveLength(2);

    const rows = screen.getAllByTestId("portal-appointment");
    expect(within(rows[0]).queryByTestId("portal-appointment-cancel")).not.toBeNull();
    expect(within(rows[1]).queryByTestId("portal-appointment-cancel")).not.toBeNull();
    for (const index of [2, 3, 4, 5, 6]) {
      expect(within(rows[index]).queryByTestId("portal-appointment-cancel")).toBeNull();
      expect(within(rows[index]).queryByTestId("portal-appointment-move")).toBeNull();
    }
  });

  it("cancels a SCHEDULED appointment and refreshes the stored status", async () => {
    const fetchMock = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED")]) },
      appointmentsAfter: { body: envelope([appointment("appt-1", "CANCELLED")]) },
      cancel: { body: appointment("appt-1", "CANCELLED", "Rex", 2) },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-appointment-cancel"));

    await waitFor(() => {
      const post = calls(fetchMock).find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      expect(resolveRequestUrl(post![0])).toBe("/api/portal/appointments/appt-1/cancel");
    });

    // The list refreshes to the stored status AND the action reports success.
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(await screen.findByTestId("portal-appointment-cancel-success")).toHaveTextContent(
      "Appointment cancelled."
    );
    expect(appointmentReads(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it("maps a cancel 409 to the changed-appointment copy and refreshes", async () => {
    const fetchMock = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED")]) },
      appointmentsAfter: { body: envelope([appointment("appt-1", "CONFIRMED")]) },
      cancel: {
        body: {
          error: { code: "CONFLICT", message: "Cannot cancel an appointment in status COMPLETED." },
        },
        status: 409,
      },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-appointment-cancel"));

    const alert = await screen.findByTestId("portal-appointment-cancel-error");
    expect(alert).toHaveAttribute("role", "alert");
    // The command checks state and version, so the copy may name a change.
    expect(alert).toHaveTextContent("may have already changed");
    expect(alert).toHaveTextContent("refreshed");
    expect(alert).not.toHaveTextContent("Cannot cancel an appointment in status COMPLETED.");

    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(appointmentReads(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it("moves an appointment with the shared picker and the appointment version", async () => {
    const fetchMock = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED", "Rex", 3)]) },
      appointmentsAfter: { body: envelope([appointment("appt-1", "SCHEDULED", "Rex", 4)]) },
      availability: { body: AVAILABILITY },
      move: {
        body: {
          id: "appt-1",
          patientId: REX_ID,
          status: "SCHEDULED",
          startAt: SLOT.startAt,
          endAt: SLOT.endAt,
          version: 4,
        },
      },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-appointment-move"));

    // The move flow reuses the extracted picker, not a second slot grid.
    expect(await screen.findByTestId("portal-slot-picker")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("portal-slot"));

    await waitFor(() => {
      const put = calls(fetchMock).find(([, init]) => init?.method === "PUT");
      expect(put).toBeDefined();
      expect(resolveRequestUrl(put![0])).toBe("/api/portal/appointments/appt-1");
      // The chosen slot's exact instants AND the last-read version go out;
      // without `version` the API cannot accept the move.
      expect(JSON.parse(put![1].body as string)).toEqual({
        startAt: SLOT.startAt,
        endAt: SLOT.endAt,
        version: 3,
      });
    });

    expect(await screen.findByTestId("portal-appointment-move-success")).toHaveTextContent(
      "Appointment moved."
    );
    expect(appointmentReads(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it("maps a move 409 to the slot-or-version copy and refreshes", async () => {
    const fetchMock = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED", "Rex", 1)]) },
      appointmentsAfter: { body: envelope([appointment("appt-1", "SCHEDULED", "Rex", 2)]) },
      availability: { body: AVAILABILITY },
      move: {
        body: {
          error: { code: "CONFLICT", message: "The appointment was updated by another writer." },
        },
        status: 409,
      },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-appointment-move"));
    fireEvent.click(await screen.findByTestId("portal-slot"));

    const alert = await screen.findByTestId("portal-appointment-move-error");
    expect(alert).toHaveAttribute("role", "alert");
    // The move command checks both availability and the version, so both known
    // causes may be named.
    expect(alert).toHaveTextContent("may no longer be free");
    expect(alert).toHaveTextContent("may have changed");
    expect(alert).not.toHaveTextContent("The appointment was updated by another writer.");
    // The failed move leaves the row actionable and the picker open to retry.
    expect(screen.getByTestId("portal-appointment-move")).toBeEnabled();
    expect(screen.getByTestId("portal-slot-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("portal-appointment-move-success")).toBeNull();
    expect(appointmentReads(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it("leaves the row actionable after a failed cancellation", async () => {
    const fetchMock = routeFetch({
      appointments: { body: envelope([appointment("appt-1", "SCHEDULED")]) },
      cancel: { body: { error: { code: "INTERNAL", message: "boom" } }, status: 500 },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-appointment-cancel"));

    expect(await screen.findByTestId("portal-appointment-cancel-error")).toHaveAttribute(
      "role",
      "alert"
    );
    // Not settled: the holder can retry instead of the row looking done.
    expect(screen.getByTestId("portal-appointment-cancel")).toBeEnabled();
    expect(screen.queryByTestId("portal-appointment-cancel-success")).toBeNull();
  });
});
