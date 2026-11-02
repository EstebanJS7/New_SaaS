import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerSelector } from "./customer-selector";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

const CUSTOMER = {
  id: CUSTOMER_ID,
  tenantId: "tenant-a",
  kind: "INDIVIDUAL",
  displayName: "Ana Pérez",
  legalName: null,
  taxId: null,
  firstName: "Ana",
  lastName: "Pérez",
  documentNumber: null,
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderSelector(customerId = "", onChange = vi.fn()): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CustomerSelector customerId={customerId} onChange={onChange} disabled={false} />
    </QueryClientProvider>
  );
}

describe("CustomerSelector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers a walk-in default so an empty selection never blocks the sale", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([CUSTOMER])));

    renderSelector();

    const select = screen.getByLabelText("Cliente (opcional)");
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "Venta directa (sin cliente)" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Ana Pérez" })).toBeInTheDocument();
  });

  it("reports the selected customer reference without inventing one", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([CUSTOMER])));
    const onChange = vi.fn();

    renderSelector("", onChange);
    await screen.findByRole("option", { name: "Ana Pérez" });
    fireEvent.change(screen.getByLabelText("Cliente (opcional)"), {
      target: { value: CUSTOMER_ID },
    });

    expect(onChange).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("keeps the walk-in option and shows a hint when no customers exist", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([])));

    renderSelector();

    expect(
      await screen.findByText("No hay clientes disponibles; podés continuar como venta directa.")
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Venta directa (sin cliente)" })).toBeInTheDocument();
  });

  it("does not gate the sale when the customer read fails", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "denied" } }, 403))
    );

    renderSelector();

    expect(
      await screen.findByText(
        "No se pudieron cargar los clientes; podés continuar sin seleccionar uno."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers no discount, appointment or patient picker", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([CUSTOMER])));

    renderSelector();
    await screen.findByRole("option", { name: "Ana Pérez" });

    expect(
      screen.queryByLabelText(/discount|appointment|patient|descuento|turno|paciente/i)
    ).not.toBeInTheDocument();
  });
});
