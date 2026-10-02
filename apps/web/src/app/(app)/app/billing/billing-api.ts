"use client";

/**
 * Staff billing client. Every call goes through the authenticated web proxy at
 * `/api/billing`, which resolves the tenant from the server-side session cookie —
 * the browser never supplies a tenant id, and this client is never an
 * authorization authority. The invoice's currency, customer, snapshot lines and
 * totals are likewise derived server-side from the source sale: no helper here
 * sends a currency, a customer, a line, a total or a status, because none of them
 * is caller-owned (DEC-038).
 *
 * Data classification (PRD §41): the currency, the status, the series, the
 * allocated number, the frozen rate code, the line description and the money
 * amounts are INTERNAL. This module sends and returns those fields and
 * deliberately writes none of them anywhere else: no console call, no error
 * telemetry and no analytics event takes an invoice payload, and only the API's
 * own stable, value-free error copy is surfaced.
 *
 * This module is the WHOLE staff billing surface: the status-filtered list, the
 * id read with the immutable lines, the create-from-a-completed-sale command and
 * the two lifecycle commands. No helper offers an edit, a reopen, a delete, a
 * print or an export — a draft is never edited (DEC-038), `CANCELLED` is terminal
 * (DEC-043) and no printable document exists in this epic (DEC-044/DEC-045). The
 * surface shows no fiscal state at all, because Billing keeps none (DEC-042).
 *
 * Money and quantity never become JavaScript numbers. Every amount
 * (`unitPrice`, `lineTotal`, `taxableBase`, `taxAmount`, `total`, `taxTotal`) and
 * every quantity (`quantity`) arrives as an exact fixed-scale decimal string and
 * is displayed as returned; this module performs NO arithmetic on them, not even
 * a total check, because the server-computed value is the only authority
 * (DEC-038).
 *
 * Neither lifecycle command takes an `Idempotency-Key`: confirm and cancel are
 * payload-free (apart from the reason) and state-guarded, so a repeat is a `200`
 * replay of the same representation rather than a replay protocol the caller has
 * to drive (DEC-041/DEC-043). This module therefore never mints or forwards one.
 *
 * Like the EPIC-11/EPIC-13 sibling clients, this module declares its own
 * `ApiRequestError` so it stays independently testable: a billing refusal is
 * classified by this module's predicates, never by a sale or cash predicate.
 */

/** Lifecycle values pinned by the `invoice_status` enum (PRD §21, DEC-038). */
export type InvoiceStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

/** Runtime mirror of the invoice-status union, pinned so the enum cannot drift. */
export const INVOICE_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "CANCELLED",
] as const satisfies readonly InvoiceStatus[];

/**
 * The `invoice.cancel_reason` upper bound (`VARCHAR(500)` plus the
 * `invoice_cancel_reason_present` CHECK). Mirrored so the surface can bound the
 * reason before the API rejects it with the stable `400`.
 */
export const INVOICE_CANCEL_REASON_MAX_LENGTH = 500;

/**
 * One allowlisted invoice line: the immutable snapshot copied verbatim from the
 * sale's frozen line, as the API projects it. Every money field is an exact
 * fixed-scale string (2 decimals) and `quantity` is exact at scale 3 — this
 * module only carries them.
 */
export interface InvoiceLine {
  readonly id: string;
  readonly catalogItemId: string;
  /** Invoice-local 0-based reading order, unique per invoice. */
  readonly position: number;
  /** Frozen line description copied from the catalog item name. */
  readonly description: string;
  /** Frozen stable rate code, e.g. `"EXEMPT"` / `"IVA_10"`. */
  readonly rateCode: string;
  /** Exact fixed-scale (2 decimals) non-negative literal, e.g. `"10.50"`. */
  readonly unitPrice: string;
  /** Exact fixed-scale (3 decimals) positive literal, e.g. `"2.000"`. */
  readonly quantity: string;
  /** Exact fixed-scale (2 decimals) non-negative literal. */
  readonly lineTotal: string;
  /** Exact fixed-scale (2 decimals) non-negative literal. */
  readonly taxableBase: string;
  /** Exact fixed-scale (2 decimals) non-negative literal. */
  readonly taxAmount: string;
}

/**
 * Allowlisted invoice response, mirroring `InvoiceResponse` field for field.
 * There is deliberately no `tenantId` (the caller's tenant is the request's own
 * identity), no fiscal field (DEC-042) and no payment field (DEC-044).
 *
 * `total` and `taxTotal` are server-computed projections over the invoice's own
 * immutable lines. They arrive as exact fixed-scale strings; the surface renders
 * them and computes nothing.
 */
