import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Agenda } from "./agenda";
import type { Appointment, AppointmentStatus, BookingRequest } from "./agenda-api";

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const PATIENT_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_BRANCH_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";

const APPOINTMENT: Appointment = {
  id: APPOINTMENT_ID,
  tenantId: "tenant-a",
  branchId: BRANCH_ID,
  patientId: PATIENT_ID,
  professionalMembershipId: MEMBERSHIP_ID,
  status: "SCHEDULED",
  startAt: "2026-09-14T12:00:00.000Z",
  endAt: "2026-09-14T12:30:00.000Z",
  version: 1,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

const BOOKING_REQUEST: BookingRequest = {
  id: REQUEST_ID,
  patientId: PATIENT_ID,
  status: "PENDING",
  startAt: "2026-09-14T15:00:00.000Z",
  endAt: "2026-09-14T15:30:00.000Z",
};

const AVAILABILITY_WINDOW = {
  membershipId: MEMBERSHIP_ID,
  branchId: BRANCH_ID,
  weekday: 1,
  startMinute: 9 * 60,
  endMinute: 13 * 60,
} as const;

const AVAILABILITY_BLOCK = {
  membershipId: MEMBERSHIP_ID,
  branchId: BRANCH_ID,
  startsAt: "2026-09-14T13:00:00.000Z",
  endsAt: "2026-09-14T14:00:00.000Z",
} as const;

const AVAILABILITY_HINT =
  "Select a branch and a professional to shade the times outside their working hours, plus their one-off blocks.";
const AVAILABILITY_UNAVAILABLE =
  "Availability for this professional and branch could not be loaded, so nothing is shaded. The calendar may show times outside their working hours.";

function schedulingSettingsResponse(
  availability: readonly unknown[],
  blocks: readonly unknown[]
): Response {
  return jsonResponse({ settings: { conflictPolicy: "REJECT", availability, blocks } });
}

interface CalendarStubEvent {
  readonly id?: string;
  readonly start?: string;
  readonly end?: string;
}

interface CalendarStubProps {
  readonly initialView?: string;
  readonly events?: readonly CalendarStubEvent[];
  readonly businessHours?: unknown;
  readonly eventDrop?: (arg: unknown) => void;
  readonly eventResize?: (arg: unknown) => void;
  readonly eventClick?: (arg: unknown) => void;
  readonly select?: (arg: unknown) => void;
}

let latestCalendarProps: CalendarStubProps | null = null;
const changeViewMock = vi.fn();
const gotoDateMock = vi.fn();

/**
 * The approved FullCalendar React component is replaced with a deterministic
 * stub. Tests exercise our integration (event mapping, drop/resize normalization,
 * view wiring) and never claim coverage of FullCalendar's own drag/resize internals.
 */
vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");
  const Stub = React.forwardRef<unknown, CalendarStubProps>(function FullCalendarStub(props, ref) {
    latestCalendarProps = props;
    React.useImperativeHandle(ref, () => ({
      getApi: () => ({ changeView: changeViewMock, gotoDate: gotoDateMock }),
    }));
    return React.createElement("div", {
      "data-testid": "fullcalendar",
      "data-view": props.initialView,
    });
  });
  return { default: Stub };
});

