import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudyList } from "./study-list";
import { writeStudy } from "./study-write-api";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const patient = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const original = {
  id,
  studyType: "Tipo de estudio guardada",
  result: "Resultado guardado",
  performedAt: "2026-10-20T15:00:42.123Z",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function setup(
  options: {
    writeStatus?: number;
    network?: boolean;
    stale?: boolean;
    remoteResult?: boolean;
    pending?: boolean;
    permissions?: readonly string[];
  } = {}
) {
  let item = { ...original },
    getCount = 0;
  let settle: ((response: Response) => void) | undefined;
  const writes: { method: string; body: object }[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (typeof url !== "string") throw new Error("String expected");
    if (url.endsWith("/search")) {
      if (typeof init?.body !== "string") throw new Error("JSON expected");
      const body = JSON.parse(init.body) as { page: number };
      return Promise.resolve(
        json({ items: [item], page: body.page, pageSize: 20, total: 21, totalPages: 2 })
      );
    }
    if (init?.method === "GET") {
      getCount++;
      return Promise.resolve(
        json(
          options.stale && getCount > 1
            ? { ...item, studyType: "Cambio remoto" }
            : options.remoteResult && getCount > 1
              ? { ...item, result: "Resultado remoto" }
              : item
        )
      );
    }
    if (typeof init?.body !== "string") throw new Error("JSON expected");
    const body = JSON.parse(init.body) as Partial<typeof original>;
    writes.push({ method: init.method ?? "", body });
    expect(init.cache).toBe("no-store");
    expect(url).not.toContain("?");
    if (options.pending)
      return new Promise<Response>((done) => {
        settle = done;
      });
    if (options.network) return Promise.reject(new TypeError("Synthetic lost response"));
    if (options.writeStatus)
      return Promise.resolve(
        json(
          {
            error: {
              code: options.writeStatus === 403 ? "FORBIDDEN" : "INTERNAL",
              message: "PRIVATE",
            },
          },
          options.writeStatus
        )
      );
    item = { ...item, ...body };
    return Promise.resolve(json(item, init.method === "POST" ? 201 : 200));
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StudyList patientId={patient} permissions={options.permissions} />
      <a href="/app/customers">Ir a clientes</a>
    </QueryClientProvider>
  );
  return {
    writes,
    fetch,
    finish: () => settle?.(json({ ...original, studyType: "Nuevo estudio", result: "" })),
  };
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
  push.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function createForm() {
  await screen.findByText(original.studyType);
  fireEvent.click(screen.getByRole("button", { name: "Registrar estudio" }));
  fireEvent.change(screen.getByLabelText("Tipo de estudio"), {
    target: { value: "Nuevo estudio" },
  });
  fireEvent.change(screen.getByLabelText("Fecha y hora de realización"), {
    target: { value: "2026-10-20T12:00" },
  });
}
async function editForm() {
  await screen.findByText(original.studyType);
  fireEvent.click(screen.getByRole("button", { name: /Ver estudio/ }));
  await screen.findByText(original.result);
  fireEvent.click(screen.getByRole("button", { name: "Corregir estudio" }));
}
function confirm() {
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar estudio" })
  );
}
describe("Study entry and correction", () => {
  it("blocks a remote result change before replacing that result", async () => {
    const { writes } = setup({ remoteResult: true });
    await editForm();
    fireEvent.change(screen.getByLabelText("Resultado del estudio (opcional)"), {
      target: { value: "Mi resultado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar corrección" }));
    confirm();
    await screen.findByText(/El estudio cambió/);
    expect(writes).toHaveLength(0);
  });
  it("preserves a multiline result as literal text in review and saved detail", async () => {
    const { writes } = setup();
    await createForm();
    const result = "Primera línea\n<script>texto literal</script>\nÚltima línea";
    fireEvent.change(screen.getByLabelText("Resultado del estudio (opcional)"), {
      target: { value: result },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    const text = within(screen.getByRole("dialog")).getByText(/Primera línea/);
    expect(text.textContent).toBe(result);
    expect(text.querySelector("script")).toBeNull();
    confirm();
    await screen.findByText("Estudio registrado.");
    expect(writes[0].body).toMatchObject({ result });
    expect((await screen.findByText(/Primera línea/)).textContent).toBe(result);
  });
  it("treats an invalid success DTO with null result as uncertain rather than safe to retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ ...original, result: null }, 201)))
    );
    await expect(
      writeStudy(patient, undefined, {
        studyType: "Synthetic",
        performedAt: original.performedAt,
        result: "",
      })
    ).rejects.toMatchObject({ uncertain: true });
  });
  it("does not submit twice while the first command is pending", async () => {
    const { writes, finish } = setup({ pending: true });
    await createForm();
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    confirm();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Guardando…" })
    ).toBeDisabled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardando…" }));
    expect(writes).toHaveLength(1);
    finish();
    await screen.findByText("Estudio registrado.");
  });
  it("changes an edited administration date explicitly at minute precision", async () => {
    const { writes } = setup();
    await editForm();
    fireEvent.change(screen.getByLabelText("Fecha y hora de realización"), {
      target: { value: "2026-10-20T20:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar corrección" }));
    confirm();
    await screen.findByText("Estudio corregido.");
    expect(writes[0].body).toEqual({ performedAt: "2026-10-20T23:30:00.000Z" });
  });
  it("creates only after review, converting Paraguay clock and retaining list page", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { writes } = setup();
    await screen.findByText(original.studyType);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    await createForm();
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    expect(writes).toHaveLength(0);
    expect(screen.getByRole("dialog")).toHaveTextContent("Nuevo estudio");
    confirm();
    await screen.findByText("Estudio registrado.");
    expect(writes).toEqual([
      {
        method: "POST",
        body: {
          studyType: "Nuevo estudio",
          performedAt: "2026-10-20T15:00:00.000Z",
          result: "",
        },
      },
    ]);
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Volver al listado de estudios" }));
    await screen.findByText("Página 2 de 2");
  });
  it("sends only modified studyType and preserves original seconds/result", async () => {
    const { writes } = setup();
    await editForm();
    fireEvent.change(screen.getByLabelText("Tipo de estudio"), {
      target: { value: "Corrección" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar corrección" }));
    confirm();
    await screen.findByText("Estudio corregido.");
    expect(writes).toEqual([{ method: "PUT", body: { studyType: "Corrección" } }]);
    expect(await screen.findByText(original.result)).toBeInTheDocument();
  });
  it("clears result with explicit empty string", async () => {
    const { writes } = setup();
    await editForm();
    fireEvent.change(screen.getByLabelText("Resultado del estudio (opcional)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar corrección" }));
    confirm();
    await screen.findByText("Estudio corregido.");
    expect(writes[0].body).toEqual({ result: "" });
    await screen.findByText("Sin resultado registrado.");
  });
  it("does not mutate when review is cancelled and asks before discarding dirty form", async () => {
    const { writes } = setup();
    await createForm();
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Volver al formulario" })
    );
    expect(screen.getByLabelText("Tipo de estudio")).toHaveValue("Nuevo estudio");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Seguir editando" })
    );
    expect(screen.getByLabelText("Tipo de estudio")).toHaveValue("Nuevo estudio");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar cambios" })
    );
    await screen.findByText(original.studyType);
    expect(writes).toHaveLength(0);
  });
  it("rejects empty studyType and overlong result before any write", async () => {
    const { writes } = setup();
    await createForm();
    fireEvent.change(screen.getByLabelText("Tipo de estudio"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    expect(screen.getByRole("alert")).toHaveTextContent("2000");
    fireEvent.change(screen.getByLabelText("Tipo de estudio"), {
      target: { value: "Válida" },
    });
    fireEvent.change(screen.getByLabelText("Resultado del estudio (opcional)"), {
      target: { value: "x".repeat(10001) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    expect(writes).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("blocks visible concurrent changes rather than overwriting them", async () => {
    const { writes } = setup({ stale: true });
    await editForm();
    fireEvent.change(screen.getByLabelText("Tipo de estudio"), {
      target: { value: "Mi corrección" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar corrección" }));
    confirm();
    await screen.findByText(/El estudio cambió/);
    expect(writes).toHaveLength(0);
  });
  it.each([{ network: true }, { writeStatus: 500 }, { writeStatus: 408 }])(
    "locks retries after an uncertain write %j",
    async (options) => {
      const { writes } = setup(options);
      await createForm();
      fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
      confirm();
      await screen.findByText(/No pudimos confirmar si se guardó/);
      expect(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar estudio" })
      ).toBeDisabled();
      expect(writes).toHaveLength(1);
    }
  );
  it("keeps form contents and permission failure explicit without private details", async () => {
    const { writes } = setup({ writeStatus: 403 });
    await createForm();
    fireEvent.click(screen.getByRole("button", { name: "Revisar estudio" }));
    confirm();
    await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
    expect(writes).toHaveLength(1);
    expect(screen.getByLabelText("Tipo de estudio")).toHaveValue("Nuevo estudio");
  });
  it("hides write actions when permissions are known read-only", async () => {
    setup({ permissions: ["vet.clinical.read"] });
    await screen.findByText(original.studyType);
    expect(screen.queryByRole("button", { name: "Registrar estudio" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver estudio/ }));
    await screen.findByText(original.result);
    expect(screen.queryByRole("button", { name: "Corregir estudio" })).not.toBeInTheDocument();
  });
  it("warns before leaving a dirty form through a link", async () => {
    const { writes } = setup();
    await createForm();
    fireEvent.click(screen.getByRole("link", { name: "Ir a clientes" }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar cambios" })
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/customers"));
    expect(writes).toHaveLength(0);
  });
  it("forgets a cancelled link destination before discarding from the form", async () => {
    const { writes } = setup();
    await createForm();
    fireEvent.click(screen.getByRole("link", { name: "Ir a clientes" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Seguir editando" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar cambios" })
    );
    await screen.findByText(original.studyType);
    expect(push).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
