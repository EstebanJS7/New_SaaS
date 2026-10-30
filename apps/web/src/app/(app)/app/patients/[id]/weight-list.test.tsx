import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WeightList } from "./weight-list";
import { WEIGHT_LIST_CONTEXT_MS } from "./weight-list-state";
import { parseWeightRange } from "./weight-filter-input";
import type { WeightSearchInput, WeightSearchResult } from "./weight-search-api";
const patient = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const item = { id, quantity: "12.345", unit: null, measuredAt: "2026-10-20T15:00:00.000Z" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function page(input: Partial<WeightSearchResult> = {}) {
  return { items: [item], page: 1, pageSize: 20, total: 1, totalPages: 1, ...input };
}
function install(
  handler: (input: WeightSearchInput) => Response | Promise<Response> = () => json(page())
) {
  const requests: WeightSearchInput[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (typeof url !== "string") throw new Error("String route expected");
    expect(url).not.toContain("?");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (init?.method === "GET") return Promise.resolve(json(item));
    expect(init?.method).toBe("POST");
    if (typeof init?.body !== "string") throw new Error("JSON expected");
    const input = JSON.parse(init.body) as WeightSearchInput;
    requests.push(input);
    return Promise.resolve(handler(input));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests };
}
function view(client: QueryClient, patientId = patient) {
  return (
    <QueryClientProvider client={client}>
      <WeightList patientId={patientId} />
    </QueryClientProvider>
  );
}
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(view(client)) };
}
function apply(min: string, max = "") {
  fireEvent.change(screen.getByLabelText("Unidad de peso"), { target: { value: "unspecified" } });
  fireEvent.change(screen.getByLabelText("Valor mínimo"), { target: { value: min } });
  fireEvent.change(screen.getByLabelText("Valor máximo"), { target: { value: max } });
  fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Exact local weight filters", () => {
  it("accepts empty, grouped and exact inclusive bounds", () => {
    expect(parseWeightRange("", "")).toEqual({
      ok: true,
      value: { minQuantity: undefined, maxQuantity: undefined },
    });
    expect(parseWeightRange("0,001", "9.999.999,999")).toEqual({
      ok: true,
      value: { minQuantity: "0.001", maxQuantity: "9999999.999" },
    });
    expect(parseWeightRange("12,345", "12,345").ok).toBe(true);
  });
  it.each(["1.5", "0", "0,000", "-1", "1e3", "NaN", "10.000.000", "1,2345", "1.23,4"])(
    "rejects ambiguous or invalid %s",
    (value) => {
      expect(parseWeightRange(value, "").ok).toBe(false);
    }
  );
  it("compares adjacent maximum thousandths exactly", () => {
    expect(parseWeightRange("9.999.999,999", "9.999.999,998").ok).toBe(false);
  });
});
describe("Patient weight list", () => {
  it("requires a unit for ranges and never submits an all-unit numerical comparison", async () => {
    const { requests } = install();
    mount();
    await screen.findByText("12,345");
    fireEvent.change(screen.getByLabelText("Valor mínimo"), { target: { value: "1,234" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Seleccioná kg o sin unidad");
    expect(requests).toHaveLength(1);
  });
  it("shows explicit KG and unspecified filters without attributing units to unknown rows", async () => {
    const { requests } = install((input) =>
      json(page({ items: [{ ...item, unit: input.unit === "KG" ? "KG" : null }] }))
    );
    mount();
    await screen.findByText("12,345");
    fireEvent.change(screen.getByLabelText("Unidad de peso"), { target: { value: "KG" } });
    await screen.findByText("12,345 kg");
    expect(requests.at(-1)).toMatchObject({ unit: "KG", page: 1 });
    fireEvent.change(screen.getByLabelText("Unidad de peso"), { target: { value: "unspecified" } });
    await screen.findByText("12,345");
    expect(screen.queryByText("12,345 kg")).not.toBeInTheDocument();
  });
  it("submits bounds explicitly in a private body and displays server results", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { requests } = install((input) =>
      json(page({ items: [{ ...item, quantity: input.minQuantity ? "22.222" : item.quantity }] }))
    );
    mount();
    await screen.findByText("12,345");
    fireEvent.change(screen.getByLabelText("Valor mínimo"), { target: { value: "1,234" } });
    expect(requests).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Unidad de peso"), { target: { value: "unspecified" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await screen.findByText("22,222");
    expect(requests.at(-1)).toMatchObject({ minQuantity: "1.234", page: 1, unit: "unspecified" });
    expect(requests.at(-1)).not.toHaveProperty("q");
    expect(storage).not.toHaveBeenCalled();
  });
  it("rejects reversed bounds locally and resets", async () => {
    const { requests } = install();
    mount();
    await screen.findByText("12,345");
    apply("2,001", "2,000");
    expect(screen.getByRole("alert")).toHaveTextContent("mínimo no puede ser mayor");
    expect(requests).toHaveLength(2);
    expect(requests.at(-1)).toMatchObject({ unit: "unspecified" });
    expect(requests.at(-1)?.minQuantity).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByLabelText("Valor mínimo")).toHaveValue("");
    expect(screen.getByLabelText("Valor máximo")).toHaveValue("");
  });
  it("uses server pages and resets page on period/order changes", async () => {
    const { requests } = install((input) =>
      json(page({ page: input.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText("12,345");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fecha de medición"), { target: { value: "last30" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ period: "last30", page: 1 }));
    fireEvent.change(screen.getByLabelText("Ordenar pesos"), { target: { value: "oldest" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ sort: "oldest", page: 1 }));
  });
  it("reads fresh detail and returns to page with focus and no assumed unit", async () => {
    const { requests } = install((input) =>
      json(page({ page: input.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText("12,345");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    fireEvent.click(screen.getByRole("button", { name: /Ver registro de peso/ }));
    await screen.findByText("Valor registrado");
    expect(screen.getByText("Unidad no especificada en el registro.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Detalle del registro de peso" })).toHaveFocus();
    expect(screen.queryByText(/\bkg\b/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver al listado de pesos" }));
    await screen.findByText("Página 2 de 2");
    expect(requests.at(-1)?.page).toBe(2);
    expect(screen.getByRole("heading", { name: "Pesos" })).toHaveFocus();
  });
  it("restores exact bounds per patient and discards expired context", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText("12,345");
    apply("0,001", "9.999.999,999");
    await waitFor(() => expect(requests.at(-1)?.minQuantity).toBe("0.001"));
    first.unmount();
    const second = mount(first.client);
    await screen.findByText("12,345");
    expect(screen.getByLabelText("Valor mínimo")).toHaveValue("0,001");
    expect(screen.getByLabelText("Valor máximo")).toHaveValue("9999999,999");
    second.unmount();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + WEIGHT_LIST_CONTEXT_MS + 1);
    mount(first.client);
    await screen.findByText("12,345");
    expect(screen.getByLabelText("Valor mínimo")).toHaveValue("");
  });
  it("does not reuse another patient's range", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText("12,345");
    apply("1,001");
    await waitFor(() => expect(requests.at(-1)?.minQuantity).toBe("1.001"));
    first.rerender(view(first.client, "33333333-3333-4333-8333-333333333333"));
    await waitFor(() => expect(requests.at(-1)?.minQuantity).toBeUndefined());
    expect(screen.getByLabelText("Valor mínimo")).toHaveValue("");
  });
  it("shows empty state and bounded navigation", async () => {
    install(() => json(page({ items: [], total: 0, totalPages: 0 })));
    mount();
    await screen.findByText("No encontramos registros de peso");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [403, "FEATURE_NOT_ENTITLED"],
    [404, "NOT_FOUND"],
  ])("handles %s %s without private messages", async (status, code) => {
    install(() => json({ error: { code, message: "PRIVATE" } }, Number(status)));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
  });
  it("retries list failures", async () => {
    let fail = true;
    install(() => (fail ? json({ error: { code: "INTERNAL" } }, 500) : json(page())));
    mount();
    await screen.findByRole("alert");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("12,345");
  });
  it("aborts superseded bounds and ignores late results", async () => {
    let resolve: ((response: Response) => void) | undefined;
    const { fetch } = install((input) =>
      input.minQuantity === "1.001"
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : json(page({ items: [{ ...item, quantity: input.minQuantity ?? item.quantity }] }))
    );
    mount();
    await screen.findByText("12,345");
    apply("1,001");
    await waitFor(() => expect(resolve).toBeDefined());
    apply("2,002");
    await screen.findByText("2,002");
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
    await act(async () => {
      resolve?.(json(page({ items: [{ ...item, quantity: "1.001" }] })));
      await Promise.resolve();
    });
    expect(screen.queryByText("1,001")).not.toBeInTheDocument();
  });
  it("discards context with a new document QueryClient", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText("12,345");
    apply("1,001");
    await waitFor(() => expect(requests.at(-1)?.minQuantity).toBe("1.001"));
    first.unmount();
    mount();
    await screen.findByText("12,345");
    expect(screen.getByLabelText("Valor mínimo")).toHaveValue("");
  });
  it("renders maximum and smallest stored decimals exactly in es-PY", async () => {
    install(() =>
      json(
        page({
          items: [
            { ...item, quantity: "9999999.999" },
            { ...item, id: "33333333-3333-4333-8333-333333333333", quantity: "0.001" },
          ],
        })
      )
    );
    mount();
    await screen.findByText("9.999.999,999");
    expect(screen.getByText("0,001")).toBeInTheDocument();
  });
});
