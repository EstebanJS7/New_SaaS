import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SupplierForm } from "./supplier-form";
import { ApiRequestError, type Supplier } from "./suppliers-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "supplier-1" }),
}));

const CONFLICT_MESSAGE = "A supplier with this tax identifier already exists in this tenant.";

const SUPPLIER: Supplier = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: "Distribuidora Central S.A.",
  taxId: "80012345-6",
  email: "compras@distribuidora.example",
  phone: "+595981123456",
  address: "Av. Mcal. López 1234, Asunción",
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function submitForm(): void {
  const form = screen.getByRole("button", { name: /Create supplier|Save changes/ }).closest("form");
  fireEvent.submit(form!);
}

describe("SupplierForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates with the required name only and omits every empty optional field", () => {
    const onSubmit = vi.fn();

    render(<SupplierForm onSubmit={onSubmit} isPending={false} error={null} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({ name: "Distribuidora Central" });
  });

  it("sends each optional identity field when the user provides one", () => {
    const onSubmit = vi.fn();

    render(<SupplierForm onSubmit={onSubmit} isPending={false} error={null} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    fireEvent.change(screen.getByLabelText("Legal name"), {
      target: { value: "Distribuidora Central S.A." },
    });
    fireEvent.change(screen.getByLabelText("Tax identifier"), { target: { value: "80012345-6" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "compras@distribuidora.example" },
    });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+595981123456" } });
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "Av. Mcal. López 1234, Asunción" },
    });
    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Distribuidora Central",
      legalName: "Distribuidora Central S.A.",
      taxId: "80012345-6",
      email: "compras@distribuidora.example",
      phone: "+595981123456",
      address: "Av. Mcal. López 1234, Asunción",
    });
  });

  it("refuses to submit without a trading name", () => {
    const onSubmit = vi.fn();

    render(<SupplierForm onSubmit={onSubmit} isPending={false} error={null} />);

    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends only changed fields on edit and never writes isActive", () => {
    const onSubmit = vi.fn();

    render(<SupplierForm supplier={SUPPLIER} onSubmit={onSubmit} isPending={false} error={null} />);

    expect(screen.getByLabelText("Name")).toHaveValue("Distribuidora Central");
    expect(screen.getByLabelText("Tax identifier")).toHaveValue("80012345-6");

    submitForm();

    const body = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toEqual({});
    expect(Object.keys(body)).not.toContain("isActive");
  });

  it("clears an omitted optional field with an explicit null", () => {
    const onSubmit = vi.fn();

    render(<SupplierForm supplier={SUPPLIER} onSubmit={onSubmit} isPending={false} error={null} />);

    fireEvent.change(screen.getByLabelText("Legal name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tax identifier"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "" } });
    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      legalName: null,
      taxId: null,
      email: null,
      phone: null,
      address: null,
    });
  });

  it("never lets the trading name be cleared", () => {
    const onSubmit = vi.fn();

    render(<SupplierForm supplier={SUPPLIER} onSubmit={onSubmit} isPending={false} error={null} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a duplicate tax identifier 409 as a field-level conflict, not a generic error", () => {
    render(
      <SupplierForm
        supplier={SUPPLIER}
        onSubmit={vi.fn()}
        isPending={false}
        error={new ApiRequestError("CONFLICT", CONFLICT_MESSAGE, 409)}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Tax identifier conflict");
    expect(alert).toHaveTextContent(CONFLICT_MESSAGE);
    // The conflict is attached to the identifier field it belongs to.
    expect(screen.getByLabelText("Tax identifier")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not mark the identifier invalid for an unrelated failure", () => {
    render(
      <SupplierForm
        onSubmit={vi.fn()}
        isPending={false}
        error={new ApiRequestError("VALIDATION_FAILED", "Invalid supplier create body.", 400)}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid supplier create body.");
    expect(screen.getByLabelText("Tax identifier")).not.toHaveAttribute("aria-invalid");
  });

  it("surfaces a 403 permission error truthfully", () => {
    render(
      <SupplierForm
        onSubmit={vi.fn()}
        isPending={false}
        error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to manage suppliers."
    );
  });

  it("offers no control that writes the lifecycle flag directly", () => {
    const { container } = render(
      <SupplierForm supplier={SUPPLIER} onSubmit={vi.fn()} isPending={false} error={null} />
    );

    // Removal is the explicit deactivate command on the list, never a form field.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(container.querySelector('[name="isActive"]')).toBeNull();
  });

  it("shows a pending state and blocks input while the save is in flight", () => {
    render(<SupplierForm onSubmit={vi.fn()} isPending error={null} />);

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Tax identifier")).toBeDisabled();
  });

  it("keeps the edited values after a failed submit so the user does not retype them", async () => {
    const onSubmit = vi.fn();

    const { rerender } = render(
      <SupplierForm onSubmit={onSubmit} isPending={false} error={null} />
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    submitForm();

    rerender(
      <SupplierForm
        onSubmit={onSubmit}
        isPending={false}
        error={new ApiRequestError("VALIDATION_FAILED", "Invalid supplier create body.", 400)}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Distribuidora Central");
    });
  });
});
