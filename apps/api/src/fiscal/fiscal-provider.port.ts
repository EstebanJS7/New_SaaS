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

export interface FiscalIssueRequest {
  readonly fiscalDocumentId: string;
  readonly tenantId: string;
  readonly provider: FiscalProviderId;
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

export type FiscalIssueOutcome =
  "APPROVED" | "REJECTED" | "FUNCTIONAL_REJECTION" | "CONFIGURATION_ERROR" | "TRANSIENT_FAILURE";

export interface FiscalIssueResult {
  readonly outcome: FiscalIssueOutcome;
  readonly externalId: string | null;
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

export interface FiscalProviderPort {
  readonly provider: FiscalProviderId;
  issue(request: FiscalIssueRequest): Promise<FiscalIssueResult>;
}

/** DEC-049 makes every outcome except TRANSIENT_FAILURE terminal. */
export function isRetryableOutcome(outcome: FiscalIssueOutcome): boolean {
  return outcome === "TRANSIENT_FAILURE";
}
