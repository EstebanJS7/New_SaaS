import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatientDetail } from "./patient-detail";

/**
 * The mounted clinical client (WU4A) validates every patient id as a canonical
 * UUID before it builds a proxy path, so the fixture and the `useParams` id must
 * be a UUID rather than the earlier `patient-1` placeholder. Without this, the
 * mounted ClinicalWorkspace renders its INVALID_IDENTIFIER ("Invalid patient
 * id.") state instead of issuing a request.
 */
const { PATIENT_ID } = vi.hoisted(() => ({
  PATIENT_ID: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: PATIENT_ID }),
}));

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

const PATIENT = {
  id: PATIENT_ID,
  tenantId: "tenant-a",
  name: "Rex",
  speciesId: "species-1",
  breedId: "breed-1",
  sex: "MALE",
  birthDate: "2020-05-01T00:00:00.000Z",
  isActive: true,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};

const SPECIES = [
  {
    id: "species-1",
    code: "DOG",
    name: "Dog",
    breeds: [{ id: "breed-1", code: "LAB", name: "Labrador" }],
  },
];

const CUSTOMERS = [
  {
    id: "customer-1",
    tenantId: "tenant-a",
    kind: "INDIVIDUAL",
    displayName: "Ana Gomez",
    legalName: null,
    taxId: null,
    firstName: "Ana",
    lastName: "Gomez",
    documentNumber: null,
    isActive: true,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  },
  {
    id: "customer-2",
    tenantId: "tenant-a",
    kind: "INDIVIDUAL",
    displayName: "Beto Diaz",
    legalName: null,
    taxId: null,
    firstName: "Beto",
    lastName: "Diaz",
    documentNumber: null,
    isActive: true,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  },
];

const GUARDIANS = [
  {
    id: "guardian-1",
    tenantId: "tenant-a",
    patientId: PATIENT_ID,
    customerId: "customer-1",
    isPrimary: true,
    isActive: true,
    position: 0,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  },
];

const GUARDIANS_TWO = [
  ...GUARDIANS,
  {
    id: "guardian-2",
    tenantId: "tenant-a",
    patientId: PATIENT_ID,
    customerId: "customer-2",
    isPrimary: false,
    isActive: true,
    position: 1,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  },
];

type Handler = () => Response | Promise<Response>;

interface WorkflowOverrides {
  readonly patient?: Handler;
  readonly guardians?: Handler;
  readonly customers?: Handler;
  readonly catalog?: Handler;
  readonly createGuardian?: Handler;
  readonly setPrimary?: Handler;
  readonly deactivatePatient?: Handler;
}

/**
 * URL + method aware fetch double for the staff detail workflow. The default
 * handlers render one primary guardian; overrides exercise loading/empty/error
 * and mutation flows without touching the real proxy or API.
 */
