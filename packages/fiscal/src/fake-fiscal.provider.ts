import type { FiscalProviderId } from "./fiscal-provider.port.js";
import type {
  FiscalIssueOutcome,
  FiscalIssueRequest,
  FiscalIssueResult,
  FiscalProviderPort,
} from "./fiscal-provider.port.js";

export interface FakeFiscalProviderOptions {
  readonly outcomes?: readonly FiscalIssueOutcome[];
  readonly externalIdPrefix?: string;
  readonly clock?: () => Date;
}

/** Deterministic provider fake for development and tests; it does not implement SIFEN. */
export class FakeFiscalProvider implements FiscalProviderPort {
  readonly provider: FiscalProviderId = "FAKE";
  private calls = 0;
  private readonly outcomes: readonly FiscalIssueOutcome[];
  private readonly externalIdPrefix: string;
  private readonly clock: () => Date;

  constructor(options: FakeFiscalProviderOptions = {}) {
    this.outcomes = options.outcomes?.length ? options.outcomes : ["APPROVED"];
    this.externalIdPrefix = options.externalIdPrefix ?? "fake";
    this.clock = options.clock ?? (() => new Date());
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
    const retryAfterMs = transient ? 1_000 : null;
    // PRD §23 forbids inventing SIFEN XML, signatures, or protocol artefacts from memory.
    return Promise.resolve({
      outcome,
      externalId,
      cdc: null,
      reasonCode,
      reason: reasonCode === null ? null : `Simulated ${outcome.toLowerCase()}`,
      retryAfterMs,
      providerRequest: { kind: "fake", outcome },
      providerResponse: { kind: "fake", outcome, externalId, reasonCode, retryAfterMs },
      resolvedAt: this.clock().toISOString(),
    });
  }
}

export function createFakeFiscalProvider(options?: FakeFiscalProviderOptions): FakeFiscalProvider {
  return new FakeFiscalProvider(options);
}
