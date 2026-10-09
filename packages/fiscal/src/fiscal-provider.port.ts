/**
 * Consumers inject this token and depend on the port, never a concrete
 * implementation.
 */
export const FISCAL_PROVIDER = Symbol("FISCAL_PROVIDER");

/**
 * The provider vocabulary, declared by the boundary that owns it.
 *
 * A port must not depend on the persistence layer's generated types, so this is
 * a local frozen literal union rather than the Prisma enum — the same shape
 * `billing.zod.ts` uses for `INVOICE_STATUS_VALUES`. The values are identical to
 * the `fiscal_provider` enum FISC-002 applied, and any drift surfaces as a type
 * error at the mapping site where a Fiscal service assigns one to a
 * `FiscalDocument.provider` field (FISC-004), which is the guard that matters.
 */
export const FISCAL_PROVIDER_VALUES = Object.freeze([
  "THIRD_PARTY",
  "SIFEN_DIRECT",
  "FAKE",
] as const);

export type FiscalProviderId = (typeof FISCAL_PROVIDER_VALUES)[number];

export interface FiscalIssueLine {
  readonly description: string;
  /** Decimal string; numbers never cross the Fiscal provider boundary. */
  readonly quantity: string;
  /** Decimal string; numbers never cross the Fiscal provider boundary. */
  readonly unitPrice: string;
  readonly rateCode: string;
  /** Decimal string; numbers never cross the Fiscal provider boundary. */
  readonly taxableBase: string;
  /** Decimal string; numbers never cross the Fiscal provider boundary. */
  readonly taxAmount: string;
  /** Decimal string; numbers never cross the Fiscal provider boundary. */
  readonly lineTotal: string;
}

/**
 * The document a caller built and signed, as the provider will submit it.
 *
 * ADR-009 puts the document in the request because the two facts that make it
 * necessary meet here: the port's request carries **invoice data** while a real
 * provider submits a **signed document**, and the caller is the side that can
 * build and sign one — the emitter profile, the timbrado and the allocation
 * live in PostgreSQL, and `packages/fiscal` deliberately depends on neither
 * Prisma nor `@newsaas/database`. The port therefore carries bytes and an
 * identity; it never learns what kind of document they are, and the adapter
 * stays the only side that knows (ADR-009, ADR-007 §6).
 *
 * The bytes are passed through unchanged: a provider that re-serialized them
 * would invalidate the signature it was handed.
 */
export interface FiscalIssueDocument {
  /** The CDC, which the signature's reference also carries. */
  readonly cdc: string;
  /** The signed DE, with its QR already filled. */
  readonly signedXml: string;
}

export interface FiscalIssueRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  /**
   * The signed document, or `null` when the provider does not require one.
   *
   * Required rather than optional (ADR-009): an optional field lets a caller
   * forget it, and the provider that needs the document would then have to
   * decide what a missing field means. `null` is the caller's explicit
   * statement that the provider it selected answers
   * {@link FiscalProviderPort.requiresSignedDocument} with `false`.
   */
  readonly document: FiscalIssueDocument | null;
  readonly invoice: {
    readonly series: string;
    readonly number: number;
    readonly currency: string;
    readonly issuedAt: string;
  };
  readonly lines: readonly FiscalIssueLine[];
  readonly totals: {
    /** Decimal string; numbers never cross the Fiscal provider boundary. */
    readonly taxableBase: string;
    /** Decimal string; numbers never cross the Fiscal provider boundary. */
    readonly taxAmount: string;
    /** Decimal string; numbers never cross the Fiscal provider boundary. */
    readonly total: string;
  };
}

