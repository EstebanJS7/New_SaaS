import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatientDetail } from "./patient-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "patient-1" }),
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
  id: "patient-1",
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
    patientId: "patient-1",
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
    patientId: "patient-1",
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
    if (url.endsWith("/api/patients/patient-1/guardians/guardian-2/primary")) {
      return Promise.resolve(
        overrides.setPrimary?.() ?? jsonResponse({ ...GUARDIANS_TWO[1], isPrimary: true })
      );
    }
    if (url.endsWith("/api/patients/patient-1/guardians") && method === "POST") {
      return Promise.resolve(overrides.createGuardian?.() ?? jsonResponse(GUARDIANS_TWO[1], 201));
    }
    if (url.endsWith("/api/patients/patient-1/guardians")) {
      return Promise.resolve(overrides.guardians?.() ?? jsonResponse(GUARDIANS));
    }
    if (url.endsWith("/api/patients/patient-1/deactivate")) {
      return Promise.resolve(
        overrides.deactivatePatient?.() ?? jsonResponse({ ...PATIENT, isActive: false })
      );
    }
    if (url.endsWith("/api/patients/patient-1")) {
      return Promise.resolve(overrides.patient?.() ?? jsonResponse(PATIENT));
    }
    if (url.endsWith("/api/patients/catalog")) {
      return Promise.resolve(overrides.catalog?.() ?? jsonResponse(SPECIES));
    }
    if (url.endsWith("/api/customers")) {
      return Promise.resolve(overrides.customers?.() ?? jsonResponse(CUSTOMERS));
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
  const row = screen.getByText(displayName).closest("div.flex.items-start");
  if (!row) {
    throw new Error(`Guardian row not found for ${displayName}`);
  }
  return row as HTMLElement;
}

describe("PatientDetail", () => {
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
    expect(await screen.findByText("Ana Gomez")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();

    const makePrimary = screen.getByRole("button", { name: "Make primary" });
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

    expect(await screen.findByText("Loading patient...")).toBeInTheDocument();
    expect(screen.getByText("Loading guardians...")).toBeInTheDocument();
  });

  it("renders the empty guardian state for a patient with no links", async () => {
    mockWorkflow({ guardians: () => jsonResponse([]) });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    expect(await screen.findByText("No guardians yet.")).toBeInTheDocument();
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
      expect(
        screen.getByText("You do not have permission to manage patients.")
      ).toBeInTheDocument();
    });
  });

  it("links a candidate customer as a guardian through the form", async () => {
    const fetchMock = mockWorkflow({ guardians: () => jsonResponse([]) });

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    await screen.findByText("No guardians yet.");
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "customer-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Link guardian" }));

    await waitFor(() => {
      expect(screen.getByText("Guardian linked.")).toBeInTheDocument();
    });

    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        resolveRequestUrl(input as RequestInfo | URL).endsWith(
          "/api/patients/patient-1/guardians"
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
    expect(within(initialRow).queryByText("Primary")).not.toBeInTheDocument();
    const betoPromote = within(initialRow).getByRole("button", { name: "Make primary" });
    expect(betoPromote).toBeEnabled();
    const getCallsBefore = guardiansGetCalls;

    fireEvent.click(betoPromote);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/patients/patient-1/guardians/guardian-2/primary",
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
      expect(within(promotedRow).getByText("Primary")).toBeInTheDocument();
      expect(within(promotedRow).getByRole("button", { name: "Make primary" })).toBeDisabled();
    });

    const demotedRow = guardianRow("Ana Gomez");
    expect(within(demotedRow).queryByText("Primary")).not.toBeInTheDocument();
    expect(within(demotedRow).getByRole("button", { name: "Make primary" })).toBeEnabled();
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
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <TestWrapper>
        <PatientDetail />
      </TestWrapper>
    );

    const deactivate = await screen.findByRole("button", { name: "Deactivate" });
    fireEvent.click(deactivate);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/patients/patient-1/deactivate",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByText("Inactive")).toBeInTheDocument();
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
      expect(
        screen.getByText("You do not have permission to manage patients.")
      ).toBeInTheDocument();
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
        screen.getByText("The veterinary module is not enabled for this tenant.")
      ).toBeInTheDocument();
    });
  });
});
