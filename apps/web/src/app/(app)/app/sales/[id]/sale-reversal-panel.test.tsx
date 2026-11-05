import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Sale } from "../sales-api";
import { SaleReversalPanel } from "./sale-reversal-panel";

const SALE_ID = "22222222-2222-4222-8222-222222222222";

const SALE: Sale = {
  id: SALE_ID,
  tenantId: "tenant-a",
  customerId: null,
  currency: "PYG",
  status: "COMPLETED",
  lines: [],
  total: "185000.00",
  createdAt: "2026-11-03T10:00:00.000Z",
  updatedAt: "2026-11-03T10:00:00.000Z",
} as unknown as Sale;

const REVERSAL = {
  id: "44444444-4444-4444-8444-444444444444",
  saleId: SALE_ID,
  reason: "Cobro duplicado",
  reversedAt: "2026-11-03T12:00:00.000Z",
  reversedByUserProfileId: "u-1",
  cashSessionId: "s-1",
  refunds: [
    { paymentId: "p-1", method: "CASH", amount: "100000.00" },
    { paymentId: "p-2", method: "CARD", amount: "85000.00" },
  ],
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly key: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      key: headers["idempotency-key"] ?? null,
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  });
  return calls;
}

function renderPanel(sale: Sale): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SaleReversalPanel sale={sale} />
    </QueryClientProvider>
  );
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

afterEach(() => vi.restoreAllMocks());

function openAndType(reason: string): void {
  fireEvent.click(screen.getByRole("button", { name: "Anular venta" }));
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: reason } });
}

function confirmButton(): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: "Anular venta" });
  return buttons[buttons.length - 1];
}

describe("SaleReversalPanel (SAL-REV-001) — a completed sale", () => {
  it("asks for a reason before it can be confirmed, and sends nothing until then", () => {
    const calls = installFetch(() => json(REVERSAL, 201));
    renderPanel(SALE);
    openAndType("no");

    expect(screen.getByText("¿Anular esta venta?")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(calls).toHaveLength(0);
  });

  it("posts the trimmed reason with an idempotency key", async () => {
    const calls = installFetch(() => json(REVERSAL, 201));
    renderPanel(SALE);
    openAndType("  Cobro duplicado  ");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe(`/api/sales/${SALE_ID}/reverse`);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ reason: "Cobro duplicado" });
    expect(post?.key).toMatch(/.{8,}/);
  });

  it("keeps the dialog open with a usable message when no cash session is open", async () => {
    installFetch(() =>
      json(
        { error: { code: "CONFLICT", message: "A cash payment requires an open cash session." } },
        409
      )
    );
    renderPanel(SALE);
    openAndType("Cobro duplicado");
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/tiene que haber una caja abierta/)).toBeInTheDocument();
  });

  it("re-sends the SAME key when the same attempt is retried", async () => {
    let first = true;
    const calls = installFetch(() => {
      if (first) {
        first = false;
        return json({ error: { code: "INTERNAL", message: "boom" } }, 500);
      }
      return json(REVERSAL, 200);
    });
    renderPanel(SALE);
    openAndType("Cobro duplicado");
    fireEvent.click(confirmButton());
    await screen.findByRole("alert");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(2));
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts[0]?.key).toBe(posts[1]?.key);
  });

  it("explains a permission refusal", async () => {
    installFetch(() => json({ error: { code: "FORBIDDEN", message: "x" } }, 403));
    renderPanel(SALE);
    openAndType("Cobro duplicado");
    fireEvent.click(confirmButton());
    expect(await screen.findByText(/Solo Propietario y Administración/)).toBeInTheDocument();
  });
});

describe("SaleReversalPanel (SAL-REV-001) — a cancelled sale", () => {
  it("shows the credit note and where it is with SIFEN (NCE-001)", async () => {
    installFetch(() =>
      json({
        ...REVERSAL,
        creditNote: {
          id: "cn-1",
          number: "001-002-0000003",
          issuedAt: "2026-11-04T09:00:00.000Z",
          fiscalStatus: "SUBMITTED",
        },
      })
    );
    renderPanel({ ...SALE, status: "CANCELLED" });

    const note = await screen.findByTestId("sale-credit-note");
    expect(note.textContent).toContain("N° 001-002-0000003");
    expect(note.textContent).toContain("esperando la respuesta de SIFEN");
  });

  it("shows no credit note section for a sale that was not invoiced", async () => {
    installFetch(() => json({ ...REVERSAL, creditNote: null }));
    renderPanel({ ...SALE, status: "CANCELLED" });
    await screen.findByTestId("sale-reversal-record");
    expect(screen.queryByTestId("sale-credit-note")).toBeNull();
  });

  it("shows when, why and what was refunded", async () => {
    installFetch(() => json(REVERSAL));
    renderPanel({ ...SALE, status: "CANCELLED" });

    const record = await screen.findByTestId("sale-reversal-record");
    expect(record.textContent).toContain("Cobro duplicado");
    expect(record.textContent).toContain("Efectivo (salió de la caja abierta)");
    expect(record.textContent).toContain("Tarjeta");
  });

  it("shows nothing for a cancelled draft, which has no reversal", async () => {
    const calls = installFetch(() => json({ error: { code: "NOT_FOUND", message: "x" } }, 404));
    renderPanel({ ...SALE, status: "CANCELLED" });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId("sale-reversal-record")).toBeNull();
    expect(screen.queryByRole("button", { name: "Anular venta" })).toBeNull();
  });

  it("offers nothing on a draft", () => {
    const calls = installFetch(() => json({}));
    renderPanel({ ...SALE, status: "DRAFT" });
    expect(screen.queryByRole("button", { name: "Anular venta" })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