/**
 * The outcomes of one issuance attempt.
 *
 * `SUBMITTED` is the non-terminal member ADR-007 §1 adds: the provider accepted
 * the document into its processing queue and the document's fate is learned
 * later, through {@link FiscalProviderPort.query}. It **amends** DEC-049's
 * "every outcome except `TRANSIENT_FAILURE` is terminal" instead of quietly
 * contradicting it — so a reader who still holds that rule must read it as
 * "...is terminal, except `TRANSIENT_FAILURE` and `SUBMITTED`".
 *
 * `SUBMITTED` is not a failure and must never be retried: handing the document
 * over succeeded, and resubmitting one the provider already holds is the
 * duplicate send its own operational rules punish. That is why
 * {@link isRetryableOutcome} still answers `TRANSIENT_FAILURE` and nothing else.
 */
export type FiscalIssueOutcome =
  | "APPROVED"
  | "REJECTED"
  | "FUNCTIONAL_REJECTION"
  | "SUBMITTED"
  | "CONFIGURATION_ERROR"
  | "TRANSIENT_FAILURE";

export interface FiscalIssueResult {
  readonly outcome: FiscalIssueOutcome;
  readonly externalId: string | null;
  /**
   * The provider's handle for **the operation**, not for the document.
   *
   * It is deliberately not {@link FiscalIssueResult.externalId}: that one is the
   * provider's reference for the _document_, which for an authorization protocol
   * is known only once the document resolves, while this one is issued at
   * hand-over time for the _operation_ that carried it — and one operation may
   * carry many documents. It is what a later {@link FiscalProviderPort.query}
   * polls with, so it must outlive the worker process that received it rather
   * than live in memory (ADR-007 §2, §4).
   *
   * `null` when the answer already carries the document's own fate, and for a
   * provider that resolves synchronously and has no operation handle to give.
   */
  readonly providerReference: string | null;
  readonly cdc: string | null;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
  /** RAW provider request; the Fiscal boundary must sanitize it before persistence. */
  readonly providerRequest: unknown;
  /** RAW provider response; the Fiscal boundary must sanitize it before persistence. */
  readonly providerResponse: unknown;
  readonly resolvedAt: string;
}

/**
 * The outcomes of a query about a document the provider has not resolved yet.
 *
 * `PROCESSING` is deliberately **not** called `PENDING`: `PENDING` is already a
 * `fiscal_document_status` meaning "no submission has been attempted", and using
 * the same word for "submitted and waiting" would make every later conversation
 * about a document ambiguous (ADR-007 §1).
 */
export type FiscalQueryOutcome =
  | "APPROVED"
  | "REJECTED"
  | "FUNCTIONAL_REJECTION"
  | "PROCESSING"
  | "CONFIGURATION_ERROR"
  | "TRANSIENT_FAILURE";

/**
 * What the caller knows about the document it is asking about.
 *
 * Both identities travel because either one may be the only one available:
 * {@link FiscalQueryRequest.providerReference} is missing when the hand-over
 * answer never arrived, and the document's own identity
 * ({@link FiscalQueryRequest.cdc}) survives that loss. A port that required the
 * handle would make the lost-response case unresolvable, which is the case the
 * provider's own recovery guidance exists for (ADR-007 §2). Deciding which of
 * the two to ask with is the adapter's, not the port's.
 */
export interface FiscalQueryRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  /** The document's identity; the fallback when the handle was never received. */
  readonly cdc: string | null;
  readonly externalId: string | null;
  /** The operation's handle from {@link FiscalIssueResult}; may be null. */
  readonly providerReference: string | null;
  /**
   * Optional abort signal. The caller has already enforced a deadline, so an
   * adapter that can abandon the provider call should do so when this fires;
   * an adapter that ignores it still gets a bounded caller.
   */
  readonly signal?: AbortSignal;
}

/**
 * A query's answer. It **may not resolve anything**: `PROCESSING` is a
 * legitimate, expected answer and not a failure, so an unresolved document stays
 * `SUBMITTED` — only a terminal resolution moves it (ADR-007 §5).
 */
