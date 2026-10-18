import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalBookingGrid } from "./portal-booking-grid";

const SLUG = "acme-clinic";
const PET_ID = "11111111-1111-4111-8111-111111111111";

/** One slot as the availability read returns it: `Z`-suffixed UTC instants. */
const SLOT = {
  startAt: "2026-06-15T13:00:00.000Z",
  endAt: "2026-06-15T13:30:00.000Z",
};

const AVAILABILITY = {
  date: "2026-06-15",
  timeZone: "America/Asuncion",
  durationMinutes: 30,
  stepMinutes: 30,
  slots: [SLOT],
};

/** A created PENDING request as the API returns it. */
const CREATED = { ...SLOT, id: "booking-1", patientId: PET_ID, status: "PENDING" };

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

type Call = [RequestInfo | URL, RequestInit];

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): Call[] {
  return fetchMock.mock.calls as unknown as Call[];
}

/** The one `POST /bookings` call among the mocked requests, if any. */
function bookingCall(fetchMock: ReturnType<typeof vi.fn>): Call | undefined {
  return fetchCalls(fetchMock).find(([, init]) => init?.method === "POST");
}

/** A fetch double that answers availability and the booking POST by URL. */
function availabilityAndBooking(
  availability: unknown,
  booking: { readonly body: unknown; readonly status: number }
): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) =>
    resolveRequestUrl(input).startsWith("/api/portal/availability")
      ? Promise.resolve(jsonResponse(availability))
      : Promise.resolve(jsonResponse(booking.body, booking.status))
  );
}

function renderGrid(): void {
  render(
    <TestWrapper>
      <PortalBookingGrid slug={SLUG} petId={PET_ID} />
    </TestWrapper>
  );
}

