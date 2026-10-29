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

    expect(fresh.title).toBe("Venta completada");
    expect(replay.title).toBe("La venta ya estaba completada");
    expect(replay.title).not.toBe(fresh.title);
    expect(replay.description).toMatch(/No se volvió a completar/i);
  });

  it("gives every distinct failure its own non-empty copy", () => {
    for (const failure of ALL_FAILURES) {
      const copy = completionFailureCopy(failure);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });

  it("names the specific conditions the API reports apart", () => {
    expect(completionFailureCopy("payment-total-mismatch").title).toMatch(/no coinciden/i);
    expect(completionFailureCopy("missing-cash-session").title).toMatch(/sesión de caja abierta/i);
    expect(completionFailureCopy("ambiguous-cash-session").title).toMatch(
      /más de una sesión de caja/i
    );
    expect(completionFailureCopy("not-editable").title).toMatch(/ya no es un borrador/i);
    expect(completionFailureCopy("idempotency-conflict").title).toMatch(/otros datos/i);
    expect(completionFailureCopy("permission-denied").title).toBe("Sin permiso");
    expect(completionFailureCopy("not-entitled").title).toMatch(/no habilitadas/i);
    expect(completionFailureCopy("not-found").title).toMatch(/No encontramos/i);
  });

  it("states that a transport failure leaves the outcome unknown rather than assuming it", () => {
    const copy = completionFailureCopy("transport");
    expect(copy.description).toMatch(/no sabemos/i);
    expect(copy.description).not.toMatch(/la venta se completó con éxito/i);
  });
});

describe("CompletionOutcomeAlert", () => {
  it("renders a confirmed completion as a status, never as a failure", () => {
    render(<CompletionOutcomeAlert completed={{ replayed: false }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Venta completada");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders an identical replay met with the sale already completed copy", () => {
    render(<CompletionOutcomeAlert completed={{ replayed: true }} />);

    expect(screen.getByRole("status")).toHaveTextContent("La venta ya estaba completada");
  });

  it("renders a refusal in the alert role", () => {
    render(<CompletionOutcomeAlert failure="insufficient-stock" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Stock insuficiente");
  });

  it("renders nothing when there is no outcome yet", () => {
    const { container } = render(<CompletionOutcomeAlert />);

    expect(container).toBeEmptyDOMElement();
  });
});
