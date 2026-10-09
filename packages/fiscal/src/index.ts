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
  FiscalQueryOutcome,
  FiscalQueryRequest,
  FiscalQueryResult,
  FiscalIssueDocument,
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
export type { FiscalProviderModuleOptions } from "./fiscal-provider.module.js";
// FISC-010 WU-C / ADR-008 §2: the credential boundary the transport reads per
// call. The port lives here; its implementation lands in the worker (FISC-012),
// because `packages/fiscal` must not depend on Prisma or `@newsaas/secret-store`.
// `createNullFiscalCredentialPort` is the fail-closed default `forRoot()` wires.
export {
  createNullFiscalCredentialPort,
  FISCAL_CREDENTIAL_PORT,
  isCredentialFresh,
} from "./fiscal-credential.port.js";
export type {
  FiscalCredentialPort,
  FiscalSigningEnvironment,
  FiscalTransportCredential,
} from "./fiscal-credential.port.js";
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
// FISC-011 WU-G: the RUC the signing certificate carries. Baseline §22.4's
// `D101` obligation is only checkable where the certificate actually holds the
// RUC, and baseline §6 pins that placement per taxpayer type.
export {
  CERTIFICATE_RUC_LITERAL,
  CERTIFICATE_RUC_SUBJECT_ATTRIBUTE,
  CertificateRucError,
  certificateRucMatches,
  parseCertificateRucToken,
  readCertificateRuc,
  readRucFromSubject,
  readRucFromSubjectAlternativeName,
} from "./signing-material/certificate-ruc.js";
export type { CertificateRuc, CertificateRucFailure } from "./signing-material/certificate-ruc.js";
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
// FISC-012 WU-C / baseline §24: the QR. Its composition, its two consultation
// addresses, and the placeholder the unsigned DE carries in `dCarQR` — the QR
// depends on the signature's digest, and `gCamFuFD` sits outside the signed
// subtree, so `fillQrContent` is the one replacement and it cannot break the
// signature. The CSC stays an input and never enters the returned URL.
export {
  buildQrContent,
  DteQrError,
  fillQrContent,
  QR_CONSULTATION_URLS,
  QR_CONTENT_MAX_LENGTH,
  QR_CONTENT_MIN_LENGTH,
  QR_PLACEHOLDER,
} from "./dte/dte.qr.js";
export type { BuildQrContentArgs, DteQrFailure, FillQrContentArgs } from "./dte/dte.qr.js";
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
// FISC-010 WU-B: the pure message layer of the SIFEN web services — the six
// services' shapes, their serializers and parsers, and the result-code tables.
// No I/O, no clock, no filesystem: the transport and the credential port are
// WU-C's, the facade and the outcome mapping are WU-E's.
//
// The result codes first, because they are the vocabulary the other three
// speak: `dEstRes`'s three published values, the batch reception's 0300/0301,
// the batch query's 0360-0364, and Tabla G/H's 0420-0422 and 0500-0502. Every
// descriptor is total and answers `unknown` carrying the raw code, because §23.8
// records that no retrieved source enumerates the dCodRes catalogue.
export {
  describeBatchQuery,
  describeBatchReception,
  describeCdcQuery,
  describeDeStatus,
  describeRucQuery,
  SIFEN_BATCH_POLL_INTERVAL_MS,
  SIFEN_BATCH_QUERY_CODES,
  SIFEN_BATCH_QUERY_WINDOW_MS,
  SIFEN_BATCH_RECEPTION_CODES,
  SIFEN_CDC_QUERY_CODES,
  SIFEN_DE_STATUS_OUTCOMES,
  SIFEN_RUC_QUERY_CODES,
} from "./sifen/sifen.codes.js";
export type {
  SifenBatchQueryDescriptor,
  SifenBatchQueryOutcome,
  SifenBatchReceptionDescriptor,
  SifenBatchReceptionOutcome,
  SifenDeStatusDescriptor,
  SifenDeStatusOutcome,
  SifenEstadoResultado,
  SifenLookupDescriptor,
  SifenLookupOutcome,
} from "./sifen/sifen.codes.js";
// The six shapes and the constants that pin them: the namespaces, the envelope's
// element names, and every published field domain the serializer writes and the
// parser validates.
export {
  SIFEN_BASE64_PATTERN,
  SIFEN_BATCH_NUMBER_MAX_DIGITS,
  SIFEN_BATCH_NUMBER_PATTERN,
  SIFEN_BATCH_PROTOCOL_NUMBER_PATTERN,
  SIFEN_BATCH_QUERY_MAX_CODES,
  SIFEN_BATCH_QUERY_MAX_RESULTS,
  SIFEN_CDC_LENGTH,
  SIFEN_CDC_PATTERN,
  SIFEN_EVENT_MAX_CODES,
  SIFEN_EVENT_MAX_RESULTS,
  SIFEN_EVENT_MIN_RESULTS,
  SIFEN_ID_PATTERN,
  SIFEN_MAX_ID_DIGITS,
  SIFEN_NAMESPACE,
  SIFEN_PROTOCOL_NUMBER_PATTERN,
  SIFEN_RECEPTION_MAX_CODES,
  SIFEN_RESULT_CODE_PATTERN,
  SIFEN_RESULT_CODE_WIDTH,
  SIFEN_RESULT_MESSAGE_MAX_LENGTH,
  SIFEN_RUC_ELECTRONIC_VALUES,
  SIFEN_RUC_MAX_LENGTH,
  SIFEN_RUC_MIN_LENGTH,
  SIFEN_RUC_NAME_MAX_LENGTH,
  SIFEN_RUC_PATTERN,
  SIFEN_RUC_STATE_CODE_LENGTH,
  SIFEN_RUC_STATE_DESCRIPTION_MAX_LENGTH,
  SIFEN_SOAP_BODY,
  SIFEN_SOAP_ENVELOPE,
  SIFEN_SOAP_HEADER,
  SOAP_ENVELOPE_NAMESPACE,
} from "./sifen/sifen.messages.js";
export type {
  SifenBatchQueryDeResult,
  SifenBatchQueryRequest,
  SifenBatchQueryResponse,
  SifenBatchQueryResultGroup,
  SifenBatchReceptionRequest,
  SifenBatchReceptionResponse,
  SifenCdcQueryRequest,
  SifenCdcQueryResponse,
  SifenDeContent,
  SifenEventReceptionRequest,
  SifenEventReceptionResponse,
  SifenEventResult,
  SifenProcessingProtocol,
  SifenProcessingResultGroup,
  SifenReceptionRequest,
  SifenReceptionResponse,
  SifenRucElectronicFlag,
  SifenRucQueryRequest,
  SifenRucQueryResponse,
  SifenRucStatus,
} from "./sifen/sifen.messages.js";
// The serializers. One function per service, plus the batch container; the two
// things §23.8 leaves unpinned (the ZIP entry's name and the container's
// namespace) are single constants a homologation run can flip.
export {
  buildBatchContainer,
  serializeBatchQuery,
  serializeBatchReception,
  serializeCdcQuery,
  serializeEventReception,
  serializeReception,
  serializeRucQuery,
  SIFEN_BATCH_CONTAINER_NAMESPACE,
  SIFEN_BATCH_MAX_DOCUMENTS,
  SIFEN_MAX_REQUEST_BYTES,
  SIFEN_ZIP_ENTRY_NAME,
  SifenSerializationError,
} from "./sifen/sifen.serializer.js";
export type { SifenSerializationFailure } from "./sifen/sifen.serializer.js";
// The parsers, with ADR-008's guardrails: the size cap and the DOCTYPE refusal
// run before the parse, no value is coerced, and the reader builds its result
// field by field.
export {
  parseBatchQueryResponse,
  parseBatchReceptionResponse,
  parseCdcQueryResponse,
  parseEventReceptionResponse,
  parseReceptionResponse,
  parseRucQueryResponse,
  SIFEN_MAX_NESTED_TAGS,
  SIFEN_MAX_RESPONSE_BYTES,
  SifenParseError,
} from "./sifen/sifen.parser.js";
export type { SifenParseFailure } from "./sifen/sifen.parser.js";
// FISC-010 WU-C / ADR-008 §1: the transport. SOAP 1.2 Document/Literal over
// `node:https` with a per-call mutual-TLS configuration, `agent: false` on every
// request, no redirect followed, the response bounded while it is read, and a
// typed failure for every way a call can end badly. The local TLS double that
// proves it is test scaffolding and lives at `@newsaas/fiscal/testing`.
export {
  classifySocketFailure,
  sendSifenRequest,
  SIFEN_DEFAULT_TIMEOUT_MS,
  SIFEN_ENVIRONMENT_HOSTS,
  SIFEN_SOAP_CONTENT_TYPE,
  SIFEN_TLS_MIN_VERSION,
  SifenTransportError,
  sifenBaseUrl,
} from "./sifen/sifen.transport.js";
export type {
  SendSifenRequestArgs,
  SifenTransportFailure,
  SifenTransportResponse,
} from "./sifen/sifen.transport.js";
// FISC-010 WU-E / baseline §8: the service facade. One typed method per
// implemented service, each bound to the endpoint the Manual's table publishes,
// and no endpoint string written anywhere else in the package. Every call reads
// the tenant's credential, builds its envelope, posts it and parses the answer,
// in that order; a null credential read is a typed `CREDENTIAL_UNAVAILABLE` and
// the transport's and the parser's failures travel out unchanged.
export {
  createSifenServiceFacade,
  SIFEN_SERVICE_PATHS,
  SifenFacadeError,
} from "./sifen/sifen.facade.js";
export type {
  SifenFacadeDependencies,
  SifenFacadeFailure,
  SifenServiceFacade,
} from "./sifen/sifen.facade.js";
// FISC-010 WU-E / ADR-007: the pure outcome mapping from a parsed SIFEN answer
// onto the port's vocabulary. No I/O and no clock — `resolvedAt` arrives in the
// context, the raw snapshots are only echoed (the Fiscal boundary sanitizes
// them), and every field of the result is set, with `null` where the answer is
// silent. The `SIFEN_*_REASON` strings are client-authored notes, not protocol
// constants.
export {
  mapBatchQueryOutcome,
  mapBatchReceptionOutcome,
  mapCdcQueryOutcome,
  mapReceptionOutcome,
  mapRucQueryOutcome,
  SIFEN_BATCH_CONCLUDED_WITHOUT_RESULTS_REASON,
  SIFEN_BATCH_RECEPTION_MESSAGE_ABSENT_REASON,
  SIFEN_BATCH_WINDOW_CLOSED_REASON,
  SIFEN_OBSERVATION_UNSTATED_REASON,
  SIFEN_RECEPTION_FATE_ABSENT_REASON,
  SIFEN_RECEPTION_MESSAGE_ABSENT_REASON,
} from "./sifen/sifen.outcomes.js";
export type { SifenOutcomeContext, SifenRucQueryOutcome } from "./sifen/sifen.outcomes.js";
