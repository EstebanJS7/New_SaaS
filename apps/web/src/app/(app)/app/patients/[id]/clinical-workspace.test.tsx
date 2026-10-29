import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClinicalWorkspace } from "./clinical-workspace";
import type { ClinicalEncounter } from "./clinical-api";
import {
  CLINICAL_RECOVERY_MS,
  clearClinicalRecovery,
  readClinicalRecovery,
  retainClinicalRecovery,
} from "./clinical-draft-recovery";

/**
 * The WU4A clinical client validates every patient and encounter id as a
 * canonical UUID before it builds a proxy path, so the workspace fixtures must
 * be valid identifiers rather than the earlier `patient-1` / `enc-1` placeholders.
 */
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";
const AMENDMENT_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";

/** Small autosave debounce so the real timer can be asserted without fake timers. */
const AUTOSAVE_MS = 30;

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

const DRAFT: ClinicalEncounter = {
  id: ENCOUNTER_ID,
  tenantId: TENANT_ID,
  patientId: PATIENT_ID,
  status: "DRAFT",
  version: 1,
  reasonForVisit: "Limping",
  anamnesis: "Started two days ago",
  diagnosis: "Soft tissue injury",
  treatmentPlan: "Rest and NSAIDs",
  internalNotes: "Owner non-compliance note",
  clientSummary: "Mild sprain summary",
  amendsEncounterId: null,
  amendmentReason: null,
  closedAt: null,
  closedByUserProfileId: null,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

const CLOSED: ClinicalEncounter = {
  ...DRAFT,
  status: "CLOSED",
  closedAt: "2026-09-12T01:00:00.000Z",
};

type Handler = (body?: Record<string, unknown>) => Response | Promise<Response>;

interface WorkflowOverrides {
  readonly list?: Handler;
  readonly create?: Handler;
  readonly save?: Handler;
  readonly close?: Handler;
  readonly amend?: Handler;
}

/**
 * URL + method aware fetch double for the staff clinical workspace. Default
 * handlers render one DRAFT encounter; overrides exercise loading/empty/error,
 * permission denial, conflicts and the close/amend commands without touching
 * the real proxy or API. The default handlers mutate a per-test in-memory
 * encounter list so a save/close/create round trip is reflected by the next
 * list read, mirroring a real server.
 */
function mockClinical(overrides: WorkflowOverrides = {}): ReturnType<typeof vi.fn> {
  const state: ClinicalEncounter[] = [{ ...DRAFT }];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    if (url.endsWith(`/encounters/${DRAFT.id}/close`) && method === "POST") {
      if (overrides.close) return Promise.resolve(overrides.close());
      state[0] = { ...CLOSED };
      return Promise.resolve(jsonResponse(CLOSED));
    }
    if (url.endsWith(`/encounters/${DRAFT.id}/amendments`) && method === "POST") {
      return Promise.resolve(
        overrides.amend?.() ?? jsonResponse({ ...CLOSED, id: AMENDMENT_ID }, 201)
      );
    }
    if (url.endsWith(`/encounters/${DRAFT.id}`) && method === "PUT") {
      if (overrides.save) return Promise.resolve(overrides.save(body));
      const updated: ClinicalEncounter = {
        ...DRAFT,
        ...(body as Partial<ClinicalEncounter>),
        status: state[0]?.status ?? "DRAFT",
        version: (state[0]?.version ?? 1) + 1,
      };
      state[0] = updated;
      return Promise.resolve(jsonResponse(updated));
    }
    if (url.endsWith("/encounters") && method === "POST") {
      if (overrides.create) return Promise.resolve(overrides.create(body));
      state.push({ ...DRAFT });
      return Promise.resolve(jsonResponse(DRAFT, 201));
    }
    if (url.endsWith("/encounters")) {
      return Promise.resolve(overrides.list?.() ?? jsonResponse(state));
    }
    // The workspace now also mounts the vaccination/deworming section
    // (EPIC-18 REP-010). An empty list keeps these encounter tests focused; the
    // section's own contract is covered in clinical-records.test.tsx.
    if (url.endsWith("/vaccinations") || url.endsWith("/deworming")) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function saveCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      resolveRequestUrl(input as RequestInfo | URL).endsWith(
        `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}`
      ) && (init as RequestInit | undefined)?.method === "PUT"
  );
}

function renderWorkspace(
  options: { readonly autosaveDelayMs?: number } = {}
): ReturnType<typeof render> {
  return render(
    <TestWrapper>
      <ClinicalWorkspace
        patientId={PATIENT_ID}
        autosaveDelayMs={options.autosaveDelayMs ?? AUTOSAVE_MS}
      />
    </TestWrapper>
  );
}

/**
 * Runs the pending debounce timer inside `act` so the autosave mutation and its
 * resulting state updates are flushed before assertions.
 */
