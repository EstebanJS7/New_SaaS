import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClinicalHistory, ClinicalHistoryEntry, readClinicalHistory } from "./clinical-history";

const patient = "11111111-1111-4111-8111-111111111111",
  record = "22222222-2222-4222-8222-222222222222";
const date = "2026-10-20T15:00:42.123Z";
const cases = [
  {
    kind: "treatments",
    before: { description: "Antes <script>literal</script>", context: null, administeredAt: date },
    after: { description: "Después", context: "Dos\nlíneas", administeredAt: date },
  },
  {
    kind: "studies",
    before: { studyType: "Radiografía", result: "Antes", performedAt: date },
    after: { studyType: "Radiografía", result: "Después", performedAt: date },
  },
  {
    kind: "weights",
    before: { quantity: "12.345", unit: null, measuredAt: date },
    after: { quantity: "0.125", unit: "KG", measuredAt: date },
  },
] as const;
afterEach(() => vi.unstubAllGlobals());
describe("history access without parent permission props", () => {
  function setup(allowed?: boolean, status = 200, serverAllowed = true) {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ allowed: serverAllowed }), { status }))
      );
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ClinicalHistoryEntry patientId={patient} kind="weights" id={record} allowed={allowed} />
      </QueryClientProvider>
    );
    return fetch;
  }
  it("resolves the capability from the authenticated server instead of hiding an authorized entry", async () => {
    const fetch = setup();
    expect(await screen.findByRole("button", { name: "Ver historial" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`/api/clinical/${patient}/history-access`);
    expect(fetch.mock.calls[0][1]?.cache).toBe("no-store");
  });
  it("hides an explicitly denied capability", async () => {
    setup(undefined, 200, false);
    await waitFor(() =>
      expect(screen.queryByText("Comprobando acceso al historial…")).not.toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Ver historial" })).not.toBeInTheDocument();
  });
  it("distinguishes an outage from a denial and permits a read-only retry", async () => {
    const fetch = setup(undefined, 503);
    await screen.findByText("No pudimos comprobar el acceso al historial");
    fetch.mockImplementation(() => Promise.resolve(new Response('{"allowed":true}')));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("button", { name: "Ver historial" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not request or expose an entry when the parent already knows it is denied", () => {
    const fetch = setup(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
describe.each(cases)("$kind clinical history", (c) => {
  const item = {
    id: record,
    actorName: "Nombre al momento",
    reason: "Motivo\nliteral",
    correctedAt: date,
    beforeVersion: 1,
    afterVersion: 2,
    before: c.before,
    after: c.after,
  };
  function setup(status = 200, page = { items: [item], nextCursor: null as number | null }) {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(page), { status })));
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ClinicalHistory patientId={patient} kind={c.kind} id={record} />
      </QueryClientProvider>
    );
    return { fetch, ...view };
  }
  it("reads only on explicit opening and shows immutable before/after, actor and literal reason", async () => {
    const t = setup();
    expect(t.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver historial" }));
    const region = await screen.findByRole("region", { name: "Historial de correcciones" });
    await within(region).findByText("Realizada por: Nombre al momento");
    expect(region).toHaveTextContent("Motivo: Motivo literal");
    expect(within(region).getByRole("heading", { name: "Antes" })).toBeInTheDocument();
    expect(region.querySelector("script")).toBeNull();
    if (c.kind === "weights") {
      expect(region).toHaveTextContent("12,345");
      expect(region).toHaveTextContent("0,125");
      expect(region).toHaveTextContent("Unidad no especificada");
    }
    const [url, init] = t.fetch.mock.calls[0];
    expect(url).toBe(`/api/clinical/${patient}/${c.kind}/${record}/history/search`);
    expect(init).toMatchObject({ method: "POST", body: "{}", cache: "no-store" });
    fireEvent.click(screen.getByRole("button", { name: "Ocultar historial" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver historial" })).toHaveFocus();
  });
  it("distinguishes missing historic coverage from a claim that the record never changed", async () => {
    setup(200, { items: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Ver historial" }));
    expect(
      await screen.findByText("No hay correcciones conservadas para este registro.")
    ).toBeInTheDocument();
    expect(screen.getByText(/No reconstruimos cambios anteriores/)).toBeInTheDocument();
  });
  it("keeps cursors in request bodies and offers both pagination directions without a write", async () => {
    const t = setup(200, { items: [item], nextCursor: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Ver historial" }));
    await screen.findByText("Realizada por: Nombre al momento");
    t.fetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], nextCursor: null })))
    );
    fireEvent.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(t.fetch).toHaveBeenCalledTimes(2));
    expect(t.fetch.mock.calls[1][1]?.body).toBe('{"beforeVersion":2}');
    expect(await screen.findByRole("button", { name: "Más recientes" })).toBeEnabled();
  });
  it("shows a permission refusal without exposing a successful-looking history", async () => {
    setup(403);
    fireEvent.click(screen.getByRole("button", { name: "Ver historial" }));
    expect(
      await screen.findByText("No tenés permiso para consultar el historial.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Realizada por: Nombre al momento")).not.toBeInTheDocument();
  });
  it("rejects malformed or wrong-unit snapshots instead of displaying inferred content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ ...item, after: { ...c.after, unit: "LB" } }],
              nextCursor: null,
            })
          )
        )
      )
    );
    await expect(readClinicalHistory(patient, c.kind, record)).rejects.toThrow();
  });
});
