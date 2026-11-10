import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { CustomersList } from "./customers-list";
import { CustomerDetail } from "./[id]/customer-detail";
import NewCustomerPage from "./new/page";
import EditCustomerPage from "./[id]/edit/page";

/**
 * UX-037: the customers screens offer only the actions the caller's
 * capabilities allow. Unknown capabilities (no provider) keep every action, and
 * the API re-checks every one.
 */
const ID = "11111111-1111-4111-8111-111111111111";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const ALL = [
  "customers.read",
  "customers.create",
  "customers.update",
  "customers.deactivate",
  "customers.address.manage",
  "customers.contact.manage",
];
const CUSTOMER = {
  id: ID,
  displayName: "Ana",
  kind: "INDIVIDUAL",
  isActive: true,
  firstName: "Ana",
  lastName: null,
  legalName: null,
  fiscalOperationType: "B2C",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: RequestInfo | URL) => {
    const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (path === "/api/customers/search") {
      return Promise.resolve(
        json({ items: [CUSTOMER], page: 1, pageSize: 20, total: 1, totalPages: 1 })
      );
    }
    if (path === `/api/customers/${ID}`) return Promise.resolve(json(CUSTOMER));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(ui: ReactNode, capabilities?: Capabilities): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
  render(
    capabilities === undefined ? (
      tree
    ) : (
      <CapabilitiesProvider value={capabilities}>{tree}</CapabilitiesProvider>
    )
  );
}

describe("Customers list gated by capabilities (UX-037)", () => {
  it("shows a no-access state and searches nothing without customers.read", async () => {
    mount(<CustomersList />, { permissions: [] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para ver los clientes" })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides create, edit and deactivate for a read-only caller", async () => {
    mount(<CustomersList />, { permissions: ["customers.read"] });
    expect(await screen.findByRole("link", { name: "Ana" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Nuevo cliente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it.each([
    ["granted", { permissions: ALL }],
    ["unknown", undefined],
  ])("offers every action when capabilities are %s", async (_label, capabilities) => {
    mount(<CustomersList />, capabilities);
    expect(await screen.findByRole("link", { name: "Ana" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nuevo cliente/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
  });
});

describe("Customer detail gated by capabilities (UX-037)", () => {
  it("shows a no-access state without customers.read", async () => {
    mount(<CustomerDetail />, { permissions: [] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para ver los clientes" })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides every write for a read-only caller", async () => {
    mount(<CustomerDetail />, { permissions: ["customers.read"] });
    expect(await screen.findByRole("heading", { name: "Ana" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar cliente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar cliente" })).not.toBeInTheDocument();
    expect(await screen.findByText("Este cliente no tiene direcciones registradas.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agregar dirección" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar contacto" })).not.toBeInTheDocument();
  });

  it("offers only the sub-resources the caller manages", async () => {
    mount(<CustomerDetail />, { permissions: ["customers.read", "customers.contact.manage"] });
    expect(await screen.findByRole("button", { name: "Agregar contacto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar dirección" })).not.toBeInTheDocument();
  });

  it.each([
    ["granted", { permissions: ALL }],
    ["unknown", undefined],
  ])("offers every action when capabilities are %s", async (_label, capabilities) => {
    mount(<CustomerDetail />, capabilities);
    expect(await screen.findByRole("button", { name: "Editar cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar cliente" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Agregar dirección" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Agregar contacto" })).toBeInTheDocument();
  });
});

describe("Customer create and edit routes gated by capabilities (UX-037)", () => {
  it("refuses the create form without customers.create", async () => {
    mount(<NewCustomerPage />, { permissions: ["customers.read"] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para crear clientes" })
    ).toBeInTheDocument();
  });

  it("refuses the edit form without customers.update and reads nothing", async () => {
    mount(<EditCustomerPage />, { permissions: ["customers.read"] });
    expect(
      await screen.findByRole("heading", { name: "No tenés permiso para editar clientes" })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["granted", { permissions: ALL }],
    ["unknown", undefined],
  ])("keeps both forms when capabilities are %s", (_label, capabilities) => {
    mount(<NewCustomerPage />, capabilities);
    expect(
      screen.queryByRole("heading", { name: "No tenés permiso para crear clientes" })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