describe("PortalBookingGrid", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state while the availability read is in flight", () => {
    // A never-resolving read keeps the query in its loading state.
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderGrid();

    expect(screen.getByTestId("portal-booking-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("treats a day with no slots as a normal empty state, never an error", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ ...AVAILABILITY, slots: [] })));

    renderGrid();

    expect(await screen.findByTestId("portal-booking-empty")).toBeInTheDocument();
    expect(screen.getByText("No available times")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders only the returned slots and submits the selected slot's exact instants", async () => {
    const fetchMock = availabilityAndBooking(AVAILABILITY, { body: CREATED, status: 201 });
    global.fetch = fetchMock;

    renderGrid();

    const slot = await screen.findByTestId("portal-slot");
    // The booking flow and the appointment-move flow share ONE picker.
    expect(screen.getByTestId("portal-slot-picker")).toBeInTheDocument();
    // The clinic-local time of the returned instant (Asuncion = UTC-3).
    expect(slot).toHaveTextContent("10:00");
    fireEvent.click(slot);

    await waitFor(() => {
      const call = bookingCall(fetchMock);
      expect(call).toBeDefined();
      const [input, init] = call!;
      expect(resolveRequestUrl(input)).toBe(`/api/portal/pets/${PET_ID}/bookings`);
      expect(init.method).toBe("POST");
      // The exact slot the API offered is what is submitted — nothing resampled.
      expect(JSON.parse(init.body as string)).toEqual({
        startAt: SLOT.startAt,
        endAt: SLOT.endAt,
      });
    });

    expect(await screen.findByTestId("portal-booking-success")).toBeInTheDocument();
  });

  it("uses the chosen duration for both the availability query and the submission", async () => {
    const fetchMock = availabilityAndBooking(
      { ...AVAILABILITY, durationMinutes: 15, stepMinutes: 15 },
      { body: CREATED, status: 201 }
    );
    global.fetch = fetchMock;

    renderGrid();
    await screen.findByTestId("portal-slot");

    fireEvent.change(screen.getByTestId("portal-booking-duration"), { target: { value: "15" } });

    await waitFor(() => {
      const urls = fetchCalls(fetchMock).map(([input]) => resolveRequestUrl(input));
      expect(urls.some((url) => url.endsWith("durationMinutes=15&stepMinutes=15"))).toBe(true);
    });

    // The new query key refetches, so wait for the grid to settle before
    // selecting the slot from the re-rendered response.
    const slot = await screen.findByTestId("portal-slot");
    fireEvent.click(slot);
    await waitFor(() => {
      const call = bookingCall(fetchMock);
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body as string)).toEqual({
        startAt: SLOT.startAt,
        endAt: SLOT.endAt,
      });
    });
  });

  it("tells the truth on success: PENDING, not confirmed, and points at the requests view", async () => {
    global.fetch = availabilityAndBooking(AVAILABILITY, { body: CREATED, status: 201 });

    renderGrid();
    fireEvent.click(await screen.findByTestId("portal-slot"));

    const success = await screen.findByTestId("portal-booking-success");
    expect(success).toHaveTextContent(/pending/i);
    expect(success).toHaveTextContent(/not confirmed yet/i);
    // The old copy claimed there was no way to check; there is one now.
    expect(success).not.toHaveTextContent(/no way to check/i);
    expect(success).toHaveTextContent(/booking requests/i);
    expect(screen.getByTestId("portal-booking-requests-link")).toHaveAttribute(
      "href",
      "/acme-clinic/appointments"
    );
    // Never promise a confirmation that does not exist.
    expect(success).not.toHaveTextContent(/confirmed appointment/i);
  });

  it("maps a 409 submission failure to cause-neutral copy and never echoes the server", async () => {
    global.fetch = availabilityAndBooking(AVAILABILITY, {
      body: { error: { code: "CONFLICT", message: "slot already taken upstream" } },
      status: 409,
    });

    renderGrid();
    fireEvent.click(await screen.findByTestId("portal-slot"));

    const alert = await screen.findByTestId("portal-booking-submit-error");
    expect(alert).toHaveAttribute("role", "alert");
    // The create command performs no conflict check today, so the copy names no
    // cause at all rather than a wrong one.
    expect(alert).not.toHaveTextContent(/taken/i);
    expect(alert).not.toHaveTextContent(/decided/i);
    expect(alert).toHaveTextContent(/refresh/i);
    expect(alert).not.toHaveTextContent("slot already taken upstream");
  });

  it("maps a 404 submission failure to the same neutral not-found copy", async () => {
    global.fetch = availabilityAndBooking(AVAILABILITY, {
      body: { error: { code: "NOT_FOUND", message: "pet not found upstream" } },
      status: 404,
    });

    renderGrid();
    fireEvent.click(await screen.findByTestId("portal-slot"));

    const alert = await screen.findByTestId("portal-booking-submit-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/may not exist/i);
    expect(alert).toHaveTextContent(/may not be linked to your account/i);
    expect(alert).not.toHaveTextContent("pet not found upstream");
  });

  it("renders a denied state when the availability read is refused", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "nope" } }, 403))
    );

    renderGrid();

    const denied = await screen.findByTestId("portal-booking-denied");
    expect(denied).toHaveAttribute("role", "alert");
    expect(denied).toHaveTextContent("You do not have access to this portal.");
  });

  it("links back to the pet without losing the tenant slug", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(AVAILABILITY)));

    renderGrid();
    await screen.findByTestId("portal-slot");

    expect(screen.getByTestId("portal-booking-back")).toHaveAttribute(
      "href",
      `/acme-clinic/pets/${PET_ID}`
    );
  });

  it("keeps a submission failure visible when the holder changes the date", async () => {
    // The FIRST availability read offers a slot; every later read (a date or
    // duration change) returns an EMPTY day, so the grid leaves the "has slots"
    // state while the earlier submission error is on screen.
    let availabilityReads = 0;
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({ error: { code: "CONFLICT", message: "slot already taken upstream" } }, 409)
        );
      }
      availabilityReads += 1;
      return Promise.resolve(
        jsonResponse(availabilityReads > 1 ? { ...AVAILABILITY, slots: [] } : AVAILABILITY)
      );
    });

    renderGrid();
    fireEvent.click(await screen.findByTestId("portal-slot"));
    expect(await screen.findByTestId("portal-booking-submit-error")).toHaveAttribute(
      "role",
      "alert"
    );

    fireEvent.change(screen.getByTestId("portal-booking-date"), {
      target: { value: "1999-01-01" },
    });

    // The reloaded day is empty, yet the submission failure is about the
    // submission, not the date just typed, so it must stay visible while the
    // holder picks a new day. Pinned so it is not silently moved back inside
    // the availability branch by a future "cleanup".
    expect(await screen.findByTestId("portal-booking-empty")).toBeInTheDocument();
    const alert = screen.getByTestId("portal-booking-submit-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(/refresh/i);
  });
});
