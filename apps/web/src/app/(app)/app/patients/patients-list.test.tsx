import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatientsList } from "./patients-list";

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

function mockFetchByUrl(handlers: { patients?: () => Response; catalog?: () => Response }): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/patients/catalog")) {
      return Promise.resolve(handlers.catalog?.() ?? jsonResponse([]));
    }
    if (url.endsWith("/api/patients")) {
      return Promise.resolve(handlers.patients?.() ?? jsonResponse([]));
    }
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
}

const SPECIES = [
  {
    id: "species-1",
    code: "DOG",
    name: "Dog",
    breeds: [{ id: "breed-1", code: "LAB", name: "Labrador" }],
  },
];

describe("PatientsList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a permission-denied UX message when the API returns 403", async () => {
    mockFetchByUrl({
      patients: () => jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403),
    });

    render(
      <TestWrapper>
        <PatientsList />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to manage patients.")
      ).toBeInTheDocument();
    });
  });

  it("renders an unauthenticated UX message when the API returns 401", async () => {
    mockFetchByUrl({
      patients: () =>
        jsonResponse(
          { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
          401
        ),
    });

    render(
      <TestWrapper>
        <PatientsList />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("You must be signed in to view patients.")).toBeInTheDocument();
    });
  });

  it("renders the veterinary entitlement UX message when the API returns 403 FEATURE_NOT_ENTITLED", async () => {
    mockFetchByUrl({
      patients: () =>
        jsonResponse({ error: { code: "FEATURE_NOT_ENTITLED", message: "Not entitled" } }, 403),
    });

    render(
      <TestWrapper>
        <PatientsList />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(
        screen.getByText("The veterinary module is not enabled for this tenant.")
      ).toBeInTheDocument();
    });
  });

  it("renders the empty state when the tenant has no patients", async () => {
    mockFetchByUrl({ patients: () => jsonResponse([]) });

    render(
      <TestWrapper>
        <PatientsList />
      </TestWrapper>
    );

    expect(await screen.findByText("No patients yet")).toBeInTheDocument();
  });

  it("lists patients and filters them client-side by name", async () => {
    mockFetchByUrl({
      patients: () =>
        jsonResponse([
          {
            id: "patient-1",
            tenantId: "tenant-a",
            name: "Rex",
            speciesId: "species-1",
            breedId: "breed-1",
            sex: "MALE",
            birthDate: null,
            isActive: true,
            createdAt: "2026-09-11T00:00:00.000Z",
            updatedAt: "2026-09-11T00:00:00.000Z",
          },
          {
            id: "patient-2",
            tenantId: "tenant-a",
            name: "Milo",
            speciesId: "species-1",
            breedId: null,
            sex: "FEMALE",
            birthDate: null,
            isActive: true,
            createdAt: "2026-09-11T00:00:00.000Z",
            updatedAt: "2026-09-11T00:00:00.000Z",
          },
        ]),
      catalog: () => jsonResponse(SPECIES),
    });

    render(
      <TestWrapper>
        <PatientsList />
      </TestWrapper>
    );

    expect(await screen.findByText("Rex")).toBeInTheDocument();
    expect(screen.getByText("Milo")).toBeInTheDocument();
    // Species resolved from the global catalog once its query resolves.
    await waitFor(() => {
      expect(screen.getAllByText(/Dog/).length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "rex" } });

    await waitFor(() => {
      expect(screen.queryByText("Milo")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Rex")).toBeInTheDocument();
  });
});
