import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { PatientsList } from "./patients-list";
import NewPatientPage from "./new/page";
import EditPatientPage from "./[id]/edit/page";

/**
 * UX-037: the patients list and the create/edit routes offer only what the
 * caller's capabilities allow. Unknown capabilities keep every action.
 */
const ID = "11111111-1111-4111-8111-111111111111";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const ALL = ["patients.read", "patients.create", "patients.update", "patients.deactivate"];
const ROW = {
  id: ID,
  name: "Rex",
  speciesName: "Canine",
  breedName: null,
  sex: "MALE",
  isActive: true,
  primaryGuardianName: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: RequestInfo | URL) => {
    const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (path === "/api/patients/search") {
      return Promise.resolve(
        json({
          items: [ROW],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          canReadGuardians: false,
        })
      );
    }
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(ui: ReactNode, capabilities?: Capabilities): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
  render(
    capabilities === undefined ? (
      tree
    ) : (
      <CapabilitiesProvider value={capabilities}>{tree}</CapabilitiesProvider>
    )
  );
}

describe("Patients list gated by capabilities (UX-037)", () => {
  it("shows a no-access state and searches nothing without patients.read", async () => {
    mount(<PatientsList />, { permissions: [] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para ver los pacientes" })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides create, edit and deactivate for a read-only caller", async () => {
    mount(<PatientsList />, { permissions: ["patients.read"] });
    expect(await screen.findByRole("link", { name: "Rex" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Nuevo paciente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it.each([
    ["granted", { permissions: ALL, features: ["veterinary"] }],
    ["unknown", undefined],
  ])("offers every action when capabilities are %s", async (_label, capabilities) => {
    mount(<PatientsList />, capabilities);
    expect(await screen.findByRole("link", { name: "Rex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nuevo paciente/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });
});

describe("Patient create and edit routes gated by capabilities (UX-037)", () => {
  it("refuses the create form without patients.create", async () => {
    mount(<NewPatientPage />, { permissions: ["patients.read"] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para crear pacientes" })
    ).toBeInTheDocument();
  });

  it("refuses the edit form without patients.update and reads nothing", async () => {
    mount(<EditPatientPage />, { permissions: ["patients.read"] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para editar pacientes" })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["granted", { permissions: ALL }],
    ["unknown", undefined],
  ])("keeps the create form when capabilities are %s", (_label, capabilities) => {
    mount(<NewPatientPage />, capabilities);
    expect(
      screen.queryByRole("heading", { name: "No tenés permiso para crear pacientes" })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
