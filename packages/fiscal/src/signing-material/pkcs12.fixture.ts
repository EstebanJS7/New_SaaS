/**
 * Throwaway signing material for the PKCS#12 parser tests.
 *
 * GENERATED ONCE WITH OPENSSL AND SAFE TO REGENERATE. This is NOT a credential:
 * it is a self-signed RSA-2048 certificate and its matching key, valid
 * 2026-10-04 to 2036-10-01, with extendedKeyUsage = clientAuth to mirror the
 * SIFEN baseline dual use (the same certificate signs a DE and authenticates
 * mutual TLS). It is used for one thing: assembling an in-memory PKCS#12 that
 * the parser is proven against. Nothing outside tests reads it.
 *
 * It lives here as base64 DER rather than as a .p12 or .pem file for two
 * reasons. The harness path guard blocks those extensions outright, and pkijs
 * cannot build a usable X.509 certificate (its signatureAlgorithm comes out
 * malformed), so the certificate cannot be produced at test time. See
 * docs/02-stories/FISC-007-tenant-signing-material.md, section
 * "The test fixture".
 *
 * Regenerate with:
 *   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
 *     -subj "/C=PY/O=NewSaaS Test Fixture/CN=RUC80012345-6" \
 *     -addext "keyUsage=digitalSignature,nonRepudiation" \
 *     -addext "extendedKeyUsage=clientAuth"
 *   openssl x509 -in cert.pem -outform der | base64 -w0
 *   openssl pkcs8 -topk8 -nocrypt -in key.pem -outform der | base64 -w0
 */

/** Self-signed certificate, DER, base64. Public material. */
export const TEST_CERTIFICATE_DER_BASE64 =
  "MIIDizCCAnOgAwIBAgIUYSTo1wsVq98UKztJR4nxt3L2TA8wDQYJKoZIhvcNAQELBQAwRDELMAkGA1UEBhMCUFkxHTAbBgNV" +
  "BAoMFE5ld1NhYVMgVGVzdCBGaXh0dXJlMRYwFAYDVQQDDA1SVUM4MDAxMjM0NS02MB4XDTI2MTAwNDAxMjQ0NloXDTM2MTAw" +
  "MTAxMjQ0NlowRDELMAkGA1UEBhMCUFkxHTAbBgNVBAoMFE5ld1NhYVMgVGVzdCBGaXh0dXJlMRYwFAYDVQQDDA1SVUM4MDAx" +
  "MjM0NS02MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxJaLs9yNs/Y9dsIlUMg1fo1A445UDcz925GdiaL+I0SM" +
  "EmJBZ37w5DUhmMqDHbmmhAwYTwzZlBQcb8yTg8KsUi+XmYlil4bW2ktb4uUuEdY7vQrrIFhuzE+bnI37wy5Tgtn8MHviMZ+h" +
  "ajr2d/YBSkAH27QgfvLJ28iRfV1D6Ew14qN6aeagnXrLn50Z4IHodjVwuV67MyZMvYs929wGCer7MRX+qktfTrTNMPqblWH/" +
  "krbuIYjU0NvYlUd8VMiPV17brAHMcREoqdgpim/dlwDtdgI+CUtzqfzASJVODUfNjR1BKTFTm/5KQ65yI+/deVuXOoYNiPh/" +
  "HaciUtnhZQIDAQABo3UwczAdBgNVHQ4EFgQU377sxCgcWXdSkp2ys4b8o9c8HfwwHwYDVR0jBBgwFoAU377sxCgcWXdSkp2y" +
  "s4b8o9c8HfwwDwYDVR0TAQH/BAUwAwEB/zALBgNVHQ8EBAMCBsAwEwYDVR0lBAwwCgYIKwYBBQUHAwIwDQYJKoZIhvcNAQEL" +
  "BQADggEBACFRTdS4gZYgw0wLnXdx22VrAj8lobnCfmBr4dcDoHK1852TkgE1nHnAtWr5pc23fxzf5izr7Mtm6aI3kGcci3zY" +
  "iRWFp3/2b77FeHtexvSbVP7mqDftW0klcF/GjXXpQZDULOgAR6hgasMD5VQUyduzmUnk2FT8Md/4L4J/z3pr4vaRQERyFmTL" +
  "FrUiDB3yxKOndsQcFEnk26zoUwI5ZKbuLYCxTUpHPyvE7UF2kvP0pmbwjO9zYiFajTii2eOoTF4zFEI9RAKBIScMUuWJ5It7" +
  "aDqoiGhgUJBPT7Syr7HlHSPbS1JoF9WLvl81TshqduIFo3WuSHeM3mdDm5bd7yU=";