async function flushAutosave(delayMs = AUTOSAVE_MS): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs + 15));
  });
}

async function selectEncounter(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /Limping/ }));
}

async function confirmClosure(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Cerrar ficha clínica" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar y cerrar" })
  );
}

describe("ClinicalWorkspace", () => {
  it("reopens a saved consultation from return context without creating or saving it", async () => {
    const fetch = mockClinical();
    render(
      <TestWrapper>
        <ClinicalWorkspace patientId={PATIENT_ID} initialEncounterId={ENCOUNTER_ID} />
      </TestWrapper>
    );
    expect(await screen.findByDisplayValue(DRAFT.reasonForVisit!)).toBeInTheDocument();
    expect(
      fetch.mock.calls.every(
        (call) => ((call[1] as RequestInit | undefined)?.method ?? "GET") === "GET"
      )
    ).toBe(true);
  });
  it("does not open a consultation absent from the authorized fresh list", async () => {
    mockClinical();
    render(
      <TestWrapper>
        <ClinicalWorkspace patientId={PATIENT_ID} initialEncounterId={AMENDMENT_ID} />
      </TestWrapper>
    );
    await screen.findByText(DRAFT.reasonForVisit!);
    expect(screen.getByText(/No encontramos la consulta de retorno/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(DRAFT.reasonForVisit!)).not.toBeInTheDocument();
  });

  it("offers a navigation-only POS continuation for a closed consultation with appointment context", async () => {
    const fetch = mockClinical({ list: () => jsonResponse([CLOSED]) });
    render(
      <TestWrapper>
        <ClinicalWorkspace patientId={PATIENT_ID} appointmentId={AMENDMENT_ID} />
      </TestWrapper>
    );
    await selectEncounter();
    expect(screen.getByRole("link", { name: "Ir al punto de venta" })).toHaveAttribute(
      "href",
      `/app/sales?patient=${PATIENT_ID}&encounter=${ENCOUNTER_ID}&appointment=${AMENDMENT_ID}`
    );
    expect(
      screen.getByText(/Esto no completa el turno ni crea una venta automáticamente/)
    ).toBeInTheDocument();
    expect(
      fetch.mock.calls.every(([, init]) => {
        const request = init as RequestInit | undefined;
        return request?.method === undefined || request.method === "GET";
      })
    ).toBe(true);
  });

  it("preserves spaces during typing and saves the complete text in StrictMode", async () => {
    const fetchMock = mockClinical();
    render(
      <StrictMode>
        <TestWrapper>
          <ClinicalWorkspace patientId={PATIENT_ID} autosaveDelayMs={AUTOSAVE_MS} />
        </TestWrapper>
      </StrictMode>
    );
    await selectEncounter();
    const field = screen.getByLabelText("Motivo de consulta");
    fireEvent.change(field, { target: { value: "Control " } });
    expect(field).toHaveValue("Control ");
    fireEvent.change(field, { target: { value: "Control de seguimiento" } });
    await flushAutosave();
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(1));
    const init = saveCalls(fetchMock)[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      reasonForVisit: "Control de seguimiento",
    });
    expect(await screen.findByText("Todos los cambios están guardados")).toBeInTheDocument();
  });

  it("links an oversized field error and prevents autosave and closure without truncation", async () => {
    const fetchMock = mockClinical();
    renderWorkspace();
    await selectEncounter();
    const field = screen.getByLabelText("Diagnóstico");
    fireEvent.change(field, { target: { value: "a".repeat(10_001) } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", "diagnosis-help diagnosis-error");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Diagnóstico: el máximo es de 10.000 caracteres"
    );
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cerrar ficha clínica" })).toBeDisabled();
    expect(field).toHaveValue("a".repeat(10_001));
    fireEvent.change(field, { target: { value: "Corregido" } });
    await flushAutosave();
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(1));
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("stops automatic retries after a failed save and offers an explicit successful retry", async () => {
    let attempt = 0;
    const save = vi.fn(() =>
      ++attempt === 1
        ? jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Failed" } }, 500)
        : jsonResponse({ ...DRAFT, version: 2, diagnosis: "Nuevo" })
    );
    mockClinical({ save });
    renderWorkspace();
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Nuevo" } });
    await flushAutosave();
    expect(await screen.findByText(/usá Guardar borrador para reintentar/)).toBeInTheDocument();
    await flushAutosave();
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Todos los cambios están guardados")).toBeInTheDocument();
  });

  it("protects pending content on route exit or encounter switch while allowing section anchors", async () => {
    mockClinical({
      list: () =>
        jsonResponse([DRAFT, { ...DRAFT, id: AMENDMENT_ID, reasonForVisit: "Otra consulta" }]),
    });
    renderWorkspace({ autosaveDelayMs: 60000 });
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Sin guardar" } });
    expect(screen.getByRole("button", { name: /Otra consulta/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nueva consulta" })).toBeDisabled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const link = document.createElement("a");
    link.href = "/app/agenda";
    link.textContent = "Salir";
    document.body.append(link);
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Hay cambios pendientes");
    const exitDialog = screen.getByRole("dialog", { name: "Salir sin guardar" });
    fireEvent.click(within(exitDialog).getByRole("button", { name: "Seguir editando" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    link.href = "#patient-prevention";
    // The guard must allow native links between sections of the current document.
    link.addEventListener("click", (event) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    fireEvent.click(link);
    link.remove();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Sin guardar");
  });

  it("reviews current clinical content before closing and explains the independent appointment and sale", async () => {
    mockClinical();
    renderWorkspace({ autosaveDelayMs: 60000 });
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Diagnóstico de revisión" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha clínica" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Diagnóstico de revisión")).toBeInTheDocument();
    expect(within(dialog).getByText("Notas internas · solo equipo")).toBeInTheDocument();
    expect(within(dialog).getByText(/no completa la cita ni genera una venta/)).toBeInTheDocument();
  });

  it("renders the persisted closed consultation read-only alongside the explicit amendment", async () => {
    mockClinical({ list: () => jsonResponse([CLOSED]) });
    renderWorkspace();
    await selectEncounter();
    const record = screen.getByRole("region", { name: "Consulta cerrada" });
    expect(within(record).getByText(DRAFT.diagnosis!)).toBeInTheDocument();
    expect(within(record).getByText(DRAFT.clientSummary!)).toBeInTheDocument();
    expect(screen.queryByLabelText("Diagnóstico")).not.toBeInTheDocument();
    expect(within(record).getByLabelText(/Motivo de la enmienda/)).toBeInTheDocument();
  });

  it("keeps a newer edit editable when it arrives during the save before closure", async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveSave = resolve;
        })
    );
    const close = vi.fn(() => jsonResponse(CLOSED));
    mockClinical({ save, close });
    renderWorkspace({ autosaveDelayMs: 60000 });
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Submitted edit" } });
    await confirmClosure();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Newer edit" } });
    await act(async () => {
      resolveSave?.(jsonResponse({ ...DRAFT, version: 2, diagnosis: "Submitted edit" }));
      await Promise.resolve();
    });
    expect(await screen.findByText(/Hubo cambios durante el guardado/)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Newer edit");
  });
  it("cancels closure without issuing the immutable close command", async () => {
    const close = vi.fn(() => jsonResponse(CLOSED));
    mockClinical({ close });
    renderWorkspace();
    await selectEncounter();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha clínica" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Volver" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Diagnóstico")).toBeEnabled();
  });

  it("saves dirty content before closing with the refreshed version", async () => {
    const fetchMock = mockClinical();
    renderWorkspace({ autosaveDelayMs: 60000 });
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Final diagnosis" },
    });
    await confirmClosure();
    await screen.findByText("Ficha clínica cerrada.");
    const writes = (fetchMock.mock.calls as [RequestInfo | URL, RequestInit | undefined][]).filter(
      ([, init]) => init?.method === "PUT" || init?.method === "POST"
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(writes[0]?.[1]?.body as string)).toMatchObject({
      version: 1,
      diagnosis: "Final diagnosis",
    });
    expect(resolveRequestUrl(writes[1]?.[0] ?? "")).toMatch(/\/close$/);
    expect(JSON.parse(writes[1]?.[1]?.body as string)).toMatchObject({ version: 2 });
  });

  it("preserves unsaved text and never closes after a save conflict", async () => {
    const close = vi.fn(() => jsonResponse(CLOSED));
    mockClinical({
      save: () => jsonResponse({ error: { code: "CONFLICT", message: "Concurrent update" } }, 409),
      close,
    });
    renderWorkspace({ autosaveDelayMs: 60000 });
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Keep this edit" } });
    await confirmClosure();
    await screen.findByText(/Otra persona modificó esta ficha/);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Keep this edit");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the loading state for the encounter list", async () => {
    mockClinical({ list: () => new Promise<Response>(() => undefined) });

    renderWorkspace();

    expect(await screen.findByText("Cargando fichas clínicas…")).toBeInTheDocument();
  });

  it("renders the empty state with a create affordance", async () => {
    mockClinical({ list: () => jsonResponse([]) });

    renderWorkspace();

    expect(await screen.findByText("Todavía no hay consultas clínicas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva consulta" })).toBeEnabled();
  });

  it("renders a draft encounter and its status badge", async () => {
    mockClinical();

    renderWorkspace();

    expect(await screen.findByText("Limping")).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
  });

  it("mounts the vaccination and deworming section beside the encounter section", async () => {
    mockClinical();

    renderWorkspace();

    // Both entry surfaces coexist: the encounter card is unchanged and the
    // records section is an additional card in the same workspace.
    expect(await screen.findByTestId("vaccination-records")).toBeInTheDocument();
    expect(screen.getByTestId("deworming-records")).toBeInTheDocument();
    expect(screen.getByText("Vacunas y desparasitaciones")).toBeInTheDocument();
    expect(screen.getByText("Ficha clínica")).toBeInTheDocument();
  });

  it("surfaces a generic API error state", async () => {
    mockClinical({
      list: () => jsonResponse({ error: { code: "INTERNAL", message: "Boom" } }, 500),
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    });
  });

  it("renders the permission-denied state on 403 FORBIDDEN", async () => {
    mockClinical({
      list: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();

    await waitFor(() => {
      expect(
        screen.getByText("No tenés permiso para gestionar fichas clínicas.")
      ).toBeInTheDocument();
    });
  });

  it("creates a draft encounter and opens its editor", async () => {
    const encounters: ClinicalEncounter[] = [];
    mockClinical({
      list: () => jsonResponse(encounters),
      create: () => {
        encounters.push(DRAFT);
        return jsonResponse(DRAFT, 201);
      },
    });

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "Nueva consulta" }));

    expect(await screen.findByText("Borrador de ficha clínica creado.")).toBeInTheDocument();
    expect(await screen.findByText(`Consulta ${ENCOUNTER_ID.slice(0, 8)}`)).toBeInTheDocument();
  });

  it("announces create success in a live status region", async () => {
    mockClinical({ list: () => jsonResponse([]) });

    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "Nueva consulta" }));

    const status = await screen.findByText("Borrador de ficha clínica creado.");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("marks the selected encounter with aria-current", async () => {
    mockClinical();

    renderWorkspace();

    const item = await screen.findByRole("button", { name: /Limping/ });
    expect(item).not.toHaveAttribute("aria-current");

    fireEvent.click(item);

    expect(item).toHaveAttribute("aria-current", "true");
  });

  it("autosaves a draft after the debounce with the last-read version", async () => {
    const fetchMock = mockClinical();

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "Updated diagnosis" },
    });

    // No write happens before the debounce window closes.
    expect(saveCalls(fetchMock)).toHaveLength(0);

    await flushAutosave();

    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    const calls = saveCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0]?.[1] as RequestInit).body as string)).toMatchObject({
      version: 1,
      diagnosis: "Updated diagnosis",
    });
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Updated diagnosis");
  });

  it("coalesces rapid edits into a single autosave", async () => {
    const fetchMock = mockClinical();

    renderWorkspace();
    await selectEncounter();
    const diagnosis = await screen.findByLabelText("Diagnóstico");
    fireEvent.change(diagnosis, { target: { value: "One" } });
    fireEvent.change(diagnosis, { target: { value: "Two" } });
    fireEvent.change(diagnosis, { target: { value: "Three" } });

    await flushAutosave();

    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(1);
  });

  it("does not autosave when the draft is reverted to the server value", async () => {
    const fetchMock = mockClinical();

    renderWorkspace();
    await selectEncounter();
    const diagnosis = await screen.findByLabelText("Diagnóstico");
    fireEvent.change(diagnosis, { target: { value: "Temporary" } });
    fireEvent.change(diagnosis, { target: { value: "Soft tissue injury" } });

    await flushAutosave();

    expect(saveCalls(fetchMock)).toHaveLength(0);
    expect(screen.getByText("Todos los cambios están guardados")).toBeInTheDocument();
  });

  it("surfaces an autosave conflict, preserves edits, and clears it on reload", async () => {
    let version = 1;
    let attempt = 0;
    let diagnosis: string | null = "Soft tissue injury";
    mockClinical({
      list: () => jsonResponse([{ ...DRAFT, version }]),
      save: (body) => {
        attempt += 1;
        if (attempt === 1) {
          return jsonResponse(
            {
              error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
            },
            409
          );
        }
        version = 2;
        diagnosis = (body?.diagnosis as string | undefined) ?? diagnosis;
        return jsonResponse({ ...DRAFT, version, diagnosis });
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "Unsaved diagnosis" },
    });
    await flushAutosave();

    expect(
      await screen.findByText(
        "Otra persona modificó esta ficha. Cargá la versión más reciente antes de volver a guardar."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar versión actual" })).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Unsaved diagnosis");

    fireEvent.click(screen.getByRole("button", { name: "Cargar versión actual" }));

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Otra persona modificó esta ficha. Cargá la versión más reciente antes de volver a guardar."
        )
      ).not.toBeInTheDocument();
    });

    await flushAutosave();

    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("suspends autosave across a delayed conflict reload and adopts the refreshed version", async () => {
    let serverVersion = 1;
    let listCalls = 0;
    let releaseReload: (() => void) | undefined;
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    let saveAttempts = 0;
    const savedBodies: Record<string, unknown>[] = [];

    const fetchMock = mockClinical({
      list: async () => {
        listCalls += 1;
        if (listCalls > 1) await reloadGate;
        return jsonResponse([{ ...DRAFT, version: serverVersion }]);
      },
      save: (body) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          // A concurrent writer advanced the server version before our write.
          serverVersion = 2;
          return jsonResponse(
            {
              error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
            },
            409
          );
        }
        savedBodies.push(body ?? {});
        serverVersion += 1;
        return jsonResponse({
          ...DRAFT,
          version: serverVersion,
          diagnosis: body?.diagnosis as string | null,
        });
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "Edited locally" },
    });
    await flushAutosave();

    expect(await screen.findByText(/Otra persona modificó esta ficha/)).toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cargar versión actual" }));

    // The refetch is still pending: no stale-version write may fire yet.
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      releaseReload?.();
      await reloadGate;
      await Promise.resolve();
    });

    await flushAutosave();
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(2));
    expect(savedBodies[0]).toMatchObject({ version: 2, diagnosis: "Edited locally" });
  });

  it("cancels a pending autosave when the editor unmounts", async () => {
    const fetchMock = mockClinical();
    const view = renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "Never persisted" },
    });

    view.unmount();
    await flushAutosave();

    expect(saveCalls(fetchMock)).toHaveLength(0);
  });

  it("does not clobber a newer local edit when a save resolves in flight", async () => {
    // A single mutable server row backs both doubles, so a refetch after a save
    // returns what the save wrote instead of an unrelated seed row. That makes
    // the test assert the guard, not a contradiction between its own doubles.
    let serverRow: ClinicalEncounter = { ...DRAFT };
    let saveAttempts = 0;
    let releaseFirstSave: (() => void) | undefined;
    let releaseSecondSave: (() => void) | undefined;
    const savedBodies: Record<string, unknown>[] = [];

    const fetchMock = mockClinical({
      list: () => jsonResponse([{ ...serverRow }]),
      save: (body) => {
        saveAttempts += 1;
        const submitted = body ?? {};
        if (saveAttempts === 1) {
          return new Promise<Response>((resolve) => {
            releaseFirstSave = () => {
              serverRow = {
                ...serverRow,
                version: serverRow.version + 1,
                diagnosis: submitted.diagnosis as string | null,
              };
              resolve(jsonResponse({ ...serverRow }));
            };
          });
        }
        savedBodies.push(submitted);
        // Gate the follow-up save so the assertion below cannot race its echo
        // and refetch: it is released only after the field is asserted.
        return new Promise<Response>((resolve) => {
          releaseSecondSave = () => {
            serverRow = {
              ...serverRow,
              version: serverRow.version + 1,
              diagnosis: submitted.diagnosis as string | null,
            };
            resolve(jsonResponse({ ...serverRow }));
          };
        });
      },
    });

    renderWorkspace();
    await selectEncounter();
    const diagnosis = await screen.findByLabelText("Diagnóstico");
    fireEvent.change(diagnosis, { target: { value: "First edit" } });
    await flushAutosave();

    expect(saveCalls(fetchMock)).toHaveLength(1);

    // A newer local edit lands while the first write is still in flight.
    fireEvent.change(diagnosis, { target: { value: "Second edit" } });

    await act(async () => {
      releaseFirstSave?.();
      await Promise.resolve();
    });

    // Wait for the first save's echo to be processed, then assert the stale echo
    // ("First edit") did not replace the newer local edit. The follow-up save is
    // still gated, so this cannot be satisfied by a later write restoring it.
    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Second edit");

    await flushAutosave();
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(2));
    await act(async () => {
      releaseSecondSave?.();
      await Promise.resolve();
    });
    expect(savedBodies[0]).toMatchObject({ diagnosis: "Second edit", version: 2 });
  });

  it("does not revert the draft when an older-version refetch lands after a newer save", async () => {
    const staleRow: ClinicalEncounter = { ...DRAFT, version: 1 };
    let listCalls = 0;
    let releaseStaleRefetch: (() => void) | undefined;
    const staleRefetchGate = new Promise<void>((resolve) => {
      releaseStaleRefetch = resolve;
    });

    mockClinical({
      // The first read seeds the draft. The post-save refetch is held open and
      // then resolves with the pre-save row, simulating an out-of-order response
      // that is older than the version the save already applied.
      list: async () => {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse([{ ...DRAFT }]);
        await staleRefetchGate;
        return jsonResponse([{ ...staleRow }]);
      },
      save: (body) =>
        jsonResponse({
          ...DRAFT,
          version: 2,
          diagnosis: body?.diagnosis as string | null,
        }),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "Edited locally" },
    });
    await flushAutosave();

    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    // The save echo advanced the editor to version 2.
    await waitFor(() => expect(screen.getByText(/Versión 2/)).toBeInTheDocument());
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));

    await act(async () => {
      releaseStaleRefetch?.();
      await staleRefetchGate;
    });

    // The stale refetch regressed the query data back to version 1...
    await waitFor(() => expect(screen.getByText(/Versión 1/)).toBeInTheDocument());
    // ...but the monotonic guard must keep the newer draft in place.
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Edited locally");
  });

  it("sends the newer applied version on the next edit after an older-version refetch", async () => {
    const staleRow: ClinicalEncounter = { ...DRAFT, version: 1 };
    let listCalls = 0;
    let releaseStaleRefetch: (() => void) | undefined;
    const staleRefetchGate = new Promise<void>((resolve) => {
      releaseStaleRefetch = resolve;
    });
    const savedBodies: Record<string, unknown>[] = [];

    mockClinical({
      // Same out-of-order refetch as the test above: the post-save read is held
      // and then resolves with the pre-save row.
      list: async () => {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse([{ ...DRAFT }]);
        await staleRefetchGate;
        return jsonResponse([{ ...staleRow }]);
      },
      save: (body) => {
        savedBodies.push(body ?? {});
        return jsonResponse({
          ...DRAFT,
          version: 2,
          diagnosis: body?.diagnosis as string | null,
        });
      },
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "First edit" },
    });
    await flushAutosave();

    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Versión 2/)).toBeInTheDocument());
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));

    await act(async () => {
      releaseStaleRefetch?.();
      await staleRefetchGate;
    });

    // The stale refetch regressed the LIST row back to version 1...
    await waitFor(() => expect(screen.getByText(/Versión 1/)).toBeInTheDocument());

    // ...but the next edit must NOT submit that stale version: the ref the
    // mutation reads stayed at the applied version 2.
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Second edit" },
    });
    await flushAutosave();

    await waitFor(() => expect(savedBodies).toHaveLength(2));
    expect(savedBodies[1]).toMatchObject({ version: 2, diagnosis: "Second edit" });
  });

  it("refuses to install an older-version row on a conflict reload", async () => {
    // The list answers differ per read: the seed (v1), the post-save echo (v2),
    // and the conflict reload, whose out-of-order fetch resolves with a row
    // OLDER than the version the successful save already applied. The reload is
    // only reachable through the conflict flow, so the plain refetch tests above
    // cannot exercise it.
    const autosaveDelayMs = 120;
    let listCalls = 0;
    let saveAttempts = 0;
    const conflictBody = {
      error: { code: "CONFLICT", message: "The encounter was updated by another writer." },
    };

    const fetchMock = mockClinical({
      list: () => {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse([{ ...DRAFT }]); // seed: version 1
        if (listCalls === 2) {
          return jsonResponse([{ ...DRAFT, version: 2, diagnosis: "Saved edit" }]);
        }
        // Conflict reload: same id, OLDER version and older content.
        if (listCalls === 3) {
          return jsonResponse([{ ...DRAFT, diagnosis: "Stale server text" }]);
        }
        return jsonResponse([{ ...DRAFT, version: 3, diagnosis: "Saved edit" }]);
      },
      save: (body) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return jsonResponse({
            ...DRAFT,
            version: 2,
            diagnosis: body?.diagnosis as string | null,
          });
        }
        // A concurrent writer advanced the server before our version-2 write.
        return jsonResponse(conflictBody, 409);
      },
    });

    renderWorkspace({ autosaveDelayMs });
    await selectEncounter();

    // 1) A successful save advances the applied version to 2 and makes
    //    "Saved edit" the clean baseline.
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), {
      target: { value: "Saved edit" },
    });
    await flushAutosave(autosaveDelayMs);
    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Versión 2/)).toBeInTheDocument());

    // 2) The next autosave loses the race and surfaces a conflict.
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Pending edit" } });
    await flushAutosave(autosaveDelayMs);
    expect(await screen.findByText(/Otra persona modificó esta ficha/)).toBeInTheDocument();

    // The user discards the losing edit, so the draft is clean against the
    // applied baseline; autosave stays suspended while the conflict remains.
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Saved edit" } });
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Saved edit");

    // 3) The conflict reload resolves with an OLDER version-1 row. The monotonic
    // guard must refuse to install it as the baseline: adopting the stale content
    // would make the clean draft look dirty and trigger a spurious write.
    fireEvent.click(screen.getByRole("button", { name: "Cargar versión actual" }));
    await waitFor(() => expect(screen.getByText(/Versión 1/)).toBeInTheDocument());

    await flushAutosave(autosaveDelayMs);

    // Only the successful save and the losing one were ever sent: the stale row
    // did not regress the baseline, so the draft never became dirty again.
    expect(saveCalls(fetchMock)).toHaveLength(2);
    expect(screen.getByText("Todos los cambios están guardados")).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Saved edit");
  });

  it("renders a denied create as permission-aware UX and disables the action", async () => {
    mockClinical({
      list: () => jsonResponse([]),
      create: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    const createButton = await screen.findByRole("button", { name: "Nueva consulta" });
    fireEvent.click(createButton);

    expect(
      await screen.findByText("No tenés permiso para gestionar fichas clínicas.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva consulta" })).toBeDisabled();
  });

  it("renders a denied entitlement as permission-aware UX", async () => {
    mockClinical({
      list: () => jsonResponse([]),
      create: () =>
        jsonResponse({ error: { code: "FEATURE_NOT_ENTITLED", message: "Not entitled" } }, 403),
    });

    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Nueva consulta" }));

    expect(
      await screen.findByText("El módulo veterinario no está habilitado para esta organización.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva consulta" })).toBeDisabled();
  });

  it("renders a denied draft autosave as permission-aware UX and stops retrying", async () => {
    const fetchMock = mockClinical({
      save: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText("Diagnóstico"), { target: { value: "Nope" } });
    await flushAutosave();

    expect(
      await screen.findByText("No tenés permiso para gestionar fichas clínicas.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnóstico")).toBeDisabled();

    const attempts = saveCalls(fetchMock).length;
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(attempts);
  });

  it("renders a denied close as permission-aware UX and disables the action", async () => {
    mockClinical({
      close: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    await selectEncounter();
    await confirmClosure();

    expect(
      await screen.findByText("No tenés permiso para gestionar fichas clínicas.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar ficha clínica" })).toBeDisabled();
  });

  it("renders a denied amendment as permission-aware UX and disables the action", async () => {
    mockClinical({
      list: () => jsonResponse([CLOSED]),
      amend: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText(/Motivo de la enmienda/), {
      target: { value: "Correct the diagnosis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar enmienda" }));

    expect(
      await screen.findByText("No tenés permiso para gestionar fichas clínicas.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar enmienda" })).toBeDisabled();
    expect(screen.getByLabelText(/Motivo de la enmienda/)).toBeDisabled();
  });

  it("closes a draft encounter and swaps to the amendment form", async () => {
    let status: ClinicalEncounter["status"] = "DRAFT";
    const fetchMock = mockClinical({
      list: () => jsonResponse([{ ...DRAFT, status }]),
      close: () => {
        status = "CLOSED";
        return jsonResponse(CLOSED);
      },
    });

    renderWorkspace();
    await selectEncounter();
    await confirmClosure();

    expect(await screen.findByText("Ficha clínica cerrada.")).toBeInTheDocument();
    expect(await screen.findByText("Enmendar ficha clínica cerrada")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/close`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("records an amendment for a closed encounter", async () => {
    const fetchMock = mockClinical({ list: () => jsonResponse([CLOSED]) });

    renderWorkspace();
    await selectEncounter();
    fireEvent.change(await screen.findByLabelText(/Motivo de la enmienda/), {
      target: { value: "Correct the diagnosis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar enmienda" }));

    expect(await screen.findByText("Enmienda registrada.")).toBeInTheDocument();

    const amendCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        resolveRequestUrl(input as RequestInfo | URL).endsWith(
          `/api/clinical/${PATIENT_ID}/encounters/${ENCOUNTER_ID}/amendments`
        ) && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(amendCall).toBeDefined();
    expect(JSON.parse((amendCall?.[1] as RequestInit).body as string)).toEqual({
      reason: "Correct the diagnosis",
    });
  });

  it("keeps staff internal notes out of the client summary region", async () => {
    mockClinical();

    renderWorkspace();
    await selectEncounter();

    const staffNotes = await screen.findByTestId("staff-internal-notes");
    expect(within(staffNotes).getByDisplayValue("Owner non-compliance note")).toBeInTheDocument();

    const summary = screen.getByLabelText("Resumen para el cliente");
    expect(summary).toHaveValue("Mild sprain summary");
    expect(summary).not.toHaveValue("Owner non-compliance note");
  });
});

/** Route unmount/remount with the same root QueryClient, as App Router does. */
function mountRecoveryWorkspace(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ClinicalWorkspace patientId={PATIENT_ID} autosaveDelayMs={AUTOSAVE_MS} />
    </QueryClientProvider>
  );
}

describe("clinical route recovery (TD-065)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("restores pending text and selected encounter on return without an automatic write", async () => {
    const fetchMock = mockClinical();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountRecoveryWorkspace(client);
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Recuperar al volver" },
    });
    first.unmount();
    mountRecoveryWorkspace(client);
    expect(await screen.findByLabelText("Diagnóstico")).toHaveValue("Recuperar al volver");
    expect(screen.getByText(/Recuperamos los cambios pendientes/)).toBeInTheDocument();
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(saveCalls(fetchMock)).toHaveLength(1));
    expect(await screen.findByText("Todos los cambios están guardados")).toBeInTheDocument();
    expect(readClinicalRecovery(client, PATIENT_ID)).toBeUndefined();
    client.clear();
  });

  it("retains a failed save across leaving and returning", async () => {
    const fetchMock = mockClinical({
      save: () => jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Failed" } }, 500),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountRecoveryWorkspace(client);
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Error recuperable" },
    });
    await flushAutosave();
    await screen.findByText(/usá Guardar borrador/);
    first.unmount();
    mountRecoveryWorkspace(client);
    expect(await screen.findByLabelText("Diagnóstico")).toHaveValue("Error recuperable");
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(1);
    client.clear();
  });

  it("blocks overwriting a server version changed while away", async () => {
    let server = { ...DRAFT };
    const fetchMock = mockClinical({ list: () => jsonResponse([server]) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountRecoveryWorkspace(client);
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Texto local" } });
    first.unmount();
    server = { ...DRAFT, version: 3, diagnosis: "Cambio externo" };
    mountRecoveryWorkspace(client);
    expect(await screen.findByText(/Otra persona modificó/)).toBeInTheDocument();
    expect(screen.getByLabelText("Diagnóstico")).toHaveValue("Texto local");
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    await flushAutosave();
    expect(saveCalls(fetchMock)).toHaveLength(0);
    client.clear();
  });

  it("does not expose recovery from stale cached data before a denied fresh read", async () => {
    let denied = false;
    mockClinical({
      list: () =>
        denied
          ? jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403)
          : jsonResponse([DRAFT]),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountRecoveryWorkspace(client);
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Contenido reservado" },
    });
    first.unmount();
    denied = true;
    mountRecoveryWorkspace(client);
    await waitFor(() => expect(readClinicalRecovery(client, PATIENT_ID)).toBeUndefined());
    expect(screen.queryByDisplayValue("Contenido reservado")).not.toBeInTheDocument();
    expect(screen.queryByText("Contenido reservado")).not.toBeInTheDocument();
    client.clear();
  });

  it("shows recovered content read-only if the server encounter closed while away", async () => {
    let server = { ...DRAFT };
    const fetchMock = mockClinical({ list: () => jsonResponse([server]) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountRecoveryWorkspace(client);
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Recuperado sin aplicar" },
    });
    first.unmount();
    server = { ...CLOSED, version: 2 };
    mountRecoveryWorkspace(client);
    expect(await screen.findByText("Recuperado sin aplicar")).toBeInTheDocument();
    expect(screen.queryByLabelText("Diagnóstico")).not.toBeInTheDocument();
    expect(saveCalls(fetchMock)).toHaveLength(0);
    client.clear();
  });

  it("reconciles an in-flight save that succeeds after unmount without losing a newer edit", async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    mockClinical({
      save: () =>
        new Promise<Response>((resolve) => {
          resolveSave = resolve;
        }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountRecoveryWorkspace(client);
    await selectEncounter();
    fireEvent.change(screen.getByLabelText("Diagnóstico"), { target: { value: "Enviado" } });
    await flushAutosave();
    await waitFor(() => expect(resolveSave).toBeDefined());
    fireEvent.change(screen.getByLabelText("Diagnóstico"), {
      target: { value: "Edición posterior" },
    });
    first.unmount();
    await act(async () => {
      resolveSave?.(jsonResponse({ ...DRAFT, version: 2, diagnosis: "Enviado" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(readClinicalRecovery(client, PATIENT_ID)?.version).toBe(2));
    expect(readClinicalRecovery(client, PATIENT_ID)?.content.diagnosis).toBe("Edición posterior");
    expect(readClinicalRecovery(client, PATIENT_ID)?.baseline.diagnosis).toBe("Enviado");
    client.clear();
  });

  it("isolates memory by patient and QueryClient and expires or clears recovery", () => {
    const client = new QueryClient();
    const other = new QueryClient();
    const content = {
      reasonForVisit: null,
      anamnesis: null,
      diagnosis: "Texto",
      treatmentPlan: null,
      internalNotes: null,
      clientSummary: null,
    };
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    retainClinicalRecovery(client, PATIENT_ID, {
      encounterId: ENCOUNTER_ID,
      version: 1,
      baseline: content,
      content,
    });
    expect(readClinicalRecovery(client, AMENDMENT_ID)).toBeUndefined();
    expect(readClinicalRecovery(other, PATIENT_ID)).toBeUndefined();
    clock.mockReturnValue(now + CLINICAL_RECOVERY_MS);
    expect(readClinicalRecovery(client, PATIENT_ID)).toBeUndefined();
    retainClinicalRecovery(client, PATIENT_ID, {
      encounterId: ENCOUNTER_ID,
      version: 1,
      baseline: content,
      content,
    });
    clearClinicalRecovery(client, PATIENT_ID);
    expect(readClinicalRecovery(client, PATIENT_ID)).toBeUndefined();
    client.clear();
    other.clear();
  });
});
