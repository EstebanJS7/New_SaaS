import type { FiscalProviderId } from "./fiscal-provider.port.js";
import type {
  FiscalCancelOutcome,
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalIssueOutcome,
  FiscalIssueRequest,
  FiscalIssueResult,
  FiscalProviderPort,
  FiscalQueryOutcome,
  FiscalQueryRequest,
  FiscalQueryResult,
} from "./fiscal-provider.port.js";

export interface FakeFiscalProviderOptions {
  readonly outcomes?: readonly FiscalIssueOutcome[];
  /**
   * The ordered answers {@link FakeFiscalProvider.query} returns; the last entry
   * repeats. It is a scripted outcome and simulates no protocol detail (DEC-048):
   * the adapter decides which service to ask, and the fake only decides what
   * comes back.
   */
  readonly queryOutcomes?: readonly FiscalQueryOutcome[];
  readonly cancelOutcomes?: readonly FiscalCancelOutcome[];
  readonly externalIdPrefix?: string;
  /**
   * Prefix of the operation handle a scripted `SUBMITTED` answer returns,
   * in the style of {@link FakeFiscalProviderOptions.externalIdPrefix}.
   */
  readonly providerReferencePrefix?: string;
  /**
   * The retry hint a scripted `PROCESSING` answer carries.
   *
   * Omitted (or null), `PROCESSING` carries none. Supplied, only `PROCESSING`
   * carries it: a transient failure keeps its own fixed hint and every other
   * answer is not a "keep waiting" answer at all. The value is **not** a protocol
   * constant — the provider's polling cadence and the reconciliation bound belong
   * to the adapter and to the outcome mapping, and this is the knob that lets
   * their tests exercise the bound before a real provider exists (ADR-007 §5,
   * guardrail 5).
   */
  readonly queryRetryAfterMs?: number;
  readonly clock?: () => Date;
}

/** Deterministic provider fake for development and tests; it does not implement SIFEN. */
export class FakeFiscalProvider implements FiscalProviderPort {
  readonly provider: FiscalProviderId = "FAKE";
  /**
   * The fake submits nothing, so it needs no document (ADR-009): a demo tenant
   * without an emitter profile must stay issuable in development.
   */
  readonly requiresSignedDocument = false;
  private calls = 0;
  private queryCalls = 0;
  private cancelCalls = 0;
  private readonly outcomes: readonly FiscalIssueOutcome[];
  private readonly queryOutcomes: readonly FiscalQueryOutcome[];
  private readonly cancelOutcomes: readonly FiscalCancelOutcome[];
  private readonly externalIdPrefix: string;
  private readonly providerReferencePrefix: string;
  private readonly queryRetryAfterMs: number | null;
  private readonly clock: () => Date;

  constructor(options: FakeFiscalProviderOptions = {}) {
    this.outcomes = options.outcomes?.length ? options.outcomes : ["APPROVED"];
    this.queryOutcomes = options.queryOutcomes?.length ? options.queryOutcomes : ["APPROVED"];
    this.cancelOutcomes = options.cancelOutcomes?.length ? options.cancelOutcomes : ["CANCELLED"];
    this.externalIdPrefix = options.externalIdPrefix ?? "fake";
    this.providerReferencePrefix = options.providerReferencePrefix ?? "fake-ref";
    this.queryRetryAfterMs = options.queryRetryAfterMs ?? null;
    this.clock = options.clock ?? (() => new Date());
  }

  cancel(_request: FiscalCancelRequest): Promise<FiscalCancelResult> {
    this.cancelCalls += 1;
    const outcome =
      this.cancelOutcomes[Math.min(this.cancelCalls - 1, this.cancelOutcomes.length - 1)];
    const hasReason =
      outcome === "REJECTED" ||
      outcome === "CONFIGURATION_ERROR" ||
      outcome === "TRANSIENT_FAILURE";
    const reasonCode = hasReason ? `FAKE_${outcome}` : null;
    const retryAfterMs = outcome === "TRANSIENT_FAILURE" ? 1_000 : null;
    return Promise.resolve({
      outcome,
      reasonCode,
      reason: reasonCode === null ? null : `Simulated ${outcome.toLowerCase()}`,
      retryAfterMs,
      providerRequest: { kind: "fake", outcome },
      providerResponse: { kind: "fake", outcome, reasonCode, retryAfterMs },
      resolvedAt: this.clock().toISOString(),
    });
  }

