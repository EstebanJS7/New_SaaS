/**
 * Test-only entry point for the Fiscal package.
 *
 * Separated from the package index on purpose: the signing-material fixture
 * carries throwaway key material, and a package's public contract should not
 * include test scaffolding. Consumers reach it as `@newsaas/fiscal/testing`.
 *
 * Nothing in this module may be imported by production code.
 */

export {
  buildTestPkcs12,
  PKCS12_CERT_BAG_ID,
  PKCS12_KEY_BAG_ID,
  PKCS12_SHROUDED_KEY_BAG_ID,
  SDSI_CERTIFICATE_CERT_ID,
  TEST_CERTIFICATE_DER_BASE64,
  TEST_CERTIFICATE_NOT_AFTER,
  TEST_CERTIFICATE_NOT_BEFORE,
  TEST_CERTIFICATE_SERIAL,
  TEST_CERTIFICATE_SUBJECT,
  TEST_KEY_ALGORITHM,
  TEST_PKCS12_ITERATIONS,
  TEST_PKCS12_PASSWORD,
  TEST_PRIVATE_KEY_PKCS8_DER_BASE64,
  testCertificateDer,
  testPrivateKeyPkcs8Der,
  X509_CERTIFICATE_CERT_ID,
} from "./signing-material/pkcs12.fixture.js";
export type {
  TestPkcs12Certificate,
  TestPkcs12Options,
} from "./signing-material/pkcs12.fixture.js";
// FISC-008 WU-B: the DTE schema-validation fixture and the tooling that
// prepares the official DNIT schemas for the dedicated CI job.
// `testing.ts` (not the package index) on purpose: both are scaffolding, and the
// prepared schemas are copyrighted artifacts that are never committed.
export {
  FIXTURE_CDC,
  FIXTURE_CERTIFICATE_PEM,
  FIXTURE_DOCUMENT_NUMBER,
  FIXTURE_PRIVATE_KEY_PEM,
  FIXTURE_QR,
  FIXTURE_SECURITY_CODE,
  STRUCTURAL_SIGNATURE,
  validFacturaElectronicaRequest,
  withStructuralSignature,
} from "./dte/dte.fixture.js";
export {
  assertArtifact,
  assertNoAbsoluteSchemaLocations,
  defaultDteSchemaDirectory,
  defaultFetch,
  DTE_XSD_ARTIFACTS,
  DTE_XSD_BASE_URL,
  DTE_XSD_ENTRY_ARTIFACT,
  DTE_XSD_FETCH_ATTEMPTS,
  DTE_XSD_FETCH_TIMEOUT_MS,
  DTE_XSD_FILE_NAMES,
  DteSchemaError,
  inspectDteSchemas,
  prepareDteSchemas,
  rewriteAbsoluteSchemaLocations,
  SIFEN_XSD_NAMESPACE,
  XMLDSIG_XSD_NAMESPACE,
} from "./dte/xsd-artifacts.js";
export type {
  DteSchemaDirectoryInspection,
  DteSchemaFailure,
  DteXsdArtifact,
  FetchLike,
  PrepareDteSchemasOptions,
  PreparedDteSchemas,
} from "./dte/xsd-artifacts.js";
export { buildDteEntrySchema, validateDeAgainstOfficialXsd } from "./dte/xsd-validator.js";
export type { DteXsdValidationResult } from "./dte/xsd-validator.js";
