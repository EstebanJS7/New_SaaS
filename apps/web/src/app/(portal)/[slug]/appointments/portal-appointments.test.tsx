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
const MILO_ID = "22222222-2222-4222-8222-222222222222";
const UNLISTED_ID = "33333333-3333-4333-8333-333333333333";

const REX = {
  id: REX_ID,
  name: "Rex",
  speciesId: "species-1",
  breedId: null,
  sex: "MALE",
  birthDate: null,
  isActive: true,
};

const MILO = {
  id: MILO_ID,
  name: "Milo",
  speciesId: "species-1",
  breedId: null,
  sex: "UNKNOWN",
  birthDate: null,
  isActive: true,
};

/** Availability shape the zone probe consumes; slots are irrelevant here. */
const AVAILABILITY = {
  date: "2026-06-15",
  timeZone: "America/Asuncion",
  durationMinutes: 30,
  stepMinutes: 30,
  slots: [],
};

const START = "2026-06-15T13:00:00.000Z";
const END = "2026-06-15T13:30:00.000Z";

function appointment(id: string, patientId: string, status: string): Record<string, string> {
  return { id, patientId, status, startAt: START, endAt: END };
}

interface Route {
  readonly body: unknown;
  readonly status?: number;
}

/**
 * Fetch double that answers the three reads by URL. The appointments read is
 * checked first because `/api/portal/pets` is a prefix of nothing it returns,
 * but ordering keeps intent explicit.
 */
function routeFetch(routes: {
  readonly appointments: Route;
  readonly pets: Route;
  readonly availability?: Route;
}): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = resolveRequestUrl(input);
    if (url.startsWith("/api/portal/appointments")) {
      return Promise.resolve(jsonResponse(routes.appointments.body, routes.appointments.status));
    }
    if (url.startsWith("/api/portal/pets")) {
      return Promise.resolve(jsonResponse(routes.pets.body, routes.pets.status));
    }
    if (url.startsWith("/api/portal/availability")) {
      const availability = routes.availability ?? { body: AVAILABILITY };
      return Promise.resolve(jsonResponse(availability.body, availability.status));
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

  it("shows a loading state while the reads are in flight", () => {
    // A never-resolving read keeps the combined query in its loading state.
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderView();

    expect(screen.getByTestId("portal-appointments-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("treats an empty list as a normal state, not an error", async () => {
    global.fetch = routeFetch({ appointments: { body: [] }, pets: { body: [REX] } });

    renderView();

    expect(await screen.findByTestId("portal-appointments-empty")).toBeInTheDocument();
    expect(screen.getByText("No appointments yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("points the empty state at the booking flow and keeps the tenant slug", async () => {
    global.fetch = routeFetch({ appointments: { body: [] }, pets: { body: [REX, MILO] } });

    renderView("acme-clinic");

    expect(await screen.findByTestId("portal-appointments-book-link")).toHaveAttribute(
      "href",
      `/acme-clinic/pets/${REX_ID}/book`
    );
  });

  it("points a pet-less empty state at the pets list, still slug-correct", async () => {
    global.fetch = routeFetch({ appointments: { body: [] }, pets: { body: [] } });

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
      pets: { body: [REX] },
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
      pets: { body: [REX] },
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
      pets: { body: [REX] },
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

  it("joins the pet name by patientId and renders clinic-local slot times", async () => {
    global.fetch = routeFetch({
      appointments: { body: [appointment("appt-1", REX_ID, "SCHEDULED")] },
      pets: { body: [REX, MILO] },
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

    // 13:00Z is 10:00 in America/Asuncion (UTC-3). The explicit clinic zone is
    // what makes this deterministic: a browser-zone render would differ.
    const time = screen.getByTestId("portal-appointment-time");
    expect(time).toHaveTextContent("15 Jun 2026");
    expect(time).toHaveTextContent("10:00");
    expect(time).toHaveTextContent("10:30");

    // No client-side identifier leaks into the row.
    expect(container.textContent).not.toContain(REX_ID);
  });

  it("falls back to a neutral pet label (never an identifier) when the join misses", async () => {
    global.fetch = routeFetch({
      appointments: { body: [appointment("appt-1", UNLISTED_ID, "SCHEDULED")] },
      pets: { body: [REX, MILO] },
    });

    const { container } = render(
      <TestWrapper>
        <PortalAppointmentsView slug="acme-clinic" />
      </TestWrapper>
    );

    const pet = await screen.findByTestId("portal-appointment-pet");
    expect(pet).toHaveTextContent("Unknown pet");
    expect(pet.tagName).toBe("SPAN");
    expect(container.textContent).not.toContain(UNLISTED_ID);
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
        body: cases.map(([status], index) => appointment(`appt-${index}`, REX_ID, status)),
      },
      pets: { body: [REX] },
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
