import { describe, expect, it } from "vitest";
import { BranchesApiError, branchesErrorMessage } from "./branches-api";

/**
 * Branch error copy (UX-036). The branches API authors its CONFLICT and
 * FEATURE_NOT_ENTITLED sentences in Spanish (`apps/api/src/branches/*.ts`), and
 * those are the only explanation of WHICH rule failed, so they are shown as is.
 * The global filter's English defaults for the same codes must never reach the
 * screen.
 */
const FALLBACK = "No se pudo guardar la sucursal.";

function apiError(code: string, message: string, status: number): BranchesApiError {
  return new BranchesApiError(code, message, status);
}

describe("branchesErrorMessage", () => {
  it("shows the API's Spanish conflict and plan sentences as is", () => {
    const cases = [
      ["CONFLICT", "Ya hay una sucursal con ese nombre.", 409],
      ["CONFLICT", "Tiene que quedar al menos una sucursal activa.", 409],
      [
        "CONFLICT",
        "La sucursal tiene 1 turno pendiente: reprogramalo o cancelalo antes de desactivarla.",
        409,
      ],
      [
        "FEATURE_NOT_ENTITLED",
        "Tu plan incluye una sola sucursal activa: para tener más, activá la función multi-sucursal.",
        403,
      ],
    ] as const;
    for (const [code, message, status] of cases) {
      expect(branchesErrorMessage(apiError(code, message, status), FALLBACK)).toBe(message);
    }
  });

  it("replaces the API's English defaults for those codes with Spanish copy", () => {
    expect(
      branchesErrorMessage(
        apiError("CONFLICT", "Request conflicts with current state.", 409),
        FALLBACK
      )
    ).toBe("Los datos de la sucursal cambiaron. Actualizá la lista y volvé a intentar.");
    expect(
      branchesErrorMessage(
        apiError(
          "FEATURE_NOT_ENTITLED",
          "The requested feature is not enabled for this tenant.",
          403
        ),
        FALLBACK
      )
    ).toBe("Tu plan no incluye esta función de sucursales.");
  });

  it("keeps the existing validation, permission, not-found and fallback copy", () => {
    expect(
      branchesErrorMessage(
        apiError("VALIDATION_FAILED", "Elegí al menos una sucursal.", 400),
        FALLBACK
      )
    ).toBe("Elegí al menos una sucursal.");
    expect(
      branchesErrorMessage(
        apiError("VALIDATION_FAILED", "Request validation failed.", 400),
        FALLBACK
      )
    ).toBe("Revisá los datos: algún campo no es válido.");
    expect(branchesErrorMessage(apiError("FORBIDDEN", "Access denied.", 403), FALLBACK)).toBe(
      "No tenés permiso para gestionar sucursales."
    );
    expect(
      branchesErrorMessage(apiError("NOT_FOUND", "La sucursal no existe.", 404), FALLBACK)
    ).toBe("Ya no figura en la clínica. Actualizá la lista.");
    expect(
      branchesErrorMessage(apiError("INTERNAL", "Internal server error.", 500), FALLBACK)
    ).toBe(FALLBACK);
    expect(branchesErrorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(FALLBACK);
  });
});
