import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ApiRequestError,
  INVOICE_SALE_ALREADY_INVOICED_MESSAGE,
  type Invoice,
} from "./billing-api";
import { CreateInvoicePanel } from "./create-invoice-panel";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const DRAFT_INVOICE: Invoice = {
  id: "99999999-9999-4999-8999-999999999999",
  saleId: SALE_ID,
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

function renderPanel(overrides: Partial<Parameters<typeof CreateInvoicePanel>[0]> = {}): {
  readonly onCreate: ReturnType<typeof vi.fn>;
} {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <CreateInvoicePanel
      onCreate={onCreate}
      isCreating={false}
      createError={null}
      created={null}
      {...overrides}
    />
  );
  return { onCreate };
}

describe("CreateInvoicePanel validation", () => {
  it("requires a sale id before the request leaves the browser", () => {
    const { onCreate } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId("invoice-sale-id-error")).toHaveTextContent(
      "A completed sale id is required."
    );
  });

  it("refuses an id that is not a UUID", () => {
    const { onCreate } = renderPanel();

    fireEvent.change(screen.getByLabelText("Completed sale id"), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId("invoice-sale-id-error")).toHaveTextContent(
      "The sale id must be a UUID."
    );
  });

  it("creates from the sale id alone and clears the form", async () => {
    const { onCreate } = renderPanel();

    fireEvent.change(screen.getByLabelText("Completed sale id"), {
      target: { value: `  ${SALE_ID}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(onCreate).toHaveBeenCalledWith({ saleId: SALE_ID });
    expect(await screen.findByLabelText("Completed sale id")).toHaveValue("");
  });

  it("disables the command while the request is in flight", () => {
    renderPanel({ isCreating: true });

    expect(screen.getByRole("button", { name: "Creating invoice..." })).toBeDisabled();
  });
});

describe("CreateInvoicePanel outcomes", () => {
  it("shows the draft the API created", () => {
    renderPanel({ created: DRAFT_INVOICE });

    const created = screen.getByTestId("invoice-created");
    expect(created).toHaveTextContent("Draft invoice created");
    expect(created).toHaveTextContent("1,500.00");
    expect(created).toHaveTextContent("no number yet");
  });

  it("renders a sale that already holds an invoice by its stable outcome", () => {
    renderPanel({
      createError: new ApiRequestError("CONFLICT", INVOICE_SALE_ALREADY_INVOICED_MESSAGE, 409),
    });

    expect(screen.getByTestId("invoice-create-error")).toHaveTextContent(
      "This sale already has an invoice"
    );
  });

  it("renders a sale that is not completed by its stable outcome", () => {
    renderPanel({
      createError: new ApiRequestError("CONFLICT", "Only a completed sale can be invoiced.", 409),
    });

    expect(screen.getByTestId("invoice-create-error")).toHaveTextContent(
      "Only a completed sale can be invoiced"
    );
  });
});
