"use client";

import type { JSX } from "react";
import type { SaleCompletionFailure } from "./sales-api";

/**
 * The completion outcome mapping (EPIC-12 POS-004, POS-003 contract).
 *
 * The API answers a completion in exactly the ways POS-003 defined, and the
 * counter must render each one honestly instead of collapsing them into a single
 * failure. This module turns the classifier E1 shipped
 * (`classifySaleCompletionError`) and the completion response's replay
 * discriminant into stable, value-free UX copy.
 *
 * The copy is UX only: the backend already decided the outcome. Two invariants
 * are stated by the copy itself: a success is only ever rendered from the API's
 * returned completed sale (there is no locally assumed completion), and a
 * refusal never claims the sale completed.
 */

/** The heading and body a single outcome renders. */
export interface CompletionOutcomeCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The copy for a completed sale. A fresh `201` and an identical `200` replay
 * carry the SAME body, so the `replayed` discriminant from the API — and never a
 * local assumption — is what tells "just completed" apart from "already
 * completed".
 */
export function completedOutcomeCopy(replayed: boolean): CompletionOutcomeCopy {
  return replayed
    ? {
        title: "Sale already completed",
        description:
          "The API recognised an identical replay and returned the existing completed sale. No second completion happened and no stock or cash effect was applied twice.",
      }
    : {
        title: "Sale completed",
        description:
          "The API confirmed the completed sale. Its stock and cash effects are written and the sale is now COMPLETED.",
      };
}

/**
 * The copy for a failed completion, per stable outcome. Every branch states what
 * actually happened; the ones where a refusal persists nothing say so, and the
 * transport branch says the outcome is unknown rather than guessing.
 */
export function completionFailureCopy(failure: SaleCompletionFailure): CompletionOutcomeCopy {
  switch (failure) {
    case "permission-denied":
      return {
        title: "Permission denied",
        description: "You do not have permission to complete sales. The sale was not completed.",
      };
    case "not-entitled":
      return {
        title: "Sales are not enabled for this tenant",
        description:
          "The tenant does not have the sales capability, so the sale was not completed.",
      };
    case "not-found":
      return {
        title: "Sale not found",
        description:
          "The sale does not exist for this tenant — an unknown id and a foreign one are the same answer. Nothing was completed.",
      };
    case "not-editable":
      return {
        title: "This sale is no longer a draft",
        description:
          "The sale already moved on, so this completion was not applied. It is a terminal condition, not a transient failure to retry.",
      };
    case "payment-total-mismatch":
      return {
        title: "The payments do not sum to the sale total",
        description:
          "The API refused the payment set and persisted nothing. Adjust the payments so they sum exactly to the total and submit again.",
      };
    case "missing-cash-session":
      return {
        title: "A cash payment needs an open cash session",
        description:
          "No open session was found for a cash payment, so the sale was not completed. Open a cash session before retrying.",
      };
    case "ambiguous-cash-session":
      return {
        title: "More than one cash session is open",
        description:
          "A cash payment could not be attributed to a single drawer, so the sale was not completed. Close the extra sessions before retrying.",
      };
    case "insufficient-stock":
      return {
        title: "Not enough stock",
        description:
          "The stock policy refused the completion. Nothing was completed and no stock moved.",
      };
    case "inactive-item":
      return {
        title: "A line's catalog item is inactive",
        description:
          "An inactive item cannot take part in a sale, so the completion was refused. Nothing was completed.",
      };
    case "idempotency-conflict":
      return {
        title: "This completion was already used for a different request",
        description:
          "The idempotency key was reused with different content, so the API refused it. Nothing was completed; start a new completion.",
      };
    case "conflict":
      return {
        title: "The API refused the completion",
        description:
          "A conflicting state prevented the completion and nothing was persisted. Reload the sale to see its current status.",
      };
    case "validation":
      return {
        title: "The completion was rejected",
        description: "The API rejected the completion request as invalid and persisted nothing.",
      };
    case "transport":
      return {
        title: "Could not reach the server",
        description:
          "The request did not reach the API, so whether the sale completed is unknown. Reload the sale and check its real status before retrying.",
      };
    default:
      return {
        title: "Completion failed",
        description: "The API refused the completion. Nothing was completed.",
      };
  }
}

interface CompletionOutcomeAlertProps {
  /** The API's completed-sale result; present only after a confirmed completion. */
  readonly completed?: { readonly replayed: boolean } | null;
  /** The classified failure from a refused completion. */
  readonly failure?: SaleCompletionFailure | null;
}

/**
 * Renders one completion outcome. A day where the sale completed and a day where
 * it did not are visually and textually distinct, and the success branch only
 * renders when the API actually returned a completed sale.
 */
export function CompletionOutcomeAlert({
  completed = null,
  failure = null,
}: CompletionOutcomeAlertProps): JSX.Element | null {
  if (completed !== null) {
    const copy = completedOutcomeCopy(completed.replayed);
    return (
      <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm">
        <p className="font-medium text-foreground">{copy.title}</p>
        <p className="text-muted-foreground">{copy.description}</p>
      </div>
    );
  }

  if (failure === null) {
    return null;
  }

  const copy = completionFailureCopy(failure);
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <p className="font-medium">{copy.title}</p>
      <p>{copy.description}</p>
    </div>
  );
}
