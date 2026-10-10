import type { FiscalIssueDocument } from "@newsaas/fiscal";

/**
 * FISC-012 WU-D2 / DEC-056: the stage's seam onto the document assembly.
 *
 * The worker's document stage knows how to claim a fiscal document, store what
 * it is given and submit it; it does **not** know how to build a DE. The
 * assembly — the emitter profile, the allocation, the receptor, each line's tax
 * treatment, the CSC — needs product decisions that are not modelled yet and
 * that [[FISC-015]] owns, and a guessed document is worse than no document: a
 * wrong `iAfecIVA` misstates a tax treatment and a wrong range key emits a
 * `dEst`/`dPunExp` the emitter is not authorised for.
 *
 * So the assembly is injected behind this seam and **fails closed**: the
 * default builder answers `UNAVAILABLE` with a named reason, the stage maps that
 * to a terminal `ERROR` row, and nothing is submitted. [[FISC-015]] replaces
 * the provider at the composition root; the stage does not change.
 *
 * `build` returns an outcome rather than throwing because "this deployment has
 * no assembly" is a configuration state, not an exception — the stage records
 * it as `CONFIGURATION_ERROR`, which [[DEC-049]] makes terminal and
 * non-retryable, so the document reaches an operator instead of a retry loop.
 * The real builder reads `FISCAL_CREDENTIAL_PORT` per call for the signature,
 * the same read that authenticates the transport later (ADR-008 §2).
 */

/** The injection token the worker's composition root provides and FISC-015 overrides. */
export const FISCAL_DOCUMENT_BUILDER = Symbol("FISCAL_DOCUMENT_BUILDER");

export interface FiscalDocumentBuildRequest {
  readonly tenantId: string;
  readonly fiscalDocumentId: string;
}

/**
 * The two answers a builder can give.
 *
 * A builder never returns a partial document: `BUILT` carries the signed
 * document exactly as the provider will receive it ([[ADR-009]]), and anything
 * the builder cannot produce is `UNAVAILABLE` with a named reason a human can
 * act on. No secret material belongs in either field; the reason is written to
 * `fiscal_document.last_error_code`/`last_error_message`.
 */
export type FiscalDocumentBuildOutcome =
  | {
      readonly outcome: "BUILT";
      readonly document: FiscalIssueDocument;
    }
  | {
      readonly outcome: "UNAVAILABLE";
      readonly reasonCode: string;
      readonly reason: string;
    };

export interface FiscalDocumentBuilder {
  build(request: FiscalDocumentBuildRequest): Promise<FiscalDocumentBuildOutcome>;
}

/**
 * The fail-closed default: nothing is built, and the reason names the story
 * that will build it.
 *
 * `FiscalProviderModule`'s null credential port is the same shape one layer
 * down: a deployment that has not wired the real implementation refuses the
 * operation with a typed, operator-readable answer instead of throwing at boot
 * or submitting something invented.
 */
export function createUnavailableFiscalDocumentBuilder(): FiscalDocumentBuilder {
  return {
    build: () =>
      Promise.resolve({
        outcome: "UNAVAILABLE",
        reasonCode: "DOCUMENT_ASSEMBLY_UNAVAILABLE",
        reason:
          "The document assembly is not implemented in this deployment (FISC-015); no document was built and nothing was submitted.",
      }),
  };
}
