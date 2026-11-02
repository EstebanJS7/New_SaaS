import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiRequestError, type Patient } from "./patients-api";
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

const PATIENT: Patient = {
  id: "patient-1",
  tenantId: "tenant-a",
  name: "Rex",
  speciesId: "species-1",
  breedId: "breed-1",
  sex: "MALE",
  birthDate: "2020-05-01T00:00:00.000Z",
  isActive: true,
  createdAt: "",
  updatedAt: "",
};
async function fillActive() {
  await screen.findByRole("option", { name: "Dog" });
  await screen.findByRole("option", { name: "Ana Gomez" });
  fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), { target: { value: "Rex" } });
  fireEvent.change(screen.getByLabelText("Especie (obligatorio)"), {
    target: { value: "species-1" },
  });
  fireEvent.change(screen.getByLabelText(/Responsable principal/), {
    target: { value: "customer-1" },
  });
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: /Crear paciente|Guardar cambios/ }).closest("form")!
  );
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

    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), { target: { value: "Rex" } });
    fireEvent.change(screen.getByLabelText("Especie (obligatorio)"), {
      target: { value: "species-1" },
    });
    fireEvent.change(screen.getByLabelText(/Responsable principal/), {
      target: { value: "customer-1" },
    });

    fireEvent.submit(screen.getByRole("button", { name: "Crear paciente" }).closest("form")!);

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

    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), { target: { value: "Milo" } });
    fireEvent.change(screen.getByLabelText("Especie (obligatorio)"), {
      target: { value: "species-1" },
    });
    fireEvent.click(screen.getByLabelText("Paciente activo"));

    expect(screen.queryByLabelText(/Responsable principal/)).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: "Crear paciente" }).closest("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Milo",
        speciesId: "species-1",
        sex: "UNKNOWN",
        isActive: false,
      });
    });
  });

  it("renders a safe error without exposing the arbitrary mutation message", () => {
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

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos completar la solicitud de pacientes."
    );
    expect(screen.queryByText("Invalid patient create body.")).not.toBeInTheDocument();
  });
});

describe("Patient identity interaction", () => {
  afterEach(() => vi.restoreAllMocks());
  it("keeps oversized text, links its error and focuses the first invalid field without sending", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillActive();
    const name = screen.getByLabelText("Nombre (obligatorio)");
    fireEvent.change(name, { target: { value: "a".repeat(201) } });
    submit();
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveValue("a".repeat(201));
    expect(screen.getByText("Usá hasta 200 caracteres.")).toHaveAttribute("id", "name-help");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Rex" } });
    expect(name).toHaveAttribute("aria-invalid", "false");
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });
  it("requires a guardian only on active creation", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillActive();
    fireEvent.change(screen.getByLabelText(/Responsable principal/), { target: { value: "" } });
    submit();
    await waitFor(() => expect(screen.getByLabelText(/Responsable principal/)).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("preserves changed-fields-only edits and clears breed/date with null without changing calendar dates", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm patient={PATIENT} onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await screen.findByRole("option", { name: "Dog" });
    expect(screen.getByLabelText(/Fecha de nacimiento/)).toHaveValue("2020-05-01");
    expect(screen.getByText(/Fecha seleccionada: 1 may. 2020/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Raza/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/), { target: { value: "" } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ breedId: null, birthDate: null }));
  });
  it("reactivation sends the explicit guardian while unrelated identity stays omitted", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm
          patient={{ ...PATIENT, isActive: false }}
          onSubmit={onSubmit}
          isPending={false}
          error={null}
        />
      </TestWrapper>
    );
    await screen.findByRole("option", { name: "Dog" });
    fireEvent.click(screen.getByLabelText("Paciente activo"));
    await screen.findByRole("option", { name: "Ana Gomez" });
    fireEvent.change(screen.getByLabelText(/Responsable principal/), {
      target: { value: "customer-1" },
    });
    submit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        isActive: true,
        primaryGuardianCustomerId: "customer-1",
      })
    );
  });
  it("serializes birth date without browser timezone conversion and blocks overlapping submits", async () => {
    mockFetch();
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillActive();
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/), {
      target: { value: "2020-05-01" },
    });
    submit();
    submit();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: "2020-05-01T00:00:00.000Z" })
    );
  });
  it("does not replay an uncertain command even after editing and retains values", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm
          onSubmit={onSubmit}
          isPending={false}
          error={new ApiRequestError("NETWORK_ERROR", "private", 0, true)}
        />
      </TestWrapper>
    );
    await fillActive();
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Crear paciente" })).toBeDisabled();
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Rex");
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar");
  });
  it("distinguishes failed catalog from empty and only retries a read explicitly", async () => {
    let calls = 0;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).endsWith("/catalog")
      ) {
        calls++;
        return Promise.resolve(
          calls === 1
            ? jsonResponse({ error: { code: "FORBIDDEN", message: "PRIVATE" } }, 403)
            : jsonResponse([])
        );
      }
      return Promise.resolve(jsonResponse(CUSTOMERS));
    });
    render(
      <TestWrapper>
        <PatientForm onSubmit={vi.fn()} isPending={false} error={null} />
      </TestWrapper>
    );
    await screen.findByText("No tenés permiso para gestionar pacientes.");
    expect(calls).toBe(1);
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear paciente" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
    await screen.findByText(/No hay especies disponibles/);
    expect(calls).toBe(2);
  });
  it("protects the working copy on cancel and beforeunload without sending", async () => {
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
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillActive();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Rex");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Patient optional date validity", () => {
  afterEach(() => vi.restoreAllMocks());
  it("does not silently omit an incomplete native date just because its value is empty", async () => {
    mockFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <PatientForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillActive();
    const date = screen.getByLabelText(/Fecha de nacimiento/);
    // Native date controls expose empty value plus badInput while a segment is incomplete.
    Object.defineProperty(date, "validity", {
      configurable: true,
      value: { valid: false, badInput: true },
    });
    submit();
    await waitFor(() => expect(date).toHaveFocus());
    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Revisá la fecha de nacimiento.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
