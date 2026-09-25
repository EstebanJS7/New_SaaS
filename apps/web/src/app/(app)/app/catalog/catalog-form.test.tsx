import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogForm } from "./catalog-form";
import { ApiRequestError, type CatalogItem } from "./catalog-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: "item-1" }),
}));

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

const RATE_ID = "22222222-2222-4222-8222-222222222222";

const RATES = [{ id: RATE_ID, code: "IVA_10", name: "IVA 10%", rate: "0.1" }];

const ITEM: CatalogItem = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-a",
  kind: "SERVICE",
  name: "Consulta clínica",
  taxRateId: RATE_ID,
  taxRate: { code: "IVA_10", name: "IVA 10%", rate: "0.1" },
  referencePriceAmount: "150000.00",
  referencePriceCurrency: "PYG",
  isActive: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

function mockRatesFetch(): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = resolveUrl(input);
    if (url.endsWith("/api/catalog/tax-rates")) return Promise.resolve(jsonResponse(RATES));
    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404)
    );
  });
}

function submitForm(): void {
  const form = screen.getByRole("button", { name: /Create item|Save changes/ }).closest("form");
  fireEvent.submit(form!);
}

describe("CatalogForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers PYG by default and only the currencies the API accepts", async () => {
    mockRatesFetch();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={vi.fn()} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });

    const currency = screen.getByRole("combobox", { name: "Currency" });
    expect(currency).toHaveValue("PYG");
    expect(
      within(currency)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["PYG", "USD"]);
  });

  it("presents the rate selector in human order, not the API's lexicographic code order", async () => {
    // The API orders by `code`; the seeded set therefore arrives as
    // EXEMPT, IVA_10, IVA_5 and the UI must re-order it for a person.
    const rates = [
      { id: "rate-exempt", code: "EXEMPT", name: "Exento", rate: "0.00" },
      { id: "rate-10", code: "IVA_10", name: "IVA 10%", rate: "0.10" },
      { id: "rate-5", code: "IVA_5", name: "IVA 5%", rate: "0.05" },
    ];
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(rates)));

    render(
      <TestWrapper>
        <CatalogForm onSubmit={vi.fn()} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "Exento" });
    const taxRate = screen.getByRole("combobox", { name: "Tax rate" });
    expect(
      within(taxRate)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Select tax rate", "Exento", "IVA 5%", "IVA 10%"]);
  });

  it("submits a create with the required rate and the optional price pair", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Consulta clínica" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "SERVICE" } });
    fireEvent.change(screen.getByLabelText("Tax rate"), { target: { value: RATE_ID } });
    fireEvent.change(screen.getByLabelText("Reference price"), {
      target: { value: "150000.00" },
    });

    submitForm();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Consulta clínica",
        kind: "SERVICE",
        taxRateId: RATE_ID,
        referencePriceAmount: "150000.00",
        referencePriceCurrency: "PYG",
      });
    });
  });

  it("omits the price pair entirely when no amount is entered", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gasa" } });
    fireEvent.change(screen.getByLabelText("Tax rate"), { target: { value: RATE_ID } });

    submitForm();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Gasa",
        kind: "PRODUCT",
        taxRateId: RATE_ID,
      });
    });
  });

  it("refuses to submit without a selected tax rate", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Consulta" } });

    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Select a tax rate.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a malformed amount client-side before calling the API", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Consulta" } });
    fireEvent.change(screen.getByLabelText("Tax rate"), { target: { value: RATE_ID } });
    fireEvent.change(screen.getByLabelText("Reference price"), { target: { value: "12.345" } });

    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reference price must be a non-negative decimal with at most 2 decimals."
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces a 400 server field error truthfully", () => {
    mockRatesFetch();

    render(
      <TestWrapper>
        <CatalogForm
          onSubmit={vi.fn()}
          isPending={false}
          error={new ApiRequestError("VALIDATION_FAILED", "Invalid catalog item body.", 400)}
        />
      </TestWrapper>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid catalog item body.");
  });

  it("surfaces a 403 permission error truthfully", () => {
    mockRatesFetch();

    render(
      <TestWrapper>
        <CatalogForm
          onSubmit={vi.fn()}
          isPending={false}
          error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)}
        />
      </TestWrapper>
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to manage catalog items."
    );
  });

  it("sends only changed fields on edit and clears the price pair as a pair", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm item={ITEM} onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    expect(screen.getByLabelText("Name")).toHaveValue("Consulta clínica");
    expect(screen.getByLabelText("Tax rate")).toHaveValue(RATE_ID);

    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Reference price"), { target: { value: "" } });
    submitForm();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        referencePriceAmount: null,
        referencePriceCurrency: null,
      });
    });
  });
});
