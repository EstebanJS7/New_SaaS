/**
 * Shared fiscal-provider boundary for NewSaaS.
 *
 * Extracted from `apps/api` so both the API deployable and the worker
 * deployable consume the SAME port, fake, and sanitizer. Domains depend only on
 * the abstract {@link FiscalProviderPort}; provider details stay behind the
 * boundary.
 */
export {
  FISCAL_PROVIDER,
  FISCAL_PROVIDER_VALUES,
  isRetryableOutcome,
} from "./fiscal-provider.port.js";
export type {
  FiscalIssueLine,
  FiscalIssueOutcome,
  FiscalIssueRequest,
  FiscalIssueResult,
  FiscalProviderId,
  FiscalProviderPort,
} from "./fiscal-provider.port.js";
// Dev/test only; this fake does not implement SIFEN.
export { createFakeFiscalProvider, FakeFiscalProvider } from "./fake-fiscal.provider.js";
export type { FakeFiscalProviderOptions } from "./fake-fiscal.provider.js";
export { sanitizeProviderSnapshot } from "./fiscal-snapshot.sanitizer.js";
export type {
  SanitizeProviderSnapshotOptions,
  SanitizedProviderSnapshot,
} from "./fiscal-snapshot.sanitizer.js";
export { FiscalProviderModule } from "./fiscal-provider.module.js";
