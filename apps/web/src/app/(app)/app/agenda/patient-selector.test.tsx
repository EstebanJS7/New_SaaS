import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientSelector } from "./patient-selector";

const patient = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Luna",
  isActive: true,
  speciesName: "Canino",
  primaryGuardianName: "Ana García",
};
let client: QueryClient;
const fetchMock = vi.fn<typeof fetch>();
function renderSelector() {
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PatientSelector value={null} onChange={onChange} disabled={false} invalid={false} />
    </QueryClientProvider>
  );
  return onChange;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

describe("Agenda patient selection", () => {
  it("avoids an unbounded list and requires explicit selection", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([patient]), { status: 200 }));
    const changed = renderSelector();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Buscar paciente"), { target: { value: "Lu" } });
    const option = await screen.findByRole(
      "radio",
      { name: /Luna.*Ana García/ },
      { timeout: 2500 }
    );
    expect(changed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/patients/lookup",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ q: "Lu" }) })
    );
    fireEvent.click(option);
    expect(changed).toHaveBeenCalledWith(patient);
  });
  it("hides stale results immediately when the query changes", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([patient]), { status: 200 }))
    );
    renderSelector();
    const input = screen.getByLabelText("Buscar paciente");
    fireEvent.change(input, { target: { value: "Lu" } });
    await screen.findByRole("radio", { name: /Luna/ }, { timeout: 2500 });
    fireEvent.change(input, { target: { value: "Otro" } });
    expect(screen.queryByRole("radio", { name: /Luna/ })).not.toBeInTheDocument();
  });
  it("explains denied patient/customer access", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden" } }), {
        status: 403,
      })
    );
    renderSelector();
    fireEvent.change(screen.getByLabelText("Buscar paciente"), { target: { value: "Ana" } });
    await waitFor(
      () =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "permisos de lectura de pacientes y clientes"
        ),
      { timeout: 2500 }
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
  it("makes empty results actionable", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    renderSelector();
    fireEvent.change(screen.getByLabelText("Buscar paciente"), {
      target: { value: "Sin coincidencias" },
    });
    await screen.findByText(/No encontramos pacientes/, {}, { timeout: 2500 });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});
