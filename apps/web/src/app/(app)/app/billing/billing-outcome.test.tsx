import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ApiRequestError,
  BILLING_FEATURE_NOT_ENTITLED_MESSAGE,
  INVOICE_CUSTOMER_REQUIRED_MESSAGE,
  INVOICE_NOT_CANCELLABLE_MESSAGE,
  INVOICE_NOT_DRAFT_MESSAGE,
  INVOICE_SALE_ALREADY_INVOICED_MESSAGE,
  INVOICE_SALE_NOT_COMPLETED_MESSAGE,
} from "./billing-api";
import { BillingErrorAlert, billingErrorTitle } from "./billing-outcome";

describe("billingErrorTitle", () => {
  it("names the entitlement refusal distinctly from the permission one", () => {
    expect(billingErrorTitle(new ApiRequestError("FEATURE_NOT_ENTITLED", "x", 403))).toBe(
      "Facturación no habilitada"
    );
    expect(billingErrorTitle(new ApiRequestError("FORBIDDEN", "x", 403))).toBe("Sin permiso");
  });

  it("names the shared 404 without distinguishing an unknown id from a foreign one", () => {
    expect(billingErrorTitle(new ApiRequestError("NOT_FOUND", "x", 404))).toBe(
      "No encontramos la factura"
    );
  });

  it("separates the named 409 outcomes from the generic one", () => {
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_SALE_NOT_COMPLETED_MESSAGE, 409))
    ).toBe("Solo se puede facturar una venta completada");
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_CUSTOMER_REQUIRED_MESSAGE, 409))
    ).toBe("Esta organización exige un cliente para emitir una factura");
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_SALE_ALREADY_INVOICED_MESSAGE, 409))
    ).toBe("Esta venta ya tiene una factura");
    expect(billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE, 409))).toBe(
      "Solo se puede confirmar una factura en borrador"
    );
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_NOT_CANCELLABLE_MESSAGE, 409))
    ).toBe("Solo se puede anular una factura en borrador o confirmada");
    expect(billingErrorTitle(new ApiRequestError("CONFLICT", "Some other conflict.", 409))).toBe(
      "La operación fue rechazada"
    );
  });

  it("names the stable 400 and the transport failure", () => {
    expect(billingErrorTitle(new ApiRequestError("VALIDATION_FAILED", "Invalid body.", 400))).toBe(
      "Revisá los datos de la operación"
    );
    expect(billingErrorTitle(new Error("fetch failed"))).toBe(
      "No se pudo conectar con el servidor"
    );
  });

  it("falls back to a Spanish heading and body for an unknown failure", () => {
    const unknown = new ApiRequestError("UNKNOWN", "Request failed (500)", 500);
    expect(billingErrorTitle(unknown)).toBe("No pudimos completar la operación");
    render(<BillingErrorAlert error={unknown} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos completar la operación. Revisá los datos y volvé a intentar."
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Request failed");
  });
});

describe("BillingErrorAlert", () => {
  it("renders the stable heading and the Spanish copy instead of the API English", () => {
    render(
      <BillingErrorAlert
        error={
          new ApiRequestError("FEATURE_NOT_ENTITLED", BILLING_FEATURE_NOT_ENTITLED_MESSAGE, 403)
        }
        testId="billing-error"
      />
    );

    const alert = screen.getByTestId("billing-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Facturación no habilitada");
    expect(alert).toHaveTextContent("Facturación no está habilitada para esta organización.");
    expect(alert).not.toHaveTextContent(BILLING_FEATURE_NOT_ENTITLED_MESSAGE);
  });

  it("renders the permission copy for a forbidden billing call", () => {
    render(<BillingErrorAlert error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Sin permiso");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tenés permiso para gestionar facturas."
    );
  });

  it("renders its own copy for a transport failure instead of a raw browser string", () => {
    render(<BillingErrorAlert error={new TypeError("Failed to fetch")} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo conectar con el servidor");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar."
    );
  });
});