export interface Invoice {
  readonly id: string;
  /** The one completed sale this invoice bills (DEC-038). */
  readonly saleId: string;
  /** Customer inherited from the sale; `null` for a walk-in sale. */
  readonly customerId: string | null;
  /** ISO 4217 code inherited from the source sale; never caller-supplied. */
  readonly currency: string;
  readonly status: InvoiceStatus;
  /** Numbering series, `"A"` in this epic (DEC-039). */
  readonly series: string;
  /** Allocated number; `null` until confirmation (DEC-039). */
  readonly number: number | null;
  /** Set exactly when the invoice is confirmed. */
  readonly confirmedAt: string | null;
  /** Set exactly when the invoice is cancelled (DEC-043). */
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly lines: InvoiceLine[];
  /** Sum of the line totals, exact fixed-scale (2 decimals). */
  readonly total: string;
  /** Sum of the line tax amounts, exact fixed-scale (2 decimals). */
  readonly taxTotal: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Create payload: the completed sale to invoice and nothing else. The currency,
 * the customer, the snapshot lines, the totals, the series and the number are all
 * derived server-side, so no caller-computed value can enter the document
 * (DEC-038/DEC-039). The proxy refuses any other key before the request leaves
 * the web tier.
 */
export interface CreateInvoiceInput {
  readonly saleId: string;
}

/**
 * Cancel payload: the required reason and nothing else. The API trims it and
 * bounds it to 1..500 characters; the status, the timestamps and the reason
 * column are written only by the command (DEC-043).
 */
export interface CancelInvoiceInput {
  readonly reason: string;
}

/**
 * Invoice list filters; the only field is optional and server-applied.
 *
 * `status` IS the lifecycle filter: the API's list query accepts exactly
 * `status` (one enum value) and validates it with `.strict()`, so any other key
 * would be a `400` upstream. The API applies NO implicit default, so a caller
 * that wants only the drafts must ask for them explicitly.
 */
export interface InvoiceListFilters {
  readonly status?: InvoiceStatus;
}

interface ApiErrorEnvelope {
  readonly error: {
    readonly code?: string;
    readonly message?: string;
  };
}

/**
 * Carries the stable API error code so the UI branches on the contract instead
 * of fragile message matching of its own invention. `message` remains the
 * server-provided text, which the billing API keeps value-free — no conflict
 * message ever echoes an invoice, a sale or a reason back.
 */
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
  const response = await fetch(`/api/billing${path}`, { ...init, cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

function getJson<T>(path: string): Promise<T> {
  return request<T>(path, {});
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * POSTs a payload-free command. Used by {@link confirmInvoice} alone: the
 * transition declares no body and no idempotency key, so neither is invented
 * here (DEC-041).
 */
function postCommand<T>(path: string): Promise<T> {
  return request<T>(path, { method: "POST" });
}

/**
 * Lists the caller tenant's invoices with their lines, newest first. An omitted
 * `status` applies NO implicit filter, so the view that wants only the drafts
 * must ask for `DRAFT`.
 */
export function listInvoices(filters: InvoiceListFilters = {}): Promise<Invoice[]> {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set("status", filters.status);
  const query = params.toString();
  return getJson(`/invoices${query.length > 0 ? `?${query}` : ""}`);
}

/**
 * Gets one invoice of the caller tenant with its immutable snapshot lines by
 * UUID. A cross-tenant id is the same `404` as an absent one, so the surface must
 * render both as "not found" rather than distinguishing them.
 */
export function getInvoice(id: string): Promise<Invoice> {
  return getJson(`/invoices/${id}`);
}

/**
 * Creates one `DRAFT` invoice from one completed in-tenant sale. The sale must be
 * `COMPLETED`, must satisfy the tenant's invoicing policy and may hold at most
 * one live invoice — each violated rule is a stable `409`, never a silent retry.
 */
export function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  return postJson("/invoices", input);
}

/**
 * Confirms one `DRAFT` invoice, allocating its number inside the same
 * transaction as the `CONFIRMED` write. The command is payload-free and
 * state-guarded: a retried call is a `200` replay of the same representation, so
 * the caller must NOT treat a repeat as a second confirmation (DEC-041). A
 * `CANCELLED` invoice is the stable `409`.
 */
export function confirmInvoice(id: string): Promise<Invoice> {
  return postCommand(`/invoices/${id}/confirm`);
}

/**
 * Cancels one `DRAFT` or `CONFIRMED` invoice with its reason, writing the
 * terminal `CANCELLED` state (DEC-043). A repeat on an already-`CANCELLED`
 * invoice is a `200` replay, and cancelling reverses no money: the cash
 * compensation path stays out of this epic ([[TD-018]]).
 */
export function cancelInvoice(id: string, input: CancelInvoiceInput): Promise<Invoice> {
  return postJson(`/invoices/${id}/cancel`, input);
}

/**
 * Stable, value-free error copy the billing API emits, duplicated from
 * `apps/api/src/billing/billing.service.ts` and `billing.repository.ts` for the
 * same reason the sale and cash clients duplicate their own: the web tier cannot
 * import from the API package, and each string names a condition rather than
 * echoing a value.
 */
export const BILLING_FEATURE_NOT_ENTITLED_MESSAGE =
  "Billing features are not enabled for this tenant.";
export const INVOICE_SALE_NOT_COMPLETED_MESSAGE = "Only a completed sale can be invoiced.";
export const INVOICE_CUSTOMER_REQUIRED_MESSAGE =
  "This tenant requires a customer before an invoice can be issued.";
export const INVOICE_SALE_ALREADY_INVOICED_MESSAGE = "This sale already has an invoice.";
export const INVOICE_NOT_DRAFT_MESSAGE = "Only a draft invoice can be confirmed.";
export const INVOICE_NOT_CANCELLABLE_MESSAGE =
  "Only a draft or confirmed invoice can be cancelled.";
export const INVOICE_NOT_FOUND_MESSAGE = "Invoice was not found.";

/**
 * True when the API refused the request because the staff role does not hold the
 * `billing.*` key the operation needs. A UX branch only: the backend check
 * behind it is what actually protects the data, and it runs BEFORE this one (the
 * entitlement first, the permission second).
 */
export function isBillingPermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

/**
 * True when the tenant lacks the `billing` entitlement. Distinct from
 * {@link isBillingPermissionDenied}: the capability is not enabled for the
 * tenant, which is not a problem with the operator's role.
 */
export function isBillingNotEntitled(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED";
}

/**
 * True when the API answered the shared `404` — a foreign-tenant invoice id is
 * byte-equivalent to an unknown one, so the UI must not distinguish them.
 */
export function isBillingNotFound(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

/** True when the API refused the request with any stable `409 CONFLICT`. */
export function isBillingConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * True when the create named a sale whose status is not `COMPLETED`. A real state
 * of the tenant, not a malformed request: the sale exists and its own state
 * forbids the command.
 */
export function isBillingSaleNotCompleted(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === INVOICE_SALE_NOT_COMPLETED_MESSAGE;
}

/**
 * True when the create was blocked by the tenant's `requireCustomerForInvoice`
 * policy because the source sale is a walk-in (DEC-038). A tenant policy, not a
 * caller mistake.
 */
export function isBillingCustomerRequired(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === INVOICE_CUSTOMER_REQUIRED_MESSAGE;
}

/**
 * True when the sale already holds a live invoice. A cancelled invoice releases
 * its sale, so the way forward is to cancel the existing invoice rather than to
 * retry this create (DEC-043).
 */
export function isBillingSaleAlreadyInvoiced(error: Error): boolean {
  return (
    error instanceof ApiRequestError && error.message === INVOICE_SALE_ALREADY_INVOICED_MESSAGE
  );
}

/**
 * True when the confirm was refused because the stored status is not `DRAFT` —
 * `CONFIRMED` (already allocated) or `CANCELLED` (terminal).
 */
export function isBillingNotDraft(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === INVOICE_NOT_DRAFT_MESSAGE;
}

/**
 * True when the cancel was refused by the database's conditional write, meaning
 * the stored status was neither `DRAFT` nor `CONFIRMED` after the lock — a lost
 * race, never a silent success.
 */
export function isBillingNotCancellable(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === INVOICE_NOT_CANCELLABLE_MESSAGE;
}

/**
 * True when the request never reached the API: a fetch rejection or any other
 * non-`ApiRequestError` failure. Rendered as a transport error so it is never
 * conflated with a refusal the API actually produced.
 */
export function isBillingTransportError(error: Error): boolean {
  return !(error instanceof ApiRequestError);
}

/**
 * Maps the stable billing error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate. Every
 * unmapped code falls through to the server message — which the billing API
 * keeps value-free — instead of inventing a cause, and a bare transport failure
 * gets its own copy rather than a raw browser string.
 */
export function userFacingBillingError(error: Error): string {
  if (!(error instanceof ApiRequestError)) {
    return "The request could not reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to use billing.";
    case "FORBIDDEN":
      return "You do not have permission to manage invoices.";
    case "FEATURE_NOT_ENTITLED":
      return "Billing features are not enabled for this tenant.";
    case "NOT_FOUND":
      return "Invoice not found.";
    default:
      return error.message;
  }
}
