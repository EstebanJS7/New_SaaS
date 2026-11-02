import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ApiRequestError,
  CASH_FEATURE_NOT_ENTITLED_MESSAGE,
  CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE,
  CASH_REGISTER_NAME_CONFLICT_MESSAGE,
  CASH_SESSION_ALREADY_OPEN_MESSAGE,
  CASH_SESSION_NOT_OPEN_MESSAGE,
} from "./cash-api";
import { CashErrorAlert, cashErrorTitle } from "./cash-outcome";

describe("cashErrorTitle", () => {
  it("names the entitlement refusal distinctly from the permission one", () => {
    expect(cashErrorTitle(new ApiRequestError("FEATURE_NOT_ENTITLED", "x", 403))).toBe(
      "Caja no está habilitada para esta organización"
    );
    expect(cashErrorTitle(new ApiRequestError("FORBIDDEN", "x", 403))).toBe("Sin permiso");
  });

  it("names the shared 404 without distinguishing an unknown id from a foreign one", () => {
    expect(cashErrorTitle(new ApiRequestError("NOT_FOUND", "x", 404))).toBe(
      "No encontramos la caja o sesión"
    );
  });

  it("separates the three named 409 conflicts from the generic one", () => {
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_REGISTER_NAME_CONFLICT_MESSAGE, 409))
    ).toBe("Ya existe una caja con este nombre");
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE, 409))
    ).toBe("Esta caja ya tiene una sesión abierta");
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE, 409))
    ).toBe("Esta sesión no está abierta");
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE, 409))
    ).toBe("El intento enviado corresponde a otro movimiento");
    expect(cashErrorTitle(new ApiRequestError("CONFLICT", "Some other conflict.", 409))).toBe(
      "La operación fue rechazada"
    );
  });

  it("names the stable 400 and the transport failure", () => {
    expect(cashErrorTitle(new ApiRequestError("VALIDATION_FAILED", "Invalid body.", 400))).toBe(
      "Revisá los datos de la operación"
    );
    expect(cashErrorTitle(new Error("fetch failed"))).toBe("No pudimos confirmar el resultado");
  });
});

describe("CashErrorAlert", () => {
  it("renders the stable heading and the value-free API copy", () => {
    render(
      <CashErrorAlert
        error={new ApiRequestError("FEATURE_NOT_ENTITLED", CASH_FEATURE_NOT_ENTITLED_MESSAGE, 403)}
        testId="cash-error"
      />
    );

    const alert = screen.getByTestId("cash-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Caja no está habilitada para esta organización");
    expect(alert).toHaveTextContent("Caja no está habilitada para esta organización.");
  });

  it("renders the permission copy for a forbidden cash call", () => {
    render(<CashErrorAlert error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Sin permiso");
    expect(screen.getByRole("alert")).toHaveTextContent("No tenés permiso para gestionar Caja.");
  });

  it("renders its own copy for a transport failure instead of a raw browser string", () => {
    render(<CashErrorAlert error={new TypeError("Failed to fetch")} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar el resultado");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos confirmar el resultado. Revisá el estado antes de volver a enviar."
    );
  });
});
