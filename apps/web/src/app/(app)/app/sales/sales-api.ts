"use client";

/**
 * Staff POS sale client (EPIC-12 POS-004 E1). Every call goes through the
 * authenticated web proxy at `/api/sales`, which resolves the tenant from the
 * server-side session cookie — the browser never supplies a tenant id, and this
 * client is never an authorization authority.
 *
 * Data classification (PRD §41): the currency, the lifecycle status, the frozen
 * rate code and the line money amounts are INTERNAL. This module sends and
 * returns those fields and deliberately writes none of them anywhere else: no
 * console call, no error telemetry and no analytics event takes a sale payload,
 * and only the API's own stable, value-free error copy is surfaced.
 *
 * The lifecycle is server-owned: no helper here sends a `status`, and the two
 * transitions are the API's own explicit commands (`cancel`, `complete`). There
 * is no delete call anywhere on this surface, and no edit affordance is exposed
 * for a `COMPLETED` sale.
 *
 * Money never becomes a JavaScript number in this module. Every amount arrives
 * as an exact fixed-scale decimal string and is either forwarded unchanged or
 * rendered by {@link formatWireAmount}, which groups digits textually.
 */

/** Lifecycle values pinned by the `sale_status` enum (PRD §18, POS-001). */
export type SaleStatus = "DRAFT" | "COMPLETED" | "CANCELLED";

/** Runtime mirror of the status union, pinned so the enum cannot drift. */
export const SALE_STATUSES = [
  "DRAFT",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly SaleStatus[];

/** Payment methods pinned by the `payment_method` enum (PRD §19, DEC-029). */
export type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER" | "QR" | "CHECK" | "OTHER";

/** Runtime mirror of the payment-method union, pinned so the enum cannot drift. */
export const PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "QR",
  "CHECK",
  "OTHER",
] as const satisfies readonly PaymentMethod[];

/**
 * One allowlisted sale line: the immutable snapshot a future invoice consumes
 * (DEC-021). `unitPrice` is the applied price whether it came from the catalog
 * reference price or the operator's override (DEC-022), and every money field is
 * an exact fixed-scale string at its column scale — never a float.
 */
