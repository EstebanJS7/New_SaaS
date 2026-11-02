"use client";

import type { JSX } from "react";
import {
  ApiRequestError,
  isCashConflict,
  isCashIdempotencyKeyConflict,
  isCashNotFound,
  isCashNotEntitled,
  isCashPermissionDenied,
  isCashRegisterNameConflict,
  isCashSessionAlreadyOpen,
  isCashSessionNotOpen,
  isCashTransportError,
  userFacingCashError,
} from "./cash-api";

/**
 * The cash refusal outcome (EPIC-13 CASH-004).
 *
 * The cash API answers a refused request with one of a small set of stable
 * outcomes, and the surface renders each one honestly instead of collapsing them
 * into a single failure. The heading comes from the cash client's own
 * classifiers — never from fragile message matching invented here — and the body
 * is the client's value-free {@link userFacingCashError} copy, which the API
 * keeps free of stored values.
 *
 * Every heading is UX only: the backend already decided the outcome and remains
 * the authority. The classifications are checked most-specific first, because a
 * duplicate register name, an already-open register, a closed session and a
 * reused idempotency key are all the stable `409 CONFLICT` underneath.
 */

/** The heading for a refused cash request, by its stable outcome. */
export function cashErrorTitle(error: Error): string {
  if (isCashNotEntitled(error)) {
    return "Caja no está habilitada para esta organización";
  }
  if (isCashPermissionDenied(error)) {
    return "Sin permiso";
  }
  if (isCashNotFound(error)) {
    return "No encontramos la caja o sesión";
  }
  if (isCashRegisterNameConflict(error)) {
    return "Ya existe una caja con este nombre";
  }
  if (isCashSessionAlreadyOpen(error)) {
    return "Esta caja ya tiene una sesión abierta";
  }
  if (isCashSessionNotOpen(error)) {
    return "Esta sesión no está abierta";
  }
  if (isCashIdempotencyKeyConflict(error)) {
    return "El intento enviado corresponde a otro movimiento";
  }
  if (isCashConflict(error)) {
    return "La operación fue rechazada";
  }
  if (error instanceof ApiRequestError && error.status === 400) {
    return "Revisá los datos de la operación";
  }
  if (isCashTransportError(error)) {
    return "No pudimos confirmar el resultado";
  }
  return "No pudimos completar la operación";
}

interface CashErrorAlertProps {
  /** The refusal to render. */
  readonly error: Error;
  /** Optional test id so a state branch can be asserted by its own name. */
  readonly testId?: string;
}

/**
 * Renders one cash refusal: a stable heading plus the API's value-free message.
 * A short drawer is never routed through this component — a negative close
 * difference is an outcome, not an error.
 */
export function CashErrorAlert({ error, testId }: CashErrorAlertProps): JSX.Element {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <p className="font-medium">{cashErrorTitle(error)}</p>
      <p>{userFacingCashError(error)}</p>
    </div>
  );
}
