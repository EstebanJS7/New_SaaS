import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PurchaseForm } from "./purchase-form";
import { ApiRequestError, PURCHASE_NOT_EDITABLE_MESSAGE, type Purchase } from "./purchases-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "purchase-1" }),
}));

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ITEM_ID = "44444444-4444-4444-8444-444444444444";

const SUPPLIER = {
  id: SUPPLIER_ID,
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: null,
  taxId: null,
  email: null,
  phone: null,
  address: null,
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function catalogItem(id: string, name: string): Record<string, unknown> {
  return {
    id,
    tenantId: "tenant-a",
    kind: "SUPPLY",
    name,
    taxRateId: "rate-1",
    taxRate: { code: "IVA_10", name: "IVA 10%", rate: "10.00" },
    referencePriceAmount: null,
    referencePriceCurrency: null,
    isActive: true,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

const PURCHASE: Purchase = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: "tenant-a",
  supplierId: SUPPLIER_ID,
  status: "DRAFT",
  lines: [
    { id: "line-1", catalogItemId: ITEM_ID, quantity: "2.000", unitCost: "1500.00" },
    { id: "line-2", catalogItemId: OTHER_ITEM_ID, quantity: "1.000", unitCost: null },
  ],
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function installLists(): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = resolveUrl(input);
    if (url.startsWith("/api/suppliers")) {
      return Promise.resolve(jsonResponse([SUPPLIER]));
    }
    if (url.startsWith("/api/catalog")) {
      return Promise.resolve(
        jsonResponse([catalogItem(ITEM_ID, "Gauze roll"), catalogItem(OTHER_ITEM_ID, "Bandage")])
      );
    }
    return Promise.resolve(jsonResponse([]));
  });
}

function wrapper(children: React.ReactNode): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function submitForm(): void {
  const form = screen.getByRole("button", { name: /Create purchase|Save changes/ }).closest("form");
  fireEvent.submit(form!);
}

async function selectSupplier(): Promise<void> {
  await screen.findByRole("option", { name: "Distribuidora Central" });
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: SUPPLIER_ID } });
}

