import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GeneralSettingsSurface } from "./general-settings-surface";

/**
 * CFG-001 T2 (S4): the availability windows and blocks editor of «Agenda».
 * Driven through the page surface, with a fake settings API and the agenda's
 * options read (`/api/scheduling/appointments/options`) as picker source.
 */

const ANA = "11111111-1111-4111-8111-111111111111";
const LUIS = "33333333-3333-4333-8333-333333333333";
const GONE_MEMBER = "99999999-9999-4999-8999-999999999999";
const CENTRAL = "22222222-2222-4222-8222-222222222222";
const NORTE = "44444444-4444-4444-8444-444444444444";
const GONE_BRANCH = "88888888-8888-4888-8888-888888888888";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTIONS = {
  branches: [
    { id: CENTRAL, name: "Central", isActive: true },
    { id: NORTE, name: "Norte", isActive: true },
  ],
  professionals: [
    { membershipId: ANA, displayName: "Dra. Ana", branchIds: [CENTRAL] },
    { membershipId: LUIS, displayName: "Dr. Luis", branchIds: [CENTRAL, NORTE] },
  ],
};

function scheduling(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conflictPolicy: "REJECT",
    availability: [
      { membershipId: ANA, branchId: CENTRAL, weekday: 1, startMinute: 480, endMinute: 720 },
    ],
    blocks: [
      {
        membershipId: LUIS,
        branchId: NORTE,
        startsAt: "2026-11-20T11:00:00.000Z",
        endsAt: "2026-11-20T15:30:00.000Z",
      },
    ],
    ...overrides,
  };
}

function installApi(
  options: {
    scheduling?: Record<string, unknown>;
    reject?: Response;
    optionsResponse?: () => Response;
  } = {}
): Call[] {
  let stored = options.scheduling ?? scheduling();
  const calls: Call[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (url === "/api/scheduling/appointments/options") {
      return Promise.resolve(options.optionsResponse ? options.optionsResponse() : json(OPTIONS));
    }
    if (url === "/api/settings/scheduling") {
      if (method === "PUT") {
        if (options.reject) return Promise.resolve(options.reject);
        stored = { ...stored, ...(JSON.parse(body) as Record<string, unknown>) };
      }
      return Promise.resolve(json({ settings: stored }));
    }
    return Promise.resolve(json({ error: { code: "NOT_FOUND" } }, 404));
  });
  return calls;
}

function renderAgendaOnly(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GeneralSettingsSurface permissions={["scheduling.settings.manage"]} />
    </QueryClientProvider>
  );
}

async function windowsRegion(): Promise<HTMLElement> {
  const region = await screen.findByRole("region", { name: "Horarios de atención" });
  await within(region).findByRole("button", { name: "Agregar horario" });
  return region;
}

async function blocksRegion(): Promise<HTMLElement> {
  const region = await screen.findByRole("region", { name: "Bloqueos" });
  await within(region).findByRole("button", { name: "Agregar bloqueo" });
  return region;
}

function rows(region: HTMLElement): HTMLElement[] {
  // Skip the header row.
  return within(region).getAllByRole("row").slice(1);
}

function puts(calls: readonly Call[]): unknown[] {
  return calls
    .filter((call) => call.method === "PUT" && call.url === "/api/settings/scheduling")
    .map((call) => JSON.parse(call.body) as unknown);
}

function choose(region: HTMLElement, label: string, option: string): void {
  const select = within(region).getByLabelText(label);
  const match = within(select).getByRole("option", { name: option });
  fireEvent.change(select, { target: { value: match.getAttribute("value") ?? "" } });
}

function type(region: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(region).getByLabelText(label), { target: { value } });
}

function save(): void {
  const agenda = screen.getByRole("region", { name: "Agenda" });
  fireEvent.click(within(agenda).getByRole("button", { name: "Guardar horarios y bloqueos" }));
}

afterEach(() => vi.restoreAllMocks());