  issue(_request: FiscalIssueRequest): Promise<FiscalIssueResult> {
    this.calls += 1;
    const index = this.calls;
    const outcome = this.outcomes[Math.min(index - 1, this.outcomes.length - 1)];
    const approved = outcome === "APPROVED";
    const transient = outcome === "TRANSIENT_FAILURE";
    const reasonCode =
      outcome === "REJECTED"
        ? "FAKE_REJECTED"
        : outcome === "FUNCTIONAL_REJECTION"
          ? "FAKE_FUNCTIONAL_REJECTION"
          : outcome === "CONFIGURATION_ERROR"
            ? "FAKE_CONFIGURATION_ERROR"
            : null;
    const externalId = approved ? `${this.externalIdPrefix}-${index}` : null;
    // ADR-007 §2: the handle is what the reconciliation path polls with, so a
    // scripted `SUBMITTED` answer without one would make the contract
    // untestable before a real provider exists — which is what the fake is for.
    const providerReference =
      outcome === "SUBMITTED" ? `${this.providerReferencePrefix}-${index}` : null;
    const retryAfterMs = transient ? 1_000 : null;
    // PRD §23 forbids inventing SIFEN XML, signatures, or protocol artefacts from memory.
    return Promise.resolve({
      outcome,
      externalId,
      providerReference,
      cdc: null,
      reasonCode,
      reason: reasonCode === null ? null : `Simulated ${outcome.toLowerCase()}`,
      retryAfterMs,
      providerRequest: { kind: "fake", outcome },
      providerResponse: { kind: "fake", outcome, externalId, providerReference, reasonCode },
      resolvedAt: this.clock().toISOString(),
    });
  }

  /**
   * The scripted answer to "what happened to the document I handed over?".
   *
   * It carries the same shape as {@link issue}: the ordered script with its last
   * entry repeating, the `FAKE_*` reason-code style, and `retryAfterMs` only for
   * a transient failure — plus, for `PROCESSING` only, the hint the
   * {@link FakeFiscalProviderOptions.queryRetryAfterMs} option supplies. Without
   * that option a `PROCESSING` answer carries no hint, because the polling
   * cadence is a protocol constant the adapter owns (baseline §23 records the ten
   * minutes) and the fake simulates no protocol detail (DEC-048). `SUBMITTED` on
   * the issuance side is not a query outcome — an unresolved document is
   * `PROCESSING` here.
   *
   * The answer's `cdc` is the request's own CDC when it carried one, and a
   * deterministic synthetic one when a **resolved** answer was asked with only a
   * reference. That second case is not decoration: the whole point of ADR-007
   * §2's CDC-only recovery is that the provider tells us the identity we could
   * not record, so a fake that could only echo would leave the path
   * unexercisable before a real provider exists.
   *
   * **Only a resolved answer carries it.** `PROCESSING`, a transient failure and
   * a configuration error identify no document — even when the question carried a
   * CDC — so echoing it there would report an identity the answer never
   * confirmed, which is exactly what `FiscalQueryResult.cdc`'s contract forbids.
   */
  query(request: FiscalQueryRequest): Promise<FiscalQueryResult> {
    this.queryCalls += 1;
    const index = this.queryCalls;
    const outcome = this.queryOutcomes[Math.min(index - 1, this.queryOutcomes.length - 1)];
    const reasonCode = queryReasonCode(outcome);
    const externalId = outcome === "APPROVED" ? `${this.externalIdPrefix}-${index}` : null;
    const resolved =
      outcome === "APPROVED" || outcome === "REJECTED" || outcome === "FUNCTIONAL_REJECTION";
    const cdc = resolved ? (request.cdc ?? `${this.externalIdPrefix}-cdc-${index}`) : null;
    const retryAfterMs =
      outcome === "TRANSIENT_FAILURE"
        ? 1_000
        : outcome === "PROCESSING"
          ? this.queryRetryAfterMs
          : null;
    return Promise.resolve({
      outcome,
      cdc,
      externalId,
      reasonCode,
      reason: reasonCode === null ? null : `Simulated ${outcome.toLowerCase()}`,
      retryAfterMs,
      providerRequest: { kind: "fake", outcome },
      providerResponse: { kind: "fake", outcome, cdc, externalId, reasonCode, retryAfterMs },
      resolvedAt: this.clock().toISOString(),
    });
  }
}

/**
 * `PROCESSING` and `APPROVED` are answers, not failures, so they carry no code;
 * every other query outcome does, in the `FAKE_*` style the other capabilities
 * already use for a scripted failure.
 */
function queryReasonCode(outcome: FiscalQueryOutcome): string | null {
  switch (outcome) {
    case "APPROVED":
    case "PROCESSING":
      return null;
    case "REJECTED":
      return "FAKE_REJECTED";
    case "FUNCTIONAL_REJECTION":
      return "FAKE_FUNCTIONAL_REJECTION";
    case "CONFIGURATION_ERROR":
      return "FAKE_CONFIGURATION_ERROR";
    case "TRANSIENT_FAILURE":
      return "FAKE_TRANSIENT_FAILURE";
  }
}

export function createFakeFiscalProvider(options?: FakeFiscalProviderOptions): FakeFiscalProvider {
  return new FakeFiscalProvider(options);
}
