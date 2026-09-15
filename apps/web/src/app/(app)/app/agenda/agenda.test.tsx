import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Agenda } from "./agenda";
import type { Appointment } from "./agenda-api";

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const PATIENT_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_BRANCH_ID = "66666666-6666-4666-8666-666666666666";

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

interface CalendarStubEvent {
  readonly id?: string;
  readonly start?: string;
  readonly end?: string;
}

interface CalendarStubProps {
  readonly initialView?: string;
  readonly events?: readonly CalendarStubEvent[];
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
  readonly appointment?: () => Response | Promise<Response>;
  readonly reschedule?: () => Response | Promise<Response>;
  readonly transition?: () => Response | Promise<Response>;
}

const APPOINTMENT_DETAIL = /\/appointments\/[0-9a-f-]{36}$/;

function mockAgendaFetch(handlers: FetchHandlers): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    if (url.includes("/appointments/options")) {
      return Promise.resolve(
        handlers.options?.() ?? jsonResponse({ branches: [], professionals: [] })
      );
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
});
