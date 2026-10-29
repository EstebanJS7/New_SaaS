import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Agenda } from "./agenda";
import type { Appointment, AppointmentStatus, BookingRequest } from "./agenda-api";

// jsdom models visibility only; native focus containment is checked in a browser.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

async function selectPatient(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Buscar paciente"), { target: { value: "Bobby" } });
  fireEvent.click(await screen.findByRole("radio", { name: /Bobby/ }));
}

async function clickConsequentialAction(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name }));
  const dialog = screen.queryByRole("dialog");
  if (dialog !== null) fireEvent.click(within(dialog).getByRole("button", { name }));
}

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const PATIENT_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_BRANCH_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_APPOINTMENT_ID = "77777777-7777-4777-8777-777777777777";
const CATALOG_SERVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_NAME = "Vaccination";
// Present in the catalog payload the selector reads, and never rendered on the
// agenda: the agenda shows the item's identity, not its price.
const SERVICE_PRICE = "150000";

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
  serviceId: null,
  service: null,
};

const BOOKING_REQUEST: BookingRequest = {
  id: REQUEST_ID,
  patientId: PATIENT_ID,
  status: "PENDING",
  startAt: "2026-09-14T15:00:00.000Z",
  endAt: "2026-09-14T15:30:00.000Z",
};

/** One active SERVICE item as the catalog read returns it (price included). */
const CATALOG_SERVICE = {
  id: CATALOG_SERVICE_ID,
  tenantId: "tenant-a",
  kind: "SERVICE",
  name: SERVICE_NAME,
  taxRateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "0.10" },
  referencePriceAmount: SERVICE_PRICE,
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
} as const;

/** A service-linked appointment as the WU4 appointment DTO returns it. */
function linkedAppointment(
  serviceId: string = CATALOG_SERVICE_ID,
  name: string = SERVICE_NAME
): Appointment {
  return {
    ...APPOINTMENT,
    serviceId,
    service: { id: serviceId, name, kind: "SERVICE" },
  };
}

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
  "Elegí una sucursal y un profesional para ver sus horarios y bloqueos en el calendario.";
const AVAILABILITY_UNAVAILABLE =
  "No se pudo cargar la disponibilidad. El calendario podría mostrar horarios fuera de la jornada del profesional.";

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
  readonly eventContent?: (arg: unknown) => React.ReactNode;
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
  readonly catalog?: () => Response | Promise<Response>;
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
    if (url === "/api/patients/lookup") {
      return Promise.resolve(
        jsonResponse([
          {
            id: PATIENT_ID,
            name: "Bobby",
            isActive: true,
            speciesName: "Dog",
            primaryGuardianName: "Ana García",
          },
        ])
      );
    }
    if (url.includes("/api/catalog")) {
      return Promise.resolve(handlers.catalog?.() ?? jsonResponse([CATALOG_SERVICE]));
    }
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
  fireEvent.click(await screen.findByRole("button", { name: "Lista" }));
  fireEvent.click(await screen.findByRole("button", { name: "Gestionar" }));
}

async function openRequestPanel(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Lista" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revisar" }));
}

