import { describe, expect, it } from "vitest";
import { IMPORT_ENTITY_LABELS, ImportRequestError, userFacingImportError } from "./imports-api";

/**
 * The imports error copy (UX-036). The API answers in English with stable codes
 * and stable sentences (`apps/api/src/imports/import-artefact.pipe.ts`,
 * `imports.repository.ts`); the surface shows the same explanation in es-PY and
 * never the English sentence.
 */
function refusal(code: string, message: string, status = 400): ImportRequestError {
  return new ImportRequestError(code, message, status);
}

describe("userFacingImportError", () => {
  it("uses the common connection sentence when the request never got an API answer", () => {
    expect(userFacingImportError(new TypeError("Failed to fetch"))).toBe(
      "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar."
    );
  });

  it("states the authorization gates in es-PY", () => {
    expect(userFacingImportError(refusal("UNAUTHENTICATED", "Authentication required.", 401))).toBe(
      "Tenés que iniciar sesión para trabajar con importaciones."
    );
    expect(userFacingImportError(refusal("FORBIDDEN", "Insufficient permissions.", 403))).toBe(
      "No tenés permiso para trabajar con importaciones."
    );
  });

  it("translates each stable upload refusal instead of passing the English through", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      [
        "VALIDATION_FAILED",
        "Spreadsheet uploads are not supported: export the data as CSV. The accepted format is CSV (text/csv).",
        "No se aceptan planillas de cálculo: exportá los datos como CSV. El formato aceptado es CSV (text/csv).",
      ],
      [
        "VALIDATION_FAILED",
        "The import file must be CSV. The accepted content types are text/csv and application/csv.",
        "El archivo debe ser CSV. Los tipos de contenido aceptados son text/csv y application/csv.",
      ],
      [
        "VALIDATION_FAILED",
        "An import requires one uploaded file.",
        "La importación requiere un archivo.",
      ],
      [
        "VALIDATION_FAILED",
        "An import accepts exactly one uploaded file.",
        "La importación acepta un solo archivo.",
      ],
      [
        "VALIDATION_FAILED",
        "An import must be uploaded as a multipart/form-data request.",
        "La importación debe enviarse como un formulario multipart/form-data.",
      ],
      [
        "VALIDATION_FAILED",
        "The entity field is required and must be CUSTOMER or PATIENT.",
        "Elegí qué importar: clientes o pacientes.",
      ],
      [
        "PAYLOAD_TOO_LARGE",
        "The import file exceeds the 5242880 byte limit.",
        "El archivo supera el tamaño máximo permitido.",
      ],
    ];
    for (const [code, english, spanish] of cases) {
      expect(userFacingImportError(refusal(code, english)), english).toBe(spanish);
    }
  });

  it("explains the lifecycle conflict and a missing import in es-PY", () => {
    expect(
      userFacingImportError(
        refusal("CONFLICT", "The import is not in a state that allows this transition.", 409)
      )
    ).toBe("La importación no está en un estado que permita esta acción.");
    expect(userFacingImportError(refusal("NOT_FOUND", "Import was not found.", 404))).toBe(
      "No encontramos la importación."
    );
  });

  it("falls back to Spanish copy for any other refusal and never echoes the server text", () => {
    expect(
      userFacingImportError(refusal("VALIDATION_FAILED", "Invalid import list filters."))
    ).toBe("La solicitud no es válida. Revisá los datos y volvé a intentar.");
    expect(
      userFacingImportError(refusal("INTERNAL_ERROR", "The imports could not be read.", 500))
    ).toBe("No se pudo completar la operación. Volvé a intentar.");
  });
});

describe("IMPORT_ENTITY_LABELS", () => {
  it("names both entities in Spanish", () => {
    expect(IMPORT_ENTITY_LABELS).toEqual({ CUSTOMER: "Clientes", PATIENT: "Pacientes" });
  });
});
