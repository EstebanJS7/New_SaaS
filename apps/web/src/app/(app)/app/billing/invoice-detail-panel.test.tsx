import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ApiRequestError,
  INVOICE_NOT_DRAFT_MESSAGE,
  type Invoice,
  type InvoiceLine,
} from "./billing-api";
import { InvoiceDetailPanel } from "./invoice-detail-panel";

const LINE: InvoiceLine = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  catalogItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  position: 0,
  description: "Consultation",
  rateCode: "IVA_10",
  unitPrice: "750.00",
  quantity: "2.000",
  lineTotal: "1500.00",
  taxableBase: "1363.64",
  taxAmount: "136.36",
};

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
  lines: [LINE],
  total: "1500.00",
  taxTotal: "136.36",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};

const CONFIRMED_INVOICE: Invoice = {
  ...DRAFT_INVOICE,
  status: "CONFIRMED",
  number: 12,
  confirmedAt: "2026-10-01T09:30:00.000Z",
};

const CANCELLED_INVOICE: Invoice = {
  ...CONFIRMED_INVOICE,
  status: "CANCELLED",
  cancelledAt: "2026-10-01T10:15:00.000Z",
  cancelReason: "Duplicated by mistake",
};

function renderPanel(overrides: Partial<Parameters<typeof InvoiceDetailPanel>[0]> = {}): {
  readonly onConfirm: ReturnType<typeof vi.fn>;
  readonly onCancel: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn().mockResolvedValue(undefined);
  render(
    <InvoiceDetailPanel
      invoice={DRAFT_INVOICE}
      isLoading={false}
      loadError={null}
      onConfirm={onConfirm}
      isConfirming={false}
      confirmError={null}
      onCancel={onCancel}
      isCancelling={false}
      cancelError={null}
      outcome={null}
      {...overrides}
    />
  );
  return { onConfirm, onCancel };
}