function TestWrapper({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

function requestMethod(call: unknown): string {
  const [, init] = call as [RequestInfo | URL, RequestInit | undefined];
  return init?.method ?? "GET";
}

interface FetchHandlers {
  readonly appointments?: (url: string) => Response | Promise<Response>;
  readonly options?: () => Response | Promise<Response>;
  readonly settings?: () => Response | Promise<Response>;
  readonly appointment?: () => Response | Promise<Response>;
  readonly reschedule?: () => Response | Promise<Response>;
  readonly transition?: () => Response | Promise<Response>;
  readonly bookingRequests?: () => Response | Promise<Response>;
  readonly approve?: () => Response | Promise<Response>;
  readonly reject?: () => Response | Promise<Response>;
}

const APPOINTMENT_DETAIL = /\/appointments\/[0-9a-f-]{36}$/;

function mockAgendaFetch(handlers: FetchHandlers): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    if (url.includes("/api/settings/scheduling")) {
      return Promise.resolve(
        handlers.settings?.() ??
          jsonResponse({ settings: { conflictPolicy: "REJECT", availability: [], blocks: [] } })
      );
    }
    if (url.includes("/appointments/options")) {
      return Promise.resolve(
        handlers.options?.() ?? jsonResponse({ branches: [], professionals: [] })
      );
    }
    if (url.includes("/booking-requests")) {
      if (method === "POST" && url.endsWith("/approve")) {
        return Promise.resolve(handlers.approve?.() ?? jsonResponse(APPOINTMENT));
      }
      if (method === "POST" && url.endsWith("/reject")) {
        return Promise.resolve(
          handlers.reject?.() ?? jsonResponse({ ...BOOKING_REQUEST, status: "REJECTED" })
        );
      }
      return Promise.resolve(handlers.bookingRequests?.() ?? jsonResponse([]));
    }
    if (method === "PUT" && APPOINTMENT_DETAIL.test(url)) {
      return Promise.resolve(
        handlers.reschedule?.() ?? jsonResponse({ ...APPOINTMENT, version: 2 })
      );
    }
    if (method === "GET" && APPOINTMENT_DETAIL.test(url)) {
      return Promise.resolve(handlers.appointment?.() ?? jsonResponse(APPOINTMENT));
    }
    if (method === "POST" && url.includes("/appointments")) {
      return Promise.resolve(handlers.transition?.() ?? jsonResponse(APPOINTMENT));
    }
    if (url.includes("/appointments")) {
      return Promise.resolve(handlers.appointments?.(url) ?? jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND", message: "nf" } }, 404));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function optionsResponse(): Response {
  return jsonResponse({
    branches: [{ id: BRANCH_ID, name: "Main" }],
    professionals: [{ membershipId: MEMBERSHIP_ID }],
  });
}

function renderAgenda(): void {
  render(
    <TestWrapper>
      <Agenda />
    </TestWrapper>
  );
}

async function openManagePanel(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "List" }));
  fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
}

async function openRequestPanel(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "List" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
}

