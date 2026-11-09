"use client";

import type { JSX } from "react";
import {
  ApiRequestError,
  isFiscalConflict,
  isFiscalNotEntitled,
  isFiscalNotFound,
  isFiscalPermissionDenied,
  isFiscalTransportError,
  isFiscalValidationFailed,
  userFacingFiscalError,
} from "./fiscal-api";

export function fiscalErrorTitle(error: Error): string {
  if (isFiscalNotEntitled(error)) return "Facturación electrónica no habilitada";
  if (isFiscalPermissionDenied(error)) return "Sin permiso";
  if (isFiscalNotFound(error)) return "No encontramos el documento fiscal";
  if (isFiscalConflict(error)) return "La operación fue rechazada";
  if (isFiscalValidationFailed(error)) return "Revisá los datos de la operación";
  if (error instanceof ApiRequestError && error.status === 400)
    return "Revisá los datos de la operación";
  if (isFiscalTransportError(error)) return "No se pudo conectar con el servidor";
  return "No pudimos completar la operación";
}
interface FiscalErrorAlertProps {
  readonly error: Error;
  readonly testId?: string;
}
export function FiscalErrorAlert({ error, testId }: FiscalErrorAlertProps): JSX.Element {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <p className="font-medium">{fiscalErrorTitle(error)}</p>
      <p>{userFacingFiscalError(error)}</p>
    </div>
  );
}
