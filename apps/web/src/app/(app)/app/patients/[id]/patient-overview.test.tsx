import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PatientOverview } from "./patient-overview";
import { ClinicalRecordsSection } from "./clinical-records";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
const ID = "11111111-1111-4111-8111-111111111111";
const vaccine = {
  id: "v1",
  vaccine: "Vacuna registrada",
  administeredAt: "2026-01-01T12:00:00Z",
  nextDueAt: "2100-01-01T12:00:00Z",
};
function setup(
  options: {
    denied?: boolean;
    empty?: boolean;
    pending?: boolean;
    overdue?: boolean;
    records?: boolean;
  } = {}
) {
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (options.pending) return new Promise<Response>(() => undefined);
    if (options.denied && !url.endsWith(ID))
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Denied" } }), {
          status: 403,
        })
      );
    const body: unknown = url.endsWith("/guardians")
      ? options.empty
        ? []
        : [{ id: "g1", customerId: "c1", isPrimary: true, isActive: true }]
      : url.endsWith("/customers")
        ? [{ id: "c1", displayName: "Ana Demo" }]
        : url.endsWith("/encounters")
          ? options.empty
            ? []
            : [
                {
                  id: "e1",
                  status: "DRAFT",
                  createdAt: "2026-10-01T12:00:00Z",
                  reasonForVisit: "Control de prueba",
                },
              ]
          : url.endsWith("/vaccinations")
            ? options.empty
              ? []
              : [
                  {
                    ...vaccine,
                    nextDueAt: options.overdue ? "2000-01-01T12:00:00Z" : vaccine.nextDueAt,
                  },
                ]
            : url.endsWith("/deworming")
              ? []
              : { id: ID, isActive: true };
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    );
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PatientOverview patientId={ID} />
      {options.records ? <ClinicalRecordsSection patientId={ID} permissions={[]} /> : null}
    </QueryClientProvider>
  );
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("PatientOverview", () => {
  it("shows existing identities, draft and recorded vaccination date with section links", async () => {
    setup();
    expect(await screen.findByText("Ana Demo")).toBeInTheDocument();
    expect(await screen.findByText(/Borrador · Control de prueba/)).toBeInTheDocument();
    expect(await screen.findByText("Vacuna registrada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver ficha clínica/ })).toHaveAttribute(
      "href",
      "#patient-clinical"
    );
  });
  it("does not invent reminders or history when the API has no records", async () => {
    setup({ empty: true });
    expect(await screen.findByText("Sin consultas registradas")).toBeInTheDocument();
    expect(await screen.findByText("Sin próxima fecha registrada")).toBeInTheDocument();
    expect(
      screen.queryByText(/fecha de vacunación registrada anterior a hoy/)
    ).not.toBeInTheDocument();
  });
  it("distinguishes failed private reads from an empty history or a missing guardian", async () => {
    setup({ denied: true });
    expect(await screen.findAllByText("No disponible")).toHaveLength(3);
    expect(screen.queryByText(/No hay un responsable principal activo/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sin consultas registradas")).not.toBeInTheDocument();
  });
  it("shows loading while reads are unresolved", () => {
    setup({ pending: true });
    expect(
      within(screen.getByRole("region", { name: "Resumen del paciente" })).getAllByText("Cargando…")
    ).toHaveLength(3);
  });
  it("flags only a recorded past date and does not derive a future dose", async () => {
    setup({ overdue: true });
    expect(
      await screen.findByText(/una fecha de vacunación registrada anterior a hoy/)
    ).toBeInTheDocument();
    expect(screen.getByText("Sin próxima fecha registrada")).toBeInTheDocument();
  });
  it("shares the vaccination projection with the mounted records editor", async () => {
    const fetch = setup({ records: true });
    await waitFor(() => expect(screen.getAllByText("Vacuna registrada")).toHaveLength(2));
    expect(
      fetch.mock.calls.filter(([input]) => requestUrl(input).endsWith("/vaccinations"))
    ).toHaveLength(1);
  });
});
