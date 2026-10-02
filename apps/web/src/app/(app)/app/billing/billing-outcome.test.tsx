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
      "Billing features are not enabled for this tenant"
    );
    expect(billingErrorTitle(new ApiRequestError("FORBIDDEN", "x", 403))).toBe("Permission denied");
  });

  it("names the shared 404 without distinguishing an unknown id from a foreign one", () => {
    expect(billingErrorTitle(new ApiRequestError("NOT_FOUND", "x", 404))).toBe("Invoice not found");
  });

  it("separates the named 409 outcomes from the generic one", () => {
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_SALE_NOT_COMPLETED_MESSAGE, 409))
    ).toBe("Only a completed sale can be invoiced");
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_CUSTOMER_REQUIRED_MESSAGE, 409))
    ).toBe("This tenant requires a customer before an invoice can be issued");
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_SALE_ALREADY_INVOICED_MESSAGE, 409))
    ).toBe("This sale already has an invoice");
    expect(billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_NOT_DRAFT_MESSAGE, 409))).toBe(
      "Only a draft invoice can be confirmed"
    );
    expect(
      billingErrorTitle(new ApiRequestError("CONFLICT", INVOICE_NOT_CANCELLABLE_MESSAGE, 409))
    ).toBe("Only a draft or confirmed invoice can be cancelled");
    expect(billingErrorTitle(new ApiRequestError("CONFLICT", "Some other conflict.", 409))).toBe(
      "The API refused the request"
    );
  });

  it("names the stable 400 and the transport failure", () => {
    expect(billingErrorTitle(new ApiRequestError("VALIDATION_FAILED", "Invalid body.", 400))).toBe(
      "The request was rejected as invalid"
    );
    expect(billingErrorTitle(new Error("fetch failed"))).toBe("Could not reach the server");
  });
});

describe("BillingErrorAlert", () => {
  it("renders the stable heading and the value-free API copy", () => {
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
    expect(alert).toHaveTextContent("Billing features are not enabled for this tenant");
    expect(alert).toHaveTextContent(BILLING_FEATURE_NOT_ENTITLED_MESSAGE);
  });

  it("renders the permission copy for a forbidden billing call", () => {
    render(<BillingErrorAlert error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to manage invoices."
    );
  });

  it("renders its own copy for a transport failure instead of a raw browser string", () => {
    render(<BillingErrorAlert error={new TypeError("Failed to fetch")} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The request could not reach the server. Check your connection and try again."
    );
  });
});