/** The matching RSA-2048 private key, PKCS#8 DER, base64. Test-only. */
export const TEST_PRIVATE_KEY_PKCS8_DER_BASE64 =
  "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDElouz3I2z9j12wiVQyDV+jUDjjlQNzP3bkZ2Jov4jRIwS" +
  "YkFnfvDkNSGYyoMduaaEDBhPDNmUFBxvzJODwqxSL5eZiWKXhtbaS1vi5S4R1ju9CusgWG7MT5ucjfvDLlOC2fwwe+Ixn6Fq" +
  "OvZ39gFKQAfbtCB+8snbyJF9XUPoTDXio3pp5qCdesufnRnggeh2NXC5XrszJky9iz3b3AYJ6vsxFf6qS19OtM0w+puVYf+S" +
  "tu4hiNTQ29iVR3xUyI9XXtusAcxxESip2CmKb92XAO12Aj4JS3Op/MBIlU4NR82NHUEpMVOb/kpDrnIj7915W5c6hg2I+H8d" +
  "pyJS2eFlAgMBAAECggEAA17PtS0e6nraWb7L3CXxPC1zSJjK1PQSq8ZEFL/sNVIU8wa8t30cElQyh9em+6Y7FjCij7kObOUT" +
  "ChFQO8t6tVZWth2TyLnEKrjCh0dlwg1cd6n9gc/fpxXmpX6OAQNlD/f+mcfcnFGv4dicxk3mfphORNnCed1d5mxP9D3aWXFB" +
  "+N2jQiJyKU1giIo+A21ZraA/I+ogwLUv06rxlZd/FFe5UEk5CWY3hi9jF8DzXOaqaqxTMgkuT/BoEjCsou8B+QthKTlwd4qY" +
  "IHtH9siXAwDE2io+0jcSfgInl/qTiGEwoEwhnOOkLKLgK/xv4BzrKQc2juozV032nFoJAFFP+QKBgQD6sN0YVEoqK+hI5FDM" +
  "GqhswCs/8PPMW2X8gWuiLLua4X29QU0GPBEM6SBO0W8CBW1jAUtc4hcQfDbsfoWb9TFt2r9mnRkVT1zXDWCwOC2vVJZMrBa9" +
  "GDx3qjpcnHqpr4iE7ZMKJNLGHtzoKJRakqIBg4XnoJuKnDyMbatTN2JEvQKBgQDIwFw8u28XsxZWBHe28MWeMlhRXZfpqKiX" +
  "R2WhmZO+af7HV6dncCAs5qxL/OroB+h2q0NiFAL5oy5YzgAshi1DKFrUcY+atnPbpcDVJWY1HIy5OI2d4vm/bnnuYQKe++Uk" +
  "Zi3JzMZbwYJ8485sRo/Qd2RaQ5mH9IGjvoNoplKdyQKBgQC19cQ1UZEXdRFAP0CKNVtEvGNoIOvEzB6FnibS6uctLzjGMuzG" +
  "drjlhx0lOIz7iZbxQtJB0/VryM1Q8TDnl5xOIXXF9IdtWVKI4bPplI1Mcvg5JLvIexwAu7Vq3UWHftp3qb2Nola+6U3s0O+F" +
  "omMm+CEsk/3yKR8lysCNQWj5fQKBgHosv7XiaHjm8AgHjggTPmHJyAA00rhMgdYXiJ2xxr3S6lDNYr9L+Pj6pg9U7G2sKmjW" +
  "UBsHjMv66MD5FhgCzNcbXzP9rOT+d0JM/S97JFncdzReW6mkMlSz2pceCSdSrCDb4q/25R2AhnaVedJhmzLHBpb8nxqjzqYl" +
  "0vnEh3EpAoGBAL6RX3/zOin7xasYUoYfGsHPH+FiN7fNl5fLW+ra0LiD+7QemvQToY5ZYyhftL9G+CXUN8Hm9MOqCO+SgBzp" +
  "OEilbWN9CsRXKBVXJfu7o1afXwsPZWfSnlZgzSjmMUo8P4N8zSyGT+/AF17ru9eQuIUpWS+uG0v111XHnYYEFZGd";

/** Password protecting the assembled container. */
export const TEST_PKCS12_PASSWORD = "newsaas-test-password";

