import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TreatmentList } from "./treatment-list";
import { TREATMENT_LIST_CONTEXT_MS } from "./treatment-list-state";
import type { TreatmentSearchInput, TreatmentSearchResult } from "./treatment-search-api";
const patient = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const item = {
  id,
  description: "Tratamiento sintético",
  administeredAt: "2026-10-20T15:00:00.000Z",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function page(input: Partial<TreatmentSearchResult> = {}) {
  return { items: [item], page: 1, pageSize: 20, total: 1, totalPages: 1, ...input };
}
function install(
  handler: (body: TreatmentSearchInput) => Response | Promise<Response> = () => json(page())
) {
  const requests: TreatmentSearchInput[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (typeof url !== "string") throw new Error("String route expected");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (init?.method === "GET") {
      expect(url).toContain(`/treatments/${id}`);
      return Promise.resolve(json({ ...item, context: "Contexto completo" }));
    }
    expect(init?.method).toBe("POST");
    expect(url).not.toContain("?");
    if (typeof init?.body !== "string") throw new Error("JSON expected");
    const input = JSON.parse(init.body) as TreatmentSearchInput;
    requests.push(input);
    return Promise.resolve(handler(input));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests };
}
function view(client: QueryClient, patientId = patient) {
  return (
    <QueryClientProvider client={client}>
      <TreatmentList patientId={patientId} />
    </QueryClientProvider>
  );
}
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(view(client)) };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Patient treatment list", () => {
  it("submits only explicit search with confidential body and displays server results", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { requests } = install((input) =>
      json(
        page({
          items: [{ ...item, description: input.q ? "Resultado del servidor" : item.description }],
        })
      )
    );
    mount();
    await screen.findByText(item.description);
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), {
      target: { value: "  Sintético  " },
    });
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Resultado del servidor");
    expect(requests[1]).toMatchObject({ q: "Sintético", page: 1 });
    expect(storage).not.toHaveBeenCalled();
  });
  it("validates a short query locally and resets filters", async () => {
    const { requests } = install();
    mount();
    await screen.findByText(item.description);
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("2 y 80");
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByLabelText("Buscar por descripción")).toHaveValue("");
  });
  it("uses server page/count, period and order with page reset", async () => {
    const { requests } = install((input) =>
      json(page({ page: input.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText(item.description);
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fecha de administración"), {
      target: { value: "last30" },
    });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ period: "last30", page: 1 }));
    fireEvent.change(screen.getByLabelText("Ordenar tratamientos"), {
      target: { value: "oldest" },
    });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ sort: "oldest", page: 1 }));
  });
  it("opens fresh detail and returns with applied context and keyboard focus", async () => {
    const { requests } = install((input) =>
      json(page({ page: input.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText(item.description);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    fireEvent.click(screen.getByRole("button", { name: /Ver tratamiento/ }));
    await screen.findByText("Contexto completo");
    expect(screen.getByRole("heading", { name: "Detalle del tratamiento" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Volver al listado de tratamientos" }));
    await screen.findByText("Página 2 de 2");
    expect(requests.at(-1)?.page).toBe(2);
    expect(screen.getByRole("heading", { name: "Tratamientos" })).toHaveFocus();
  });
  it("restores per-patient context after remount and discards expired context", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText(item.description);
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), {
      target: { value: "Conservada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(requests.at(-1)?.q).toBe("Conservada"));
    first.unmount();
    const second = mount(first.client);
    await screen.findByText(item.description);
    expect(screen.getByLabelText("Buscar por descripción")).toHaveValue("Conservada");
    second.unmount();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + TREATMENT_LIST_CONTEXT_MS + 1);
    mount(first.client);
    await screen.findByText(item.description);
    expect(screen.getByLabelText("Buscar por descripción")).toHaveValue("");
  });
  it("does not reuse another patient's filters or records", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText(item.description);
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), {
      target: { value: "Privada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(requests.at(-1)?.q).toBe("Privada"));
    first.rerender(view(first.client, "33333333-3333-4333-8333-333333333333"));
    await waitFor(() => expect(requests.at(-1)?.q).toBe(""));
    expect(screen.getByLabelText("Buscar por descripción")).toHaveValue("");
  });
  it("shows empty and clamped page without an invented creation command", async () => {
    install(() => json(page({ items: [], total: 0, totalPages: 0 })));
    mount();
    await screen.findByText("No encontramos tratamientos");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.queryByText("Crear tratamiento")).not.toBeInTheDocument();
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [403, "FEATURE_NOT_ENTITLED"],
    [404, "NOT_FOUND"],
  ])("renders %s %s explicitly", async (status, code) => {
    install(() => json({ error: { code, message: "PRIVATE" } }, Number(status)));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
    expect(screen.queryByText("No encontramos tratamientos")).not.toBeInTheDocument();
  });
  it("retries read failures with Spanish feedback", async () => {
    let fail = true;
    install(() => (fail ? json({ error: { code: "INTERNAL" } }, 500) : json(page())));
    mount();
    await screen.findByRole("alert");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText(item.description);
  });
  it("aborts obsolete searches and never displays their late results", async () => {
    let resolve: ((response: Response) => void) | undefined;
    const { fetch } = install((input) =>
      input.q === "Vieja"
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : json(page({ items: [{ ...item, description: input.q || item.description }] }))
    );
    mount();
    await screen.findByText(item.description);
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), {
      target: { value: "Vieja" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), {
      target: { value: "Nueva" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Nueva");
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
    await act(async () => {
      resolve?.(json(page({ items: [{ ...item, description: "Vieja" }] })));
      await Promise.resolve();
    });
    expect(screen.queryByText("Vieja")).not.toBeInTheDocument();
  });
  it("discards confidential context with a new document QueryClient", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText(item.description);
    fireEvent.change(screen.getByLabelText("Buscar por descripción"), {
      target: { value: "Anterior" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(requests.at(-1)?.q).toBe("Anterior"));
    first.unmount();
    mount();
    await screen.findByText(item.description);
    expect(screen.getByLabelText("Buscar por descripción")).toHaveValue("");
  });
  it("retries a missing detail without inventing data and can return after the error", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          init?.method === "POST"
            ? json(page())
            : fail
              ? json({ error: { code: "NOT_FOUND", message: "Private" } }, 404)
              : json({ ...item, context: null })
        )
      )
    );
    mount();
    await screen.findByText(item.description);
    fireEvent.click(screen.getByRole("button", { name: /Ver tratamiento/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No encontramos el paciente o el tratamiento solicitado."
    );
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Sin contexto registrado.");
    fireEvent.click(screen.getByRole("button", { name: "Volver al listado de tratamientos" }));
    await screen.findByText(item.description);
  });
});
