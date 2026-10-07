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
// FISC-011 WU-E: the stored rows -> the profile the mapper takes. It does not
// allocate, does not store descriptions and reads no clock or tenant.
export { assembleEmitterProfile, EmitterProfileAssemblyError } from "./timbrado/emitter-profile.js";
export type {
  AllocatedNumber,
  AssembleEmitterProfileArgs,
  EmitterProfileAssemblyFailure,
  StoredActivity,
  StoredEmitterProfile,
  StoredEstablishment,
  StoredTimbradoRange,
} from "./timbrado/emitter-profile.js";
// FISC-011: the descriptions the DE carries beside its enumerated codes. Keyed
// by CODE, never by position — the Manual lists 13 transaction types and the XSD
// enumerates 11 of them, so the third entry of the enum belongs to code 4.
export {
  describeDepartment,
  describeDocumentType,
  describeEmissionType,
  describeTaxType,
  describeTransactionType,
  DTE_DEPARTMENT_NAMES,
  DTE_DOCUMENT_TYPE_DESCRIPTIONS,
  DTE_EMISSION_TYPE_DESCRIPTIONS,
  DTE_TAX_TYPE_DESCRIPTIONS,
  DTE_TRANSACTION_TYPE_DESCRIPTIONS,
  DteCatalogueError,
} from "./dte/dte.catalogues.js";
export type { DteCatalogueFailure, DteCodeDescription } from "./dte/dte.catalogues.js";
// FISC-011: the Manual §10.5 series order, which is a validation and not just a
// sequence — SIFEN refuses a series that is not the previous, the same or the
// next one.
export {
  assertSeriesSuccession,
  assertValidSeries,
  FIRST_SERIES,
  LAST_SERIES,
  nextSeries,
  SERIES_COUNT,
  seriesFromOrdinal,
  seriesOrdinal,
  TimbradoError,
} from "./timbrado/series.js";
export type { TimbradoFailure } from "./timbrado/series.js";
// FISC-011 WU-D: the allocation. It owns no transaction and no Prisma client —
// the caller's transaction client satisfies `TimbradoRangeDelegate` structurally,
// which is what lets the same rules serve the API and the worker. WU-F adds the
// set-once series start the caller that has just signed records.
export {
  ALLOCATION_MAX_ATTEMPTS,
  allocateDocumentNumber,
  assertSeriesStartUsable,
  DOCUMENT_NUMBER_WIDTH,
  formatDocumentNumber,
  MAX_DOCUMENT_NUMBER,
  TimbradoAllocationError,
} from "./timbrado/allocation.js";
export type {
  AllocatedDocumentNumber,
  TimbradoAllocationFailure,
  TimbradoRangeKey,
  TimbradoRangeRecord,
  TimbradoRangeStore,
} from "./timbrado/allocation.js";
// FISC-009: the XMLDSig signer. The profile's constants are exported so a caller
// can assert them without reaching into the module's internals.
export {
  DteSigningError,
  ENVELOPED_TRANSFORM,
  EXCLUSIVE_CANONICALIZATION,
  FORBIDDEN_KEY_INFO_ELEMENTS,
  SIGNATURE_CANONICALIZATION,
  SIGNATURE_DIGEST_METHOD,
  SIGNATURE_METHOD,
  signDteXml,
} from "./dte/dte.signing.js";
export type { DteSigningFailure, SignDteXmlArgs } from "./dte/dte.signing.js";
// FISC-008: the security code's generator, with its randomness injected.
export {
  generateSecurityCode,
  SECURITY_CODE_DIGITS,
  SECURITY_CODE_MAX_ATTEMPTS,
} from "./dte/dte.codseg.js";
export type { GeneratedSecurityCode, GenerateSecurityCodeArgs } from "./dte/dte.codseg.js";
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
