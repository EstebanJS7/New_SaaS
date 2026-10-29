import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SalesList } from "./sales-list";
import { SALE_LIST_CONTEXT_MS } from "./sales-list-state";
import type { SaleSearchInput, SaleSearchResult } from "./sale-search-api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const ID = "11111111-1111-4111-8111-111111111111";
const item = {
  id: ID,
  customerName: "Rex",
  hasCustomer: true,
  status: "DRAFT" as const,
  createdAt: "2026-10-29T12:00:00Z",
};
function page(input: Partial<SaleSearchResult> = {}): SaleSearchResult {
  return {
    items: [item],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    canReadCustomers: true,
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
  handler: (body: SaleSearchInput) => Response | Promise<Response> = () => json(page())
) {
  const requests: SaleSearchInput[] = [];
  const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    expect(url).toBe("/api/sales/search");
    expect(init?.method).toBe("POST");
    if (typeof init?.body !== "string") throw new Error("JSON body expected");
    const body = JSON.parse(init.body) as SaleSearchInput;
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
        <SalesList />
      </QueryClientProvider>
    ),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Sale server list", () => {
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
    expect(await screen.findByText("Rex")).toBeInTheDocument();
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [403, "FEATURE_NOT_ENTITLED"],
  ])("keeps %s %s errors explicit", async (status, code) => {
    install(() => json({ error: { code, message: "Denied" } }, Number(status)));
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No encontramos ventas")).not.toBeInTheDocument();
  });
  it("searches only on submit using POST and renders server results rather than filtering locally", async () => {
    const { requests } = install((body) =>
      json(page({ items: [{ ...item, customerName: body.q ? "Michi" : "Rex" }] }))
    );
    mount();
    await screen.findByText("Rex");
    fireEvent.change(screen.getByLabelText("Buscar ventas"), {
      target: { value: "Synthetic guardian" },
    });
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("Michi")).toBeInTheDocument();
    expect(requests[1]).toMatchObject({ q: "Synthetic guardian", page: 1 });
    expect(window.location.search).not.toContain("Synthetic");
  });
  it("uses server page metadata and disables boundary navigation", async () => {
    const { requests } = install((body) =>
      json(
        page({
          page: body.page,
          total: 21,
          totalPages: 2,
          items: [{ ...item, customerName: body.page === 1 ? "Rex" : "Michi" }],
        })
      )
    );
    mount();
    await screen.findByText("Rex");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Michi");
    expect(requests.at(-1)?.page).toBe(2);
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.getByText("Mostrando 21–21 de 21")).toBeInTheDocument();
  });
  it("resets the page when lifecycle or order changes", async () => {
    const { requests } = install((body) =>
      json(page({ page: body.page, total: 21, totalPages: 2 }))
    );
    mount();
    await screen.findByText("Rex");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "CANCELLED" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ status: "CANCELLED", page: 1 }));
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "oldest" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ sort: "oldest", page: 1 }));
  });
  it("restores search and page after opening a record and returning in the same document", async () => {
    const { requests } = install((body) =>
      json(page({ page: body.page, total: 21, totalPages: 2 }))
    );
    const first = mount();
    await screen.findByText("Rex");
    fireEvent.change(screen.getByLabelText("Buscar ventas"), {
      target: { value: "Responsible" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Rex");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 2");
    expect(screen.getByRole("link", { name: `Venta ${ID}` })).toHaveAttribute(
      "href",
      `/app/sales/${ID}`
    );
    first.unmount();
    mount(first.client);
    expect(screen.getByLabelText("Buscar ventas")).toHaveValue("Responsible");
    await screen.findByText("Rex");
    expect(requests.at(-1)).toMatchObject({ q: "Responsible", page: 2 });
  });
  it("expires same-document context and does not reuse it with a new query client", async () => {
    const { requests } = install();
    const first = mount();
    await screen.findByText("Rex");
    fireEvent.change(screen.getByLabelText("Buscar ventas"), {
      target: { value: "Responsible" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Rex");
    first.unmount();
    const time = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(time + SALE_LIST_CONTEXT_MS + 1);
    const second = mount(first.client);
    await screen.findByText("Rex");
    expect(screen.getByLabelText("Buscar ventas")).toHaveValue("");
    expect(requests.at(-1)?.q).toBe("");
    second.unmount();
    mount();
    await screen.findByText("Rex");
    expect(screen.getByLabelText("Buscar ventas")).toHaveValue("");
  });
  it("does not disclose guardian names when the server denies their read", async () => {
    install(() =>
      json(page({ canReadCustomers: false, items: [{ ...item, customerName: null }] }))
    );
    mount();
    await screen.findByRole("link", { name: `Venta ${ID}` });
    expect(screen.getByText(/No tenés acceso a nombres de clientes/)).toBeInTheDocument();
    expect(screen.getByText(/Cliente: acceso restringido/)).toBeInTheDocument();
  });
  it("validates a short input and shows an empty state with clear filters", async () => {
    const { requests } = install((body) =>
      json(page({ items: body.q ? [] : [item], total: body.q ? 0 : 1, totalPages: body.q ? 0 : 1 }))
    );
    mount();
    await screen.findByText("Rex");
    fireEvent.change(screen.getByLabelText("Buscar ventas"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar ventas"), { target: { value: "Absent" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("No encontramos ventas");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await screen.findByText("Rex");
    expect(screen.getByLabelText("Buscar ventas")).toHaveValue("");
  });
  it("keeps late responses from replacing a newer filter result", async () => {
    let resolve: (value: Response) => void = () => undefined;
    install((body) =>
      body.status === "all"
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : json(page({ items: [{ ...item, customerName: "Inactive result", status: "CANCELLED" }] }))
    );
    mount();
    expect(screen.getByText("Buscando ventas…")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "CANCELLED" } });
    await screen.findByText("Inactive result");
    await act(async () => {
      resolve(json(page()));
      await Promise.resolve();
    });
    expect(screen.queryByText("Rex")).not.toBeInTheDocument();
  });
});
