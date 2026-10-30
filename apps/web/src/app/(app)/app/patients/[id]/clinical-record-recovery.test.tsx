import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TreatmentList } from "./treatment-list";
import { StudyList } from "./study-list";
import { WeightList } from "./weight-list";
import {
  RECORD_RECOVERY_MS,
  recordRecoveryKey,
  useRecordRecovery,
} from "./clinical-record-recovery";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const patient = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const id = "22222222-2222-4222-8222-222222222222";
const precise = "2026-10-20T15:00:42.123Z";
const configs = [
  {
    kind: "treatment",
    name: "tratamiento",
    plural: "tratamientos",
    label: "Descripción del tratamiento",
    original: "Original clínico",
    changed: "Cambio temporal",
    review: "Revisar tratamiento",
    field: "description",
    baseline: {
      id,
      description: "Original clínico",
      context: "Contexto original",
      administeredAt: precise,
    },
  },
  {
    kind: "study",
    name: "estudio",
    plural: "estudios",
    label: "Tipo de estudio",
    original: "Original clínico",
    changed: "Cambio temporal",
    review: "Revisar estudio",
    field: "studyType",
    baseline: {
      id,
      studyType: "Original clínico",
      result: "Resultado original",
      performedAt: precise,
    },
  },
  {
    kind: "weight",
    name: "peso",
    plural: "pesos",
    label: "Peso (kg)",
    original: "12,345 kg",
    changed: "0,125",
    review: "Revisar peso",
    field: "quantity",
    baseline: { id, quantity: "12.345", unit: "KG", measuredAt: precise },
  },
] as const;
type Config = (typeof configs)[number];
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function setup(c: Config) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  let item: Record<string, unknown> = { ...c.baseline };
  const options = {
    readStatus: 200,
    detailStatus: 200,
    pending: false,
    writeStatus: 200,
    stale: false,
  };
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  let finish: ((response: Response) => void) | undefined;
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (typeof url !== "string") throw Error("Expected URL string");
    expect(url).not.toContain("?");
    if (url.endsWith("/search")) {
      if (options.readStatus !== 200)
        return json({ error: { code: "FORBIDDEN" } }, options.readStatus);
      if (typeof init?.body !== "string") throw Error("Expected JSON body");
      const body = JSON.parse(init.body) as { page: number };
      return json({ items: [item], page: body.page, pageSize: 20, total: 21, totalPages: 2 });
    }
    if (init?.method === "GET") {
      if (options.detailStatus !== 200)
        return json({ error: { code: "FORBIDDEN" } }, options.detailStatus);
      return json(
        options.stale
          ? { ...item, [c.field]: c.kind === "weight" ? "33.333" : "Cambio remoto" }
          : item
      );
    }
    if (typeof init?.body !== "string") throw Error("Expected JSON body");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    writes.push({ method: init?.method ?? "", body });
    if (options.pending)
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    if (options.writeStatus !== 200)
      return json({ error: { code: "INTERNAL" } }, options.writeStatus);
    item = { ...item, ...body };
    return json(item, init?.method === "POST" ? 201 : 200);
  });
  vi.stubGlobal("fetch", fetch);
  const view = (target = client, p = patient, permissions?: readonly string[]) =>
    render(
      <QueryClientProvider client={target}>
        {c.kind === "treatment" ? (
          <TreatmentList patientId={p} permissions={permissions} />
        ) : c.kind === "study" ? (
          <StudyList patientId={p} permissions={permissions} />
        ) : (
          <WeightList patientId={p} permissions={permissions} />
        )}
      </QueryClientProvider>
    );
  return {
    client,
    options,
    writes,
    fetch,
    view,
    change: (data: Record<string, unknown>) => {
      item = { ...item, ...data };
    },
    finish: (status = 200) => {
      item = { ...item, ...writes.at(-1)?.body };
      finish?.(status === 200 ? json(item) : json({ error: { code: "INTERNAL" } }, status));
    },
  };
}
async function open(c: Config, correction = false) {
  await screen.findByText(c.original);
  if (correction) {
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(c.kind === "weight" ? "Ver registro de peso" : "Ver " + c.name),
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Corregir " + c.name }));
  } else fireEvent.click(screen.getByRole("button", { name: "Registrar " + c.name }));
  fireEvent.change(screen.getByLabelText(c.label), { target: { value: c.changed } });
  if (!correction)
    fireEvent.change(
      screen.getByLabelText(
        c.kind === "treatment"
          ? "Fecha y hora de administración"
          : c.kind === "study"
            ? "Fecha y hora de realización"
            : "Fecha y hora de medición"
      ),
      { target: { value: "2026-10-30T09:00" } }
    );
}
async function offer(c: Config) {
  return screen.findByRole("region", { name: "Cambios pendientes de " + c.name });
}
async function reviewAndSave(c: Config, correction = false) {
  fireEvent.click(
    screen.getByRole("button", { name: correction ? "Revisar corrección" : c.review })
  );
  const dialog = await screen.findByRole("dialog", { name: new RegExp("Confirmar ") });
  fireEvent.click(within(dialog).getByRole("button", { name: "Guardar " + c.name }));
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(configs)("Clinical temporary recovery: $kind", (c) => {
  it("offers explicit recovery after remount, keeps page and never writes automatically", async () => {
    const t = setup(c);
    const v = t.view();
    await screen.findByText(c.original);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    await open(c);
    v.unmount();
    t.view();
    await offer(c);
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.queryByLabelText(c.label)).not.toBeInTheDocument();
    expect(t.writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByText("Recuperamos tus cambios temporales. Revisalos antes de guardar.");
    expect(screen.getByLabelText(c.label)).toHaveValue(c.changed);
    expect(t.writes).toHaveLength(0);
    await reviewAndSave(c);
    await waitFor(() => expect(t.writes).toHaveLength(1));
    await screen.findByText(c.name[0].toUpperCase() + c.name.slice(1) + " registrado.");
    expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull();
  });
  it("re-reads correction baseline and preserves the precise unchanged instant", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c, true);
    v.unmount();
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByText("Recuperamos tus cambios temporales. Revisalos antes de guardar.");
    await reviewAndSave(c, true);
    await waitFor(() => expect(t.writes).toHaveLength(1));
    expect(t.writes[0]?.method).toBe("PUT");
    for (const key of ["administeredAt", "performedAt", "measuredAt"])
      expect(t.writes[0]?.body).not.toHaveProperty(key);
  });
  it("blocks stale corrections and keeps a read-only copy without a PUT", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c, true);
    v.unmount();
    t.options.stale = true;
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByText(/El registro cambió mientras estabas fuera/);
    expect(screen.queryByLabelText(c.label)).not.toBeInTheDocument();
    expect(t.writes).toHaveLength(0);
    expect(screen.getByText(c.changed)).toBeInTheDocument();
  });
  it("clears only after confirmed discard and never creates a phantom form", async () => {
    const t = setup(c);
    let v = t.view();
    await open(c);
    v.unmount();
    v = t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Descartar copia temporal" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Conservar copia" })
    );
    expect(await offer(c)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descartar copia temporal" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar copia" })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Cambios pendientes de " + c.name })
      ).not.toBeInTheDocument()
    );
    v.unmount();
    t.view();
    await screen.findByText(c.original);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    expect(t.writes).toHaveLength(0);
  });
  it.each([401, 403, 404])(
    "does not expose stale cached copies on a fresh %i list read",
    async (status) => {
      const t = setup(c);
      const v = t.view();
      await open(c);
      v.unmount();
      t.options.readStatus = status;
      t.view();
      await screen.findByText("No pudimos cargar los " + c.plural);
      await waitFor(() =>
        expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull()
      );
      expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
      expect(screen.queryByText(c.changed)).not.toBeInTheDocument();
    }
  );
  it("hides recovery until a fresh list read succeeds, with a retry after outage", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c);
    v.unmount();
    t.options.readStatus = 500;
    t.view();
    await screen.findByText("No pudimos cargar los " + c.plural);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeTruthy();
    t.options.readStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await offer(c);
  });
  it("preserves a temporary failed correction check, then retries without writing", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c, true);
    v.unmount();
    t.options.detailStatus = 500;
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByText(/No pudimos comprobar el registro/);
    t.options.detailStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    expect(await screen.findByLabelText(c.label)).toHaveValue(c.changed);
    expect(t.writes).toHaveLength(0);
  });
  it.each([403, 404])("drops a correction copy after detail denies %i", async (status) => {
    const t = setup(c);
    const v = t.view();
    await open(c, true);
    v.unmount();
    t.options.detailStatus = status;
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await waitFor(() =>
      expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull()
    );
    expect(t.writes).toHaveLength(0);
  });
  it("expires a copy instead of extending its life by remounting", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c);
    v.unmount();
    const time = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(time + RECORD_RECOVERY_MS + 1);
    t.view();
    await screen.findByText(c.original);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull()
    );
  });
  it("isolates the same patient's copy from another document and patient", async () => {
    const t = setup(c);
    let v = t.view();
    await open(c);
    v.unmount();
    v = t.view(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await screen.findByText(c.original);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    v.unmount();
    t.view(t.client, other);
    await screen.findByText(c.original);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeTruthy();
  });
  it("clears recovery when known claims no longer grant creation", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c);
    v.unmount();
    t.view(t.client, patient, ["vet.clinical.read"]);
    await screen.findByText(c.original);
    await waitFor(() =>
      expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull()
    );
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
  });
  it("blocks replay while a command is pending and clears on late success", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c);
    t.options.pending = true;
    await reviewAndSave(c);
    await waitFor(() => expect(t.writes).toHaveLength(1));
    v.unmount();
    t.view();
    await offer(c);
    expect(screen.getByText(/El guardado seguía en curso al salir/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar " + c.name })).toBeDisabled();
    await act(async () => {
      t.finish();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull()
    );
    expect(t.writes).toHaveLength(1);
  });
  it("keeps lost or failed command responses blocked across remount", async () => {
    const t = setup(c);
    const v = t.view();
    await open(c);
    t.options.pending = true;
    await reviewAndSave(c);
    await waitFor(() => expect(t.writes).toHaveLength(1));
    v.unmount();
    t.view();
    await offer(c);
    await act(async () => {
      t.finish(500);
      await Promise.resolve();
    });
    await screen.findByText(/No pudimos confirmar el guardado/);
    expect(screen.getByText(c.changed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    expect(t.writes).toHaveLength(1);
  });
  it("does not retain a clean new form or accepted form discard", async () => {
    const t = setup(c);
    let v = t.view();
    await screen.findByText(c.original);
    fireEvent.click(screen.getByRole("button", { name: "Registrar " + c.name }));
    v.unmount();
    expect(t.client.getQueryData(recordRecoveryKey(patient, c.kind))).toBeNull();
    v = t.view();
    await open(c);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar cambios" })
    );
    v.unmount();
    t.view();
    await screen.findByText(c.original);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
  });
});

