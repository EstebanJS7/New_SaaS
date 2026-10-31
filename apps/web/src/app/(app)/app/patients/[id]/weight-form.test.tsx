import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WeightList } from "./weight-list";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const patient = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const base = { version: 1, id, quantity: "12.345", measuredAt: "2026-10-20T15:00:42.123Z" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function setup(
  options: {
    unknown?: boolean;
    stale?: boolean;
    status?: number;
    lostRead?: boolean;
    pending?: boolean;
    permissions?: readonly string[];
  } = {}
) {
  let row: typeof base & { unit: "KG" | null } = { ...base, unit: options.unknown ? null : "KG" },
    getCount = 0;
  let finish: ((response: Response) => void) | undefined;
  const writes: { method: string; body: object }[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (typeof url !== "string") throw new Error("String expected");
    if (url.endsWith("/search")) {
      if (typeof init?.body !== "string") throw new Error("JSON expected");
      const body = JSON.parse(init.body) as { page: number };
      return Promise.resolve(
        json({ items: [row], page: body.page, pageSize: 20, total: 21, totalPages: 2 })
      );
    }
    if (init?.method === "GET") {
      getCount++;
      return Promise.resolve(
        options.lostRead && writes.length
          ? json({ error: { code: "FORBIDDEN" } }, 403)
          : json(options.stale && getCount > 1 ? { ...row, quantity: "15.000" } : row)
      );
    }
    if (typeof init?.body !== "string") throw new Error("JSON expected");
    const body = JSON.parse(init.body) as Partial<typeof row>;
    writes.push({ method: init.method ?? "", body });
    if (options.pending)
      return new Promise<Response>((done) => {
        finish = done;
      });
    if (options.status)
      return Promise.resolve(
        json({ error: { code: "SYNTHETIC", message: "PRIVATE" } }, options.status)
      );
    row = { ...row, ...body };
    // Existing commands intentionally do not expose the newly stored unit.
    return Promise.resolve(
      json(
        { id: row.id, quantity: row.quantity, measuredAt: row.measuredAt },
        init.method === "POST" ? 201 : 200
      )
    );
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WeightList patientId={patient} permissions={options.permissions} />
    </QueryClientProvider>
  );
  return { writes, fetch, finish: () => finish?.(json(base)) };
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function ready() {
  await screen.findByRole("button", { name: /Ver registro de peso/ });
}
async function createForm(value = "0,125") {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Registrar peso" }));
  fireEvent.change(screen.getByLabelText("Peso (kg)"), { target: { value } });
  fireEvent.change(screen.getByLabelText("Fecha y hora de medición"), {
    target: { value: "2026-10-20T12:00" },
  });
}
async function editForm() {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /Ver registro de peso/ }));
  await screen.findByText("Valor registrado");
  fireEvent.click(screen.getByRole("button", { name: "Corregir peso" }));
  fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Motivo sintético" } });
}
function review(create = false) {
  fireEvent.click(
    screen.getByRole("button", { name: create ? "Revisar peso" : "Revisar corrección" })
  );
}
function confirm() {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar peso" }));
}
describe("Weight entry with declared KG", () => {
  it("creates only after review and re-reads the authoritative unit while retaining page", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { writes, fetch } = setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    await createForm();
    review(true);
    expect(writes).toHaveLength(0);
    confirm();
    await screen.findByText("Peso registrado.");
    await screen.findByText("Valor registrado");
    expect(writes).toEqual([
      {
        method: "POST",
        body: {
          idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/) as unknown,
          quantity: "0.125",
          unit: "KG",
          measuredAt: "2026-10-20T15:00:00.000Z",
        },
      },
    ]);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "GET")).toBe(true);
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Volver al listado de pesos" }));
    await screen.findByText("Página 2 de 2");
    await screen.findByText("0,125 kg");
  });
  it("updates quantity in KG without touching precise measurement time", async () => {
    const { writes } = setup();
    await editForm();
    fireEvent.change(screen.getByLabelText("Peso (kg)"), { target: { value: "9.999.999,999" } });
    review();
    confirm();
    await screen.findByText("Peso corregido.");
    expect(writes[0].body).toEqual({ expectedVersion: 1, correctionReason: "Motivo sintético", quantity: "9999999.999", unit: "KG" });
    await screen.findByText("9.999.999,999");
  });
  it("does not infer KG while opening an unknown record or editing its date only", async () => {
    const { writes } = setup({ unknown: true });
    await editForm();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Fecha y hora de medición"), {
      target: { value: "2026-10-21T12:00" },
    });
    review();
    expect(screen.getByRole("dialog")).toHaveTextContent("unidad no especificada");
    confirm();
    await screen.findByText("Peso corregido.");
    expect(writes[0].body).toEqual({ expectedVersion: 1, correctionReason: "Motivo sintético", measuredAt: "2026-10-21T15:00:00.000Z" });
    await screen.findByText("Unidad no especificada en el registro.");
  });
  it("requires explicit confirmation before replacing an unknown quantity as KG", async () => {
    const { writes } = setup({ unknown: true });
    await editForm();
    fireEvent.change(screen.getByLabelText("Valor registrado (unidad no especificada)"), {
      target: { value: "0,001" },
    });
    review();
    expect(screen.getByRole("alert")).toHaveTextContent("Confirmá");
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox"));
    review();
    confirm();
    await screen.findByText("Peso corregido.");
    expect(writes[0].body).toEqual({ expectedVersion: 1, correctionReason: "Motivo sintético", quantity: "0.001", unit: "KG" });
  });
  it("can explicitly confirm KG for an unchanged stored quantity", async () => {
    const { writes } = setup({ unknown: true });
    await editForm();
    fireEvent.click(screen.getByRole("checkbox"));
    review();
    confirm();
    await screen.findByText("Peso corregido.");
    expect(writes[0].body).toEqual({ expectedVersion: 1, correctionReason: "Motivo sintético", unit: "KG" });
  });
  it.each(["0", "0,0001", "1.5", "1e3", "10.000.000"])(
    "rejects invalid or inexact input %s without rounding",
    async (value) => {
      const { writes } = setup();
      await createForm(value);
      review(true);
      expect(screen.getByRole("alert")).toHaveTextContent("3 decimales");
      expect(writes).toHaveLength(0);
    }
  );
  it("cancels review and asks before discarding changed input", async () => {
    const { writes } = setup();
    await createForm();
    review(true);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Volver al formulario" })
    );
    expect(screen.getByLabelText("Peso (kg)")).toHaveValue("0,125");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar cambios" })
    );
    await ready();
    expect(writes).toHaveLength(0);
  });
  it("blocks correction when quantity changed remotely before confirmation", async () => {
    const { writes } = setup({ stale: true });
    await editForm();
    fireEvent.change(screen.getByLabelText("Peso (kg)"), { target: { value: "0,125" } });
    review();
    confirm();
    await screen.findByText(/El peso cambió/);
    expect(writes).toHaveLength(0);
  });
  it.each([408, 500])(
    "allows explicit safe retries after uncertain creation status %s",
    async (status) => {
      const { writes } = setup({ status });
      await createForm();
      review(true);
      confirm();
      await screen.findByText(/Podés reintentar con la misma clave/);
      expect(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar peso" })
      ).toBeEnabled();
      expect(writes).toHaveLength(1);
    }
  );
  it("retries only GET after a committed creation when unit-aware read failed", async () => {
    const options = { lostRead: true };
    const { writes, fetch } = setup(options);
    await createForm();
    review(true);
    confirm();
    await screen.findByText(/Podés reintentar con la misma clave/);
    expect(writes).toHaveLength(1);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar peso" })
    ).toBeEnabled();
    options.lostRead = false;
    confirm();
    await screen.findByText("Peso registrado.");
    expect(writes).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(3);
  });
  it("guards duplicate clicks during an in-flight command", async () => {
    const { writes, finish } = setup({ pending: true });
    await createForm();
    review(true);
    confirm();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Guardando…" })
    ).toBeDisabled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardando…" }));
    expect(writes).toHaveLength(1);
    finish();
    await screen.findByText("Peso registrado.");
  });
  it("hides commands when known permissions are read-only", async () => {
    setup({ permissions: ["vet.clinical.read"] });
    await ready();
    expect(screen.queryByRole("button", { name: "Registrar peso" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver registro de peso/ }));
    await screen.findByText("Valor registrado");
    expect(screen.queryByRole("button", { name: "Corregir peso" })).not.toBeInTheDocument();
  });
});

it("requires a nonempty correction reason before submitting a changed record", async () => {
  const {writes}=setup();await editForm();
  fireEvent.change(screen.getByLabelText("Peso (kg)"),{target:{value:"0,125"}});
  fireEvent.change(screen.getByLabelText("Motivo de la corrección"),{target:{value:""}});
  fireEvent.submit(screen.getByRole("button",{name:"Revisar corrección"}).closest("form")!);
  expect(await screen.findByText("Ingresá el motivo de la corrección (hasta 2000 caracteres).")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
