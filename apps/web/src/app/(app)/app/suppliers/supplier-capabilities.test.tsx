import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { SupplierList } from "./suppliers-list";
import { SupplierDetail } from "./[id]/supplier-detail";

const { SUPPLIER_ID } = vi.hoisted(() => ({
  SUPPLIER_ID: "11111111-1111-4111-8111-111111111111",
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: SUPPLIER_ID }),
}));

const SUPPLIER = {
  id: SUPPLIER_ID,
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: "Distribuidora Central S.A.",
  taxId: "80012345-6",
  email: null,
  phone: null,
  address: null,
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};
const READER: Capabilities = { permissions: ["suppliers.read"], features: [] };
const WRITER: Capabilities = {
  permissions: ["suppliers.read", "suppliers.create", "suppliers.update", "suppliers.deactivate"],
  features: [],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function install(list: unknown[] = [SUPPLIER]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(url.startsWith(`/api/suppliers/${SUPPLIER_ID}`) ? json(SUPPLIER) : json(list))
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

describe("supplier actions follow the caller's capabilities (UX-037)", () => {
  it("hides create, edit and deactivate from a read-only caller", async () => {
    install();
    mount(<SupplierList />, READER);
    expect(await screen.findByText("Distribuidora Central")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nuevo proveedor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it("hides the empty-state register link from a caller without suppliers.create", async () => {
    install([]);
    mount(<SupplierList />, READER);
    expect(await screen.findByText("No hay proveedores activos")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Registrar proveedor" })).not.toBeInTheDocument();
  });

  it.each([
    ["granted", WRITER],
    ["unknown", undefined],
  ])("offers every write when capabilities are %s", async (_label, capabilities) => {
    install();
    mount(<SupplierList />, capabilities);
    expect(await screen.findByText("Distribuidora Central")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo proveedor" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });

  it("hides the detail edit link without suppliers.update and offers it otherwise", async () => {
    install();
    const view = mount(<SupplierDetail />, READER);
    expect(
      await screen.findByRole("heading", { name: "Distribuidora Central" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    view.unmount();
    for (const capabilities of [WRITER, undefined]) {
      const again = mount(<SupplierDetail />, capabilities);
      expect(await screen.findByRole("link", { name: "Editar" })).toBeInTheDocument();
      again.unmount();
    }
  });
});
