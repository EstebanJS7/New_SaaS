import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function mockFetch(overrides?: { patient?: () => Response }): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/patients/patient-1/guardians"))
      return Promise.resolve(jsonResponse(GUARDIANS));
    if (url.endsWith("/api/patients/patient-1"))
      return Promise.resolve(overrides?.patient?.() ?? jsonResponse(PATIENT));
    if (url.endsWith("/api/patients/catalog")) return Promise.resolve(jsonResponse(SPECIES));
    if (url.endsWith("/api/customers")) return Promise.resolve(jsonResponse(CUSTOMERS));
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
}

describe("PatientDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the patient identity and its guardian, disabling promotion of the primary", async () => {
    mockFetch();

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

  it("maps a 403 to the permission UX copy", async () => {
    mockFetch({
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
    mockFetch({
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
