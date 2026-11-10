import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { StockSurface } from "./stock-surface";
import {
  INVALID_TRANSFER_BODY_MESSAGE,
  InventoryRequestError,
  userFacingInventoryError,
} from "./inventory-api";

const CENTRAL = "11111111-1111-4111-8111-111111111111";
const NORTE = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

function balance(branchId: string, branchName: string, quantity: string): Record<string, unknown> {
  return {
    id: `${branchId}-${ITEM}`,
    tenantId: "tenant-a",
    catalogItemId: ITEM,
    item: { name: "Pipeta", kind: "PRODUCT" },
    branchId,
    branchName,
    quantity,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FetchOptions {
  readonly branches?: readonly { id: string; name: string }[];
  readonly transfer?: () => Response;
}

function installFetch(options: FetchOptions = {}): ReturnType<typeof vi.fn> {
  const branches = options.branches ?? [
    { id: CENTRAL, name: "Casa central" },
    { id: NORTE, name: "Norte" },
  ];
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/inventory/stock/branches") return Promise.resolve(json(branches));
    if (url === "/api/memberships/me/branches") return Promise.resolve(json({ branches }));
    if (url === `/api/inventory/stock?branchId=${NORTE}`) {
      return Promise.resolve(json([balance(NORTE, "Norte", "2.000")]));
    }
    if (url === "/api/inventory/stock") {
      return Promise.resolve(
        json([balance(CENTRAL, "Casa central", "5.000"), balance(NORTE, "Norte", "2.000")])
      );
    }
    if (url === "/api/inventory/stock/transfers") {
      return Promise.resolve(options.transfer ? options.transfer() : json({}, 201));
    }
    return Promise.resolve(json({}, 404));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function renderSurface(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StockSurface />
    </QueryClientProvider>
  );
}

describe("StockSurface (MB-003)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows every branch by default («Todas») and narrows to one", async () => {
    const fetchMock = installFetch();
    renderSurface();

    expect(await screen.findByText("Casa central", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("5.000")).toBeInTheDocument();
    expect(screen.getByText("2.000")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByLabelText("Sucursal").querySelectorAll("option").length).toBe(3)
    );
    fireEvent.change(screen.getByLabelText("Sucursal"), { target: { value: NORTE } });
    await waitFor(() => expect(screen.queryByText("5.000")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(`/api/inventory/stock?branchId=${NORTE}`, {
      cache: "no-store",
    });
  });

  it("sends a transfer with the chosen origin, destination, item and quantity", async () => {
    const fetchMock = installFetch();
    renderSurface();

    await screen.findByText("5.000");
    await waitFor(() =>
      expect(screen.getByLabelText("Desde").querySelectorAll("option").length).toBe(3)
    );
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: CENTRAL } });
    fireEvent.change(screen.getByLabelText("Hacia"), { target: { value: NORTE } });
    fireEvent.change(screen.getByLabelText("Ítem"), { target: { value: ITEM } });
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Reposición" } });
    fireEvent.click(screen.getByRole("button", { name: "Transferir" }));

    expect(await screen.findByText("Transferencia registrada.")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/inventory/stock/transfers");
    expect(JSON.parse((call?.[1] as { body: string }).body)).toEqual({
      catalogItemId: ITEM,
      fromBranchId: CENTRAL,
      toBranchId: NORTE,
      quantity: "1.5",
      reason: "Reposición",
    });
  });

  it("shows the API's refusal when the origin has not enough stock", async () => {
    installFetch({
      transfer: () =>
        json(
          {
            error: {
              code: "CONFLICT",
              message:
                "No hay stock suficiente en la sucursal de origen para transferir esa cantidad.",
            },
          },
          409
        ),
    });
    renderSurface();

    await screen.findByText("5.000");
    await waitFor(() =>
      expect(screen.getByLabelText("Desde").querySelectorAll("option").length).toBe(3)
    );
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: NORTE } });
    fireEvent.change(screen.getByLabelText("Hacia"), { target: { value: CENTRAL } });
    fireEvent.change(screen.getByLabelText("Ítem"), { target: { value: ITEM } });
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Transferir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay stock suficiente");
  });

  it("does not offer transfers with a single active branch", async () => {
    installFetch({ branches: [{ id: CENTRAL, name: "Casa central" }] });
    renderSurface();
    await screen.findByText("5.000");
    expect(screen.queryByText("Transferir entre sucursales")).toBeNull();
  });

  it("asks for both branches before sending anything", async () => {
    const fetchMock = installFetch();
    renderSurface();
    await screen.findByText("5.000");
    fireEvent.click(await screen.findByRole("button", { name: "Transferir" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Elegí la sucursal de origen");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/inventory/stock/transfers")).toBe(
      false
    );
  });
});

describe("StockSurface transfer follows the caller's capabilities (UX-037)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderAs(capabilities: Capabilities): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <CapabilitiesProvider value={capabilities}>
        <QueryClientProvider client={client}>
          <StockSurface />
        </QueryClientProvider>
      </CapabilitiesProvider>
    );
  }

  it("keeps the stock readable but hides the transfer form without inventory.stock.transfer", async () => {
    installFetch();
    renderAs({ permissions: ["inventory.stock.read"], features: [] });
    expect(await screen.findAllByText("Pipeta")).not.toHaveLength(0);
    expect(screen.queryByText("Transferir entre sucursales")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transferir" })).not.toBeInTheDocument();
  });

  it("offers the transfer form when inventory.stock.transfer is granted", async () => {
    installFetch();
    renderAs({ permissions: ["inventory.stock.read", "inventory.stock.transfer"], features: [] });
    expect(await screen.findByRole("button", { name: "Transferir" })).toBeInTheDocument();
  });

  it("offers the transfer form while capabilities are unknown", async () => {
    installFetch();
    renderSurface();
    expect(await screen.findByRole("button", { name: "Transferir" })).toBeInTheDocument();
  });
});

describe("userFacingInventoryError", () => {
  it("translates the permission and body-shape refusals and keeps Spanish API messages", () => {
    expect(userFacingInventoryError(new InventoryRequestError(403, "FORBIDDEN", "x"))).toBe(
      "No tenés permiso para esta acción de stock."
    );
    expect(
      userFacingInventoryError(
        new InventoryRequestError(400, "VALIDATION_FAILED", INVALID_TRANSFER_BODY_MESSAGE)
      )
    ).toMatch(/^Revisá los datos/);
    expect(
      userFacingInventoryError(
        new InventoryRequestError(400, "VALIDATION_FAILED", "No trabajás en esa sucursal.")
      )
    ).toBe("No trabajás en esa sucursal.");
    expect(userFacingInventoryError(new TypeError("Failed to fetch"))).toMatch(/servidor/);
  });
});
