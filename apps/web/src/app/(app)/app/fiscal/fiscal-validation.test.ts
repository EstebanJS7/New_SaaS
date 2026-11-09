import { describe, expect, it } from "vitest";
import { FISCAL_CANCEL_REASON_MAX_LENGTH } from "./fiscal-api";
import { fiscalCancelReasonError, fiscalInvoiceIdError } from "./fiscal-validation";
describe("fiscal field validation", () => {
  it("validates UUID-shaped invoice ids", () => {
    expect(fiscalInvoiceIdError("")).toBe("Ingresá el identificador de la factura.");
    expect(fiscalInvoiceIdError("  ")).not.toBeNull();
    expect(fiscalInvoiceIdError("99999999-9999-4999-8999-999999999999")).toBeNull();
    expect(fiscalInvoiceIdError("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(fiscalInvoiceIdError("not-a-uuid")).toBe(
      "El identificador de la factura debe ser un UUID válido."
    );
    expect(fiscalInvoiceIdError("11111111-1111-0111-8111-111111111111")).not.toBeNull();
  });
  it("requires trimmed cancellation text up to the API limit", () => {
    expect(fiscalCancelReasonError("")).toBe("Ingresá el motivo de la cancelación.");
    expect(fiscalCancelReasonError("  ")).not.toBeNull();
    expect(fiscalCancelReasonError(" reason ")).toBeNull();
    expect(fiscalCancelReasonError("x".repeat(FISCAL_CANCEL_REASON_MAX_LENGTH))).toBeNull();
    expect(fiscalCancelReasonError("x".repeat(FISCAL_CANCEL_REASON_MAX_LENGTH + 1))).toBe(
      "El motivo de la cancelación puede tener hasta 500 caracteres."
    );
  });
});
