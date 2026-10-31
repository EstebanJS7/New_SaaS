import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TreatmentForm } from "./treatment-form";
import { StudyForm } from "./study-form";
import { WeightForm } from "./weight-form";
import { ClinicalServerDrafts } from "./clinical-server-drafts";
import {
  serverDraftRecovery,
  searchServerDrafts,
  type ServerClinicalDraft,
} from "./clinical-server-drafts-api";
import { writeTreatment } from "./treatment-write-api";
import { writeStudy } from "./study-write-api";
import { writeWeight } from "./weight-write-api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const patient = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333",
  record = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-20T15:00:42.123Z",
  ref = { id, version: 1, submitVersion: 1 };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const kinds = ["treatment", "study", "weight"] as const;
function item(kind: (typeof kinds)[number]): ServerClinicalDraft {
  const common = { date: "2026-10-20T12:00:42.123", creation: { key } };
  const copy =
    kind === "treatment"
      ? { kind, fields: { ...common, description: "Manual draft", context: "Context" } }
      : kind === "study"
        ? { kind, fields: { ...common, studyType: "Manual study", result: "Result" } }
        : { kind, fields: { ...common, quantity: "0,125", confirmedKg: true } };
  return { id, version: 1, state: "ACTIVE", copy, command: null, confirmedId: null, updatedAt: at };
}
function setup(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {element}
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe.each(kinds)("%s server drafts", (kind) => {
  it("blocks clinical confirmation while the manual save is pending or unconfirmed", async () => {
    let settle: ((response: Response) => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        })
    );
    vi.stubGlobal("fetch", fetch);
    const props = { patientId: patient, onSaved: vi.fn(), onCancel: vi.fn() };
    setup(
      kind === "treatment" ? (
        <TreatmentForm {...props} />
      ) : kind === "study" ? (
        <StudyForm {...props} />
      ) : (
        <WeightForm {...props} />
      )
    );
    const label =
      kind === "treatment"
        ? "Descripción del tratamiento"
        : kind === "study"
          ? "Tipo de estudio"
          : "Peso (kg)";
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: kind === "weight" ? "0,125" : "Synthetic" },
    });
    const review = screen.getByRole("button", {
      name:
        kind === "treatment"
          ? "Revisar tratamiento"
          : kind === "study"
            ? "Revisar estudio"
            : "Revisar peso",
    });
    expect(review).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(review).toBeDisabled());
    fireEvent.click(review);
    expect(fetch).toHaveBeenCalledTimes(1);
    settle?.(json({ error: { code: "INTERNAL" } }, 503));
    await screen.findByText(/No pudimos confirmar el borrador/);
    expect(review).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();
  });
  it("saves incomplete working fields only after an explicit click, without clinical creation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => {
      const body = JSON.parse(str(init?.body)) as { copy: ServerClinicalDraft["copy"] };
      return Promise.resolve(
        json({ ...item(kind), id: str(_url).split("/").at(-1), copy: body.copy })
      );
    });
    vi.stubGlobal("fetch", fetch);
    const props = { patientId: patient, onSaved: vi.fn(), onCancel: vi.fn() };
    setup(
      kind === "treatment" ? (
        <TreatmentForm {...props} />
      ) : kind === "study" ? (
        <StudyForm {...props} />
      ) : (
        <WeightForm {...props} />
      )
    );
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await screen.findByText(/Borrador guardado en el servidor/);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(str(url)).toMatch(/\/drafts\/[0-9a-f-]+$/);
    expect(init).toMatchObject({ method: "PUT", cache: "no-store" });
    const body = JSON.parse(str(init?.body)) as {
      version: number;
      copy: {
        kind: string;
        fields: { date: string; durable?: unknown; creation: { key: string } };
      };
    };
    expect(body.version).toBe(0);
    expect(body.copy.kind).toBe(kind);
    expect(body.copy.fields.date).toBe("");
    expect(body.copy.fields.creation.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.copy.fields.durable).toBeUndefined();
  });
  it("recovers an author-private saved copy only after explicit authorized reads", async () => {
    const draft = item(kind),
      recover = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          json(
            str(url).endsWith("/drafts/search")
              ? { items: [draft], nextCursor: null }
              : str(url).endsWith("/drafts/" + id)
                ? draft
                : { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }
          )
        )
      );
    vi.stubGlobal("fetch", fetch);
    setup(<ClinicalServerDrafts patientId={patient} kind={kind} onRecover={recover} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Borradores guardados" }));
    await screen.findByRole("button", { name: "Recuperar cambios" });
    expect(recover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recuperar cambios" }));
    await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(recover.mock.calls[0][0]).toMatchObject({
      kind,
      status: "draft",
      fields: { durable: ref },
    });
    expect(fetch.mock.calls.some(([url]) => str(url).endsWith("/drafts/" + id))).toBe(true);
    for (const [url, init] of fetch.mock.calls) {
      expect(str(url)).not.toContain("?");
      expect(init?.cache).toBe("no-store");
    }
  });
  it("restores the frozen submitted command, not stale manually saved field values", () => {
    const draft = item(kind);
    draft.state = "PENDING";
    draft.version = 2;
    draft.confirmedId = record;
    draft.command =
      kind === "treatment"
        ? { idempotencyKey: key, description: "Frozen command", context: null, administeredAt: at }
        : kind === "study"
          ? {
              idempotencyKey: key,
              studyType: "Frozen command",
              result: "Frozen result",
              performedAt: at,
            }
          : { idempotencyKey: key, quantity: "12.345", unit: "KG", measuredAt: at };
    const copy = serverDraftRecovery(draft);
    expect(copy.status).toBe("uncertain");
    expect(copy.fields.creation).toMatchObject({ key, savedId: record });
    expect(copy.fields.durable).toEqual({ id, version: 2, submitVersion: 1 });
    expect(copy.fields.creation?.command).not.toHaveProperty("idempotencyKey");
    if (copy.kind === "weight")
      expect(copy.fields).toMatchObject({ quantity: "12.345", confirmedKg: true });
    else if (copy.kind === "treatment") expect(copy.fields.description).toBe("Frozen command");
    else expect(copy.fields.studyType).toBe("Frozen command");
    expect(draft.copy.fields.creation?.savedId).toBeUndefined();
  });
});
it("reuses the same draft ID/version after a manual-save response is lost", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new TypeError("Synthetic response loss"));
  vi.stubGlobal("fetch", fetch);
  setup(<TreatmentForm patientId={patient} onSaved={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await screen.findByText(/No pudimos confirmar el borrador/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]);
  expect(fetch.mock.calls[0][1]?.body).toBe(fetch.mock.calls[1][1]?.body);
});
it("routes a bound creation through durable preparation and acknowledges only after a valid clinical DTO", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      json({ id: record, description: "Clinical", context: null, administeredAt: at })
    )
    .mockResolvedValueOnce(json({ completed: true }));
  vi.stubGlobal("fetch", fetch);
  await writeTreatment(
    patient,
    undefined,
    { description: "Clinical", context: null, administeredAt: at, draft: ref },
    { key }
  );
  expect(fetch.mock.calls[0][0]).toBe(`/api/clinical/${patient}/drafts/${id}/submit`);
  expect(JSON.parse(str(fetch.mock.calls[0][1]?.body))).toEqual({
    version: 1,
    command: { description: "Clinical", context: null, administeredAt: at, idempotencyKey: key },
  });
  expect(fetch.mock.calls[1][0]).toBe(`/api/clinical/${patient}/drafts/${id}/complete`);
});
it("routes a bound correction without changing its original version or reason", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      json({ id: record, studyType: "Study", result: "Result", performedAt: at })
    )
    .mockResolvedValueOnce(json({ completed: true }));
  vi.stubGlobal("fetch", fetch);
  await writeStudy(patient, record, {
    result: "Result",
    expectedVersion: 9,
    correctionReason: "Reason",
    draft: ref,
  });
  expect(JSON.parse(str(fetch.mock.calls[0][1]?.body))).toEqual({
    version: 1,
    command: { result: "Result", expectedVersion: 9, correctionReason: "Reason" },
  });
});
it("keeps a confirmed weight read-only after projection failure, including an authoritative recovered ID", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(json({ id: record }))
    .mockRejectedValueOnce(Error("Projection unavailable"));
  vi.stubGlobal("fetch", fetch);
  const attempt = { key, savedId: undefined as string | undefined };
  await expect(
    writeWeight(
      patient,
      undefined,
      { quantity: "0.125", unit: "KG", measuredAt: at, draft: ref },
      attempt
    )
  ).rejects.toMatchObject({ uncertain: true });
  expect(attempt.savedId).toBe(record);
  fetch
    .mockResolvedValueOnce(
      json({ id: record, quantity: "0.125", unit: "KG", measuredAt: at, version: 1 })
    )
    .mockResolvedValueOnce(json({ completed: true }));
  await writeWeight(patient, undefined, { draft: { ...ref, version: 2 } }, attempt);
  expect(fetch.mock.calls[2][1]?.method).toBe("GET");
  expect(fetch.mock.calls[2][0]).toBe(`/api/clinical/${patient}/weights/${record}`);
  expect(fetch.mock.calls.filter(([url]) => str(url).endsWith("/submit"))).toHaveLength(1);
});
it.each([401, 403, 404])("does not expose drafts on denied reads (%s)", async (status) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(json({ error: { code: "DENIED" } }, status));
  vi.stubGlobal("fetch", fetch);
  setup(<ClinicalServerDrafts patientId={patient} kind="treatment" onRecover={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Borradores guardados" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/Manual draft/)).not.toBeInTheDocument();
});
it("blocks uncertain corrections after reload without offering a resend", async () => {
  const draft = item("treatment");
  draft.state = "PENDING";
  draft.version = 2;
  draft.copy = {
    kind: "treatment",
    initial: { id: record, version: 1, description: "Before", context: null, administeredAt: at },
    fields: { description: "After", context: "", date: "2026-10-20T12:00" },
  };
  draft.command = { description: "After", expectedVersion: 1, correctionReason: "Reason" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ items: [draft], nextCursor: null })));
  setup(<ClinicalServerDrafts patientId={patient} kind="treatment" onRecover={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Borradores guardados" }));
  await screen.findByText(/El reenvío está bloqueado/);
  expect(screen.queryByRole("button", { name: /Recuperar/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Descartar borrador guardado" })).toBeEnabled();
});
it("rejects a malformed or different-kind list response rather than treating it as a usable draft", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(json({ items: [item("study")], nextCursor: null }))
  );
  await expect(searchServerDrafts(patient, "weight")).rejects.toThrow();
});

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("String expected");
  return value;
}