describe("Agenda", () => {
  it("uses professional names in selectors and list while submitting membership IDs", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: () =>
        jsonResponse({
          branches: [{ id: BRANCH_ID, name: "Main" }],
          professionals: [{ membershipId: MEMBERSHIP_ID, displayName: "Dra. Prueba" }],
        }),
    });
    renderAgenda();
    expect(await screen.findByRole("option", { name: "Dra. Prueba" })).toHaveValue(MEMBERSHIP_ID);
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(await screen.findByText(/Main · Dra. Prueba/)).toBeInTheDocument();
  });
  it("keeps branch/professional selection explicit when options arrive after the form opens", async () => {
    let resolveOptions: ((response: Response) => void) | undefined;
    const fetchMock = mockAgendaFetch({
      options: () =>
        new Promise<Response>((resolve) => {
          resolveOptions = resolve;
        }),
    });
    renderAgenda();
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo turno" }));
    const branch = screen.getByRole("combobox", { name: "Sucursal" });
    const professional = screen.getByRole("combobox", { name: "Profesional" });
    await waitFor(() => expect(resolveOptions).toBeDefined());
    act(() => resolveOptions?.(optionsResponse()));
    await within(branch).findByRole("option", { name: "Main" });
    expect(branch).toHaveValue("");
    expect(professional).toHaveValue("");
    expect(within(branch).getByRole("option", { name: "Elegí una sucursal" })).toHaveProperty(
      "selected",
      true
    );
    await selectPatient();
    fireEvent.click(screen.getByRole("button", { name: "Crear turno" }));
    expect(
      await screen.findByText(
        "Elegí una sucursal, un profesional y un paciente de los resultados de búsqueda."
      )
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          resolveRequestUrl(call[0] as RequestInfo) === "/api/scheduling/appointments" &&
          requestMethod(call) === "POST"
      )
    ).toBe(false);
  });
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

    expect(await screen.findByText("Cargando agenda…")).toBeInTheDocument();
  });

  it("renders the empty state when the tenant has no appointments", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([]) });
    renderAgenda();

    expect(await screen.findByText("Todavía no hay turnos")).toBeInTheDocument();
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
      await screen.findByText("No tenés permiso para realizar esta acción.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Gestionar")).not.toBeInTheDocument();
  });

  it("refetches the agenda scoped to the selected branch filter", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    const branchFilter = await screen.findByLabelText("Filtrar por sucursal");
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
    fireEvent.click(await screen.findByRole("button", { name: "Lista" }));
    expect(await screen.findByText("Main · Profesional (ID) 44444444")).toBeInTheDocument();
    expect(screen.getByText("Main · Profesional (ID) 55555555")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Filtrar por profesional"), {
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
      expect(screen.queryByText("Main · Profesional (ID) 55555555")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Main · Profesional (ID) 44444444")).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "Lista" }));
    expect(await screen.findByText("Main · Profesional (ID) 44444444")).toBeInTheDocument();
    expect(screen.getByText("North · Profesional (ID) 44444444")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Filtrar por estado"), {
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
      expect(screen.queryByText("Main · Profesional (ID) 44444444")).not.toBeInTheDocument()
    );
    expect(screen.getByText("North · Profesional (ID) 44444444")).toBeInTheDocument();
  });

  it("refetches the agenda scoped to the selected service filter without disturbing the others", async () => {
    const linked: Appointment = { ...linkedAppointment(), id: OTHER_APPOINTMENT_ID };
    const fetchMock = mockAgendaFetch({
      appointments: (url) =>
        jsonResponse(
          url.includes(`serviceId=${CATALOG_SERVICE_ID}`) ? [linked] : [APPOINTMENT, linked]
        ),
      options: optionsResponse,
    });
    renderAgenda();

    fireEvent.click(await screen.findByRole("button", { name: "Lista" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Gestionar" })).toHaveLength(2)
    );

    fireEvent.change(await screen.findByLabelText("Filtrar por servicio"), {
      target: { value: CATALOG_SERVICE_ID },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            resolveRequestUrl(call[0] as RequestInfo) ===
            `/api/scheduling/appointments?serviceId=${CATALOG_SERVICE_ID}`
        )
      ).toBe(true);
    });
    // Only the matching appointment stays visible, and the existing filters and
    // navigation are untouched.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Gestionar" })).toHaveLength(1)
    );
    expect(screen.getByTestId("appointment-service")).toHaveTextContent(SERVICE_NAME);
    expect(screen.getByLabelText("Filtrar por sucursal")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar por profesional")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar por estado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoy" })).toBeInTheDocument();
  });

  it("offers an optional service selector and sends the chosen id without deriving the span", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo turno" }));
    const service = await screen.findByRole("combobox", { name: "Servicio" });
    expect(within(service).getByRole("option", { name: "Sin servicio" })).toBeInTheDocument();
    expect(within(service).getByRole("option", { name: SERVICE_NAME })).toBeInTheDocument();

    await selectPatient();
    fireEvent.change(screen.getByLabelText("Inicio"), { target: { value: "2026-09-14T09:00" } });
    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "2026-09-14T09:45" } });
    fireEvent.change(service, { target: { value: CATALOG_SERVICE_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Crear turno" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            requestMethod(call) === "POST" &&
            resolveRequestUrl(call[0] as RequestInfo).endsWith("/appointments")
        )
      ).toBe(true);
    });
    const postCall = fetchMock.mock.calls.find(
      (call) =>
        requestMethod(call) === "POST" &&
        resolveRequestUrl(call[0] as RequestInfo).endsWith("/appointments")
    );
    const body = JSON.parse((postCall?.[1] as unknown as { body: string }).body) as {
      serviceId?: string;
      startAt: string;
      endAt: string;
    };
    expect(body.serviceId).toBe(CATALOG_SERVICE_ID);
    // America/Asuncion is UTC-3 in September, so 09:00 local is 12:00Z. The span
    // stays exactly what the user typed: a service derives and overwrites nothing.
    expect(body.startAt).toBe("2026-09-14T12:00:00.000Z");
    expect(body.endAt).toBe("2026-09-14T12:45:00.000Z");
  });

  it("creates an appointment with no service and sends no service key", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    fireEvent.click(await screen.findByRole("button", { name: "Nuevo turno" }));
    await screen.findByRole("combobox", { name: "Servicio" });
    await selectPatient();
    fireEvent.change(screen.getByLabelText("Inicio"), { target: { value: "2026-09-14T09:00" } });
    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "2026-09-14T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear turno" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => requestMethod(call) === "POST")).toBe(true)
    );
    const postCall = fetchMock.mock.calls.find((call) => requestMethod(call) === "POST");
    const body = JSON.parse((postCall?.[1] as unknown as { body: string }).body) as Record<
      string,
      unknown
    >;
    // The reference is OPTIONAL: leaving the selector untouched submits the
    // appointment with no service key at all.
    expect(body).not.toHaveProperty("serviceId");
  });

  it("shows the linked service by name in the list and the manage panel, and never a price", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([linkedAppointment()]),
      options: optionsResponse,
    });
    renderAgenda();

    fireEvent.click(await screen.findByRole("button", { name: "Lista" }));
    expect(await screen.findByTestId("appointment-service")).toHaveTextContent(
      `Servicio ${SERVICE_NAME}`
    );

    fireEvent.click(screen.getByRole("button", { name: "Gestionar" }));
    expect(await screen.findByTestId("manage-appointment-service")).toHaveTextContent(
      `Servicio: ${SERVICE_NAME}`
    );

    expect(screen.getByRole("link", { name: /Abrir ficha de/ })).toHaveAttribute(
      "href",
      `/app/patients/${APPOINTMENT.patientId}?appointment=${APPOINTMENT.id}#patient-clinical`
    );

    // The selector read carries the reference price, but the agenda renders no
    // price, tax, rate or currency anywhere.
    expect(screen.queryByText(SERVICE_PRICE)).toBeNull();
    expect(screen.queryByText(/PYG/)).toBeNull();
    expect(screen.queryByText(/IVA/)).toBeNull();
  });

  it("shows the linked service name on the calendar event content without a price", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([linkedAppointment()]),
      options: optionsResponse,
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    const content = latestCalendarProps?.eventContent?.({
      event: { id: APPOINTMENT_ID },
      timeText: "12:00",
    });
    render(<>{content}</>);

    expect(screen.getByTestId("event-service")).toHaveTextContent(SERVICE_NAME);
    expect(screen.queryByText(SERVICE_PRICE)).toBeNull();
  });

  it("keeps the linked service selected in the manage panel and clears it explicitly", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([linkedAppointment()]),
      options: optionsResponse,
    });
    renderAgenda();

    await openManagePanel();
    const service = await screen.findByRole<HTMLSelectElement>("combobox", {
      name: "Servicio",
    });
    expect(service.value).toBe(CATALOG_SERVICE_ID);

    fireEvent.change(service, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => requestMethod(call) === "PUT")).toBe(true)
    );
    const putCall = fetchMock.mock.calls.find((call) => requestMethod(call) === "PUT");
    const body = JSON.parse((putCall?.[1] as unknown as { body: string }).body) as {
      serviceId?: string | null;
      version: number;
    };
    // Emptying the selector is the explicit `null` that clears the link; the
    // optimistic version guard is unchanged.
    expect(body.serviceId).toBeNull();
    expect(body.version).toBe(1);
  });

  it("shows the linked service as the current selection even when it is not in the active list", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([linkedAppointment(OTHER_SERVICE_ID, "Retired service")]),
      options: optionsResponse,
      // The catalog read returns only the active item, so the linked one is absent.
      catalog: () => jsonResponse([CATALOG_SERVICE]),
    });
    renderAgenda();

    await openManagePanel();
    const service = await screen.findByRole<HTMLSelectElement>("combobox", {
      name: "Servicio",
    });
    expect(service.value).toBe(OTHER_SERVICE_ID);
    expect(within(service).getByRole("option", { name: "Retired service" })).toBeInTheDocument();
    expect(within(service).getByRole("option", { name: SERVICE_NAME })).toBeInTheDocument();
  });

  it("degrades honestly to an empty selector with a clear message when the service list fails", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      catalog: () => jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500),
    });
    renderAgenda();

    expect(await screen.findByTestId("service-options-unavailable")).toHaveTextContent(
      "No se pudo cargar la lista de servicios."
    );

    fireEvent.click(screen.getByRole("button", { name: "Nuevo turno" }));
    const service = await screen.findByRole("combobox", { name: "Servicio" });
    expect(within(service).getAllByRole("option")).toHaveLength(1);

    // The appointment is still creatable without a service: the failed read is
    // not a barrier and the client invents no permission rule from it.
    await selectPatient();
    fireEvent.change(screen.getByLabelText("Inicio"), { target: { value: "2026-09-14T09:00" } });
    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "2026-09-14T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear turno" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => requestMethod(call) === "POST")).toBe(true)
    );
    const postCall = fetchMock.mock.calls.find((call) => requestMethod(call) === "POST");
    const body = JSON.parse((postCall?.[1] as unknown as { body: string }).body) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("serviceId");
  });

  it("switches the FullCalendar view and falls back to the accessible list", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    expect(latestCalendarProps?.initialView).toBe("timeGridDay");

    fireEvent.click(screen.getByRole("button", { name: "Mes" }));
    await waitFor(() => expect(changeViewMock).toHaveBeenCalledWith("dayGridMonth"));

    fireEvent.click(screen.getByRole("button", { name: "Semana" }));
    await waitFor(() => expect(changeViewMock).toHaveBeenCalledWith("timeGridWeek"));

    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(await screen.findByRole("button", { name: "Gestionar" })).toBeInTheDocument();
  });

  it("renders the appointment as a calendar event", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    await screen.findByTestId("fullcalendar");

    await waitFor(() =>
      expect(latestCalendarProps?.events).toEqual([
        {
          id: APPOINTMENT_ID,
          title: "Bobby · Programado",
          start: APPOINTMENT.startAt,
          end: APPOINTMENT.endAt,
          allDay: false,
        },
      ])
    );
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
    fireEvent.change(await screen.findByLabelText("Filtrar por sucursal"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Filtrar por profesional"), {
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
    fireEvent.change(await screen.findByLabelText("Filtrar por sucursal"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Filtrar por profesional"), {
      target: { value: MEMBERSHIP_ID },
    });

    // The pair is configured in no way at all, so the write path is
    // unrestricted and the overlay must not shade a single minute.
    await waitFor(() => expect(latestCalendarProps?.businessHours).toBe(false));
    await waitFor(() =>
      expect(latestCalendarProps?.events).toEqual([expect.objectContaining({ id: APPOINTMENT_ID })])
    );
  });

  it("warns, without blocking, when the selected pair's settings read fails", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    fireEvent.change(await screen.findByLabelText("Filtrar por sucursal"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Filtrar por profesional"), {
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
    expect(screen.getByRole("button", { name: "Nuevo turno" })).toBeEnabled();
  });

  it("treats a malformed settings namespace as unavailable, not as unrestricted", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
      settings: () => jsonResponse({ settings: {} }),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    fireEvent.change(await screen.findByLabelText("Filtrar por sucursal"), {
      target: { value: BRANCH_ID },
    });
    fireEvent.change(await screen.findByLabelText("Filtrar por profesional"), {
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
    // A calendar drag never clears or changes the stored service link.
    expect((body as Record<string, unknown>).serviceId).toBeUndefined();
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

    expect(await screen.findByRole("heading", { name: "Nuevo turno" })).toBeInTheDocument();
    // America/Asuncion is UTC-3 in September, so 13:00Z is 10:00 tenant wall time.
    expect(screen.getByLabelText<HTMLInputElement>("Inicio").value).toBe("2026-09-15T10:00");
    expect(screen.getByLabelText<HTMLInputElement>("Fin").value).toBe("2026-09-15T10:45");
  });

  it("reschedules an appointment with its optimistic version from the Manage form", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();

    await openManagePanel();

    const start = await screen.findByLabelText("Inicio");
    fireEvent.change(start, { target: { value: "2026-09-14T08:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

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
    await clickConsequentialAction("Confirmar turno");

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

  it("contains keyboard focus and returns to the trigger when confirmation is cancelled", async () => {
    const fetchMock = mockAgendaFetch({
      appointments: () => jsonResponse([APPOINTMENT]),
      options: optionsResponse,
    });
    renderAgenda();
    await openManagePanel();
    const trigger = screen.getByRole("button", { name: "Confirmar turno" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Confirmar este turno" });
    const cancel = within(dialog).getByRole("button", { name: "Volver" });
    const confirm = within(dialog).getByRole("button", { name: "Confirmar turno" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          resolveRequestUrl(call[0] as RequestInfo).endsWith("/confirm") &&
          requestMethod(call) === "POST"
      )
    ).toBe(false);
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
    fireEvent.change(await screen.findByLabelText("Inicio"), {
      target: { value: "2026-09-14T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByTestId("stale-version-alert")).toHaveTextContent(
      "Otra persona modificó este turno."
    );
    // The client re-read the appointment to confirm the version actually moved.
    expect(fetchMock.mock.calls.some((call) => requestMethod(call) === "GET")).toBe(true);
  });

  it("shows the generic conflict copy, not a concurrent-writer alert, when the stored version did not change", async () => {
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
    fireEvent.change(await screen.findByLabelText("Inicio"), {
      target: { value: "2026-09-14T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // A 409 whose stored version did NOT advance must not be misreported as a
    // concurrent-writer conflict: the generic, cause-agnostic conflict copy is
    // shown and the stale-version alert stays hidden.
    expect(
      await screen.findByText(
        "No se pudo cambiar el turno porque su estado pudo haber cambiado. Actualizamos los datos; revisalos antes de volver a intentar."
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
    await waitFor(() =>
      expect(latestCalendarProps?.events).toEqual([
        {
          id: APPOINTMENT_ID,
          title: "Bobby · Programado",
          start: APPOINTMENT.startAt,
          end: APPOINTMENT.endAt,
          allDay: false,
        },
        {
          id: `booking-request:${REQUEST_ID}`,
          title: "Bobby · Solicitud",
          start: BOOKING_REQUEST.startAt,
          end: BOOKING_REQUEST.endAt,
          allDay: false,
          editable: false,
          extendedProps: { kind: "booking-request" },
        },
      ])
    );
  });

  it("keeps the calendar visible when there are pending requests but no appointments", async () => {
    mockAgendaFetch({
      appointments: () => jsonResponse([]),
      options: optionsResponse,
      bookingRequests: () => jsonResponse([BOOKING_REQUEST]),
    });
    renderAgenda();

    await screen.findByTestId("fullcalendar");
    await waitFor(() =>
      expect(latestCalendarProps?.events).toEqual([
        {
          id: `booking-request:${REQUEST_ID}`,
          title: "Bobby · Solicitud",
          start: BOOKING_REQUEST.startAt,
          end: BOOKING_REQUEST.endAt,
          allDay: false,
          editable: false,
          extendedProps: { kind: "booking-request" },
        },
      ])
    );
    expect(screen.queryByText("Todavía no hay turnos")).not.toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "Solicitud de turno pendiente" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar solicitud" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar solicitud" })).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "Lista" }));

    const row = await screen.findByTestId("pending-request-row");
    expect(within(row).getByTestId("request-badge")).toHaveTextContent("Solicitud");
    expect(row.className).toContain("border-dashed");
    // Exactly one request badge, and no appointment row shares the dashed layer.
    expect(screen.getAllByTestId("request-badge")).toHaveLength(1);
    for (const manage of screen.getAllByRole("button", { name: "Gestionar" })) {
      expect(manage.closest("li")?.className).not.toContain("border-dashed");
    }
  });

  it("renders the empty pending-request state without an error", async () => {
    mockAgendaFetch({ appointments: () => jsonResponse([APPOINTMENT]), options: optionsResponse });
    renderAgenda();

    expect(await screen.findByText("No hay solicitudes de turno pendientes.")).toBeInTheDocument();
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
    expect(alert).toHaveTextContent("No tenés permiso para resolver solicitudes de turno.");
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
    await clickConsequentialAction("Aprobar solicitud");

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
    expect(await screen.findByText("Solicitud aprobada; se creó el turno.")).toBeInTheDocument();
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
    await clickConsequentialAction("Rechazar solicitud");

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
    expect(await screen.findByText("Solicitud rechazada.")).toBeInTheDocument();
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
    await clickConsequentialAction("Aprobar solicitud");

    expect(
      await screen.findByText(
        "No se pudo resolver la solicitud: el horario podría estar ocupado o alguien pudo haberla resuelto antes. Actualizamos el estado."
      )
    ).toBeInTheDocument();
    // Still pending: the request stays in the layer and the panel stays open.
    expect(screen.getByTestId("pending-request-row")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Aprobar solicitud" })
    ).toBeInTheDocument();

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
    await clickConsequentialAction("Aprobar solicitud");

    await waitFor(() =>
      expect(screen.queryByTestId("pending-request-row")).not.toBeInTheDocument()
    );
    // The stale panel is closed, not left open contradicting the refreshed data.
    expect(
      screen.queryByRole("heading", { name: "Solicitud de turno pendiente" })
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
    fireEvent.change(screen.getByLabelText("Nuevo horario de inicio"), {
      target: { value: "2026-09-14T18:00" },
    });
    await clickConsequentialAction("Aprobar solicitud");

    expect(
      await screen.findByText("Ingresá los dos horarios alternativos o dejalos vacíos.")
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((call) =>
        resolveRequestUrl(call[0] as RequestInfo).endsWith("/approve")
      )
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Nuevo horario de fin"), {
      target: { value: "2026-09-14T18:30" },
    });
    await clickConsequentialAction("Aprobar solicitud");

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
