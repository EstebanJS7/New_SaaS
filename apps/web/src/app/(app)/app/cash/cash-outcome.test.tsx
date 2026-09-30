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
      "Cash features are not enabled for this tenant"
    );
    expect(cashErrorTitle(new ApiRequestError("FORBIDDEN", "x", 403))).toBe("Permission denied");
  });

  it("names the shared 404 without distinguishing an unknown id from a foreign one", () => {
    expect(cashErrorTitle(new ApiRequestError("NOT_FOUND", "x", 404))).toBe(
      "Cash register or session not found"
    );
  });

  it("separates the three named 409 conflicts from the generic one", () => {
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_REGISTER_NAME_CONFLICT_MESSAGE, 409))
    ).toBe("A cash register with this name already exists");
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE, 409))
    ).toBe("This cash register already has an open session");
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE, 409))
    ).toBe("This cash session is not open");
    expect(
      cashErrorTitle(new ApiRequestError("CONFLICT", CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE, 409))
    ).toBe("This idempotency key was already used for a different request");
    expect(cashErrorTitle(new ApiRequestError("CONFLICT", "Some other conflict.", 409))).toBe(
      "The API refused the request"
    );
  });

  it("names the stable 400 and the transport failure", () => {
    expect(cashErrorTitle(new ApiRequestError("VALIDATION_FAILED", "Invalid body.", 400))).toBe(
      "The request was rejected as invalid"
    );
    expect(cashErrorTitle(new Error("fetch failed"))).toBe("Could not reach the server");
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
    expect(alert).toHaveTextContent("Cash features are not enabled for this tenant");
    expect(alert).toHaveTextContent(CASH_FEATURE_NOT_ENTITLED_MESSAGE);
  });

  it("renders the permission copy for a forbidden cash call", () => {
    render(<CashErrorAlert error={new ApiRequestError("FORBIDDEN", "Access denied.", 403)} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Permission denied");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to manage cash registers."
    );
  });

  it("renders its own copy for a transport failure instead of a raw browser string", () => {
    render(<CashErrorAlert error={new TypeError("Failed to fetch")} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The request could not reach the server. Check your connection and try again."
    );
  });
});
