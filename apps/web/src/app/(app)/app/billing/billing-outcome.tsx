"use client";

import type { JSX } from "react";
import {
  ApiRequestError,
  isBillingConflict,
  isBillingCustomerRequired,
  isBillingNotCancellable,
  isBillingNotDraft,
  isBillingNotFound,
  isBillingNotEntitled,
  isBillingPermissionDenied,
  isBillingSaleAlreadyInvoiced,
  isBillingSaleNotCompleted,
  isBillingTransportError,
  userFacingBillingError,
} from "./billing-api";

/**
 * The billing refusal outcome (EPIC-14 BILL-004).
 *
 * The billing API answers a refused request with one of a small set of stable
 * outcomes, and the surface renders each one honestly instead of collapsing them
 * into a single failure. The heading comes from the billing client's own
 * classifiers — never from fragile message matching invented here — and the body
 * is the client's value-free {@link userFacingBillingError} copy, which the API
 * keeps free of stored values (a `409` names the condition and never echoes an
 * invoice, a sale or a cancel reason).
 *
 * Every heading is UX only: the backend already decided the outcome and remains
 * the authority. The classifications are checked most-specific first, because a
 * sale that is not completed, a tenant that requires a customer, a sale that
 * already holds an invoice and a non-draft confirm are all the stable `409
 * CONFLICT` underneath.
 */

/** The heading for a refused billing request, by its stable outcome. */
export function billingErrorTitle(error: Error): string {
  if (isBillingNotEntitled(error)) {
    return "Billing features are not enabled for this tenant";
  }
  if (isBillingPermissionDenied(error)) {
    return "Permission denied";
  }
  if (isBillingNotFound(error)) {
    return "Invoice not found";
  }
  if (isBillingSaleNotCompleted(error)) {
    return "Only a completed sale can be invoiced";
  }
  if (isBillingCustomerRequired(error)) {
    return "This tenant requires a customer before an invoice can be issued";
  }
  if (isBillingSaleAlreadyInvoiced(error)) {
    return "This sale already has an invoice";
  }
  if (isBillingNotDraft(error)) {
    return "Only a draft invoice can be confirmed";
  }
  if (isBillingNotCancellable(error)) {
    return "Only a draft or confirmed invoice can be cancelled";
  }
  if (isBillingConflict(error)) {
    return "The API refused the request";
  }
  if (error instanceof ApiRequestError && error.status === 400) {
    return "The request was rejected as invalid";
  }
  if (isBillingTransportError(error)) {
    return "Could not reach the server";
  }
  return "The request failed";
}

interface BillingErrorAlertProps {
  /** The refusal to render. */
  readonly error: Error;
  /** Optional test id so a state branch can be asserted by its own name. */
  readonly testId?: string;
}

/**
 * Renders one billing refusal: a stable heading plus the API's value-free
 * message. A cancelled invoice is never routed through this component — the
 * terminal state is an outcome, not an error.
 */
export function BillingErrorAlert({ error, testId }: BillingErrorAlertProps): JSX.Element {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <p className="font-medium">{billingErrorTitle(error)}</p>
      <p>{userFacingBillingError(error)}</p>
    </div>
  );
}
