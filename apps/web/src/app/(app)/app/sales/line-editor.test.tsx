import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineEditor } from "./line-editor";
import type { CartLine } from "./counter-cart";

const PRICED_LINE: CartLine = {
  key: "cart-0",
  catalogItemId: "33333333-3333-4333-8333-333333333333",
  name: "Antibiotic",
  referencePriceAmount: "1500.00",
  referencePriceCurrency: "PYG",
  quantity: "1.000",
  unitPrice: "1500.00",
};

const UNPRICED_LINE: CartLine = {
  key: "cart-1",
  catalogItemId: "44444444-4444-4444-8444-444444444444",
  name: "Consultation",
  referencePriceAmount: null,
  referencePriceCurrency: null,
  quantity: "1.000",
  unitPrice: "",
};

describe("LineEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pre-fills the applied price from the catalog reference price", () => {
    render(
      <LineEditor line={PRICED_LINE} disabled={false} onChange={vi.fn()} onRemove={vi.fn()} />
    );

    expect(screen.getByLabelText("Applied unit price")).toHaveValue("1500.00");
    expect(screen.getByText("Reference 1,500.00 PYG")).toBeInTheDocument();
    expect(screen.getByText(/Pre-filled from the catalog reference price/)).toBeInTheDocument();
  });

  it("lets the operator override the applied price with an exact decimal string", () => {
    const onChange = vi.fn();
    render(
      <LineEditor line={PRICED_LINE} disabled={false} onChange={onChange} onRemove={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("Applied unit price"), {
      target: { value: "1200.50" },
    });

    expect(onChange).toHaveBeenCalledWith("cart-0", { unitPrice: "1200.50" });
  });

  it("edits the quantity as the exact string the operator typed", () => {
    const onChange = vi.fn();
    render(
      <LineEditor line={PRICED_LINE} disabled={false} onChange={onChange} onRemove={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2.500" } });

    expect(onChange).toHaveBeenCalledWith("cart-0", { quantity: "2.500" });
  });

  it("does not block an item with no reference price; it asks for the applied price", () => {
    render(
      <LineEditor line={UNPRICED_LINE} disabled={false} onChange={vi.fn()} onRemove={vi.fn()} />
    );

    expect(screen.getByText("No reference price")).toBeInTheDocument();
    expect(screen.getByLabelText("Applied unit price")).toHaveValue("");
    expect(
      screen.getByText("This item has no reference price; enter the applied price.")
    ).toBeInTheDocument();
  });

  it("removes the line through the remove affordance", () => {
    const onRemove = vi.fn();
    render(
      <LineEditor line={PRICED_LINE} disabled={false} onChange={vi.fn()} onRemove={onRemove} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove line" }));

    expect(onRemove).toHaveBeenCalledWith("cart-0");
  });

  it("disables every input and the remove affordance while the sale is locked", () => {
    render(<LineEditor line={PRICED_LINE} disabled onChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByLabelText("Quantity")).toBeDisabled();
    expect(screen.getByLabelText("Applied unit price")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove line" })).toBeDisabled();
  });

  it("offers no discount, appointment or patient control", () => {
    render(
      <LineEditor line={PRICED_LINE} disabled={false} onChange={vi.fn()} onRemove={vi.fn()} />
    );

    expect(screen.queryByLabelText(/discount|appointment|patient/i)).not.toBeInTheDocument();
  });
});