describe("Recovery lifecycle boundaries", () => {
  it("removes an offered copy when its timer expires without another navigation", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const now = Date.now();
    client.setQueryData(recordRecoveryKey(patient, "study"), {
      kind: "study",
      token: "timer",
      status: "draft",
      expiresAt: now + RECORD_RECOVERY_MS,
      fields: { studyType: "Privado", date: "", result: "" },
    });
    function Probe() {
      const copy = useRecordRecovery(patient, "study");
      return <p>{copy ? "Copia disponible" : "Sin copia"}</p>;
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
    expect(screen.getByText("Copia disponible")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECORD_RECOVERY_MS + 1);
    });
    expect(screen.getByText("Sin copia")).toBeInTheDocument();
    expect(client.getQueryData(recordRecoveryKey(patient, "study"))).toBeNull();
  });
  it("keeps cleared result, multiline text and unchanged date exact after recovery", async () => {
    const c = configs[1];
    const t = setup(c);
    const v = t.view();
    await open(c, true);
    fireEvent.change(screen.getByLabelText("Resultado del estudio (opcional)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(c.label), { target: { value: "Línea uno\nLínea dos" } });
    v.unmount();
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByText("Recuperamos tus cambios temporales. Revisalos antes de guardar.");
    expect(screen.getByLabelText("Resultado del estudio (opcional)")).toHaveValue("");
    expect(screen.getByLabelText(c.label)).toHaveValue("Línea uno\nLínea dos");
    await reviewAndSave(c, true);
    await waitFor(() => expect(t.writes).toHaveLength(1));
    expect(t.writes[0]?.body).toEqual({ studyType: "Línea uno\nLínea dos", result: "" });
  });
  it("retains unknown-unit baseline and the operator's explicit KG checkbox", async () => {
    const c = configs[2];
    const t = setup(c);
    t.change({ unit: null });
    const v = t.view();
    await screen.findByText("12,345");
    fireEvent.click(screen.getByRole("button", { name: /Ver registro de peso/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Corregir peso" }));
    fireEvent.change(screen.getByLabelText("Valor registrado (unidad no especificada)"), {
      target: { value: "0,125" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    v.unmount();
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    expect(await screen.findByRole("checkbox")).toBeChecked();
    expect(screen.getByLabelText("Valor registrado (unidad no especificada)")).toHaveValue("0,125");
    await reviewAndSave(c, true);
    await waitFor(() => expect(t.writes).toHaveLength(1));
    expect(t.writes[0]?.body).toEqual({ quantity: "0.125", unit: "KG" });
  });
  it.each([200, 403, 500])(
    "does not erase a newer draft when an abandoned command settles %i",
    async (status) => {
      const c = configs[0];
      const t = setup(c);
      let v = t.view();
      await open(c);
      t.options.pending = true;
      await reviewAndSave(c);
      await waitFor(() => expect(t.writes).toHaveLength(1));
      v.unmount();
      v = t.view();
      await offer(c);
      fireEvent.click(screen.getByRole("button", { name: "Descartar copia temporal" }));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar copia" })
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Registrar tratamiento" })).toBeEnabled()
      );
      await open(c);
      fireEvent.change(screen.getByLabelText(c.label), { target: { value: "Otro borrador" } });
      v.unmount();
      await act(async () => {
        t.finish(status);
        await Promise.resolve();
      });
      const copy = t.client.getQueryData<{ fields: { description: string } }>(
        recordRecoveryKey(patient, "treatment")
      );
      expect(copy?.fields.description).toBe("Otro borrador");
    }
  );
  it("keeps the three record kinds separate in the same patient cache", async () => {
    const c = configs[0];
    const t = setup(c);
    let v = t.view();
    await open(c);
    v.unmount();
    t.change({ studyType: "Otro estudio", result: "", performedAt: precise });
    v = render(
      <QueryClientProvider client={t.client}>
        <StudyList patientId={patient} />
      </QueryClientProvider>
    );
    await screen.findByText("Otro estudio");
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    v.unmount();
    expect(t.client.getQueryData(recordRecoveryKey(patient, "treatment"))).toBeTruthy();
    expect(t.client.getQueryData(recordRecoveryKey(patient, "study"))).toBeUndefined();
  });
  it("never writes clinical recovery into browser storage or history", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const history = vi.spyOn(window.history, "replaceState");
    const c = configs[0];
    const t = setup(c);
    const v = t.view();
    await open(c);
    v.unmount();
    t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByLabelText(c.label);
    expect(storage).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });
});

describe("Recovered editor cleanup", () => {
  it("does not resurrect a recovered correction after all changes are undone", async () => {
    const c = configs[0];
    const t = setup(c);
    let v = t.view();
    await open(c, true);
    v.unmount();
    v = t.view();
    await offer(c);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await screen.findByText("Recuperamos tus cambios temporales. Revisalos antes de guardar.");
    fireEvent.change(screen.getByLabelText(c.label), { target: { value: c.baseline.description } });
    v.unmount();
    t.view();
    await screen.findByText(c.original);
    expect(screen.queryByRole("button", { name: "Recuperar cambios" })).not.toBeInTheDocument();
    expect(t.writes).toHaveLength(0);
  });
});
