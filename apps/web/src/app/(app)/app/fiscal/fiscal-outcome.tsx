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
  if (isFiscalNotEntitled(error)) return "Fiscal features are not enabled for this tenant";
  if (isFiscalPermissionDenied(error)) return "Permission denied";
  if (isFiscalNotFound(error)) return "Fiscal document not found";
  if (isFiscalConflict(error)) return "The API refused the request";
  if (isFiscalValidationFailed(error)) return "The request was rejected as invalid";
  if (error instanceof ApiRequestError && error.status === 400)
    return "The request was rejected as invalid";
  if (isFiscalTransportError(error)) return "Could not reach the server";
  return "The request failed";
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