export interface SaleLine {
  readonly id: string;
  readonly catalogItemId: string;
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
 * Allowlisted Sale DTO mirrored from the read contract. There is deliberately no
 * number, code, discount, appointment or patient key (DEC-027, DEC-028), and the
 * sale carries no invoice or fiscal state.
 */
export interface Sale {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly currency: string;
  readonly status: SaleStatus;
  readonly lines: SaleLine[];
  /** Sum of the line totals, exact fixed-scale (2 decimals). */
  readonly total: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One allowlisted payment of a completed sale: the method and the exact
 * fixed-scale (2 decimals) amount, and nothing else — there is no tendered
 * amount, no change and no refunded amount (DEC-029).
 */
export interface SalePayment {
  readonly id: string;
  readonly method: PaymentMethod;
  /** Exact fixed-scale (2 decimals) positive literal, e.g. `"1500.00"`. */
  readonly amount: string;
}

/**
 * The completion projection: the completed sale with its payments and the
 * replay discriminant. A fresh completion and an identical replay carry the SAME
 * shape; `replay` (and its transport twin, `200` versus `201`) is what tells
 * "just completed" apart from "already completed" (DEC-024).
 */
export interface CompletedSale extends Sale {
  readonly payments: SalePayment[];
  readonly replay: boolean;
}

/**
 * One submitted sale line (the strict `saleLine` contract). `unitPrice` is
 * OPTIONAL: the catalog reference price is a suggestion (DEC-022), so omitting
 * the override falls back to it and the API rejects a line that then has no
 * usable price. `id` is deliberately absent — a line is matched on update by
 * `catalogItemId`, never by a caller-supplied row id.
 */
export interface SaleLineInput {
  readonly catalogItemId: string;
  /** Exact fixed-scale (3 decimals) positive literal, e.g. `"2.000"`. */
  readonly quantity: string;
  /** Exact fixed-scale (2 decimals) non-negative literal; omit to accept the reference price. */
  readonly unitPrice?: string;
}

/**
 * Create payload (DEC-022/DEC-028): `customerId` is optional and may be `null`
 * (a walk-in sale needs none) and `lines` must carry at least one strictly
 * positive line. There is no `tenantId`, no `status`, no `currency`, no `total`,
 * no `number` and no discount field: all of them are server-owned or
 * non-existent, and the proxy refuses them before the request leaves the web
 * tier.
 */
export interface CreateSaleInput {
  readonly customerId?: string | null;
  readonly lines: SaleLineInput[];
}

/**
 * Update payload: `customerId` may be changed, cleared with `null` or omitted,
 * and `lines` is the AUTHORITATIVE line set reconciled by `catalogItemId` — a
 * stored line whose item is absent from the payload is removed, so an update
 * always states the whole set it wants.
 */
export interface UpdateSaleInput {
  readonly customerId?: string | null;
  readonly lines: SaleLineInput[];
}

/** One submitted payment: its PRD §19 method and its exact positive amount. */
export interface SalePaymentInput {
  readonly method: PaymentMethod;
  /** Exact fixed-scale (2 decimals) positive literal. */
  readonly amount: string;
}

/**
 * Completion payload (DEC-029): a NON-EMPTY payment set. The API validates that
 * the amounts sum EXACTLY to the recomputed sale total before any write, so a
 * mismatch is a `400` that persists nothing. There is no tendered amount, no
 * change and no credit field.
 */
export interface CompleteSaleInput {
  readonly payments: SalePaymentInput[];
}

/**
 * Sale list filters; the only field is optional and server-applied.
 *
 * `status` IS the lifecycle filter: the API's list query accepts exactly `status`
 * (one enum value) and validates it with `.strict()`, so any other key would be a
 * `400` upstream. The API applies NO implicit status default, so a caller that
 * wants a single status must ask for it explicitly.
 */
export interface SaleFilters {
  readonly status?: SaleStatus;
}

/** Options for the completion command; the idempotency key is caller-owned. */
export interface CompleteSaleOptions {
  /**
   * The caller's optional `Idempotency-Key` (DEC-024). It is forwarded verbatim
   * when provided and NEVER generated, reused or derived here: an absent key
   * means the API serializes on the header row lock and answers a replay with
   * the stable idempotency `409` instead of a `200`.
   */
  readonly idempotencyKey?: string;
}

/**
 * The completion outcome: the authoritative completed sale and whether the API
 * recognised it as an identical replay. The sale body is the authority — the
 * surface must never present a locally assumed completion (POS-004 invariant).
 */
export interface CompleteSaleResult {
  readonly sale: CompletedSale;
  readonly replayed: boolean;
}

/**
 * Exact quantity shape mirrored from `SALE_QUANTITY_PATTERN` in
 * `apps/api/src/sales/sales.zod.ts`: up to 7 integer digits and at most 3
 * decimals, never a sign and never a float (the `Decimal(10, 3)` column scale).
 */
export const SALE_QUANTITY_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

/**
 * Exact money shape mirrored from `SALE_UNIT_PRICE_PATTERN`/`CASH_OPENING_AMOUNT_PATTERN`:
 * up to 12 integer digits and at most 2 decimals, never a sign and never a
 * float (the `Decimal(14, 2)` column scale).
 */
export const SALE_MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** True when the literal is arithmetically zero in any accepted spelling. */
function isZeroLiteral(value: string): boolean {
  return /^0*(\.0*)?$/.test(value);
}

/**
 * True when the literal is a valid sale line quantity. A zero quantity is
 * rejected on purpose: the API refuses it with `400 VALIDATION_FAILED` before the
 * column CHECK, so the surface must not offer to submit one.
 */
export function isWireQuantity(value: string): boolean {
  return SALE_QUANTITY_PATTERN.test(value) && !isZeroLiteral(value);
}

/**
 * True when the literal is a valid non-negative unit price. Zero is accepted
 * (an item may be given away at no charge through the operator override), and a
 * negative literal is rejected here exactly as the API rejects it.
 */
export function isWireUnitPrice(value: string): boolean {
  return SALE_MONEY_PATTERN.test(value);
}

/**
 * True when the literal is a valid payment amount. Zero is rejected on purpose:
 * there is no partial payment and no zero-amount tender (DEC-029).
 */
export function isWirePaymentAmount(value: string): boolean {
  return SALE_MONEY_PATTERN.test(value) && !isZeroLiteral(value);
}

/** Exact decimal literal as the GET contract projects it: digits and one point. */
const WIRE_DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Renders an exact wire amount for display WITHOUT ever parsing it as a number:
 * the integer part is grouped in thousands and the decimals are copied
 * character by character, so no float, no rounding and no precision loss can
 * occur. An amount the wire did not produce (a literal that does not match the
 * exact-decimal shape) is returned unchanged rather than mangled.
 *
 * The value itself stays the contract: `formatWireAmount` is presentation only
 * and the amount the operator submitted or the API returned is never rewritten
 * because of it. The currency is a separate field of the sale and is rendered by
 * the caller.
 */
export function formatWireAmount(value: string): string {
  const match = WIRE_DECIMAL_PATTERN.exec(value);
  if (match === null) {
    return value;
  }
  const integer = match[1] ?? "";
  const decimals = match[2];
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decimals === undefined || decimals.length === 0) {
    return grouped;
  }
  return `${grouped}.${decimals}`;
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
 * server-provided text, which the sale API keeps value-free — a `409` names the
 * condition and never echoes a stored amount, a customer reference or an item
 * id.
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/sales${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/sales${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/sales${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json() as Promise<T>;
}

/**
 * Builds the list query from the defined filters only, in the order the proxy
 * forwards them. An omitted filter is an absent key, never an empty value, so
 * the proxy and the API both see "no filter" instead of a blank one.
 */
function filtersQuery(filters: SaleFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set("status", filters.status);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/**
 * Lists the caller tenant's sales, newest first. An omitted `status` applies NO
 * implicit filter (the API returns every lifecycle value), so a counter view that
 * wants the open drafts must ask for them.
 */
export function listSales(filters: SaleFilters = {}): Promise<Sale[]> {
  return getJson(filtersQuery(filters));
}

/** Gets one sale by its id; a foreign id is the same `404` as an unknown one. */
export function getSale(id: string): Promise<Sale> {
  return getJson(`/${id}`);
}

/**
 * Creates a `DRAFT` sale. The draft is not a sale yet: it moves stock and cash
 * only when {@link completeSale} succeeds.
 */
export function createSale(input: CreateSaleInput): Promise<Sale> {
  return postJson("", input);
}

/**
 * Updates a `DRAFT` sale. `lines` is the authoritative set, so the payload must
 * describe every line the draft should keep; any status other than `DRAFT` is the
 * stable not-editable `409`.
 */
export function updateSale(id: string, input: UpdateSaleInput): Promise<Sale> {
  return putJson(`/${id}`, input);
}

/**
 * Cancels a draft through the API's explicit cancel command. `CANCELLED` is
 * reachable only from `DRAFT`, and cancellation never deletes the sale or its
 * lines. There is no delete call and no `PATCH`-style status write.
 */
export function cancelSale(id: string): Promise<Sale> {
  return postJson(`/${id}/cancel`, {});
}

/**
 * Completes a draft through the API's explicit completion command — the sale's
 * ONLY stock and cash effect, and the only way a sale becomes `COMPLETED`. The
 * command is DRAFT-only, its payment set must sum exactly to the sale total, and
 * a CASH payment additionally requires the tenant's single `OPEN` session.
 *
 * A replay is not an error and not a second completion: the API answers `200`
 * with the SAME body and `replay: true` for an identical `Idempotency-Key`, and
 * the stable idempotency `409` when the same key was used for a different
 * request. The command is never retried silently by this module — a rejection
 * persists nothing and the caller decides.
 */
export async function completeSale(
  id: string,
  input: CompleteSaleInput,
  options: CompleteSaleOptions = {}
): Promise<CompleteSaleResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.idempotencyKey !== undefined) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  const response = await fetch(`/api/sales/${id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  const sale = (await response.json()) as CompletedSale;
  return { sale, replayed: sale.replay };
}

/**
 * Stable, value-free error copy the sale API emits. The messages are exported
 * constants in the API module (`apps/api/src/sales/sales.service.ts`,
 * `sales.repository.ts`, `apps/api/src/cash/cash.repository.ts`), and the client
 * branches on them because several `409`s and the payment-mismatch `400` share a
 * code while describing conditions the counter surface must render apart. They
 * are duplicated here on purpose: the web tier cannot import from the API
 * package, and each string names a condition rather than echoing a value.
 */
export const SALE_NOT_EDITABLE_MESSAGE = "Only a draft sale can be changed.";
export const SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE =
  "The payments must sum exactly to the sale total.";
export const SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE =
  "The idempotency key was already used for a different request.";
export const SALE_CASH_SESSION_REQUIRED_MESSAGE = "A cash payment requires an open cash session.";
export const SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE =
  "More than one cash session is open for this tenant.";
export const SALE_INSUFFICIENT_STOCK_MESSAGE =
  "The adjustment would drive the stock balance below zero.";
export const SALE_ITEM_INACTIVE_MESSAGE = "The catalog item is inactive.";
export const SALE_NOT_FOUND_MESSAGE = "Sale was not found.";
export const SALE_FEATURE_NOT_ENTITLED_MESSAGE = "Sales features are not enabled for this tenant.";

/**
 * True when the API refused the request because the staff role does not hold the
 * `sales.*` key the operation needs.
 *
 * This is a UX branch only: it decides which copy a caller renders. The backend
 * check behind it is what actually protects the data, and it runs BEFORE this one
 * (the entitlement first, the permission second).
 */
export function isSalePermissionDenied(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FORBIDDEN";
}

/**
 * True when the tenant lacks the `sales` entitlement. Distinct from
 * {@link isSalePermissionDenied} on purpose: nothing is wrong with the operator's
 * role, the capability is not enabled for the tenant, and the copy must say so.
 */
export function isSaleNotEntitled(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED";
}

/**
 * True when the API answered the shared `404` — a foreign-tenant id is
 * byte-equivalent to an unknown one, so the UI must not distinguish them.
 */
export function isSaleNotFound(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "NOT_FOUND";
}

/** True when the API refused the request with any stable `409 CONFLICT`. */
export function isSaleConflict(error: Error): boolean {
  return error instanceof ApiRequestError && error.code === "CONFLICT";
}

/**
 * True when the refusal is the non-`DRAFT` mutability rule: an edit, cancel or
 * completion of a sale whose status already moved. The condition is terminal, so
 * the UI must never present it as a transient failure to retry blindly.
 */
export function isSaleNotEditable(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === SALE_NOT_EDITABLE_MESSAGE;
}

/**
 * True when the completion was refused because the payment set does not sum
 * exactly to the sale total. A `400`, not a `409`: the request itself is
 * malformed against the contract, and nothing was persisted.
 */
export function isSalePaymentTotalMismatch(error: Error): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code === "VALIDATION_FAILED" &&
    error.message === SALE_PAYMENT_TOTAL_MISMATCH_MESSAGE
  );
}

/**
 * True when a CASH payment found no open session to attribute the drawer to.
 * Distinct from {@link isSaleCashSessionsAmbiguous} so the counter can say
 * "open a session" instead of "close one of several".
 */
export function isSaleCashSessionRequired(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === SALE_CASH_SESSION_REQUIRED_MESSAGE;
}

/**
 * True when a CASH payment found more than one open session in the tenant, so
 * there is no single drawer the sale could be attributed to. The sale carries no
 * register reference, so this is a configuration condition rather than a
 * retryable failure.
 */
export function isSaleCashSessionsAmbiguous(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE;
}

/**
 * True when the completion (or an edit) was refused because an item's stock
 * projection would go negative under the fixed `BLOCK` policy (PRD §16). A
 * business refusal with nothing persisted.
 */
export function isSaleInsufficientStock(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === SALE_INSUFFICIENT_STOCK_MESSAGE;
}

/**
 * True when a line references a deactivated catalog item. Removal in the catalog
 * is deactivation, so the item exists but must not take part in a new sale.
 */
export function isSaleInactiveItem(error: Error): boolean {
  return error instanceof ApiRequestError && error.message === SALE_ITEM_INACTIVE_MESSAGE;
}

/**
 * True when the completion's idempotency key was already used for a DIFFERENT
 * request fingerprint (DEC-024). The same key with the same fingerprint is a
 * replay instead — a `200` — so this outcome means the caller reused a key for
 * new content and must generate a new one.
 */
export function isSaleIdempotencyConflict(error: Error): boolean {
  return (
    error instanceof ApiRequestError && error.message === SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE
  );
}

/**
 * True when the request never reached the API: a fetch rejection or any other
 * non-`ApiRequestError` failure. Rendered as a transport error so it is never
 * conflated with a refusal the API actually produced, and never retried
 * silently.
 */
export function isSaleTransportError(error: Error): boolean {
  return !(error instanceof ApiRequestError);
}

/**
 * The distinct outcomes the completion flow must surface honestly (POS-004
 * acceptance criteria). `classifySaleCompletionError` maps the API's stable error
 * contract onto exactly this set, so a counter view can render each condition
 * with its own copy instead of collapsing them into one failure.
 */
export type SaleCompletionFailure =
  | "permission-denied"
  | "not-entitled"
  | "not-found"
  | "not-editable"
  | "payment-total-mismatch"
  | "missing-cash-session"
  | "ambiguous-cash-session"
  | "insufficient-stock"
  | "inactive-item"
  | "idempotency-conflict"
  | "conflict"
  | "validation"
  | "transport"
  | "unknown";

/**
 * Classifies a failed completion into its stable outcome. The message-specific
 * branches run before the generic code branches because the API shares one code
 * (`CONFLICT`, and `VALIDATION_FAILED`) across several distinct conditions; an
 * unrecognised `409` stays a generic `conflict` and an unrecognised `400` stays
 * `validation` rather than being forced into a cause the API did not name.
 */
export function classifySaleCompletionError(error: Error): SaleCompletionFailure {
  if (isSaleTransportError(error)) {
    return "transport";
  }
  if (isSalePermissionDenied(error)) {
    return "permission-denied";
  }
  if (isSaleNotEntitled(error)) {
    return "not-entitled";
  }
  if (isSaleNotFound(error)) {
    return "not-found";
  }
  if (isSaleNotEditable(error)) {
    return "not-editable";
  }
  if (isSalePaymentTotalMismatch(error)) {
    return "payment-total-mismatch";
  }
  if (isSaleCashSessionRequired(error)) {
    return "missing-cash-session";
  }
  if (isSaleCashSessionsAmbiguous(error)) {
    return "ambiguous-cash-session";
  }
  if (isSaleInsufficientStock(error)) {
    return "insufficient-stock";
  }
  if (isSaleInactiveItem(error)) {
    return "inactive-item";
  }
  if (isSaleIdempotencyConflict(error)) {
    return "idempotency-conflict";
  }
  if (isSaleConflict(error)) {
    return "conflict";
  }
  if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") {
    return "validation";
  }
  return "unknown";
}

/**
 * Maps the stable sale error contract to staff-facing UX copy.
 *
 * These messages are UX-only; the backend still enforces every gate. Every
 * unmapped code falls through to the server message — which the sale API keeps
 * value-free — instead of inventing a cause, and a bare transport failure gets
 * its own copy rather than a raw browser string.
 */
export function userFacingSaleError(error: Error): string {
  if (!(error instanceof ApiRequestError)) {
    return "The request could not reach the server. Check your connection and try again.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "You must be signed in to use the counter.";
    case "FORBIDDEN":
      return "You do not have permission to manage sales.";
    case "FEATURE_NOT_ENTITLED":
      return "Sales features are not enabled for this tenant.";
    case "NOT_FOUND":
      return "Sale not found.";
    default:
      return error.message;
  }
}
