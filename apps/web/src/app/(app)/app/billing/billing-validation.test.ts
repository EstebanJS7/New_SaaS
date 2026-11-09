import { describe, expect, it } from "vitest";
import { INVOICE_CANCEL_REASON_MAX_LENGTH } from "./billing-api";
import { invoiceCancelReasonError, invoiceSaleIdError } from "./billing-validation";

describe("invoiceSaleIdError", () => {
  it("requires a sale id", () => {
    expect(invoiceSaleIdError("")).toBe("Ingresá el identificador de una venta completada.");
    expect(invoiceSaleIdError("   ")).toBe("Ingresá el identificador de una venta completada.");
  });

  it("accepts the UUID shape the API's schema accepts", () => {
    expect(invoiceSaleIdError("99999999-9999-4999-8999-999999999999")).toBeNull();
    expect(invoiceSaleIdError("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();
    expect(invoiceSaleIdError("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(invoiceSaleIdError("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBeNull();
    expect(invoiceSaleIdError("  99999999-9999-4999-8999-999999999999  ")).toBeNull();
  });

  it("refuses a literal that is not a UUID", () => {
    expect(invoiceSaleIdError("not-a-uuid")).toBe(
      "El identificador de la venta debe ser un UUID válido."
    );
    expect(invoiceSaleIdError("99999999-9999-4999-8999-99999999999")).toBe(
      "El identificador de la venta debe ser un UUID válido."
    );
    // The API's `z.string().uuid()` bounds the version nibble to 1..5.
    expect(invoiceSaleIdError("11111111-1111-0111-8111-111111111111")).toBe(
      "El identificador de la venta debe ser un UUID válido."
    );
    expect(invoiceSaleIdError("11111111-1111-6111-8111-111111111111")).toBe(
      "El identificador de la venta debe ser un UUID válido."
    );
  });
});

describe("invoiceCancelReasonError", () => {
  it("requires a non-blank reason", () => {
    expect(invoiceCancelReasonError("")).toBe("Ingresá el motivo de la anulación.");
    expect(invoiceCancelReasonError("   ")).toBe("Ingresá el motivo de la anulación.");
  });

  it("accepts a reason up to the API's column bound", () => {
    expect(invoiceCancelReasonError("Duplicated")).toBeNull();
    expect(invoiceCancelReasonError("x".repeat(INVOICE_CANCEL_REASON_MAX_LENGTH))).toBeNull();
  });

  it("refuses a reason past the API's column bound with the API's own wording", () => {
    expect(invoiceCancelReasonError("x".repeat(INVOICE_CANCEL_REASON_MAX_LENGTH + 1))).toBe(
      "El motivo de la anulación puede tener hasta 500 caracteres."
    );
  });
});
