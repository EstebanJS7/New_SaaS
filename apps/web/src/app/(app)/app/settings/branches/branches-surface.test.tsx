import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Branch } from "./branches-api";
import { BranchesSurface } from "./branches-surface";

const CENTRAL: Branch = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Casa central",
  address: "Av. Mcal. López 1234",
  phone: "021 600 000",
  isActive: true,
  staffCount: 3,
  createdAt: "2026-11-01T10:00:00.000Z",
};
const NORTE: Branch = {
  ...CENTRAL,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Norte",
  address: null,
  phone: null,
  staffCount: 1,
};
const VIEJA: Branch = {
  ...NORTE,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Vieja",
  isActive: false,
  staffCount: 0,
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  });
  return calls;
}

function renderSurface(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BranchesSurface />
    </QueryClientProvider>
  );
}

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

afterEach(() => vi.restoreAllMocks());

describe("BranchesSurface (MB-001)", () => {
  it("lists branches with state, details and staff count", async () => {
    installFetch(() => json({ branches: [CENTRAL, NORTE, VIEJA] }));
    renderSurface();
    const rows = await screen.findAllByTestId("branch-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Av. Mcal. López 1234 · 021 600 000")).toBeInTheDocument();
    expect(within(rows[0]).getByText("3 personas asignadas")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Sin dirección ni teléfono")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Desactivada")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
  });

  it("does not offer to deactivate the only active branch", async () => {
    installFetch(() => json({ branches: [CENTRAL, VIEJA] }));
    renderSurface();
    const rows = await screen.findAllByTestId("branch-row");
    expect(within(rows[0]).queryByRole("button", { name: "Desactivar" })).toBeNull();
  });

  it("adds a branch and sends empty optional fields as null", async () => {
    const calls = installFetch((call) =>
      call.method === "POST" ? json({ branch: NORTE }, 201) : json({ branches: [CENTRAL] })
    );
    renderSurface();
    await screen.findAllByTestId("branch-row");
    fireEvent.click(screen.getByRole("button", { name: "Agregar sucursal" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar sucursal" }));
    expect(await screen.findByText("Escribí el nombre.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: " Norte " } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar sucursal" }));
    expect(await screen.findByTestId("branches-notice")).toHaveTextContent("Norte quedó agregada.");
    const post = calls.find((call) => call.method === "POST");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ name: "Norte", address: null, phone: null });
  });

  it("shows the plan limit as the API words it", async () => {
    installFetch((call) =>
      call.method === "POST"
        ? json(
            {
              error: {
                code: "FEATURE_NOT_ENTITLED",
                message: "Tu plan incluye una sola sucursal activa.",
              },
            },
            403
          )
        : json({ branches: [CENTRAL] })
    );
    renderSurface();
    await screen.findAllByTestId("branch-row");
    fireEvent.click(screen.getByRole("button", { name: "Agregar sucursal" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar sucursal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tu plan incluye una sola sucursal activa."
    );
  });

  it("edits a branch in place", async () => {
    const calls = installFetch((call) =>
      call.method === "PUT"
        ? json({ branch: { ...NORTE, name: "Norte II" } })
        : json({ branches: [CENTRAL, NORTE] })
    );
    renderSurface();
    const rows = await screen.findAllByTestId("branch-row");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Norte II" } });
    fireEvent.change(screen.getByLabelText(/Teléfono/), { target: { value: "0981 000 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByTestId("branches-notice")).toHaveTextContent(
      "Se guardaron los cambios de Norte II."
    );
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe(`/api/branches/${NORTE.id}`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      name: "Norte II",
      address: null,
      phone: "0981 000 000",
    });
  });

  it("asks before deactivating and keeps the dialog open with the API's reason", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? json(
            {
              error: {
                code: "CONFLICT",
                message:
                  "La sucursal tiene 2 turnos pendientes: reprogramalos o cancelalos antes de desactivarla.",
              },
            },
            409
          )
        : json({ branches: [CENTRAL, NORTE] })
    );
    renderSurface();
    const rows = await screen.findAllByTestId("branch-row");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Desactivar" }));
    expect(screen.getByText("¿Desactivar Norte?")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Desactivar" }).at(-1)!);
    expect(await screen.findByText(/2 turnos pendientes/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.url).toBe(
      `/api/branches/${NORTE.id}/deactivate`
    );
  });

  it("MB-002: links a branch to its own establishment and point", async () => {
    const EST = { id: "44444444-4444-4444-8444-444444444444", code: "002", addressLine: "Ruta 2" };
    const calls = installFetch((call) =>
      call.method === "PUT"
        ? json({ branch: { ...NORTE, fiscalEstablishmentId: EST.id, expeditionPoint: "001" } })
        : json({ branches: [CENTRAL, NORTE], establishments: [EST] })
    );
    renderSurface();
    const rows = await screen.findAllByTestId("branch-row");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Establecimiento fiscal"), {
      target: { value: EST.id },
    });
    fireEvent.change(screen.getByLabelText("Punto de expedición"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Tres dígitos, por ejemplo 001.")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Punto de expedición"), { target: { value: "001" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await screen.findByTestId("branches-notice");
    const put = calls.find((call) => call.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}")).toMatchObject({
      fiscalEstablishmentId: EST.id,
      expeditionPoint: "001",
    });
  });

  it("MB-002: offers no issuance point when the clinic has no establishment", async () => {
    installFetch(() => json({ branches: [CENTRAL, NORTE], establishments: [] }));
    renderSurface();
    const rows = await screen.findAllByTestId("branch-row");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Editar" }));
    expect(screen.queryByLabelText("Establecimiento fiscal")).toBeNull();
  });

  it("says permission is missing instead of pretending there are no branches", async () => {
    installFetch(() => json({ error: { code: "FORBIDDEN", message: "x" } }, 403));
    renderSurface();
    expect(await screen.findByText("No tenés permiso para ver las sucursales")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar sucursal" })).toBeNull();
  });
});
