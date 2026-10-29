import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogList } from "./catalog-list";
import type { CatalogSearchInput, CatalogSearchRow } from "./catalog-search-api";
import { formatStaffMoney } from "@/lib/es-py-format";

const ITEM: CatalogSearchRow = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "SERVICE",
  name: "Consulta clínica",
  taxRateName: "IVA 10%",
  referencePriceAmount: "150000.00",
  referencePriceCurrency: "PYG",
  isActive: true,
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function install(
  handler: (input: CatalogSearchInput) => Response = () =>
    json({ items: [ITEM], page: 1, pageSize: 20, total: 1, totalPages: 1 })
) {
  const reads: CatalogSearchInput[] = [],
    commands: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      if (url.endsWith("/deactivate")) {
        commands.push(url);
        return Promise.resolve(json({ ...ITEM, isActive: false }));
      }
      expect(url).toBe("/api/catalog/search");
      if (typeof init?.body !== "string") throw new Error("Expected JSON body");
      const input = JSON.parse(init.body) as CatalogSearchInput;
      reads.push(input);
      return Promise.resolve(handler(input));
    })
  );
  return { reads, commands };
}
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CatalogList />
    </QueryClientProvider>
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("CatalogList existing behaviors on the paginated read", () => {
  it("renders a permission-denied state for 403 FORBIDDEN", async () => {
    install(() => json({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403));
    mount();
    expect(
      await screen.findByText("No tenés permiso para ver los artículos del catálogo.")
    ).toBeInTheDocument();
  });
  it("keeps an unexpected entitlement response distinct without adding an entitlement gate", async () => {
    install(() => json({ error: { code: "FEATURE_NOT_ENTITLED", message: "Not entitled" } }, 403));
    mount();
    expect(
      await screen.findByText("El catálogo no está habilitado para esta organización.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No tenés permiso para ver los artículos del catálogo.")
    ).not.toBeInTheDocument();
  });
  it("renders a Spanish unauthenticated message for 401", async () => {
    install(() =>
      json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401)
    );
    mount();
    expect(
      await screen.findByText("Iniciá sesión para ver los artículos del catálogo.")
    ).toBeInTheDocument();
  });
  it("renders an empty state with active filters instead of claiming that all items are inactive", async () => {
    install(() => json({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }));
    mount();
    expect(await screen.findByText("No encontramos artículos")).toBeInTheDocument();
    expect(screen.getByLabelText("Estado")).toHaveValue("active");
  });
  it("links name to read-only detail and Editar to edit, retaining reference-price display", async () => {
    install();
    mount();
    expect(await screen.findByRole("link", { name: "Consulta clínica" })).toHaveAttribute(
      "href",
      `/app/catalog/${ITEM.id}`
    );
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/app/catalog/${ITEM.id}/edit`
    );
    expect(screen.getByText(/Servicio · IVA 10% · Gs\.\s150\.000/)).toBeInTheDocument();
  });
  it("defaults to active and includes inactive items only after changing the server filter", async () => {
    const { reads, commands } = install();
    mount();
    await screen.findByText("Consulta clínica");
    expect(reads[0]).toMatchObject({ status: "active", kind: "all" });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "all" } });
    await waitFor(() => expect(reads.at(-1)?.status).toBe("all"));
    expect(commands).toEqual([]);
  });
  it("sends the selected kind alongside the default active filter", async () => {
    const { reads, commands } = install();
    mount();
    await screen.findByText("Consulta clínica");
    fireEvent.change(screen.getByLabelText("Tipo de artículo"), { target: { value: "SUPPLY" } });
    await waitFor(() => expect(reads.at(-1)).toMatchObject({ kind: "SUPPLY", status: "active" }));
    expect(commands).toEqual([]);
  });
  it("deactivates only after explicit dialog confirmation", async () => {
    const prototype = HTMLDialogElement.prototype;
    const oldShow = Object.getOwnPropertyDescriptor(prototype, "showModal"),
      oldClose = Object.getOwnPropertyDescriptor(prototype, "close");
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
    try {
      const { commands } = install();
      mount();
      await screen.findByText("Consulta clínica");
      fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
      const dialog = screen.getByRole("dialog", { name: "Desactivar artículo" });
      expect(commands).toEqual([]);
      fireEvent.click(within(dialog).getByRole("button", { name: "Desactivar artículo" }));
      await waitFor(() => expect(commands).toEqual([`/api/catalog/${ITEM.id}/deactivate`]));
    } finally {
      if (oldShow) Object.defineProperty(prototype, "showModal", oldShow);
      else Reflect.deleteProperty(prototype, "showModal");
      if (oldClose) Object.defineProperty(prototype, "close", oldClose);
      else Reflect.deleteProperty(prototype, "close");
    }
  });
  it("does not offer deactivation for an already inactive item", async () => {
    install(() =>
      json({
        items: [{ ...ITEM, isActive: false }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      })
    );
    mount();
    await screen.findByText("Consulta clínica");
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeDisabled();
  });
  it("preserves large USD decimal digits and omits missing reference prices", async () => {
    install(() =>
      json({
        items: [
          { ...ITEM, referencePriceAmount: "999999999999.99", referencePriceCurrency: "USD" },
          {
            ...ITEM,
            id: "22222222-2222-4222-8222-222222222222",
            name: "Sin precio",
            referencePriceAmount: null,
            referencePriceCurrency: null,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
      })
    );
    mount();
    expect(
      await screen.findByText(`Servicio · IVA 10% · ${formatStaffMoney("999999999999.99", "USD")}`)
    ).toBeInTheDocument();
    expect(screen.getByText("Sin precio")).toBeInTheDocument();
    expect(screen.getByText("Servicio · IVA 10%")).toBeInTheDocument();
  });
});