describe("Agenda", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    changeViewMock.mockClear();
    gotoDateMock.mockClear();
    latestCalendarProps = null;
  });

  it("renders the loading state while the appointment query is in flight", async () => {
    mockAgendaFetch({
      appointments: () =>
        new Promise<Response>(() => {
          // Intentionally never resolves: keeps the query in its loading state.
        }),
    });
    renderAgenda();

    expect(await screen.findByText("Loading agenda...")).toBeInTheDocument();
  });

  it("renders the empty state when the tenant has no appointments", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([]) });
    renderAgenda();

    expect(await screen.findByText("No appointments")).toBeInTheDocument();
  });

  it("renders the error state for a non-permission failure", async () => {
    mockAgendaFetch({
      appointments: () =>
        jsonResponse({ error: { code: "INTERNAL", message: "Something went wrong." } }, 500),
    });
    renderAgenda();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  it("renders a permission-denied state without appointment data", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });
    renderAgenda();

    expect(
      await screen.findByText("You do not have permission to view the agenda.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  });

  it("refetches the agenda scoped to the selected branch filter", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    const branchFilter = await screen.findByLabelText("Branch filter");
    await screen.findByRole("option", { name: "Main" });

    fireEvent.change(branchFilter, { target: { value: BRANCH_ID } });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          resolveRequestUrl(call[0] as RequestInfo).includes(`branchId=${BRANCH_ID}`)
        )
      ).toBe(true);
    });
  });

  it("refetches for the selected professional filter and renders only that professional", async () => {
    const other: Appointment = {
      ...APPOINTMENT,
      id: "77777777-7777-4777-8777-777777777777",
      professionalMembershipId: OTHER_MEMBERSHIP_ID,
    };
    const fetchMock = mockAgendaFetch({
      appointments: (url) =>
        jsonResponse(
          url.includes(`professionalMembershipId=${MEMBERSHIP_ID}`)
            ? [APPOINTMENT]
            : [APPOINTMENT, other]
        ),
      options: () =>
        jsonResponse({
          branches: [{ id: BRANCH_ID, name: "Main" }],
          professionals: [{ membershipId: MEMBERSHIP_ID }, { membershipId: OTHER_MEMBERSHIP_ID }],
        }),
    });
    renderAgenda();

    // The accessible list makes each rendered row's professional observable.
    fireEvent.click(await screen.findByRole("button", { name: "List" }));
    expect(await screen.findByText("Main · Professional 44444444")).toBeInTheDocument();
    expect(screen.getByText("Main · Professional 55555555")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Professional filter"), {
      target: { value: MEMBERSHIP_ID },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          resolveRequestUrl(call[0] as RequestInfo).includes(
            `professionalMembershipId=${MEMBERSHIP_ID}`
          )
        )
      ).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByText("Main · Professional 55555555")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Main · Professional 44444444")).toBeInTheDocument();
  });

  it("refetches for the selected status filter and renders only that status", async () => {
    const confirmed: Appointment = {
      ...APPOINTMENT,
      id: "88888888-8888-4888-8888-888888888888",
      branchId: OTHER_BRANCH_ID,
      status: "CONFIRMED",
    };
    const fetchMock = mockAgendaFetch({
      appointments: (url) =>
        jsonResponse(url.includes("status=CONFIRMED") ? [confirmed] : [APPOINTMENT, confirmed]),
      options: () =>
        jsonResponse({
          branches: [
            { id: BRANCH_ID, name: "Main" },
            { id: OTHER_BRANCH_ID, name: "North" },
          ],
          professionals: [{ membershipId: MEMBERSHIP_ID }],
        }),
    });
    renderAgenda();

    fireEvent.click(await screen.findByRole("button", { name: "List" }));
    expect(await screen.findByText("Main · Professional 44444444")).toBeInTheDocument();
    expect(screen.getByText("North · Professional 44444444")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Status filter"), {
      target: { value: "CONFIRMED" },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          resolveRequestUrl(call[0] as RequestInfo).includes("status=CONFIRMED")
        )
      ).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByText("Main · Professional 44444444")).not.toBeInTheDocument()
    );
    expect(screen.getByText("North · Professional 44444444")).toBeInTheDocument();
  });

  it("switches the FullCalendar view and falls back to the accessible list", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    expect(latestCalendarProps?.initialView).toBe("timeGridDay");

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(changeViewMock).toHaveBeenCalledWith("dayGridMonth"));

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => expect(changeViewMock).toHaveBeenCalledWith("timeGridWeek"));

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("button", { name: "Manage" })).toBeInTheDocument();
  });

  it("renders the appointment as a calendar event", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    await screen.findByTestId("fullcalendar");

    expect(latestCalendarProps?.events).toEqual([
      {
        id: APPOINTMENT_ID,
        title: "SCHEDULED",
        start: APPOINTMENT.startAt,
        end: APPOINTMENT.endAt,
        allDay: false,
      },
    ]);
  });

  it("shows the availability hint and shades nothing until a branch and professional are selected", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => schedulingSettingsResponse([AVAILABILITY_WINDOW], [AVAILABILITY_BLOCK]),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    expect(await screen.findByText(AVAILABILITY_HINT)).toBeInTheDocument();
    // No concrete pair is selected, so the overlay is hidden: nothing shaded.
    expect(latestCalendarProps?.businessHours).toBe(false);
  });

  it("shades the selected professional's availability and one-off block once both filters are set", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => schedulingSettingsResponse([AVAILABILITY_WINDOW], [AVAILABILITY_BLOCK]),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    fireEvent.change(await screen.findByLabelText("Branch filter"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Professional filter"), {
      target: { value: MEMBERSHIP_ID },
    });

    await waitFor(() =>
      expect(latestCalendarProps?.businessHours).toEqual([
        { daysOfWeek: [1], startTime: "09:00", endTime: "13:00" },
      ])
    );
    expect(latestCalendarProps?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "availability-block:0",
          display: "background",
          start: AVAILABILITY_BLOCK.startsAt,
          end: AVAILABILITY_BLOCK.endsAt,
        }),
      ])
    );
    expect(screen.queryByText(AVAILABILITY_HINT)).not.toBeInTheDocument();
  });

  it("shades nothing when the selected pair has no availability windows (unrestricted)", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => schedulingSettingsResponse([], []),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    fireEvent.change(await screen.findByLabelText("Branch filter"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Professional filter"), {
      target: { value: MEMBERSHIP_ID },
    });

    // The pair is configured in no way at all, so the write path is
    // unrestricted and the overlay must not shade a single minute.
    await waitFor(() => expect(latestCalendarProps?.businessHours).toBe(false));
    expect(latestCalendarProps?.events).toEqual([expect.objectContaining({ id: APPOINTMENT_ID })]);
  });

  it("warns, without blocking, when the selected pair's settings read fails", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    fireEvent.change(await screen.findByLabelText("Branch filter"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Professional filter"), {
      target: { value: MEMBERSHIP_ID },
    });

    // Nothing is shaded because the hours are unknown — the SAME canvas as an
    // unrestricted pair — and the warning is what tells the two apart.
    expect(await screen.findByTestId("availability-warning")).toHaveTextContent(
      AVAILABILITY_UNAVAILABLE
    );
    expect(latestCalendarProps?.businessHours).toBe(false);
    expect(screen.queryByTestId("availability-hint")).toBeNull();
    // Information, not a barrier: the calendar and its controls stay usable.
    expect(screen.getByTestId("fullcalendar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New appointment" })).toBeEnabled();
  });

  it("treats a malformed settings namespace as unavailable, not as unrestricted", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => jsonResponse({ settings: {} }),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    fireEvent.change(await screen.findByLabelText("Branch filter"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Professional filter"), {
      target: { value: MEMBERSHIP_ID },
    });

    expect(await screen.findByTestId("availability-warning")).toHaveTextContent(
      AVAILABILITY_UNAVAILABLE
    );
    expect(latestCalendarProps?.businessHours).toBe(false);
  });

  it("shows the pick-a-pair hint, not the unavailable warning, when settings fail with no pair", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");

    // No pair selected: the hint is the honest message even though the read also
    // failed, because the overlay was never going to render without a pair.
    expect(await screen.findByTestId("availability-hint")).toHaveTextContent(AVAILABILITY_HINT);
    expect(screen.queryByTestId("availability-warning")).toBeNull();
  });

  it("reschedules from a FullCalendar drop using the optimistic version", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    act(() => {
      latestCalendarProps?.eventDrop?.({
        event: {
          id: APPOINTMENT_ID,
          start: new Date("2026-09-14T13:00:00.000Z"),
          end: new Date("2026-09-14T13:30:00.000Z"),
        },
        revert: vi.fn(),
      });
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => requestMethod(call) === "PUT")).toBe(true);
    });
    const putCall = fetchMock.mock.calls.find((call) => requestMethod(call) === "PUT");
    const body = JSON.parse(String((putCall?.[1] as { body: string }).body)) as {
      version: number;
      startAt: string;
    };
    expect(body.version).toBe(1);
    expect(body.startAt).toBe("2026-09-14T13:00:00.000Z");
  });

  it("opens the create form prefilled from a calendar time-range selection", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    act(() => {
      latestCalendarProps?.select?.({
        start: new Date("2026-09-15T13:00:00.000Z"),
        end: new Date("2026-09-15T13:45:00.000Z"),
        allDay: false,
      });
    });

    expect(await screen.findByRole("heading", { name: "New appointment" })).toBeInTheDocument();
    // America/Asuncion is UTC-3 in September, so 13:00Z is 10:00 tenant wall time.
    expect(screen.getByLabelText<HTMLInputElement>("Start").value).toBe("2026-09-15T10:00");
    expect(screen.getByLabelText<HTMLInputElement>("End").value).toBe("2026-09-15T10:45");
  });

  it("reschedules an appointment with its optimistic version from the Manage form", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    await openManagePanel();

    const start = await screen.findByLabelText("Start");
    fireEvent.change(start, { target: { value: "2026-09-14T08:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reschedule" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) => {
          const [, init] = call as unknown as [RequestInfo, RequestInit | undefined];
          return (
            init?.method === "PUT" &&
            resolveRequestUrl(call[0] as RequestInfo).includes(`/appointments/${APPOINTMENT_ID}`)
          );
        })
      ).toBe(true);
    });

    const putCall = fetchMock.mock.calls.find((call) => {
      const [, init] = call as unknown as [RequestInfo, RequestInit | undefined];
      return init?.method === "PUT";
    });
    const body = JSON.parse((putCall?.[1] as unknown as { body: string }).body) as {
      version: number;
      startAt: string;
    };
    expect(body.version).toBe(1);
    expect(body.startAt.endsWith("Z")).toBe(true);
  });

  it("runs a named lifecycle command from the manage panel", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    await openManagePanel();
    fireEvent.click(await screen.findByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            resolveRequestUrl(call[0] as RequestInfo) ===
              `/api/scheduling/appointments/${APPOINTMENT_ID}/confirm` &&
            (call[1] as unknown as RequestInit | undefined)?.method === "POST"
        )
      ).toBe(true);
    });
  });

  it("refreshes the state and explains a stale-version 409 distinctly from an overlap", async () => {
    const stale: Appointment = {
      ...APPOINTMENT,
      version: 2,
      startAt: "2026-09-14T13:00:00.000Z",
      endAt: "2026-09-14T13:30:00.000Z",
    };
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      reschedule: () =>
        jsonResponse(
          {
            error: { code: "CONFLICT", message: "The appointment was updated by another writer." },
          },
          409
        ),
      appointment: () => jsonResponse(stale),
    });
    renderAgenda();

    await openManagePanel();
    fireEvent.change(await screen.findByLabelText("Start"), {
      target: { value: "2026-09-14T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reschedule" }));

    expect(await screen.findByTestId("stale-version-alert")).toHaveTextContent(
      "changed by another staff member"
    );
    // The client re-read the appointment to confirm the version actually moved.
    expect(fetchMock.mock.calls.some((call) => requestMethod(call) === "GET")).toBe(true);
  });

  it("keeps the overlap message when the stored version did not change", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      reschedule: () =>
        jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "The professional already has an overlapping appointment.",
            },
          },
          409
        ),
      appointment: () => jsonResponse(APPOINTMENT),
    });
    renderAgenda();

    await openManagePanel();
    fireEvent.change(await screen.findByLabelText("Start"), {
      target: { value: "2026-09-14T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reschedule" }));

    expect(
      await screen.findByText(
        "That time overlaps another appointment or falls outside availability."
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stale-version-alert")).not.toBeInTheDocument();
  });

  it("renders a pending request as a distinct, non-editable calendar layer", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    expect(latestCalendarProps?.events).toEqual([
      {
        id: APPOINTMENT_ID,
        title: "SCHEDULED",
        start: APPOINTMENT.startAt,
        end: APPOINTMENT.endAt,
        allDay: false,
      },
      {
        id: `booking-request:${REQUEST_ID}`,
        title: "REQUEST",
        start: BOOKING_REQUEST.startAt,
        end: BOOKING_REQUEST.endAt,
        allDay: false,
        editable: false,
        extendedProps: { kind: "booking-request" },
      },
    ]);
  });

  it("keeps the calendar visible when there are pending requests but no appointments", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    expect(latestCalendarProps?.events).toEqual([
      {
        id: `booking-request:${REQUEST_ID}`,
        title: "REQUEST",
        start: BOOKING_REQUEST.startAt,
        end: BOOKING_REQUEST.endAt,
        allDay: false,
        editable: false,
        extendedProps: { kind: "booking-request" },
      },
    ]);
    expect(screen.queryByText("No appointments")).not.toBeInTheDocument();
  });

  it("opens approve and reject from a pending request calendar event", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    act(() => {
      latestCalendarProps?.eventClick?.({ event: { id: `booking-request:${REQUEST_ID}` } });
    });

    expect(
      await screen.findByRole("heading", { name: "Pending booking request" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeInTheDocument();
  });

  it("shows the pending request distinctly from every appointment status in the list view", async () => {
    const statuses: readonly AppointmentStatus[] = [
      "SCHEDULED",
      "CONFIRMED",
      "ARRIVED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ];
    const everyStatus = statuses.map((status, index) => ({
      ...APPOINTMENT,
      id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${String(index).padStart(2, "0")}`,
      status,
    }));
    mockAgendaFetch({
      appointments: () => jsonResponse(everyStatus),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
    });
    renderAgenda();

    fireEvent.click(await screen.findByRole("button", { name: "List" }));

    const row = await screen.findByTestId("pending-request-row");
    expect(within(row).getByTestId("request-badge")).toHaveTextContent("Request");
    expect(row.className).toContain("border-dashed");
    // Exactly one request badge, and no appointment row shares the dashed layer.
    expect(screen.getAllByTestId("request-badge")).toHaveLength(1);
    for (const manage of screen.getAllByRole("button", { name: "Manage" })) {
      expect(manage.closest("li")?.className).not.toContain("border-dashed");
    }
  });

  it("renders the empty pending-request state without an error", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    expect(await screen.findByText("No pending booking requests.")).toBeInTheDocument();
    expect(screen.queryByTestId("pending-requests-alert")).not.toBeInTheDocument();
  });

  it("renders a permission-denied state for the pending layer", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });
    renderAgenda();

    const alert = await screen.findByTestId("pending-requests-alert");
    expect(alert).toHaveAttribute("data-state", "denied");
    expect(alert).toHaveTextContent("You do not have permission to decide booking requests.");
  });

  it("approves a pending request from the agenda and refreshes the pending layer", async () => {
    let decided = false;
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse(decided ? [] : [BOOKING_REQUEST]),
      approve: () => {
        decided = true;
        return jsonResponse(APPOINTMENT);
      },
    });
    renderAgenda();

    await openRequestPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve request" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            resolveRequestUrl(call[0] as RequestInfo) ===
              `/api/scheduling/booking-requests/${REQUEST_ID}/approve` &&
            requestMethod(call) === "POST"
        )
      ).toBe(true);
    });
    const approveCall = fetchMock.mock.calls.find((call) =>
      resolveRequestUrl(call[0] as RequestInfo).endsWith("/approve")
    );
    expect(JSON.parse((approveCall?.[1] as unknown as { body: string }).body)).toEqual({
      branchId: BRANCH_ID,
      professionalMembershipId: MEMBERSHIP_ID,
    });
    await waitFor(() =>
      expect(screen.queryByTestId("pending-request-row")).not.toBeInTheDocument()
    );
    expect(await screen.findByText("Booking request approved.")).toBeInTheDocument();
  });

  it("rejects a pending request from the agenda and refreshes the pending layer", async () => {
    let decided = false;
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse(decided ? [] : [BOOKING_REQUEST]),
      reject: () => {
        decided = true;
        return jsonResponse({ ...BOOKING_REQUEST, status: "REJECTED" });
      },
    });
    renderAgenda();

    await openRequestPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Reject request" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            resolveRequestUrl(call[0] as RequestInfo) ===
              `/api/scheduling/booking-requests/${REQUEST_ID}/reject` &&
            requestMethod(call) === "POST"
        )
      ).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("pending-request-row")).not.toBeInTheDocument()
    );
    expect(await screen.findByText("Booking request rejected.")).toBeInTheDocument();
  });

  it("keeps a request visible with non-committal copy and refreshes both layers on a 409", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
      approve: () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "Overlaps another appointment." } },
          409
        ),
    });
    renderAgenda();

    await openRequestPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve request" }));

    expect(
      await screen.findByText(
        "The request could not be decided as it stands: the slot may no longer be free, or the request may already have been decided. The latest state is being refreshed."
      )
    ).toBeInTheDocument();
    // Still pending: the request stays in the layer and the panel stays open.
    expect(screen.getByTestId("pending-request-row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve request" })).toBeInTheDocument();

    // The 409 re-reads reality instead of guessing a cause: both layers refetch.
    await waitFor(() => {
      const requestsGets = fetchMock.mock.calls.filter(
        (call) =>
          resolveRequestUrl(call[0] as RequestInfo).endsWith("/booking-requests") &&
          requestMethod(call) === "GET"
      );
      const appointmentsGets = fetchMock.mock.calls.filter(
        (call) =>
          resolveRequestUrl(call[0] as RequestInfo).endsWith("/appointments") &&
          requestMethod(call) === "GET"
      );
      expect(requestsGets.length).toBeGreaterThanOrEqual(2);
      expect(appointmentsGets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("removes a request from the pending layer when a 409 refresh shows it already decided", async () => {
    let decided = false;
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse(decided ? [] : [BOOKING_REQUEST]),
      approve: () => {
        // The concurrent decision already landed before the refresh read the data.
        decided = true;
        return jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "Only a pending booking request can be approved or rejected.",
            },
          },
          409
        );
      },
    });
    renderAgenda();

    await openRequestPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve request" }));

    await waitFor(() =>
      expect(screen.queryByTestId("pending-request-row")).not.toBeInTheDocument()
    );
    // The stale panel is closed, not left open contradicting the refreshed data.
    expect(
      screen.queryByRole("heading", { name: "Pending booking request" })
    ).not.toBeInTheDocument();
  });

  it("blocks a half-supplied slot override and sends both times when supplied", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
    });
    renderAgenda();

    await openRequestPanel();
    fireEvent.change(screen.getByLabelText("Override start"), {
      target: { value: "2026-09-14T18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(
      await screen.findByText("Enter both override times or leave them empty.")
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((call) =>
        resolveRequestUrl(call[0] as RequestInfo).endsWith("/approve")
      )
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Override end"), {
      target: { value: "2026-09-14T18:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          resolveRequestUrl(call[0] as RequestInfo).endsWith("/approve")
        )
      ).toBe(true);
    });
    const approveCall = fetchMock.mock.calls.find((call) =>
      resolveRequestUrl(call[0] as RequestInfo).endsWith("/approve")
    );
    const body = JSON.parse((approveCall?.[1] as unknown as { body: string }).body) as {
      startAt: string;
      endAt: string;
    };
    // America/Asuncion is UTC-3 in September, so 18:00 local is 21:00Z.
    expect(body.startAt).toBe("2026-09-14T21:00:00.000Z");
    expect(body.endAt).toBe("2026-09-14T21:30:00.000Z");
  });
});
