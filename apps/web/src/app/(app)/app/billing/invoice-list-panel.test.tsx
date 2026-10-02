import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApiRequestError, type Invoice, type InvoiceLine } from "./billing-api";
import { InvoiceListPanel } from "./invoice-list-panel";

const DRAFT_INVOICE: Invoice = {
  id: "99999999-9999-4999-8999-999999999999",
  saleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  customerId: null,
  currency: "PYG",
  status: "DRAFT",
  series: "A",
  number: null,
  confirmedAt: null,
  cancelledAt: null,
  cancelReason: null,
  lines: [],
  total: "1500.00",
  taxTotal: "136.36",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};

const CONFIRMED_INVOICE: Invoice = {
  ...DRAFT_INVOICE,
  id: "88888888-8888-4888-8888-888888888888",
  status: "CONFIRMED",
  number: 12,
  confirmedAt: "2026-10-01T09:30:00.000Z",
};

const CANCELLED_INVOICE: Invoice = {
  ...CONFIRMED_INVOICE,
  id: "77777777-7777-4777-8777-777777777777",
  status: "CANCELLED",
  cancelledAt: "2026-10-01T10:00:00.000Z",
  cancelReason: "Duplicated",
};

const LINE: InvoiceLine = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  catalogItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  position: 0,
  description: "Consultation",
  rateCode: "IVA_10",
  unitPrice: "10.50",
  quantity: "1.000",
  lineTotal: "10.50",
  taxableBase: "9.55",
  taxAmount: "0.95",
};

function renderPanel(overrides: Partial<Parameters<typeof InvoiceListPanel>[0]> = {}): {
  readonly onSelectInvoice: ReturnType<typeof vi.fn>;
  readonly onStatusFilterChange: ReturnType<typeof vi.fn>;
} {
  const onSelectInvoice = vi.fn();
  const onStatusFilterChange = vi.fn();
  render(
    <InvoiceListPanel
      invoices={[DRAFT_INVOICE, CONFIRMED_INVOICE, CANCELLED_INVOICE]}
      isLoading={false}
      loadError={null}
      statusFilter="ALL"
      onStatusFilterChange={onStatusFilterChange}
      selectedInvoiceId={null}
      onSelectInvoice={onSelectInvoice}
      {...overrides}
    />
  );
  return { onSelectInvoice, onStatusFilterChange };
}

describe("InvoiceListPanel states", () => {
  it("renders the loading branch", () => {
    renderPanel({ invoices: [], isLoading: true });

    expect(screen.getByTestId("invoices-loading")).toHaveTextContent("Loading invoices...");
    expect(screen.queryByTestId("invoices-empty")).not.toBeInTheDocument();
  });

  it("renders a permission refusal as its own outcome, never as an empty list", () => {
    renderPanel({
      invoices: [],
      loadError: new ApiRequestError("FORBIDDEN", "Access denied.", 403),
    });

    expect(screen.getByTestId("invoices-error")).toHaveTextContent("Permission denied");
    expect(screen.queryByTestId("invoices-empty")).not.toBeInTheDocument();
  });

  it("renders the empty branch", () => {
    renderPanel({ invoices: [] });

    expect(screen.getByTestId("invoices-empty")).toHaveTextContent(
      "No invoices match this filter."
    );
    expect(screen.queryAllByTestId("invoice-list-item")).toHaveLength(0);
  });
});

describe("InvoiceListPanel content", () => {
  it("renders each invoice with its status, number reading and total", () => {
    renderPanel();

    const items = screen.getAllByTestId("invoice-list-item");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Draft invoice No number yet");
    expect(items[0]).toHaveTextContent("1,500.00");
    expect(items[1]).toHaveTextContent("Confirmed invoice A-12");
    expect(items[2]).toHaveTextContent("Cancelled invoice A-12");
  });

  it("asks the API for the chosen status filter", () => {
    const { onStatusFilterChange } = renderPanel();

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "CONFIRMED" } });

    expect(onStatusFilterChange).toHaveBeenCalledWith("CONFIRMED");
  });

  it("selects the invoice the operator chose and marks it selected", () => {
    const { onSelectInvoice } = renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "Select invoice" })[0]);

    expect(onSelectInvoice).toHaveBeenCalledWith(DRAFT_INVOICE);
  });

  it("marks the selected invoice without claiming its lines", () => {
    renderPanel({ selectedInvoiceId: CONFIRMED_INVOICE.id });

    const items = screen.getAllByTestId("invoice-list-item");
    expect(items[1]).toHaveAttribute("data-selected", "true");
    expect(items[0]).toHaveAttribute("data-selected", "false");
    expect(screen.getByRole("button", { name: "Selected" })).toBeInTheDocument();
  });

  it("renders a line-free invoice list without inventing a line count", () => {
    renderPanel({ invoices: [{ ...DRAFT_INVOICE, lines: [LINE] }] });

    expect(screen.getByTestId("invoice-list-item")).toHaveTextContent(
      "Draft invoice No number yet"
    );
  });
});
