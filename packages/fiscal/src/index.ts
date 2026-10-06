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
// The PKCS#12 test fixture is NOT exported here: test scaffolding is not part of
// the package's public contract. It lives at `@newsaas/fiscal/testing`.
export {
  buildTestPkcs12,
  TEST_PKCS12_PASSWORD,
  TEST_CERTIFICATE_SERIAL,
  TEST_CERTIFICATE_SUBJECT,
  TEST_CERTIFICATE_NOT_BEFORE,
  TEST_CERTIFICATE_NOT_AFTER,
  TEST_KEY_ALGORITHM,
  testCertificateDer,
  testPrivateKeyPkcs8Der,
} from "./signing-material/pkcs12.fixture.js";
export type {
  TestPkcs12Certificate,
  TestPkcs12Options,
} from "./signing-material/pkcs12.fixture.js";
// FISC-008 WU-A: pure typed request -> XML builder for unsigned SIFEN DTEs.
export { buildDteXml } from "./dte/dte.builder.js";
// FISC-008: the CDC's composition and its check digit, both pinned 2026-10-06.
export {
  CDC_CHECK_DIGIT_BASE_MAX,
  CDC_FIELD_WIDTHS,
  composeCdc,
  computeCdcCheckDigit,
} from "./dte/dte.cdc.js";
export type { ComposedCdc, DteCdcFields } from "./dte/dte.cdc.js";
// FISC-008 WU-C: the invoice -> DteRequest mapper, with the profile supplied.
export {
  addDecimals,
  buildDteRequestFromInvoice,
  DTE_IVA_RATES,
  emitterNameForEnvironment,
  scale,
} from "./dte/dte.mapper.js";
export type {
  ConfirmedInvoiceLineSnapshot,
  ConfirmedInvoiceSnapshot,
  DocumentIdentity,
  DteIvaRate,
  DteMappingInput,
  EmitterFiscalProfile,
  MappedDteRequest,
  MappedDteTotals,
} from "./dte/dte.mapper.js";
export { AFEC_IVA_DESCRIPTIONS, AFEC_IVA_VALUES } from "./dte/dte.types.js";
export { DteValidationError, assertValidDteRequest } from "./dte/dte.rules.js";
export type { DteValidationFailure } from "./dte/dte.rules.js";
export {
  DTE_NAMESPACE,
  DTE_XML_VERSION,
  SIFEN_MIN_VALIDITY_DATE,
  SIFEN_TEST_EMITTER_NAME,
  XMLDSIG_NAMESPACE,
} from "./dte/dte.types.js";
export type {
  DteActividadEconomica,
  DteCamposFueraFirma,
  DteCondicionAnticipo,
  DteCondicionTipoCambio,
  DteDatosGeneralesOperacion,
  DteDecimalType,
  DteEmisor,
  DteEnumType,
  DteIntegerType,
  DteNaturalezaReceptor,
  DteObligacionAfectada,
  DteOperacionComercial,
  DteOperationEmission,
  DteReceptor,
  DteRequest,
  DteResponsableEmision,
  DteTimbrado,
  DteTipoContribuyente,
  DteTipoDocumentoElectronico,
  DteTipoDocumentoReceptor,
  DteTipoEmision,
  DteTipoImpuesto,
  DteTipoOperacion,
  DteTipoTransaccion,
  DteXmlElement,
} from "./dte/dte.types.js";
