import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PaymentCapture } from "./payment-capture";

const TOTAL = "1500.00";

describe("PaymentCapture", () => {
  it("blocks an already open confirmation when a state check becomes required", () => {
    const onSubmit = vi.fn();
    const view = render(
      <PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Revisar venta" }));
    view.rerender(
      <PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} disabled />
    );
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Confirmar venta",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Volver" }));
    expect(screen.getByLabelText("Importe del pago 1")).toHaveValue("1500,00");
    expect(screen.getByRole("button", { name: "Revisar venta" })).toBeDisabled();
  });

  it("retains review and the authoritative error when completion fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("No open cash session"));
    render(
      <PaymentCapture
        total={TOTAL}
        currency="PYG"
        onSubmit={onSubmit}
        isPending={false}
        errorMessage="Abrí una sesión de caja antes de cobrar."
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Revisar venta" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar venta" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Confirmar venta" })).toBeEnabled()
    );
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Abrí una sesión de caja antes de cobrar."
    );
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it("cancels review without submitting or losing the entered payment", () => {
    const onSubmit = vi.fn();
    render(
      <PaymentCapture total="120000.00" currency="PYG" onSubmit={onSubmit} isPending={false} />
    );
    expect(screen.getByLabelText("Importe del pago 1")).toHaveValue("120000,00");
    fireEvent.click(screen.getByRole("button", { name: "Revisar venta" }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Volver" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Importe del pago 1")).toHaveValue("120000,00");
  });

  it.each(["1.23", "1,234.50", "0", "-1", "1500,001"])(
    "links a validation error and prevents review for %s",
    (value) => {
      const onSubmit = vi.fn();
      render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);
      const input = screen.getByLabelText("Importe del pago 1");
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(/Ingresá un importe positivo/);
      expect(screen.getByRole("button", { name: "Revisar venta" })).toBeDisabled();
      expect(onSubmit).not.toHaveBeenCalled();
    }
  );
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

  async function confirmSale(): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: "Revisar venta" }));
    const dialog = screen.getByRole("dialog", { name: "Revisar y confirmar venta" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar venta" }));
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the six PRD section 19 methods", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending={false} />);

    const select = screen.getByLabelText("Medio de pago 1");
    const labels = [...select.querySelectorAll("option")].map((option) => option.textContent);
    expect(labels).toEqual([
      "Efectivo",
      "Tarjeta",
      "Transferencia bancaria",
      "QR",
      "Cheque",
      "Otro",
    ]);
  });

  it("pre-fills the first payment with the API total and submits the exact set", async () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);

    expect(screen.getByLabelText("Importe del pago 1")).toHaveValue("1500,00");
    expect(screen.getByTestId("payment-sum")).toHaveTextContent("Suma de pagos: Gs. 1.500.");

    await confirmSale();

    expect(onSubmit).toHaveBeenCalledWith([{ method: "CASH", amount: TOTAL }]);
  });

  it("refuses to submit a set that does not sum exactly", () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);

    fireEvent.change(screen.getByLabelText("Importe del pago 1"), {
      target: { value: "1499,99" },
    });

    const submit = screen.getByRole("button", { name: "Revisar venta" });
    expect(submit).toBeDisabled();
    expect(screen.getByTestId("payment-sum")).toHaveTextContent("Suma de pagos: Gs. 1.499,99.");
    expect(
      screen.getByText(
        "Los importes deben sumar exactamente el total de la venta. No se calcula vuelto ni se acepta saldo a crédito."
      )
    ).toBeInTheDocument();

    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts several payments across methods when they sum exactly", async () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);

    fireEvent.change(screen.getByLabelText("Importe del pago 1"), {
      target: { value: "1.000,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar medio de pago" }));
    fireEvent.change(screen.getByLabelText("Medio de pago 2"), { target: { value: "QR" } });
    fireEvent.change(screen.getByLabelText("Importe del pago 2"), { target: { value: "500,00" } });

    expect(screen.getByTestId("payment-sum")).toHaveTextContent("Suma de pagos: Gs. 1.500.");

    await confirmSale();

    expect(onSubmit).toHaveBeenCalledWith([
      { method: "CASH", amount: "1000.00" },
      { method: "QR", amount: "500.00" },
    ]);
  });

  it("keeps the guard exact when several payments would drift in floating point", async () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total="0.30" currency="PYG" onSubmit={onSubmit} isPending={false} />);

    fireEvent.change(screen.getByLabelText("Importe del pago 1"), { target: { value: "0,10" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar medio de pago" }));
    fireEvent.change(screen.getByLabelText("Importe del pago 2"), { target: { value: "0,20" } });

    await confirmSale();

    expect(onSubmit).toHaveBeenCalledWith([
      { method: "CASH", amount: "0.10" },
      { method: "CARD", amount: "0.20" },
    ]);
  });

  it("removes a payment and never removes the last one", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending={false} />);

    expect(screen.getByRole("button", { name: "Quitar pago" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Agregar medio de pago" }));
    expect(screen.getAllByRole("button", { name: "Quitar pago" })[0]).toBeEnabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Quitar pago" })[0]);
    expect(screen.getAllByLabelText(/Importe del pago/)).toHaveLength(1);
  });

  it("shows a pending label and blocks input while the completion is in flight", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending />);

    expect(screen.getByRole("button", { name: "Confirmando venta…" })).toBeDisabled();
    expect(screen.getByLabelText("Importe del pago 1")).toBeDisabled();
    expect(screen.getByLabelText("Medio de pago 1")).toBeDisabled();
  });

  it("offers no change, tendered amount or credit field", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending={false} />);

    expect(screen.queryByLabelText(/change|tendered|credit|overpay/i)).not.toBeInTheDocument();
  });
});
