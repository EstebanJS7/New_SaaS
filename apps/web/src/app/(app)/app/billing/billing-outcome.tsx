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
 * is the client's es-PY {@link userFacingBillingError} copy, which never echoes
 * an invoice, a sale or a cancel reason and never passes the server's English
 * text through.
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
    return "Facturación no habilitada";
  }
  if (isBillingPermissionDenied(error)) {
    return "Sin permiso";
  }
  if (isBillingNotFound(error)) {
    return "No encontramos la factura";
  }
  if (isBillingSaleNotCompleted(error)) {
    return "Solo se puede facturar una venta completada";
  }
  if (isBillingCustomerRequired(error)) {
    return "Esta organización exige un cliente para emitir una factura";
  }
  if (isBillingSaleAlreadyInvoiced(error)) {
    return "Esta venta ya tiene una factura";
  }
  if (isBillingNotDraft(error)) {
    return "Solo se puede confirmar una factura en borrador";
  }
  if (isBillingNotCancellable(error)) {
    return "Solo se puede anular una factura en borrador o confirmada";
  }
  if (isBillingConflict(error)) {
    return "La operación fue rechazada";
  }
  if (error instanceof ApiRequestError && error.status === 400) {
    return "Revisá los datos de la operación";
  }
  if (isBillingTransportError(error)) {
    return "No se pudo conectar con el servidor";
  }
  return "No pudimos completar la operación";
}

interface BillingErrorAlertProps {
  /** The refusal to render. */
  readonly error: Error;
  /** Optional test id so a state branch can be asserted by its own name. */
  readonly testId?: string;
}

/**
 * Renders one billing refusal: a stable heading plus the client's es-PY
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
