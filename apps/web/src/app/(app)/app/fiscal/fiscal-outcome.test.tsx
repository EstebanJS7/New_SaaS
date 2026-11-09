import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiRequestError } from "./fiscal-api";
import { FiscalErrorAlert, fiscalErrorTitle } from "./fiscal-outcome";
describe("fiscal outcomes", () => {
  it("chooses distinct headings for classifiers", () => {
    expect(fiscalErrorTitle(new ApiRequestError("FEATURE_NOT_ENTITLED", "safe", 403))).toBe(
      "Facturación electrónica no habilitada"
    );
    expect(fiscalErrorTitle(new ApiRequestError("FORBIDDEN", "safe", 403))).toBe("Sin permiso");
    expect(fiscalErrorTitle(new ApiRequestError("NOT_FOUND", "safe", 404))).toBe(
      "No encontramos el documento fiscal"
    );
    expect(fiscalErrorTitle(new ApiRequestError("CONFLICT", "safe", 409))).toBe(
      "La operación fue rechazada"
    );
    expect(fiscalErrorTitle(new ApiRequestError("VALIDATION_FAILED", "safe", 400))).toBe(
      "Revisá los datos de la operación"
    );
  });
  it("renders alert and value-free transport copy", () => {
    render(<FiscalErrorAlert error={new TypeError("private-value")} testId="fiscal-error" />);
    const alert = screen.getByTestId("fiscal-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("No se pudo conectar con el servidor");
    expect(alert).toHaveTextContent(
      "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar."
    );
    expect(alert).not.toHaveTextContent("private-value");
  });
  it("falls back to a Spanish heading and body for an unknown failure", () => {
    const unknown = new ApiRequestError("UNKNOWN", "Request failed (500)", 500);
    expect(fiscalErrorTitle(unknown)).toBe("No pudimos completar la operación");
    render(<FiscalErrorAlert error={unknown} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos completar la operación. Revisá los datos y volvé a intentar."
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Request failed");
  });
});
