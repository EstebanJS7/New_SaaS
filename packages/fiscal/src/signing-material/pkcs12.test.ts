import { generateKeyPairSync, X509Certificate, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildTestPkcs12,
  SDSI_CERTIFICATE_CERT_ID,
  TEST_CERTIFICATE_NOT_AFTER,
  TEST_CERTIFICATE_NOT_BEFORE,
  TEST_CERTIFICATE_SERIAL,
  TEST_CERTIFICATE_SUBJECT,
  TEST_KEY_ALGORITHM,
  TEST_PKCS12_PASSWORD,
  testCertificateDer,
  X509_CERTIFICATE_CERT_ID,
} from "./pkcs12.fixture.js";
import {
  extractSigningMaterial,
  Pkcs12ExtractionError,
  type Pkcs12ExtractionFailure,
} from "./pkcs12.js";

/** Generates a throwaway key so the mismatch and key-size cases need no fixture. */
function generatePkcs8(modulusLength: number): Uint8Array {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength });
  return new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }));
}

async function expectFailure(
  container: Buffer,
  expected: Pkcs12ExtractionFailure,
  password = TEST_PKCS12_PASSWORD
): Promise<Pkcs12ExtractionError> {
  try {
    await extractSigningMaterial({ container: new Uint8Array(container), password });
  } catch (error) {
    expect(error).toBeInstanceOf(Pkcs12ExtractionError);
    const failure = error as Pkcs12ExtractionError;
    expect(failure.failure).toBe(expected);
    return failure;
  }
  throw new Error(`Expected the extraction to fail with ${expected}.`);
}

describe("extractSigningMaterial", () => {
  it("extracts the certificate and the private key from a PKCS#12 container", async () => {
    const container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });

    const material = await extractSigningMaterial({
      container: new Uint8Array(container),
      password: TEST_PKCS12_PASSWORD,
    });

    expect(material.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(material.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(material.certificateSubject).toBe(TEST_CERTIFICATE_SUBJECT);
    expect(material.certificateSerial).toBe(TEST_CERTIFICATE_SERIAL);
    expect(material.keyAlgorithm).toBe(TEST_KEY_ALGORITHM);
    expect(material.notBefore.toISOString()).toBe(TEST_CERTIFICATE_NOT_BEFORE);
    expect(material.notAfter.toISOString()).toBe(TEST_CERTIFICATE_NOT_AFTER);
    expect(material.certificateFingerprintSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(material.certificateDer.byteLength).toBeGreaterThan(0);
  });

  it("returns a key that the runtime accepts and that matches the certificate", async () => {
    const container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });
    const material = await extractSigningMaterial({
      container: new Uint8Array(container),
      password: TEST_PKCS12_PASSWORD,
    });

    const keyObject = createPrivateKey(material.privateKeyPem);
    const certificate = new X509Certificate(material.certificatePem);

    expect(keyObject.asymmetricKeyType).toBe("rsa");
    expect(keyObject.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(certificate.checkPrivateKey(keyObject)).toBe(true);
  });

  it("refuses a wrong password without echoing it", async () => {
    const container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });

    const failure = await expectFailure(container, "INVALID_PASSWORD", "not-the-password");

    expect(failure.message).not.toContain("not-the-password");
    expect(failure.message).not.toContain(TEST_PKCS12_PASSWORD);
  });

  it("refuses a file that is not a PKCS#12 container", async () => {
    await expectFailure(Buffer.from("not a container at all"), "INVALID_CONTAINER");
  });

  it("refuses a container with no certificate", async () => {
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      certificates: [],
    });

    await expectFailure(container, "MISSING_CERTIFICATE");
  });

  it("refuses a container with more than one certificate", async () => {
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      certificates: [
        { certId: X509_CERTIFICATE_CERT_ID, der: testCertificateDer() },
        { certId: X509_CERTIFICATE_CERT_ID, der: testCertificateDer() },
      ],
    });

    await expectFailure(container, "AMBIGUOUS_CERTIFICATE");
  });

  it("refuses a certificate bag that is not an X.509 certificate", async () => {
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      certificates: [{ certId: SDSI_CERTIFICATE_CERT_ID, der: testCertificateDer() }],
    });

    // pkijs rejects an unrecognised certId while parsing the container, so this
    // lands on INVALID_CONTAINER before the parser's own certId guard runs. That
    // guard stays as a second line of defence for a container pkijs does parse.
    await expectFailure(container, "INVALID_CONTAINER");
  });

  it("refuses a key that does not match the certificate", async () => {
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      privateKeyPkcs8Der: generatePkcs8(2048),
    });

    await expectFailure(container, "KEY_CERTIFICATE_MISMATCH");
  });

  it("refuses a key below the pinned RSA modulus", async () => {
    const container = await buildTestPkcs12({
      password: TEST_PKCS12_PASSWORD,
      privateKeyPkcs8Der: generatePkcs8(1024),
    });

    await expectFailure(container, "UNSUPPORTED_KEY");
  });

  it("refuses an expired certificate", async () => {
    const container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });

    // The fixture is valid for a decade, so expiry is proven by moving the clock
    // rather than by shipping a second, already-expired certificate.
    await expect(
      extractSigningMaterial({
        container: new Uint8Array(container),
        password: TEST_PKCS12_PASSWORD,
        now: new Date("2037-01-01T00:00:00.000Z"),
      })
    ).rejects.toMatchObject({ failure: "CERTIFICATE_EXPIRED" });
  });

  it("refuses a certificate that is not valid yet", async () => {
    const container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });

    // A certificate that is not yet valid is refused at upload rather than
    // accepted and discovered at the first signature, where DNIT would reject it.
    await expect(
      extractSigningMaterial({
        container: new Uint8Array(container),
        password: TEST_PKCS12_PASSWORD,
        now: new Date("2026-01-01T00:00:00.000Z"),
      })
    ).rejects.toMatchObject({ failure: "CERTIFICATE_NOT_YET_VALID" });
  });

  it("treats the validity window as inclusive at the start and exclusive at the end", async () => {
    const container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });
    const notBefore = new Date(TEST_CERTIFICATE_NOT_BEFORE);
    const notAfter = new Date(TEST_CERTIFICATE_NOT_AFTER);
    const readAt = (now: Date) =>
      extractSigningMaterial({
        container: new Uint8Array(container),
        password: TEST_PKCS12_PASSWORD,
        now,
      });

    // One millisecond before it becomes valid: refused.
    await expect(readAt(new Date(notBefore.getTime() - 1))).rejects.toMatchObject({
      failure: "CERTIFICATE_NOT_YET_VALID",
    });
    // Exactly at notBefore: usable.
    await expect(readAt(notBefore)).resolves.toMatchObject({ keyAlgorithm: TEST_KEY_ALGORITHM });
    // One millisecond before it expires: still usable.
    await expect(readAt(new Date(notAfter.getTime() - 1))).resolves.toMatchObject({
      keyAlgorithm: TEST_KEY_ALGORITHM,
    });
    // Exactly at notAfter: expired.
    await expect(readAt(notAfter)).rejects.toMatchObject({ failure: "CERTIFICATE_EXPIRED" });
  });
});