export interface FiscalQueryResult {
  readonly outcome: FiscalQueryOutcome;
  /**
   * The document's CDC **as the provider knows it**, or `null` when the answer
   * does not identify a document.
   *
   * It is here because ADR-007 §2 makes the CDC the query's own fallback
   * identifier — "the query is identified by whatever the document has: the
   * reference if it was received, and the CDC regardless" — and the Guide's
   * recovery rule is to ask with a CDC that was sent. An answer that could not
   * return the CDC would leave that path unable to persist the identity it just
   * learned, which is the one thing the lost-hand-over case needs.
   */
  readonly cdc: string | null;
  readonly externalId: string | null;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
  /** RAW provider request; the Fiscal boundary must sanitize it before persistence. */
  readonly providerRequest: unknown;
  /** RAW provider response; the Fiscal boundary must sanitize it before persistence. */
  readonly providerResponse: unknown;
  readonly resolvedAt: string;
}

/** Request to cancel a provider document using its provider identity and reason. */
export interface FiscalCancelRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
  readonly reason: string;
  readonly externalId: string | null;
  readonly cdc: string | null;
  /**
   * Optional abort signal. The caller has already enforced a deadline, so an
   * adapter that can abandon the provider call should do so when this fires;
   * an adapter that ignores it still gets a bounded caller, because the Fiscal
   * command races the call against its own deadline.
   */
  readonly signal?: AbortSignal;
}

/** Outcomes a provider can produce while cancelling a fiscal document. */
export type FiscalCancelOutcome =
  "CANCELLED" | "CANCEL_PENDING" | "REJECTED" | "CONFIGURATION_ERROR" | "TRANSIENT_FAILURE";

/**
 * Cancellation result. Raw provider payloads must be sanitized by the Fiscal
 * boundary before persistence.
 */
export interface FiscalCancelResult {
  readonly outcome: FiscalCancelOutcome;
  readonly reasonCode: string | null;
  readonly reason: string | null;
  readonly retryAfterMs: number | null;
  /** RAW provider request; sanitize at the Fiscal boundary before persistence. */
  readonly providerRequest: unknown;
  /** RAW provider response; sanitize at the Fiscal boundary before persistence. */
  readonly providerResponse: unknown;
  readonly resolvedAt: string;
}

export interface FiscalProviderPort {
  readonly provider: FiscalProviderId;
  /**
   * Whether this provider needs the caller's built document to issue.
   *
   * The contract both sides read: a provider whose flag is `true` and that is
   * handed `document: null` answers `CONFIGURATION_ERROR` and **never**
   * submits or throws. `CONFIGURATION_ERROR` is terminal and non-retryable
   * (DEC-049), so a caller that skipped the document stage gets an
   * operator-readable row instead of a retry loop (ADR-009 §3).
   */
  readonly requiresSignedDocument: boolean;
  issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>;
  /**
   * Asks what happened to a document the provider has not resolved yet.
   *
   * The name is the provider family's own word for this kind of service, and it
   * is honest about the answer: a query may not resolve anything. It is not
   * called `resolve` (which would claim an outcome the provider may not have) nor
   * `poll` (which would name a mechanism, when the port must not care whether the
   * adapter asks once, waits, or is told), and it learns nothing about any
   * provider's protocol, host, service name or result codes (ADR-007 §3, §6).
   */
  query(request: FiscalQueryRequest): Promise<FiscalQueryResult>;
  /** DEC-048 assigns both capabilities to the epic; FISC-003 deferred cancel to its flow-owning slice. */
  cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;
}

/**
 * DEC-049 makes every outcome except TRANSIENT_FAILURE terminal.
 *
 * ADR-007 §1 amends that rule: `SUBMITTED` is a successful, **non-terminal**,
 * **non-retryable** hand-over, so this predicate keeps answering only
 * `TRANSIENT_FAILURE` — and a BullMQ retry after a hand-over that worked is
 * exactly the duplicate submission the provider's rules punish.
 */
export function isRetryableOutcome(outcome: FiscalIssueOutcome | FiscalCancelOutcome): boolean {
  return outcome === "TRANSIENT_FAILURE";
}