describe("InvoiceDetailPanel states", () => {
  it("renders the no-selection branch", () => {
    renderPanel({ invoice: null });

    expect(screen.getByTestId("invoice-no-selection")).toHaveTextContent(
      "Seleccioná una factura de la lista para ver sus líneas y totales."
    );
  });

  it("renders the loading branch", () => {
    renderPanel({ invoice: null, isLoading: true });

    expect(screen.getByTestId("invoice-loading")).toHaveTextContent("Cargando factura…");
    expect(screen.queryByTestId("invoice-no-selection")).not.toBeInTheDocument();
  });

  it("renders a backend 404 as an error state, never as data", () => {
    renderPanel({
      invoice: null,
      loadError: new ApiRequestError("NOT_FOUND", "Invoice was not found.", 404),
    });

    expect(screen.getByTestId("invoice-error")).toHaveTextContent("No encontramos la factura");
    expect(screen.queryByTestId("invoice-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-total")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPanel snapshot", () => {
  it("shows the draft's lines, totals and lifecycle fields exactly as returned", () => {
    renderPanel();

    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Borrador");
    expect(screen.getByTestId("invoice-number")).toHaveTextContent("Sin número todavía");
    expect(screen.getByTestId("invoice-currency")).toHaveTextContent("PYG");
    expect(screen.getByTestId("invoice-confirmed-at")).toHaveTextContent("Sin confirmar");
    expect(screen.getByTestId("invoice-cancelled-at")).toHaveTextContent("Sin anular");
    expect(screen.queryByTestId("invoice-cancel-reason")).not.toBeInTheDocument();

    const line = screen.getByTestId("invoice-line");
    expect(line).toHaveTextContent("Consultation");
    expect(line).toHaveTextContent("Cant. 2 · unitario Gs. 750");
    expect(screen.getByTestId("invoice-line-total")).toHaveTextContent("Gs. 1.500");

    // The totals are the API's own server-computed strings, grouped for display
    // and never recomputed from the lines.
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("Gs. 1.500");
    expect(screen.getByTestId("invoice-tax-total")).toHaveTextContent("Gs. 136,36");
  });

  it("shows a confirmed invoice's allocated number and confirmation timestamp", () => {
    renderPanel({ invoice: CONFIRMED_INVOICE });

    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Confirmada");
    expect(screen.getByTestId("invoice-number")).toHaveTextContent("A-12");
    expect(screen.getByTestId("invoice-confirmed-at")).toHaveTextContent(
      "1 oct. 2026, 06:30 a. m."
    );
    // Confirm is only ever offered for a draft.
    expect(screen.queryByRole("button", { name: "Confirmar factura" })).not.toBeInTheDocument();
  });

  it("shows a cancelled invoice's reason and makes the terminal state explicit", () => {
    renderPanel({ invoice: CANCELLED_INVOICE });

    expect(screen.getByTestId("invoice-status")).toHaveTextContent("Anulada");
    expect(screen.getByTestId("invoice-cancelled-at")).toHaveTextContent(
      "1 oct. 2026, 07:15 a. m."
    );
    expect(screen.getByTestId("invoice-cancel-reason")).toHaveTextContent("Duplicated by mistake");
    expect(screen.getByTestId("invoice-cancelled-terminal")).toHaveTextContent(
      "La anulación es definitiva"
    );
    // No reopen, no edit and no second cancellation are offered.
    expect(screen.queryByRole("button", { name: "Anular factura" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Motivo de la anulación")).not.toBeInTheDocument();
  });

  it("shows no fiscal state and offers no fiscal action", () => {
    renderPanel();

    expect(screen.getByTestId("invoice-no-fiscal-state")).toHaveTextContent(
      "Esta factura no es un documento fiscal y no tiene estado fiscal."
    );
    expect(screen.queryByTestId("invoice-fiscal-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fiscal|print|export|download/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /fiscal|print|export|download/i })).toBeNull();
  });

  it("offers no edit or reopen affordance at any status", () => {
    for (const invoice of [DRAFT_INVOICE, CONFIRMED_INVOICE, CANCELLED_INVOICE]) {
      const { unmount } = render(
        <InvoiceDetailPanel
          invoice={invoice}
          isLoading={false}
          loadError={null}
          onConfirm={vi.fn()}
          isConfirming={false}
          confirmError={null}
          onCancel={vi.fn()}
          isCancelling={false}
          cancelError={null}
          outcome={null}
        />
      );
      expect(screen.queryByRole("button", { name: /edit|reopen|delete/i })).toBeNull();
      unmount();
    }
  });
});

describe("InvoiceDetailPanel commands", () => {
  it("confirms only through the confirm action", () => {
    const { onConfirm } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar factura" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("requires a reason before issuing a cancellation", () => {
    const { onCancel } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Anular factura" }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("invoice-cancel-validation-error")).toHaveTextContent(
      "Ingresá el motivo de la anulación."
    );
  });

  it("cancels with the trimmed reason the operator typed", async () => {
    const { onCancel } = renderPanel();

    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), {
      target: { value: "  Duplicated  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anular factura" }));

    expect(onCancel).toHaveBeenCalledWith("Duplicated");
    // A confirmed cancellation clears the draft.
    await waitFor(() => expect(screen.getByLabelText("Motivo de la anulación")).toHaveValue(""));
  });

  it("disables both commands while their request is in flight", () => {
    renderPanel({ isConfirming: true, isCancelling: true });

    expect(screen.getByRole("button", { name: "Confirmando factura…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anulando factura…" })).toBeDisabled();
  });

  it("renders a refused confirm by its stable outcome", () => {
    renderPanel({
      confirmError: new ApiRequestError("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE, 409),
    });

    expect(screen.getByTestId("invoice-confirm-error")).toHaveTextContent(
      "Solo se puede confirmar una factura en borrador"
    );
  });

  it("renders the confirmed representation the API returned, replay-safe", () => {
    renderPanel({ outcome: { kind: "confirmed", invoice: CONFIRMED_INVOICE } });

    expect(screen.getByTestId("invoice-confirmed")).toHaveTextContent("Factura confirmada");
    expect(screen.getByTestId("invoice-confirmed")).toHaveTextContent("con el número A-12");
    // The panel never claims a second allocation for a repeated command.
    expect(screen.getByTestId("invoice-confirmed")).toHaveTextContent(
      "no se asigna un segundo número"
    );
  });

  it("renders the cancelled representation the API returned, replay-safe", () => {
    renderPanel({ outcome: { kind: "cancelled", invoice: CANCELLED_INVOICE } });

    expect(screen.getByTestId("invoice-cancelled")).toHaveTextContent("Factura anulada");
    expect(screen.getByTestId("invoice-cancelled")).toHaveTextContent("Duplicated by mistake");
    expect(screen.getByTestId("invoice-cancelled")).toHaveTextContent("La anulación es definitiva");
  });
});
