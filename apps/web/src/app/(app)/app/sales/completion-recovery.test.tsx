import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CounterSurface } from "./counter-surface";
import { SaleDetail } from "./[id]/sale-detail";
import { completionFailureCopy, completionNeedsStateCheck } from "./completion-outcome";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "22222222-2222-4222-8222-222222222222" }),
}));
const SALE_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

const ITEM = {
  id: ITEM_ID,
  tenantId: "tenant-a",
  kind: "PRODUCT",
  name: "Antibiotic",
  taxRateId: "rate-1",
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "10.00" },
  referencePriceAmount: "1500.00",
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

const DRAFT_SALE = {
  id: SALE_ID,
  tenantId: "tenant-a",
  customerId: null,
  currency: "PYG",
  status: "DRAFT",
  lines: [
    {
      id: "line-1",
      catalogItemId: ITEM_ID,
      rateCode: "IVA_10",
      unitPrice: "1500.00",
      quantity: "1.000",
      lineTotal: "1500.00",
      taxableBase: "1363.64",
      taxAmount: "136.36",
    },
  ],
  total: "1500.00",
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function mount(
  mode: "counter" | "detail",
  options: { completed?: boolean; refreshFails?: boolean } = {}
) {
  let reads = 0;
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/catalog")) return Promise.resolve(json([ITEM]));
    if (url.startsWith("/api/customers")) return Promise.resolve(json([]));
    if (url.endsWith("/complete")) return Promise.reject(new TypeError("Lost response"));
    if (init?.method === "POST") return Promise.resolve(json(DRAFT_SALE, 201));
    reads++;
    if (reads > 1 && options.refreshFails)
      return Promise.resolve(json({ error: { code: "FORBIDDEN", message: "Denied" } }, 403));
    return Promise.resolve(
      json({ ...DRAFT_SALE, status: reads > 1 && options.completed ? "COMPLETED" : "DRAFT" })
    );
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      {mode === "counter" ? <CounterSurface /> : <SaleDetail />}
    </QueryClientProvider>
  );
  return fetch;
}
async function failCompletion() {
  fireEvent.click(await screen.findByRole("button", { name: "Revisar venta" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar venta" })
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar venta" })
    ).toBeDisabled()
  );
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Volver" }));
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("POS uncertain completion recovery", () => {
  it("does not claim rejection for an unrecognized response", () => {
    expect(completionFailureCopy("unknown").description).toMatch(/no permite determinar/);
    expect(completionNeedsStateCheck("unknown")).toBe(true);
    expect(completionNeedsStateCheck("missing-cash-session")).toBe(false);
  });
  it("counter blocks retries and links to the authoritative sale detail", async () => {
    const fetch = mount("counter");
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a la venta" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    await failCompletion();
    expect(screen.queryByText(/sigue abierta; todavía no se completó/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Consultar venta" })).toHaveAttribute(
      "href",
      `/app/sales/${SALE_ID}`
    );
    expect(screen.getByRole("button", { name: "Revisar venta" })).toBeDisabled();
    expect(
      fetch.mock.calls.filter(([input]) =>
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).endsWith("/complete")
      )
    ).toHaveLength(1);
  });
  it("detail keeps payments and requires a fresh DRAFT response before retry", async () => {
    mount("detail");
    await failCompletion();
    expect(screen.getByRole("button", { name: "Revisar venta" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado actual" }));
    expect(
      await screen.findByText(/El servidor confirma que la venta sigue en borrador/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Importe del pago 1")).toHaveValue("1500,00");
    expect(screen.getByRole("button", { name: "Revisar venta" })).toBeEnabled();
  });
  it("detail removes payment actions when the server reports COMPLETED without inventing payment history", async () => {
    mount("detail", { completed: true });
    await failCompletion();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado actual" }));
    expect(await screen.findByText(/Estado actualizado desde el servidor/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar venta" })).not.toBeInTheDocument();
    expect(screen.getByText(/El detalle de pagos no está disponible/)).toBeInTheDocument();
  });
  it("denied state reads never re-enable a payment attempt", async () => {
    mount("detail", { refreshFails: true });
    await failCompletion();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado actual" }));
    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar venta" })).not.toBeInTheDocument();
  });
});
