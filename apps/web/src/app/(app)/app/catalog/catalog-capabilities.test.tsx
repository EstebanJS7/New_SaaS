import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { CatalogList } from "./catalog-list";
import { CatalogItemDetail } from "./[id]/catalog-item-detail";

const { ITEM_ID } = vi.hoisted(() => ({ ITEM_ID: "11111111-1111-4111-8111-111111111111" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: ITEM_ID }),
}));

const ROW = {
  id: ITEM_ID,
  kind: "SERVICE",
  name: "Consulta clínica",
  taxRateName: "IVA 10%",
  referencePriceAmount: null,
  referencePriceCurrency: null,
  isActive: true,
};
const ITEM = {
  ...ROW,
  tenantId: "tenant-a",
  taxRateId: "22222222-2222-4222-8222-222222222222",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "0.10" },
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};
const READER: Capabilities = { permissions: ["catalog.read"], features: [] };
const WRITER: Capabilities = {
  permissions: ["catalog.read", "catalog.create", "catalog.update", "catalog.deactivate"],
  features: [],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function install(items: unknown[] = [ROW]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url === "/api/catalog/search"
          ? json({ items, page: 1, pageSize: 20, total: items.length, totalPages: 1 })
          : json(ITEM)
      )
    )
  );
}
function mount(node: ReactNode, capabilities?: Capabilities) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  return render(
    capabilities ? <CapabilitiesProvider value={capabilities}>{tree}</CapabilitiesProvider> : tree
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("catalog actions follow the caller's capabilities (UX-037)", () => {
  it("hides create, edit and deactivate from a read-only caller", async () => {
    install();
    mount(<CatalogList />, READER);
    expect(await screen.findByText("Consulta clínica")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Nuevo artículo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it("hides the empty-state create link from a caller without catalog.create", async () => {
    install([]);
    mount(<CatalogList />, READER);
    expect(await screen.findByText("No encontramos artículos")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crear artículo" })).not.toBeInTheDocument();
  });

  it.each([
    ["granted", WRITER],
    ["unknown", undefined],
  ])("offers every write when capabilities are %s", async (_label, capabilities) => {
    install();
    mount(<CatalogList />, capabilities);
    expect(await screen.findByText("Consulta clínica")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nuevo artículo/ })).toHaveAttribute(
      "href",
      "/app/catalog/new"
    );
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("hides the detail edit link without catalog.update and offers it otherwise", async () => {
    install();
    const view = mount(<CatalogItemDetail />, READER);
    expect(await screen.findByRole("heading", { name: "Consulta clínica" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar artículo" })).not.toBeInTheDocument();
    view.unmount();

    for (const capabilities of [WRITER, undefined]) {
      const again = mount(<CatalogItemDetail />, capabilities);
      expect(await screen.findByRole("link", { name: "Editar artículo" })).toBeInTheDocument();
      again.unmount();
    }
  });
});
