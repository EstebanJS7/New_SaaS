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
  lowStockThreshold: null,
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
  const form = screen
    .getByRole("button", { name: /Crear artículo|Guardar cambios/ })
    .closest("form");
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

    const currency = screen.getByRole("combobox", { name: "Moneda" });
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
    const taxRate = screen.getByRole("combobox", { name: "Impuesto (obligatorio)" });
    expect(
      within(taxRate)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Seleccioná un impuesto", "Exento", "IVA 5%", "IVA 10%"]);
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

    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
      target: { value: "Consulta clínica" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de artículo"), { target: { value: "SERVICE" } });
    fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), {
      target: { value: RATE_ID },
    });
    fireEvent.change(screen.getByLabelText("Precio de referencia (opcional)"), {
      target: { value: "150000,00" },
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
    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), { target: { value: "Gasa" } });
    fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), {
      target: { value: RATE_ID },
    });

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
    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
      target: { value: "Consulta" },
    });

    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Seleccioná un impuesto.");
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
    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
      target: { value: "Consulta" },
    });
    fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), {
      target: { value: RATE_ID },
    });
    fireEvent.change(screen.getByLabelText("Precio de referencia (opcional)"), {
      target: { value: "12,345" },
    });

    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ingresá un importe no negativo: hasta 12 dígitos enteros y 2 decimales, con coma decimal."
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the low-stock threshold as a decimal string on create", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
      target: { value: "Vacuna" },
    });
    fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), {
      target: { value: RATE_ID },
    });
    fireEvent.change(screen.getByLabelText("Umbral de stock bajo (opcional)"), {
      target: { value: "10,5" },
    });

    submitForm();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Vacuna",
        kind: "PRODUCT",
        taxRateId: RATE_ID,
        lowStockThreshold: "10.5",
      });
    });
    // A quantity never travels as a JavaScript number.
    const submitted = onSubmit.mock.calls[0][0] as { lowStockThreshold?: unknown };
    expect(typeof submitted.lowStockThreshold).toBe("string");
  });

  it("omits the threshold when it is left empty, the not-monitored state", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    // The label and its hint must make "empty = not monitored" discoverable.
    expect(screen.getByLabelText("Umbral de stock bajo (opcional)")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), { target: { value: "Gasa" } });
    fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), {
      target: { value: RATE_ID },
    });

    submitForm();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Gasa",
        kind: "PRODUCT",
        taxRateId: RATE_ID,
      });
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("lowStockThreshold");
  });

  it("rejects a zero or over-scaled threshold client-side before calling the API", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();

    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
      target: { value: "Consulta" },
    });
    fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), {
      target: { value: RATE_ID },
    });

    for (const value of ["0", "0,000", "1,2345"]) {
      fireEvent.change(screen.getByLabelText("Umbral de stock bajo (opcional)"), {
        target: { value },
      });
      submitForm();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Ingresá un umbral mayor que cero: hasta 7 dígitos enteros y 3 decimales, con coma decimal."
      );
    }
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

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Revisá los campos y sus límites antes de guardar."
    );
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
      "No tenés permiso para gestionar artículos del catálogo."
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
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Consulta clínica");
    expect(screen.getByLabelText("Impuesto (obligatorio)")).toHaveValue(RATE_ID);

    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Precio de referencia (opcional)"), {
      target: { value: "" },
    });
    submitForm();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        referencePriceAmount: null,
        referencePriceCurrency: null,
      });
    });
  });

  it("sends the threshold only when it changed and clears it with an explicit null", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();
    const monitored = { ...ITEM, lowStockThreshold: "10.000" };

    render(
      <TestWrapper>
        <CatalogForm item={monitored} onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "IVA 10%" });
    // The stored fixed-scale value is what the field starts from.
    expect(screen.getByLabelText("Umbral de stock bajo (opcional)")).toHaveValue("10,000");

    // An untouched threshold is not sent, so an unrelated edit cannot rewrite it.
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Umbral de stock bajo (opcional)"), {
      target: { value: "4,5" },
    });
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ lowStockThreshold: "4.5" }));

    // Emptying the field stops monitoring: an explicit null, never a zero.
    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Umbral de stock bajo (opcional)"), {
      target: { value: "" },
    });
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ lowStockThreshold: null }));
  });
});

