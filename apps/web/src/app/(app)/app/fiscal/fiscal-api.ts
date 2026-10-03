"use client";

/** Staff fiscal client. Every request uses the authenticated web proxy; tenant authority stays server-side. */
export type FiscalDocumentStatus =
  | "PENDING"
  | "QUEUED"
  | "SENDING"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "ERROR"
  | "CANCEL_PENDING"
  | "CANCELLED";
export const FISCAL_DOCUMENT_STATUSES = [
  "PENDING",
  "QUEUED",
  "SENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "ERROR",
  "CANCEL_PENDING",
  "CANCELLED",
] as const satisfies readonly FiscalDocumentStatus[];
export const FISCAL_CANCEL_REASON_MAX_LENGTH = 500;

/** Allowlisted fiscal response; snapshots and tenant identity are never exposed. */
export interface FiscalDocument {
  readonly id: string;
  readonly invoiceId: string;
  readonly provider: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly externalId: string | null;
  readonly cdc: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
}
export interface CreateFiscalDocumentInput {
  readonly invoiceId: string;
}
export interface CancelFiscalDocumentInput {
  readonly reason: string;
}
export interface FiscalDocumentListFilters {
  readonly status?: FiscalDocumentStatus;
}
interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}
async function parseError(response: Response): Promise<ApiRequestError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new ApiRequestError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `Request failed (${response.status})`,
    response.status
  );
}
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/fiscal${path}`, { ...init, cache: "no-store" });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}
function getJson<T>(path: string): Promise<T> {
  return request(path, {});
}
function postJson<T>(path: string, body: unknown): Promise<T> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
export function listFiscalDocuments(
  filters: FiscalDocumentListFilters = {}
): Promise<FiscalDocument[]> {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set("status", filters.status);
  const query = params.toString();
  return getJson(`/fiscal-documents${query ? `?${query}` : ""}`);
}
export function getFiscalDocument(id: string): Promise<FiscalDocument> {
  return getJson(`/fiscal-documents/${id}`);
}
export function issueFiscalDocument(input: CreateFiscalDocumentInput): Promise<FiscalDocument> {
  return postJson("/fiscal-documents", input);
}
export function cancelFiscalDocument(
  id: string,
  input: CancelFiscalDocumentInput
): Promise<FiscalDocument> {
  return postJson(`/fiscal-documents/${id}/cancel`, input);
}

export const FISCAL_FEATURE_NOT_ENTITLED_MESSAGE =
  "Fiscal features are not enabled for this tenant.";
export const FISCAL_PERMISSION_DENIED_MESSAGE = "The required fiscal permission is missing.";
export const FISCAL_DOCUMENT_NOT_FOUND_MESSAGE = "Fiscal document was not found.";
export const FISCAL_DOCUMENT_SOURCE_INVOICE_NOT_FOUND_MESSAGE =
  "Fiscal document source invoice was not found.";
export const FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE =
  "Only a confirmed invoice can have a fiscal document.";
export const FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE =
  "A fiscal document has already been issued for this invoice.";
export const FISCAL_DOCUMENT_CANCEL_SENDING_MESSAGE =
  "This fiscal document is being submitted and cannot be cancelled yet.";
export const FISCAL_DOCUMENT_CANCEL_CONFLICT_MESSAGE =
  "The fiscal document changed while the cancellation was in progress.";
export const FISCAL_DOCUMENT_CANCEL_REFUSED_MESSAGE =
  "The fiscal provider refused the cancellation.";
export function isFiscalPermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}
export function isFiscalNotEntitled(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED";
}
export function isFiscalNotFound(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}
export function isFiscalConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}
export function isFiscalValidationFailed(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "VALIDATION_FAILED";
}
export function isFiscalTransportError(error: Error): boolean {
  return !(error instanceof ApiRequestError);
}
export function userFacingFiscalError(error: Error): string {
  if (!(error instanceof ApiRequestError))
    return "The request could not reach the server. Check your connection and try again.";
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to use Fiscal.";
    case "FORBIDDEN":
      return "You do not have permission to manage fiscal documents.";
    case "FEATURE_NOT_ENTITLED":
      return FISCAL_FEATURE_NOT_ENTITLED_MESSAGE;
    case "NOT_FOUND":
      return "Fiscal document not found.";
    default:
      return error.message;
  }
}
