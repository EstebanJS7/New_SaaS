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
