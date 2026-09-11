import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatientForm } from "./patient-form";

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

function mockFetch(): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/patients/catalog")) return Promise.resolve(jsonResponse(SPECIES));
    if (url.endsWith("/api/customers")) return Promise.resolve(jsonResponse(CUSTOMERS));
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
}

describe("PatientForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits an active create with the selected primary guardian", async () => {
    mockFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "Dog" });
    await screen.findByRole("option", { name: "Ana Gomez" });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rex" } });
    fireEvent.change(screen.getByLabelText("Species"), { target: { value: "species-1" } });
    fireEvent.change(screen.getByLabelText("Primary guardian"), {
      target: { value: "customer-1" },
    });

    fireEvent.submit(screen.getByRole("button", { name: "Create patient" }).closest("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Rex",
        speciesId: "species-1",
        sex: "UNKNOWN",
        isActive: true,
        primaryGuardianCustomerId: "customer-1",
      });
    });
  });

  it("omits the guardian when an inactive create is chosen", async () => {
    mockFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "Dog" });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Milo" } });
    fireEvent.change(screen.getByLabelText("Species"), { target: { value: "species-1" } });
    fireEvent.click(screen.getByLabelText("Active"));

    expect(screen.queryByLabelText("Primary guardian")).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: "Create patient" }).closest("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Milo",
        speciesId: "species-1",
        sex: "UNKNOWN",
        isActive: false,
      });
    });
  });

  it("renders the API error passed by the mutation", () => {
    mockFetch();

    render(
      <TestWrapper>
        <PatientForm
          onSubmit={vi.fn()}
          isPending={false}
          error={new Error("Invalid patient create body.")}
        />
      </TestWrapper>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid patient create body.");
  });
});
