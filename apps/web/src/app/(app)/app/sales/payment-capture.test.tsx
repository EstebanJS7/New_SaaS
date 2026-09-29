import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PaymentCapture } from "./payment-capture";

const TOTAL = "1500.00";

describe("PaymentCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the six PRD section 19 methods", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending={false} />);

    const select = screen.getByLabelText("Payment 1 method");
    const labels = [...select.querySelectorAll("option")].map((option) => option.textContent);
    expect(labels).toEqual(["Cash", "Card", "Bank transfer", "QR", "Check", "Other"]);
  });

  it("pre-fills the first payment with the API total and submits the exact set", () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);

    expect(screen.getByLabelText("Payment 1 amount")).toHaveValue(TOTAL);
    expect(screen.getByTestId("payment-sum")).toHaveTextContent("Payments sum 1,500.00 PYG.");

    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(onSubmit).toHaveBeenCalledWith([{ method: "CASH", amount: TOTAL }]);
  });

  it("refuses to submit a set that does not sum exactly", () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);

    fireEvent.change(screen.getByLabelText("Payment 1 amount"), {
      target: { value: "1499.99" },
    });

    const submit = screen.getByRole("button", { name: "Complete sale" });
    expect(submit).toBeDisabled();
    expect(screen.getByTestId("payment-sum")).toHaveTextContent("Payments sum 1,499.99 PYG.");
    expect(
      screen.getByText(
        "The payments must sum exactly to the sale total before the sale can be completed."
      )
    ).toBeInTheDocument();

    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts several payments across methods when they sum exactly", () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={onSubmit} isPending={false} />);

    fireEvent.change(screen.getByLabelText("Payment 1 amount"), { target: { value: "1000.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
    fireEvent.change(screen.getByLabelText("Payment 2 method"), { target: { value: "QR" } });
    fireEvent.change(screen.getByLabelText("Payment 2 amount"), { target: { value: "500.00" } });

    expect(screen.getByTestId("payment-sum")).toHaveTextContent("Payments sum 1,500.00 PYG.");

    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(onSubmit).toHaveBeenCalledWith([
      { method: "CASH", amount: "1000.00" },
      { method: "QR", amount: "500.00" },
    ]);
  });

  it("keeps the guard exact when several payments would drift in floating point", () => {
    const onSubmit = vi.fn();
    render(<PaymentCapture total="0.30" currency="PYG" onSubmit={onSubmit} isPending={false} />);

    fireEvent.change(screen.getByLabelText("Payment 1 amount"), { target: { value: "0.10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
    fireEvent.change(screen.getByLabelText("Payment 2 amount"), { target: { value: "0.20" } });

    fireEvent.click(screen.getByRole("button", { name: "Complete sale" }));

    expect(onSubmit).toHaveBeenCalledWith([
      { method: "CASH", amount: "0.10" },
      { method: "CARD", amount: "0.20" },
    ]);
  });

  it("removes a payment and never removes the last one", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending={false} />);

    expect(screen.getByRole("button", { name: "Remove payment" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add payment" }));
    expect(screen.getAllByRole("button", { name: "Remove payment" })[0]).toBeEnabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove payment" })[0]);
    expect(screen.getAllByLabelText(/amount/)).toHaveLength(1);
  });

  it("shows a pending label and blocks input while the completion is in flight", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending />);

    expect(screen.getByRole("button", { name: "Completing..." })).toBeDisabled();
    expect(screen.getByLabelText("Payment 1 amount")).toBeDisabled();
    expect(screen.getByLabelText("Payment 1 method")).toBeDisabled();
  });

  it("offers no change, tendered amount or credit field", () => {
    render(<PaymentCapture total={TOTAL} currency="PYG" onSubmit={vi.fn()} isPending={false} />);

    expect(screen.queryByLabelText(/change|tendered|credit|overpay/i)).not.toBeInTheDocument();
  });
});