/** Values the parser must derive from the fixture certificate. */
export const TEST_CERTIFICATE_SUBJECT = "C=PY\nO=NewSaaS Test Fixture\nCN=RUC80012345-6";
export const TEST_CERTIFICATE_SERIAL = "6124E8D70B15ABDF142B3B494789F1B772F64C0F";
export const TEST_CERTIFICATE_NOT_BEFORE = "2026-10-04T01:24:46.000Z";
export const TEST_CERTIFICATE_NOT_AFTER = "2036-10-01T01:24:46.000Z";
export const TEST_KEY_ALGORITHM = "RSA_2048";

/** OIDs the container uses. */
export const PKCS12_KEY_BAG_ID = "1.2.840.113549.1.12.10.1.1";
export const PKCS12_SHROUDED_KEY_BAG_ID = "1.2.840.113549.1.12.10.1.2";
export const PKCS12_CERT_BAG_ID = "1.2.840.113549.1.12.10.1.3";
export const X509_CERTIFICATE_CERT_ID = "1.2.840.113549.1.9.22.1";
export const SDSI_CERTIFICATE_CERT_ID = "1.2.840.113549.1.9.22.2";

import * as asn1js from "asn1js";
import {
  AuthenticatedSafe,
  CertBag,
  ContentInfo,
  PFX,
  PKCS8ShroudedKeyBag,
  PrivateKeyInfo,
  SafeBag,
  SafeContents,
} from "pkijs";

export function testCertificateDer(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(TEST_CERTIFICATE_DER_BASE64, "base64"));
}

export function testPrivateKeyPkcs8Der(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(TEST_PRIVATE_KEY_PKCS8_DER_BASE64, "base64"));
}
/** PBKDF2 iteration count for the assembled container. Small: it is a fixture. */
export const TEST_PKCS12_ITERATIONS = 2048;

/** One certificate entry in the assembled container. */
export interface TestPkcs12Certificate {
  certId: string;
  der: Uint8Array;
}

export interface TestPkcs12Options {
  password: string;
  /** Defaults to the fixture key. Pass a fresh key to build a mismatched pair. */
  privateKeyPkcs8Der?: Uint8Array;
  /** Defaults to the fixture certificate. Pass `[]` to omit the certificate bag. */
  certificates?: readonly TestPkcs12Certificate[];
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Assembles a PKCS#12 container in memory from the fixture material.
 *
 * This is the pkijs path that works: the shrouded key bag, the certificate bag
 * and the outer MAC are all constructible. Only pkijs's *certificate* signing
 * is broken, which is why the certificate is supplied as base64 DER instead of
 * being generated here.
 */
export async function buildTestPkcs12(options: TestPkcs12Options): Promise<Buffer> {
  const password = toArrayBuffer(Buffer.from(options.password, "utf8"));
  const certificates = options.certificates ?? [
    { certId: X509_CERTIFICATE_CERT_ID, der: testCertificateDer() },
  ];
  const keyDer = options.privateKeyPkcs8Der ?? testPrivateKeyPkcs8Der();

  const keyBag = new PKCS8ShroudedKeyBag();
  keyBag.parsedValue = PrivateKeyInfo.fromBER(toArrayBuffer(keyDer));
  await keyBag.makeInternalValues({
    password,
    contentEncryptionAlgorithm: { name: "AES-CBC", length: 256 },
    hmacHashAlgorithm: "SHA-256",
    iterationCount: TEST_PKCS12_ITERATIONS,
  });

  const safeBags: SafeBag[] = [
    new SafeBag({ bagId: PKCS12_SHROUDED_KEY_BAG_ID, bagValue: keyBag }),
    ...certificates.map(
      (entry) =>
        new SafeBag({
          bagId: PKCS12_CERT_BAG_ID,
          bagValue: new CertBag({
            certId: entry.certId,
            certValue: new asn1js.OctetString({ valueHex: toArrayBuffer(entry.der) }),
          }),
        })
    ),
  ];

  const safeContents = new SafeContents({ safeBags });
  const contentInfo = new ContentInfo({
    contentType: ContentInfo.DATA,
    content: new asn1js.OctetString({ valueHex: safeContents.toSchema().toBER(false) }),
  });
  const authenticatedSafe = new AuthenticatedSafe({ safeContents: [contentInfo] });

  const pfx = new PFX();
  pfx.parsedValue = { integrityMode: 0, authenticatedSafe };
  await pfx.makeInternalValues({
    password,
    iterations: TEST_PKCS12_ITERATIONS,
    pbkdf2HashAlgorithm: "SHA-256",
    hmacHashAlgorithm: "SHA-256",
  });

  return Buffer.from(pfx.toSchema().toBER(false));
}
