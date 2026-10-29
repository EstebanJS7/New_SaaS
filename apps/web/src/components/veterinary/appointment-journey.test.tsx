import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppointmentJourney } from "./appointment-journey";

const APPOINTMENT = "11111111-1111-4111-8111-111111111111";
const PATIENT = "22222222-2222-4222-8222-222222222222";
function setup({
  id = APPOINTMENT,
  patientId,
  mismatch = false,
  denied = false,
  pending = false,
  optionsDenied = false,
  onAddService,
}: {
  id?: string;
  patientId?: string;
  mismatch?: boolean;
  denied?: boolean;
  pending?: boolean;
  optionsDenied?: boolean;
  onAddService?: (id: string) => void;
} = {}) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") throw new Error("Unexpected command");
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (pending) return new Promise<Response>(() => undefined);
    if (denied || (optionsDenied && url.endsWith("/options")))
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Denied" } }), {
          status: 403,
        })
      );
    const body = url.endsWith("/options")
      ? { professionals: [{ membershipId: "p1", displayName: "Profesional demo" }], branches: [] }
      : url.startsWith("/api/patients")
        ? { id: PATIENT, name: "Paciente demo" }
        : {
            id: APPOINTMENT,
            patientId: mismatch ? APPOINTMENT : PATIENT,
            professionalMembershipId: "p1",
            status: "IN_PROGRESS",
            startAt: "2026-10-28T19:00:00Z",
            service: { id: "s1", name: "Consulta demo" },
          };
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    );
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AppointmentJourney appointmentId={id} patientId={patientId} onAddService={onAddService} />
    </QueryClientProvider>
  );
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe("AppointmentJourney", () => {
  it("renders authorized context and returns to the same patient without issuing commands", async () => {
    const fetch = setup();
    expect(await screen.findByText("Paciente demo")).toBeInTheDocument();
    expect(await screen.findByText("Profesional demo")).toBeInTheDocument();
    expect(screen.getByText("Consulta demo")).toBeInTheDocument();
    expect(screen.getByText("En atención")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a la ficha del paciente" })).toHaveAttribute(
      "href",
      `/app/patients/${PATIENT}?appointment=${APPOINTMENT}#patient-clinical`
    );
    expect(screen.getByText(/no agrega un cargo ni define su precio/)).toBeInTheDocument();
    expect(fetch.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });
  it("suggests the scheduled service only after an explicit click without sending commands", async () => {
    const onAddService = vi.fn();
    const fetch = setup({ onAddService });
    const button = await screen.findByRole("button", {
      name: "Agregar servicio agendado al carrito",
    });
    expect(onAddService).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onAddService).toHaveBeenCalledExactlyOnceWith("s1");
    expect(fetch.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });
  it("rejects a malformed context without making a request", () => {
    const fetch = setup({ id: "no-es-uuid" });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos verificar");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not display a different patient's appointment or load its identity", async () => {
    const fetch = setup({ patientId: PATIENT, mismatch: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos verificar");
    expect(screen.queryByText("Consulta demo")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("denied context stays a recoverable notice rather than a fabricated association", async () => {
    setup({ denied: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("pantalla de forma independiente");
    expect(
      screen.queryByRole("link", { name: "Volver a la ficha del paciente" })
    ).not.toBeInTheDocument();
  });
  it("distinguishes pending context and unavailable professional names", async () => {
    setup({ optionsDenied: true });
    expect(screen.getByRole("status")).toHaveTextContent("Cargando contexto");
    await waitFor(() => expect(screen.getByText("Nombre no disponible")).toBeInTheDocument());
    expect(screen.getByText("Consulta demo")).toBeInTheDocument();
  });
});