describe("Agenda availability and blocks editor (CFG-001 T2)", () => {
  it("shows the stored windows and blocks with names and clinic-local times", async () => {
    installApi({
      scheduling: scheduling({
        availability: [
          { membershipId: ANA, branchId: CENTRAL, weekday: 1, startMinute: 480, endMinute: 720 },
          { membershipId: LUIS, branchId: NORTE, weekday: 0, startMinute: 1200, endMinute: 1440 },
        ],
      }),
    });
    renderAgendaOnly();

    const windows = await windowsRegion();
    const [first, second] = rows(windows);
    expect(first).toHaveTextContent(/Dra\. Ana.*Central.*Lunes.*08:00.*12:00/);
    // weekday 0 is Sunday (API getUTCDay); endMinute 1440 is the end of the day.
    expect(second).toHaveTextContent(/Dr\. Luis.*Norte.*Domingo.*20:00.*24:00/);

    const blocks = await blocksRegion();
    // 11:00Z and 15:30Z are 08:00 and 12:30 in America/Asuncion (UTC-3).
    expect(rows(blocks)[0]).toHaveTextContent(
      /Dr\. Luis.*Norte.*20\/11\/2026 08:00.*20\/11\/2026 12:30/
    );
  });

  it("explains an empty list of windows and blocks", async () => {
    installApi({ scheduling: scheduling({ availability: [], blocks: [] }) });
    renderAgendaOnly();
    const windows = await windowsRegion();
    expect(windows).toHaveTextContent("Sin horarios: la agenda acepta turnos a cualquier hora.");
    const blocks = await blocksRegion();
    expect(blocks).toHaveTextContent("Sin bloqueos.");
  });

  it("adds a window and saves the whole availability list, never conflictPolicy or blocks", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const windows = await windowsRegion();
    expect(
      within(screen.getByRole("region", { name: "Agenda" })).getByRole("button", {
        name: "Guardar horarios y bloqueos",
      })
    ).toBeDisabled();

    choose(windows, "Profesional", "Dr. Luis");
    choose(windows, "Sucursal", "Norte");
    choose(windows, "Día", "Domingo");
    type(windows, "Desde", "09:30");
    type(windows, "Hasta", "00:00");
    fireEvent.click(within(windows).getByRole("button", { name: "Agregar horario" }));
    expect(rows(windows)[1]).toHaveTextContent(/Dr\. Luis.*Norte.*Domingo.*09:30.*24:00/);

    save();
    await screen.findByText("Se guardaron los cambios.");
    expect(puts(calls)).toEqual([
      {
        availability: [
          { membershipId: ANA, branchId: CENTRAL, weekday: 1, startMinute: 480, endMinute: 720 },
          // Sunday = 0; an end of 00:00 means midnight at the end of the day (1440).
          { membershipId: LUIS, branchId: NORTE, weekday: 0, startMinute: 570, endMinute: 1440 },
        ],
      },
    ]);
  });

  it("edits a window in place", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const windows = await windowsRegion();
    fireEvent.click(within(rows(windows)[0]).getByRole("button", { name: /^Editar/ }));
    expect(within(windows).getByLabelText("Desde")).toHaveValue("08:00");
    expect(within(windows).getByLabelText("Hasta")).toHaveValue("12:00");
    choose(windows, "Día", "Sábado");
    type(windows, "Hasta", "13:15");
    fireEvent.click(within(windows).getByRole("button", { name: "Actualizar horario" }));

    save();
    await screen.findByText("Se guardaron los cambios.");
    expect(puts(calls)).toEqual([
      {
        availability: [
          { membershipId: ANA, branchId: CENTRAL, weekday: 6, startMinute: 480, endMinute: 795 },
        ],
      },
    ]);
  });

  it("removes a window and saves the remaining list", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const windows = await windowsRegion();
    fireEvent.click(within(rows(windows)[0]).getByRole("button", { name: /^Quitar/ }));
    save();
    await screen.findByText("Se guardaron los cambios.");
    expect(puts(calls)).toEqual([{ availability: [] }]);
  });

  it("refuses a window whose end is not after its start, without calling the API", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const windows = await windowsRegion();
    choose(windows, "Profesional", "Dra. Ana");
    choose(windows, "Sucursal", "Central");
    choose(windows, "Día", "Martes");
    type(windows, "Desde", "14:00");
    type(windows, "Hasta", "14:00");
    fireEvent.click(within(windows).getByRole("button", { name: "Agregar horario" }));
    expect(within(windows).getByRole("alert")).toHaveTextContent(
      "La hora de fin debe ser posterior a la de inicio."
    );
    expect(rows(windows)).toHaveLength(1);
    expect(puts(calls)).toEqual([]);
  });

  it("asks for the professional and the branch before adding a window", async () => {
    installApi();
    renderAgendaOnly();
    const windows = await windowsRegion();
    type(windows, "Desde", "08:00");
    type(windows, "Hasta", "09:00");
    fireEvent.click(within(windows).getByRole("button", { name: "Agregar horario" }));
    expect(within(windows).getByRole("alert")).toHaveTextContent("Elegí un profesional.");
    choose(windows, "Profesional", "Dra. Ana");
    fireEvent.click(within(windows).getByRole("button", { name: "Agregar horario" }));
    expect(within(windows).getByRole("alert")).toHaveTextContent("Elegí una sucursal.");
  });

  it("adds a block from clinic-local date and time and saves only the blocks as UTC instants", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const blocks = await blocksRegion();
    choose(blocks, "Profesional", "Dra. Ana");
    choose(blocks, "Sucursal", "Central");
    type(blocks, "Desde", "2026-11-12T09:00");
    type(blocks, "Hasta", "2026-11-12T18:45");
    fireEvent.click(within(blocks).getByRole("button", { name: "Agregar bloqueo" }));

    save();
    await screen.findByText("Se guardaron los cambios.");
    expect(puts(calls)).toEqual([
      {
        blocks: [
          {
            membershipId: LUIS,
            branchId: NORTE,
            startsAt: "2026-11-20T11:00:00.000Z",
            endsAt: "2026-11-20T15:30:00.000Z",
          },
          {
            membershipId: ANA,
            branchId: CENTRAL,
            startsAt: "2026-11-12T12:00:00.000Z",
            endsAt: "2026-11-12T21:45:00.000Z",
          },
        ],
      },
    ]);
  });

  it("edits and removes blocks", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const blocks = await blocksRegion();
    fireEvent.click(within(rows(blocks)[0]).getByRole("button", { name: /^Editar/ }));
    expect(within(blocks).getByLabelText("Desde")).toHaveValue("2026-11-20T08:00");
    type(blocks, "Hasta", "2026-11-20T10:00");
    fireEvent.click(within(blocks).getByRole("button", { name: "Actualizar bloqueo" }));
    save();
    await screen.findByText("Se guardaron los cambios.");

    const refreshed = await blocksRegion();
    fireEvent.click(within(rows(refreshed)[0]).getByRole("button", { name: /^Quitar/ }));
    save();
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)).toEqual([
      {
        blocks: [
          {
            membershipId: LUIS,
            branchId: NORTE,
            startsAt: "2026-11-20T11:00:00.000Z",
            endsAt: "2026-11-20T13:00:00.000Z",
          },
        ],
      },
      { blocks: [] },
    ]);
  });

  it("refuses a block whose end is not after its start", async () => {
    const calls = installApi();
    renderAgendaOnly();
    const blocks = await blocksRegion();
    choose(blocks, "Profesional", "Dra. Ana");
    choose(blocks, "Sucursal", "Central");
    type(blocks, "Desde", "2026-11-12T09:00");
    type(blocks, "Hasta", "2026-11-12T08:00");
    fireEvent.click(within(blocks).getByRole("button", { name: "Agregar bloqueo" }));
    expect(within(blocks).getByRole("alert")).toHaveTextContent(
      "El fin del bloqueo debe ser posterior al inicio."
    );
    expect(rows(blocks)).toHaveLength(1);
    expect(puts(calls)).toEqual([]);
  });

  it("keeps rows of a professional or branch no longer listed, and lets them be removed", async () => {
    const calls = installApi({
      scheduling: scheduling({
        availability: [
          {
            membershipId: GONE_MEMBER,
            branchId: CENTRAL,
            weekday: 2,
            startMinute: 60,
            endMinute: 120,
          },
          { membershipId: ANA, branchId: GONE_BRANCH, weekday: 3, startMinute: 60, endMinute: 120 },
          { membershipId: ANA, branchId: CENTRAL, weekday: 4, startMinute: 60, endMinute: 120 },
        ],
      }),
    });
    renderAgendaOnly();
    const windows = await windowsRegion();
    const [gone, goneBranch] = rows(windows);
    expect(gone).toHaveTextContent(/Profesional no disponible.*Central.*Martes/);
    expect(goneBranch).toHaveTextContent(/Dra\. Ana.*Sucursal no disponible.*Miércoles/);

    fireEvent.click(within(gone).getByRole("button", { name: /^Quitar/ }));
    save();
    await screen.findByText("Se guardaron los cambios.");
    expect(puts(calls)).toEqual([
      {
        availability: [
          { membershipId: ANA, branchId: GONE_BRANCH, weekday: 3, startMinute: 60, endMinute: 120 },
          { membershipId: ANA, branchId: CENTRAL, weekday: 4, startMinute: 60, endMinute: 120 },
        ],
      },
    ]);
  });

  it("explains the API's refusal in Spanish", async () => {
    installApi({
      reject: json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "endMinute must be greater than startMinute.",
          },
        },
        400
      ),
    });
    renderAgendaOnly();
    const windows = await windowsRegion();
    fireEvent.click(within(rows(windows)[0]).getByRole("button", { name: /^Quitar/ }));
    save();
    const agenda = screen.getByRole("region", { name: "Agenda" });
    expect(
      await within(agenda).findByText("Los valores no son válidos. Revisalos e intentá de nuevo.")
    ).toBeInTheDocument();
    expect(agenda).not.toHaveTextContent("endMinute");
  });

  it("does not offer editing while the professionals and branches cannot be read, and retries", async () => {
    let fail = true;
    const calls = installApi({
      optionsResponse: () => {
        if (fail) {
          fail = false;
          return json({ error: { code: "INTERNAL" } }, 500);
        }
        return json(OPTIONS);
      },
    });
    renderAgendaOnly();
    const agenda = await screen.findByRole("region", { name: "Agenda" });
    const alert = await within(agenda).findByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar los profesionales y las sucursales.");
    expect(
      within(agenda).queryByRole("button", { name: "Agregar horario" })
    ).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Volver a intentar" }));
    await windowsRegion();
    expect(puts(calls)).toEqual([]);
  });

  it("does not offer editing when the stored lists cannot be read", async () => {
    installApi({ scheduling: scheduling({ availability: [{ weekday: 9 }] }) });
    renderAgendaOnly();
    const agenda = await screen.findByRole("region", { name: "Agenda" });
    expect(
      await within(agenda).findByText(
        "No se pudieron leer los horarios y bloqueos guardados. No se pueden editar desde acá."
      )
    ).toBeInTheDocument();
    expect(
      within(agenda).queryByRole("button", { name: "Agregar horario" })
    ).not.toBeInTheDocument();
    // The conflict policy form stays usable.
    expect(within(agenda).getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });
});
