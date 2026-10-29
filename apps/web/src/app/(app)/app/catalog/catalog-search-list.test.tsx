import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogList } from "./catalog-list";
import { CATALOG_LIST_CONTEXT_MS } from "./catalog-list-state";
import type { CatalogSearchInput, CatalogSearchResult } from "./catalog-search-api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const ID = "11111111-1111-4111-8111-111111111111";
const item = {
  id: ID,
  name: "Ana",
  kind: "SERVICE" as const,
  isActive: true,
  taxRateName: "IVA 10%",
  referencePriceAmount: "150000.00",
  referencePriceCurrency: "PYG",
};
function page(input: Partial<CatalogSearchResult> = {}): CatalogSearchResult {
  return {
    items: [item],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    ...input,
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function install(
  handler: (body: CatalogSearchInput) => Response | Promise<Response> = () => json(page())
) {
  const requests: CatalogSearchInput[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    expect(url).toBe("/api/catalog/search");
    expect(init?.method).toBe("POST");
    if (typeof init?.body !== "string") throw new Error("JSON body expected");
    const body = JSON.parse(init.body) as CatalogSearchInput;
    requests.push(body);
    return Promise.resolve(handler(body));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests };
}
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <CatalogList />
      </QueryClientProvider>
    ),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Catalog server list", () => {
  it("offers a Spanish retry after a failed read without exposing internal errors", async () => {
    let failed = true;
    install(() =>
      failed
        ? json({ error: { code: "INTERNAL", message: "Private database detail" } }, 500)
        : json(page())
    );
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("Private database detail")).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Ana")).toBeInTheDocument();
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
  ])("keeps %s %s errors explicit", async (status, code) => {
    install(() => json({ error: { code, message: "Denied" } }, Number(status)));
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No encontramos artículos")).not.toBeInTheDocument();
  });
  it("searches only on submit using POST and renders server results rather than filtering locally", async () => {
    const stored = vi.spyOn(Storage.prototype, "setItem");
    const { requests } = install((body) =>
      json(page({ items: [{ ...item, name: body.q ? "Bea" : "Ana" }] }))
    );
    mount();
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), {
      target: { value: "Synthetic guardian" },
    });
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("Bea")).toBeInTheDocument();
    expect(requests[1]).toMatchObject({ q: "Synthetic guardian", page: 1 });
    expect(window.location.search).not.toContain("Synthetic");
    expect(stored).not.toHaveBeenCalled();
  });
  it("uses server page metadata and disables boundary navigation", async () => {
    const { requests } = install((body) =>
      json(
        page({
          page: body.page,
          total: 21,
          totalPages: 2,
          items: [{ ...item, name: body.page === 1 ? "Ana" : "Bea" }],
        })
      )
    );
    mount();
    await screen.findByText("Ana");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Bea");
    expect(requests.at(-1)?.page).toBe(2);
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.getByText("Mostrando 21–21 de 21")).toBeInTheDocument();
  });
  it("resets the page when lifecycle or order changes", async () => {
    const { requests } = install((body) =>
      json(page({ page: body.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText("Ana");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ status: "inactive", page: 1 }));
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "recent" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ sort: "recent", page: 1 }));
  });
  it("resets page when customer kind changes", async () => {
    const { requests } = install((body) =>
      json(page({ page: body.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText("Ana");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    fireEvent.change(screen.getByLabelText("Tipo de artículo"), {
      target: { value: "MEDICATION" },
    });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ kind: "MEDICATION", page: 1 }));
  });
  it("restores search and page after opening a record and returning in the same document", async () => {
    const { requests } = install((body) =>
      json(page({ page: body.page, total: 21, totalPages: 2 }))
    );
    const first = mount();
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), {
      target: { value: "Responsible" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Tipo de artículo"), {
      target: { value: "MEDICATION" },
    });
    await waitFor(() => expect(requests.at(-1)?.kind).toBe("MEDICATION"));
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
    await waitFor(() => expect(requests.at(-1)?.status).toBe("inactive"));
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "recent" } });
    await waitFor(() => expect(requests.at(-1)?.sort).toBe("recent"));
    await screen.findByText("Ana");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    expect(screen.getByRole("link", { name: "Ana" })).toHaveAttribute("href", `/app/catalog/${ID}`);
    first.unmount();
    mount(first.client);
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("Responsible");
    await screen.findByText("Ana");
    expect(requests.at(-1)).toMatchObject({
      q: "Responsible",
      page: 2,
      kind: "MEDICATION",
      status: "inactive",
      sort: "recent",
    });
    expect(screen.getByLabelText("Tipo de artículo")).toHaveValue("MEDICATION");
    expect(screen.getByLabelText("Estado")).toHaveValue("inactive");
    expect(screen.getByLabelText("Ordenar por")).toHaveValue("recent");
  });
  it("expires same-document context and does not reuse it with a new query client", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), {
      target: { value: "Responsible" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Ana");
    first.unmount();
    const time = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(time + CATALOG_LIST_CONTEXT_MS + 1);
    const second = mount(first.client);
    await screen.findByText("Ana");
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("");
    expect(requests.at(-1)?.q).toBe("");
    second.unmount();
    mount();
    await screen.findByText("Ana");
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("");
  });
  it("validates a short input and shows an empty state with clear filters", async () => {
    const { requests } = install((body) =>
      json(page({ items: body.q ? [] : [item], total: body.q ? 0 : 1, totalPages: body.q ? 0 : 1 }))
    );
    mount();
    await screen.findByText("Ana");
    fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), {
      target: { value: "Absent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("No encontramos artículos");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await screen.findByText("Ana");
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("");
  });
  it("keeps late responses from replacing a newer filter result", async () => {
    let resolve: (value: Response) => void = () => undefined;
    install((body) =>
      body.status === "active"
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : json(page({ items: [{ ...item, name: "Inactive result", isActive: false }] }))
    );
    mount();
    expect(screen.getByText("Buscando artículos…")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
    await screen.findByText("Inactive result");
    await act(async () => {
      resolve(json(page()));
      await Promise.resolve();
    });
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  });
});
