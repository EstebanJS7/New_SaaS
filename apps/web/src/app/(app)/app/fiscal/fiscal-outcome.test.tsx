import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiRequestError } from "./fiscal-api";
import { FiscalErrorAlert, fiscalErrorTitle } from "./fiscal-outcome";
describe("fiscal outcomes", () => {
  it("chooses distinct headings for classifiers", () => {
    expect(fiscalErrorTitle(new ApiRequestError("FEATURE_NOT_ENTITLED", "safe", 403))).toContain(
      "Fiscal features"
    );
    expect(fiscalErrorTitle(new ApiRequestError("FORBIDDEN", "safe", 403))).toBe(
      "Permission denied"
    );
    expect(fiscalErrorTitle(new ApiRequestError("NOT_FOUND", "safe", 404))).toBe(
      "Fiscal document not found"
    );
    expect(fiscalErrorTitle(new ApiRequestError("CONFLICT", "safe", 409))).toBe(
      "The API refused the request"
    );
    expect(fiscalErrorTitle(new ApiRequestError("VALIDATION_FAILED", "safe", 400))).toBe(
      "The request was rejected as invalid"
    );
  });
  it("renders alert and value-free transport copy", () => {
    render(<FiscalErrorAlert error={new TypeError("private-value")} testId="fiscal-error" />);
    const alert = screen.getByTestId("fiscal-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Could not reach the server");
    expect(alert).toHaveTextContent(
      "The request could not reach the server. Check your connection and try again."
    );
    expect(alert).not.toHaveTextContent("private-value");
  });
});
