import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TreatmentForm } from "./treatment-form";
import { StudyForm } from "./study-form";
import { WeightForm } from "./weight-form";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const patient = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  instant = "2026-10-20T15:00:42.123Z";
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
const cases = [
  {
    kind: "treatment",
    name: "tratamiento",
    label: "Descripción del tratamiento",
    change: "Mi corrección",
    baseline: { id, version: 1, description: "Original", context: null, administeredAt: instant },
  },
  {
    kind: "study",
    name: "estudio",
    label: "Resultado del estudio (opcional)",
    change: "Mi resultado",
    baseline: {
      id,
      version: 1,
      studyType: "Original",
      result: "Resultado original",
      performedAt: instant,
    },
  },
  {
    kind: "weight",
    name: "peso",
    label: "Peso (kg)",
    change: "0,125",
    baseline: { id, version: 1, quantity: "12.345", unit: "KG" as const, measuredAt: instant },
  },
] as const;
describe.each(cases)("$kind correction CAS UI", (c) => {
  function setup(mode: "conflict" | "missing" | "version-drift" | "success") {
    const onSaved = vi.fn();
    let reads = 0;
    const baseline = { ...c.baseline, ...(mode === "missing" ? { version: undefined } : {}) };
    const writes: { body: Record<string, unknown> }[] = [];
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") {
        reads++;
        return Promise.resolve(
          json({ ...baseline, ...((mode === "version-drift" || reads > 1) && { version: 2 }) })
        );
      }
      if (typeof init?.body !== "string") throw Error("Expected JSON");
      writes.push({ body: JSON.parse(init.body) as Record<string, unknown> });
      return Promise.resolve(
        mode === "success" ? json(baseline) : json({ error: { code: "CONFLICT" } }, 409)
      );
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {c.kind === "treatment" ? (
          <TreatmentForm
            patientId={patient}
            initial={baseline as (typeof cases)[0]["baseline"]}
            onSaved={onSaved}
            onCancel={vi.fn()}
          />
        ) : c.kind === "study" ? (
          <StudyForm
            patientId={patient}
            initial={baseline as (typeof cases)[1]["baseline"]}
            onSaved={onSaved}
            onCancel={vi.fn()}
          />
        ) : (
          <WeightForm
            patientId={patient}
            initial={baseline as (typeof cases)[2]["baseline"]}
            onSaved={onSaved}
            onCancel={vi.fn()}
          />
        )}
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Motivo sintético" } });
    fireEvent.change(screen.getByLabelText(c.label), { target: { value: c.change } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar corrección" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar " + c.name })
    );
    return { writes, onSaved, fetch };
  }
  it("sends the baseline version, preserves local input on 409 and reads current state without another PUT", async () => {
    const t = setup("conflict");
    await screen.findByText(/El registro cambió. Conservamos/);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0].body.expectedVersion).toBe(1);
    expect(screen.getByLabelText(c.label)).toHaveValue(c.change);
    expect(t.onSaved).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar " + c.name })
    ).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Volver al formulario" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Consultar registro actual" }));
    await waitFor(() =>
      expect(t.fetch.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(2)
    );
    expect(t.writes).toHaveLength(1);
    expect(screen.getByLabelText(c.label)).toHaveValue(c.change);
  });
  it("blocks a preflight version change even when clinical values match", async () => {
    const t = setup("version-drift");
    await screen.findByRole("region", { name: "Conflicto de corrección" });
    expect(t.writes).toHaveLength(0);
  });
  it("refuses to fall back to an unguarded PUT when the detail lacks version", async () => {
    const t = setup("missing");
    await screen.findByText(/No pudimos comprobar la versión/);
    expect(t.writes).toHaveLength(0);
    expect(t.onSaved).not.toHaveBeenCalled();
  });
});
