import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CompletionOutcomeAlert,
  completedOutcomeCopy,
  completionFailureCopy,
} from "./completion-outcome";
import type { SaleCompletionFailure } from "./sales-api";

/** Every stable completion failure the classifier can produce. */
const ALL_FAILURES: readonly SaleCompletionFailure[] = [
  "permission-denied",
  "not-entitled",
  "not-found",
  "not-editable",
  "payment-total-mismatch",
  "missing-cash-session",
  "ambiguous-cash-session",
  "insufficient-stock",
  "inactive-item",
  "idempotency-conflict",
  "conflict",
  "validation",
  "transport",
  "unknown",
];

describe("completion outcome copy", () => {
  it("distinguishes a fresh completion from an identical replay", () => {
    const fresh = completedOutcomeCopy(false);
    const replay = completedOutcomeCopy(true);

    expect(fresh.title).toBe("Sale completed");
    expect(replay.title).toBe("Sale already completed");
    expect(replay.title).not.toBe(fresh.title);
    expect(replay.description).toMatch(/no second completion/i);
  });

  it("gives every distinct failure its own non-empty copy", () => {
    for (const failure of ALL_FAILURES) {
      const copy = completionFailureCopy(failure);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });

  it("names the specific conditions the API reports apart", () => {
    expect(completionFailureCopy("payment-total-mismatch").title).toMatch(/do not sum/i);
    expect(completionFailureCopy("missing-cash-session").title).toMatch(/open cash session/i);
    expect(completionFailureCopy("ambiguous-cash-session").title).toMatch(
      /more than one cash session/i
    );
    expect(completionFailureCopy("not-editable").title).toMatch(/no longer a draft/i);
    expect(completionFailureCopy("idempotency-conflict").title).toMatch(/different request/i);
    expect(completionFailureCopy("permission-denied").title).toBe("Permission denied");
    expect(completionFailureCopy("not-entitled").title).toMatch(/not enabled/i);
    expect(completionFailureCopy("not-found").title).toMatch(/not found/i);
  });

  it("states that a transport failure leaves the outcome unknown rather than assuming it", () => {
    const copy = completionFailureCopy("transport");
    expect(copy.description).toMatch(/unknown/i);
    expect(copy.description).not.toMatch(/was completed/i);
  });
});

describe("CompletionOutcomeAlert", () => {
  it("renders a confirmed completion as a status, never as a failure", () => {
    render(<CompletionOutcomeAlert completed={{ replayed: false }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Sale completed");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders an identical replay met with the sale already completed copy", () => {
    render(<CompletionOutcomeAlert completed={{ replayed: true }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Sale already completed");
  });

  it("renders a refusal in the alert role", () => {
    render(<CompletionOutcomeAlert failure="insufficient-stock" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Not enough stock");
  });

  it("renders nothing when there is no outcome yet", () => {
    const { container } = render(<CompletionOutcomeAlert />);

    expect(container).toBeEmptyDOMElement();
  });
});
