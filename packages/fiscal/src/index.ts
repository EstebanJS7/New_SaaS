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
  FiscalCancelOutcome,
  FiscalCancelRequest,
  FiscalCancelResult,
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
// The queue contract lives here because both deployables share it.
// Export the identity helper so the producer and recovery sweep cannot disagree about job identity.
export {
  FISCAL_SUBMISSION_BACKOFF_DELAY_MS,
  FISCAL_SUBMISSION_JOB,
  FISCAL_SUBMISSION_MAX_ATTEMPTS,
  FISCAL_SUBMISSION_QUEUE,
  fiscalSubmissionJobId,
  fiscalSubmissionJobOptions,
} from "./fiscal-submission.queue.js";
export type { FiscalSubmissionJob } from "./fiscal-submission.queue.js";
// FISC-007: the PKCS#12 boundary that turns a PSC artifact into the certificate
// and the RESTRICTED private key the secret store persists.
export {
  extractSigningMaterial,
  MINIMUM_RSA_MODULUS_BITS,
  PKCS12_CERT_BAG_ID,
  PKCS12_KEY_BAG_ID,
  PKCS12_SHROUDED_KEY_BAG_ID,
  Pkcs12ExtractionError,
  X509_CERTIFICATE_CERT_ID,
} from "./signing-material/pkcs12.js";
export type {
  ExtractSigningMaterialArgs,
  ExtractedSigningMaterial,
  Pkcs12ExtractionFailure,
} from "./signing-material/pkcs12.js";