describe("PurchaseForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates with a supplier and one line, omitting an empty unit cost", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(wrapper(<PurchaseForm onSubmit={onSubmit} isPending={false} error={null} />));

    await selectSupplier();
    await screen.findByRole("option", { name: "Gauze roll" });
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: ITEM_ID } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2.000" } });
    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      supplierId: SUPPLIER_ID,
      lines: [{ catalogItemId: ITEM_ID, quantity: "2.000" }],
    });
  });

  it("sends the unit cost as the exact decimal string the user typed", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(wrapper(<PurchaseForm onSubmit={onSubmit} isPending={false} error={null} />));

    await selectSupplier();
    await screen.findByRole("option", { name: "Gauze roll" });
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: ITEM_ID } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2.500" } });
    fireEvent.change(screen.getByLabelText("Unit cost"), { target: { value: "1500.00" } });
    submitForm();

    const body = onSubmit.mock.calls[0]?.[0] as { lines: Record<string, unknown>[] };
    expect(body.lines[0]?.unitCost).toBe("1500.00");
    expect(typeof body.lines[0]?.unitCost).toBe("string");
  });

  it("adds a line and submits the whole set", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(wrapper(<PurchaseForm onSubmit={onSubmit} isPending={false} error={null} />));

    await selectSupplier();
    await screen.findByRole("option", { name: "Bandage" });
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: ITEM_ID } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2.000" } });

    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    fireEvent.change(screen.getByLabelText("Item 2"), { target: { value: OTHER_ITEM_ID } });
    fireEvent.change(screen.getAllByLabelText("Quantity")[1], { target: { value: "1.000" } });
    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      supplierId: SUPPLIER_ID,
      lines: [
        { catalogItemId: ITEM_ID, quantity: "2.000" },
        { catalogItemId: OTHER_ITEM_ID, quantity: "1.000" },
      ],
    });
  });

  it("removes a line so the update payload omits it", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(
      wrapper(
        <PurchaseForm purchase={PURCHASE} onSubmit={onSubmit} isPending={false} error={null} />
      )
    );

    await screen.findByRole("option", { name: "Distribuidora Central" });
    expect(screen.getAllByLabelText("Quantity")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove line" })[0]);
    submitForm();

    const body = onSubmit.mock.calls[0]?.[0] as { lines: Record<string, unknown>[] };
    expect(body.lines).toEqual([{ catalogItemId: OTHER_ITEM_ID, quantity: "1.000" }]);
  });

  it("refuses to remove the last remaining line", async () => {
    installLists();

    render(wrapper(<PurchaseForm onSubmit={vi.fn()} isPending={false} error={null} />));

    await selectSupplier();
    expect(screen.getByRole("button", { name: "Remove line" })).toBeDisabled();
  });

  it("pre-fills the edit form and sends the full desired line set", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(
      wrapper(
        <PurchaseForm purchase={PURCHASE} onSubmit={onSubmit} isPending={false} error={null} />
      )
    );

    await screen.findByRole("option", { name: "Distribuidora Central" });
    expect(screen.getByLabelText("Supplier")).toHaveValue(SUPPLIER_ID);
    expect(screen.getByLabelText("Item 1")).toHaveValue(ITEM_ID);
    expect(screen.getAllByLabelText("Quantity")[0]).toHaveValue("2.000");
    expect(screen.getAllByLabelText("Unit cost")[0]).toHaveValue("1500.00");

    fireEvent.change(screen.getAllByLabelText("Quantity")[0], { target: { value: "3.000" } });
    submitForm();

    const body = onSubmit.mock.calls[0]?.[0] as { supplierId: string; lines: unknown[] };
    expect(body.supplierId).toBe(SUPPLIER_ID);
    expect(body.lines).toHaveLength(2);
    // No lifecycle field is ever sent: the status has its own commands.
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("tenantId");
  });

  it("requires a supplier before submitting", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(wrapper(<PurchaseForm onSubmit={onSubmit} isPending={false} error={null} />));

    await screen.findByRole("option", { name: "Gauze roll" });
    submitForm();

    expect(screen.getByRole("alert")).toHaveTextContent("Select a supplier.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires an item and a quantity on every line", async () => {
    const onSubmit = vi.fn();
    installLists();

    render(wrapper(<PurchaseForm onSubmit={onSubmit} isPending={false} error={null} />));

    await selectSupplier();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "1.000" } });
    submitForm();
    expect(screen.getByRole("alert")).toHaveTextContent("Select an item for every line.");
    expect(onSubmit).not.toHaveBeenCalled();

    await screen.findByRole("option", { name: "Gauze roll" });
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: ITEM_ID } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "" } });
    submitForm();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a quantity for every line.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a non-draft 409 as a conflict, not a generic error", () => {
    installLists();

    render(
      wrapper(
        <PurchaseForm
          purchase={PURCHASE}
          onSubmit={vi.fn()}
          isPending={false}
          error={new ApiRequestError("CONFLICT", PURCHASE_NOT_EDITABLE_MESSAGE, 409)}
        />
      )
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This purchase is no longer a draft");
    expect(alert).toHaveTextContent(PURCHASE_NOT_EDITABLE_MESSAGE);
  });

  it("surfaces a 403 permission error truthfully", () => {
    installLists();

    render(
      wrapper(
        <PurchaseForm
          onSubmit={vi.fn()}
          isPending={false}
          error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)}
        />
      )
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to manage purchases."
    );
  });

  it("offers no status control and no delete affordance", async () => {
    installLists();

    const { container } = render(
      wrapper(
        <PurchaseForm purchase={PURCHASE} onSubmit={vi.fn()} isPending={false} error={null} />
      )
    );

    await screen.findByRole("option", { name: "Distribuidora Central" });
    expect(
      screen.queryByRole("button", { name: /delete|receive|cancel purchase/i })
    ).not.toBeInTheDocument();
    expect(container.querySelector('[name="status"]')).toBeNull();
  });

  it("shows a pending state and blocks input while the save is in flight", () => {
    installLists();

    render(wrapper(<PurchaseForm onSubmit={vi.fn()} isPending error={null} />));

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByLabelText("Supplier")).toBeDisabled();
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
  });

  it("shows a loading hint while the reference lists are pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    render(wrapper(<PurchaseForm onSubmit={vi.fn()} isPending={false} error={null} />));

    expect(screen.getByText("Loading suppliers...")).toBeInTheDocument();
    expect(screen.getByText("Loading catalog items...")).toBeInTheDocument();
  });

  it("shows an empty hint when no suppliers or items exist", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([])));

    render(wrapper(<PurchaseForm onSubmit={vi.fn()} isPending={false} error={null} />));

    expect(await screen.findByText("No suppliers are available yet.")).toBeInTheDocument();
    expect(screen.getByText("No catalog items are available yet.")).toBeInTheDocument();
  });
});