function mockWorkflow(overrides: WorkflowOverrides = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const method = init?.method ?? "GET";
    if (url.endsWith(`/api/patients/${PATIENT_ID}/guardians/guardian-2/primary`)) {
      return Promise.resolve(
        overrides.setPrimary?.() ?? jsonResponse({ ...GUARDIANS_TWO[1], isPrimary: true })
      );
    }
    if (url.endsWith(`/api/patients/${PATIENT_ID}/guardians`) && method === "POST") {
      return Promise.resolve(overrides.createGuardian?.() ?? jsonResponse(GUARDIANS_TWO[1], 201));
    }
    if (url.endsWith(`/api/patients/${PATIENT_ID}/guardians`)) {
      return Promise.resolve(overrides.guardians?.() ?? jsonResponse(GUARDIANS));
    }
    if (url.endsWith(`/api/patients/${PATIENT_ID}/deactivate`)) {
      return Promise.resolve(
        overrides.deactivatePatient?.() ?? jsonResponse({ ...PATIENT, isActive: false })
      );
    }
    if (url.endsWith(`/api/patients/${PATIENT_ID}`)) {
      return Promise.resolve(overrides.patient?.() ?? jsonResponse(PATIENT));
    }
    if (url.endsWith("/api/patients/catalog")) {
      return Promise.resolve(overrides.catalog?.() ?? jsonResponse(SPECIES));
    }
    if (url.endsWith("/api/customers")) {
      return Promise.resolve(overrides.customers?.() ?? jsonResponse(CUSTOMERS));
    }
    // Patient detail now also mounts the vaccination/deworming section
    // (EPIC-18 REP-010). These lists are unrelated to the detail workflow, so
    // they answer empty instead of falling through to the 404 below — which
    // would make "No encontramos la ficha clínica." ambiguous for the encounter test.
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

/**
 * Resolves the guardian row (name, Primary badge, action buttons) for a
 * customer display name, so assertions are scoped to the promoted/demoted item
 * instead of the whole document.
 */
function guardianRow(displayName: string): HTMLElement {
  return screen.getByRole("group", { name: `Responsable ${displayName}` });
}

describe("PatientDetail", () => {
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

  it("renders the patient identity and its guardian, disabling promotion of the primary", async () => {
    mockWorkflow();

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    expect(await screen.findByRole("heading", { name: "Rex" })).toBeInTheDocument();
    expect(await screen.findAllByText("Ana Gomez")).toHaveLength(2);
    expect(screen.getByText("Principal")).toBeInTheDocument();

    const makePrimary = screen.getByRole("button", { name: "Marcar principal" });
    expect(makePrimary).toBeDisabled();
  });

  it("renders the loading state for the patient and guardian queries", async () => {
    // Handlers that never settle keep both queries in their loading state.
    mockWorkflow({
      patient: () => new Promise<Response>(() => undefined),
      guardians: () => new Promise<Response>(() => undefined),
    });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Cargando paciente…")).toBeInTheDocument();
    expect(screen.getByText("Cargando responsables…")).toBeInTheDocument();
  });

  it("renders the empty guardian state for a patient with no links", async () => {
    mockWorkflow({ guardians: () => jsonResponse([]) });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("Todavía no hay responsables vinculados.")).toBeInTheDocument();
  });

  it("surfaces the guardian list error state", async () => {
    mockWorkflow({
      guardians: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Denied" } }, 403),
    });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("No tenés permiso para gestionar pacientes.")).toBeInTheDocument();
    });
  });

  it("links a candidate customer as a guardian through the form", async () => {
    const fetchMock = mockWorkflow({ guardians: () => jsonResponse([]) });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    await screen.findByText("Todavía no hay responsables vinculados.");
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "customer-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular responsable" }));

    await waitFor(() => {
      expect(screen.getByText("Responsable vinculado.")).toBeInTheDocument();
    });

    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        resolveRequestUrl(input as RequestInfo | URL).endsWith(
          `/api/patients/${PATIENT_ID}/guardians`
        ) && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toEqual({
      customerId: "customer-2",
      isPrimary: false,
    });
  });

  it("promotes a secondary guardian and refetches the list into the promoted state", async () => {
    // Stateful double: the POST flips the server-side primary, and the next
    // guardians GET returns the flipped list. A stale list (no refetch or a
    // refetch that never reflects the promotion) fails the rendered assertions.
    let primaryGuardianId = "guardian-1";
    let guardiansGetCalls = 0;
    const guardiansWithPrimary = () =>
      GUARDIANS_TWO.map((guardian) => ({
        ...guardian,
        isPrimary: guardian.id === primaryGuardianId,
      }));

    const fetchMock = mockWorkflow({
      guardians: () => {
        guardiansGetCalls += 1;
        return jsonResponse(guardiansWithPrimary());
      },
      setPrimary: () => {
        primaryGuardianId = "guardian-2";
        return jsonResponse({ ...GUARDIANS_TWO[1], isPrimary: true });
      },
    });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    await screen.findByText("Beto Diaz");
    const initialRow = guardianRow("Beto Diaz");
    expect(within(initialRow).queryByText("Principal")).not.toBeInTheDocument();
    const betoPromote = within(initialRow).getByRole("button", { name: "Marcar principal" });
    expect(betoPromote).toBeEnabled();
    const getCallsBefore = guardiansGetCalls;

    fireEvent.click(betoPromote);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/patients/${PATIENT_ID}/guardians/guardian-2/primary`,
        expect.objectContaining({ method: "POST" })
      );
    });

    // The mutation must invalidate the guardians query and trigger a refetch.
    await waitFor(() => {
      expect(guardiansGetCalls).toBeGreaterThan(getCallsBefore);
    });

    // The refetched data must render the promoted guardian as Primary and its
    // button disabled, while the demoted guardian becomes promotable.
    await waitFor(() => {
      const promotedRow = guardianRow("Beto Diaz");
      expect(within(promotedRow).getByText("Principal")).toBeInTheDocument();
      expect(within(promotedRow).getByRole("button", { name: "Marcar principal" })).toBeDisabled();
    });

    const demotedRow = guardianRow("Ana Gomez");
    expect(within(demotedRow).queryByText("Principal")).not.toBeInTheDocument();
    expect(within(demotedRow).getByRole("button", { name: "Marcar principal" })).toBeEnabled();
  });

  it("deactivates the patient after confirmation and reflects the inactive state", async () => {
    let deactivated = false;
    const fetchMock = mockWorkflow({
      guardians: () => jsonResponse([]),
      patient: () => jsonResponse(deactivated ? { ...PATIENT, isActive: false } : PATIENT),
      deactivatePatient: () => {
        deactivated = true;
        return jsonResponse({ ...PATIENT, isActive: false });
      },
    });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    const deactivate = await screen.findByRole("button", { name: "Desactivar paciente" });
    fireEvent.click(deactivate);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Desactivar paciente" })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/patients/${PATIENT_ID}/deactivate`,
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
  });

  it("maps a 403 to the permission UX copy", async () => {
    mockWorkflow({
      patient: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("No tenés permiso para gestionar pacientes.")).toBeInTheDocument();
    });
  });

  it("surfaces the veterinary entitlement UX copy on 403 FEATURE_NOT_ENTITLED", async () => {
    mockWorkflow({
      patient: () =>
        jsonResponse({ error: { code: "FEATURE_NOT_ENTITLED", message: "Not entitled" } }, 403),
    });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(
        screen.getByText("El módulo veterinario no está habilitado para esta organización.")
      ).toBeInTheDocument();
    });
  });

  it("mounts the clinical workspace with a canonical patient id instead of the invalid-identifier state", async () => {
    const fetchMock = mockWorkflow();

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    // A canonical UUID satisfies the clinical client identifier guard, so the
    // encounter list request reaches the proxy and settles on the stubbed API
    // error instead of the INVALID_IDENTIFIER ("Invalid patient id.") UX.
    expect(await screen.findByText("No encontramos la ficha clínica.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid patient id.")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        resolveRequestUrl(input as RequestInfo | URL).endsWith(
          `/api/clinical/${PATIENT_ID}/encounters`
        )
      )
    ).toBe(true);
  });
});