async function fillCreate() {
  await screen.findByRole("option", { name: "IVA 10%" });
  fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
    target: { value: "Artículo sintético" },
  });
  fireEvent.change(screen.getByLabelText("Impuesto (obligatorio)"), { target: { value: RATE_ID } });
}
describe("Catalog accessible exact input", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ["999.999.999.999,99", "9.999.999,999", "999999999999.99", "9999999.999"],
    ["0,00", "0,001", "0.00", "0.001"],
    ["12.345", "1,500", "12345", "1.500"],
  ])(
    "normalizes %s and %s without losing digits or scale",
    async (price, threshold, wirePrice, wireThreshold) => {
      mockRatesFetch();
      const onSubmit = vi.fn();
      render(
        <TestWrapper>
          <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
        </TestWrapper>
      );
      await fillCreate();
      fireEvent.change(screen.getByLabelText("Precio de referencia (opcional)"), {
        target: { value: price },
      });
      fireEvent.change(screen.getByLabelText("Umbral de stock bajo (opcional)"), {
        target: { value: threshold },
      });
      submitForm();
      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            referencePriceAmount: wirePrice,
            lowStockThreshold: wireThreshold,
            referencePriceCurrency: "PYG",
          })
        )
      );
    }
  );
  it.each(["1.000.000.000.000,00", "12.34", "1e3", "-1", "0,001"])(
    "rejects price %s without truncating or guessing",
    async (price) => {
      mockRatesFetch();
      const onSubmit = vi.fn();
      render(
        <TestWrapper>
          <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
        </TestWrapper>
      );
      await fillCreate();
      const field = screen.getByLabelText("Precio de referencia (opcional)");
      fireEvent.change(field, { target: { value: price } });
      submitForm();
      await waitFor(() => expect(field).toHaveFocus());
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveValue(price);
      expect(onSubmit).not.toHaveBeenCalled();
    }
  );
  it("does not rewrite untouched fixed-scale values after converting editable separators", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm
          item={{
            ...ITEM,
            referencePriceAmount: "999999999999.99",
            referencePriceCurrency: "USD",
            lowStockThreshold: "9999999.999",
          }}
          onSubmit={onSubmit}
          isPending={false}
          error={null}
        />
      </TestWrapper>
    );
    await screen.findByRole("option", { name: "IVA 10%" });
    expect(screen.getByLabelText("Precio de referencia (opcional)")).toHaveValue("999999999999,99");
    expect(screen.getByLabelText("Umbral de stock bajo (opcional)")).toHaveValue("9999999,999");
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));
  });
  it("focuses and associates the first invalid field, then clears its stale error on edit", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillCreate();
    const name = screen.getByLabelText("Nombre (obligatorio)");
    fireEvent.change(name, { target: { value: "a".repeat(201) } });
    submitForm();
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-describedby", "name-hint");
    expect(name).toHaveValue("a".repeat(201));
    expect(screen.getByRole("alert")).toHaveTextContent("Usá hasta 200 caracteres.");
    fireEvent.change(name, { target: { value: "Corregido" } });
    expect(name).toHaveAttribute("aria-invalid", "false");
  });
  it("blocks double submit while a command is in flight", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillCreate();
    submitForm();
    submitForm();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
  it("keeps the copy and prevents replay after an uncertain acknowledgement", async () => {
    mockRatesFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm
          onSubmit={onSubmit}
          isPending={false}
          error={new ApiRequestError("NETWORK_ERROR", "PRIVATE", 0, true)}
        />
      </TestWrapper>
    );
    await fillCreate();
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Crear artículo" })).toBeDisabled();
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Artículo sintético");
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
  });
  it("distinguishes failed and empty tax reads, with explicit GET retry only", async () => {
    let calls = 0;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        ++calls === 1
          ? jsonResponse({ error: { code: "FORBIDDEN", message: "PRIVATE" } }, 403)
          : jsonResponse([])
      )
    );
    render(
      <TestWrapper>
        <CatalogForm onSubmit={vi.fn()} isPending={false} error={null} />
      </TestWrapper>
    );
    await screen.findByText("No tenés permiso para gestionar artículos del catálogo.");
    expect(calls).toBe(1);
    expect(screen.getByRole("button", { name: "Crear artículo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));
    await screen.findByText(/No hay impuestos disponibles/);
    expect(calls).toBe(2);
    expect(screen.queryByText("PRIVATE")).not.toBeInTheDocument();
  });
  it("protects explicit cancellation and document exit without writing", async () => {
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
    mockRatesFetch();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByLabelText("Nombre (obligatorio)")).toHaveValue("Artículo sintético");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("CatalogForm — unidad de medida SIFEN (FISC-020 T9)", () => {
  const UNITS = [
    { code: "77", description: "Unidad - UNI", symbol: "UNI" },
    { code: "83", description: "Kilogramos - kg", symbol: "kg" },
  ];

  function mockRatesAndUnits(units: unknown = UNITS): void {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = resolveUrl(input);
      if (url.endsWith("/api/catalog/tax-rates")) return Promise.resolve(jsonResponse(RATES));
      if (url.endsWith("/api/catalog/units-of-measure"))
        return Promise.resolve(jsonResponse(units));
      return Promise.resolve(jsonResponse({ error: { code: "NOT_FOUND" } }, 404));
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the SIFEN units sorted by their es-PY label, with no unit preselected", async () => {
    mockRatesAndUnits();
    render(
      <TestWrapper>
        <CatalogForm onSubmit={vi.fn()} isPending={false} error={null} />
      </TestWrapper>
    );

    await screen.findByRole("option", { name: "Unidad - UNI" });
    const unit = screen.getByRole("combobox", { name: "Unidad de medida (opcional)" });
    expect(unit).toHaveValue("");
    expect(
      within(unit)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Sin unidad declarada", "Kilogramos - kg", "Unidad - UNI"]);
  });

  it("sends the selected unit on create and omits it when none is selected", async () => {
    mockRatesAndUnits();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm onSubmit={onSubmit} isPending={false} error={null} />
      </TestWrapper>
    );
    await fillCreate();
    await screen.findByRole("option", { name: "Unidad - UNI" });

    submitForm();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Artículo sintético",
        kind: "PRODUCT",
        taxRateId: RATE_ID,
      })
    );

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Unidad de medida (opcional)"), {
      target: { value: "83" },
    });
    submitForm();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Artículo sintético",
        kind: "PRODUCT",
        taxRateId: RATE_ID,
        unitOfMeasureCode: "83",
      })
    );
  });

  it("on edit prefills the unit, omits it when untouched, replaces it and clears it with null", async () => {
    mockRatesAndUnits();
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm
          item={{ ...ITEM, unitOfMeasureCode: "77" }}
          onSubmit={onSubmit}
          isPending={false}
          error={null}
        />
      </TestWrapper>
    );
    await screen.findByRole("option", { name: "Unidad - UNI" });
    expect(screen.getByLabelText("Unidad de medida (opcional)")).toHaveValue("77");

    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Unidad de medida (opcional)"), {
      target: { value: "83" },
    });
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ unitOfMeasureCode: "83" }));

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Unidad de medida (opcional)"), {
      target: { value: "" },
    });
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ unitOfMeasureCode: null }));
  });

  it("still saves the item when the unit list cannot be read, leaving the unit untouched", async () => {
    mockRatesAndUnits(null);
    global.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        resolveUrl(input).endsWith("/api/catalog/tax-rates")
          ? jsonResponse(RATES)
          : jsonResponse({ error: { code: "INTERNAL" } }, 500)
      )
    );
    const onSubmit = vi.fn();
    render(
      <TestWrapper>
        <CatalogForm
          item={{ ...ITEM, unitOfMeasureCode: "77" }}
          onSubmit={onSubmit}
          isPending={false}
          error={null}
        />
      </TestWrapper>
    );
    await screen.findByRole("option", { name: "IVA 10%" });
    expect(
      await screen.findByText(
        "No pudimos cargar las unidades de medida. La unidad actual se conserva."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Unidad de medida (opcional)")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Nombre (obligatorio)"), {
      target: { value: "Renombrado" },
    });
    submitForm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "Renombrado" }));
  });
});
