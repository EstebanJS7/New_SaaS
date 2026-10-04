/**
 * PKCS#12 → signing material extraction.
 *
 * Turns the artifact a PSC delivers — a `.p12`/`.pfx` container plus its
 * password — into the two things the rest of the system needs: the certificate
 * (public material, transmitted inside every signed DE) and its private key
 * (RESTRICTED material that only the secret store may persist).
 *
 * Node cannot open a PKCS#12 in any form: `crypto.createPrivateKey` rejects
 * `type: "pkcs12"` outright. `pkijs` supplies the container parsing; everything
 * after it — key import, pair verification, validity and algorithm checks — is
 * `node:crypto`, so the certificate standard is enforced by the runtime rather
 * than by a second library.
 *
 * Every failure is a typed reason, never a message from the underlying library:
 * a caller maps the reason to a stable domain error, and nothing here can leak
 * key material, the password or an OpenSSL diagnostic into a response or a log.
 */

import { createPrivateKey, X509Certificate, type KeyObject } from "node:crypto";
import { OctetString } from "asn1js";
import { CertBag, PFX, PKCS8ShroudedKeyBag, PrivateKeyInfo, SafeBag } from "pkijs";

/** The PKCS#12 bag identifiers this parser recognises. */
export const PKCS12_KEY_BAG_ID = "1.2.840.113549.1.12.10.1.1";
export const PKCS12_SHROUDED_KEY_BAG_ID = "1.2.840.113549.1.12.10.1.2";
export const PKCS12_CERT_BAG_ID = "1.2.840.113549.1.12.10.1.3";
/** `CertBag.certId` for an X.509 certificate; the SDSI variant is not usable. */
export const X509_CERTIFICATE_CERT_ID = "1.2.840.113549.1.9.22.1";

/**
 * SIFEN-BASELINE.md pins RSA 2048 for software signing (4096 is allowed for
 * hardware tokens). Anything smaller is refused rather than accepted quietly.
 */
export const MINIMUM_RSA_MODULUS_BITS = 2048;

/** Why an extraction failed. Stable and safe to branch on. */
export type Pkcs12ExtractionFailure =
  | "INVALID_CONTAINER"
  | "INVALID_PASSWORD"
  | "MISSING_CERTIFICATE"
  | "AMBIGUOUS_CERTIFICATE"
  | "UNSUPPORTED_KEY"
  | "KEY_CERTIFICATE_MISMATCH"
  | "CERTIFICATE_EXPIRED";

export class Pkcs12ExtractionError extends Error {
  readonly failure: Pkcs12ExtractionFailure;

  constructor(failure: Pkcs12ExtractionFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "Pkcs12ExtractionError";
    this.failure = failure;
  }
}

export interface ExtractedSigningMaterial {
  /** PKCS#8 PEM. RESTRICTED: the caller must hand this straight to the store. */
  readonly privateKeyPem: string;
  /** PEM certificate. Public material. */
  readonly certificatePem: string;
  readonly certificateDer: Uint8Array<ArrayBuffer>;
  readonly certificateSubject: string;
  readonly certificateSerial: string;
  readonly certificateFingerprintSha256: string;
  /** `<KEY_TYPE>_<MODULUS_BITS>`, e.g. `RSA_2048`. */
  readonly keyAlgorithm: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

export interface ExtractSigningMaterialArgs {
  container: Uint8Array;
  password: string;
  /** Injected for tests; defaults to now. */
  now?: Date;
}

/** The shape pkijs populates on `AuthenticatedSafe.parsedValue`. */
interface AuthenticatedSafeParsedValue {
  safeContents: { value: { safeBags?: SafeBag[] } }[];
}

/**
 * `PKCS8ShroudedKeyBag.parseInternalValues` is declared `protected` in pkijs's
 * typings even though it is a public runtime method. Rather than casting the bag
 * to `any`, the adapter declares the one method it calls.
 */
interface ShroudedKeyBagWithDecryption {
  parseInternalValues(parameters: { password: ArrayBuffer }): Promise<void>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fail(failure: Pkcs12ExtractionFailure, message: string, cause?: unknown): never {
  throw new Pkcs12ExtractionError(failure, message, cause === undefined ? undefined : { cause });
}

async function readSafeBags(container: Uint8Array, password: ArrayBuffer): Promise<SafeBag[]> {
  let pfx: PFX;
  try {
    pfx = PFX.fromBER(toArrayBuffer(container));
  } catch (cause) {
    fail("INVALID_CONTAINER", "The uploaded file is not a PKCS#12 container.", cause);
  }

  try {
    // The MAC integrity check runs here by default, which is what makes a wrong
    // password fail at this step rather than silently later.
    await pfx.parseInternalValues({ password });
  } catch (cause) {
    fail("INVALID_PASSWORD", "The PKCS#12 password is incorrect.", cause);
  }

  try {
    const authenticatedSafe = pfx.parsedValue?.authenticatedSafe;
    if (!authenticatedSafe) {
      fail("INVALID_CONTAINER", "The PKCS#12 container has no authenticated safe.");
    }
    await authenticatedSafe.parseInternalValues({
      safeContents: authenticatedSafe.safeContents.map(() => ({ password })),
    });
    // `AuthenticatedSafe.parsedValue` is typed `any` by pkijs, so the shape is
    // declared here rather than read through an untyped member.
    const parsed = authenticatedSafe.parsedValue as AuthenticatedSafeParsedValue;
    return parsed.safeContents.flatMap((entry) => entry.value.safeBags ?? []);
  } catch (cause) {
    if (cause instanceof Pkcs12ExtractionError) {
      throw cause;
    }
    fail("INVALID_CONTAINER", "The PKCS#12 container is malformed.", cause);
  }
}

function readCertificate(safeBags: readonly SafeBag[]): X509Certificate {
  const certificateBags = safeBags.filter((bag) => bag.bagId === PKCS12_CERT_BAG_ID);
  if (certificateBags.length === 0) {
    fail("MISSING_CERTIFICATE", "The PKCS#12 container has no certificate.");
  }
  if (certificateBags.length > 1) {
    fail(
      "AMBIGUOUS_CERTIFICATE",
      "The PKCS#12 container holds more than one certificate; load the signing certificate alone."
    );
  }

  const bagValue = certificateBags[0]?.bagValue;
  if (!(bagValue instanceof CertBag) || bagValue.certId !== X509_CERTIFICATE_CERT_ID) {
    fail("UNSUPPORTED_KEY", "The PKCS#12 certificate bag is not an X.509 certificate.");
  }

  const certValue = bagValue.certValue;
  if (!(certValue instanceof OctetString)) {
    fail("INVALID_CONTAINER", "The PKCS#12 certificate value is not an octet string.");
  }
  const der = certValue.valueBlock.valueHexView;
  if (!der || der.byteLength === 0) {
    fail("MISSING_CERTIFICATE", "The PKCS#12 certificate bag is empty.");
  }

  try {
    return new X509Certificate(Buffer.from(der));
  } catch (cause) {
    fail("INVALID_CONTAINER", "The PKCS#12 certificate could not be parsed.", cause);
  }
}

async function readPrivateKey(
  safeBags: readonly SafeBag[],
  password: ArrayBuffer
): Promise<KeyObject> {
  const shrouded = safeBags.find((bag) => bag.bagId === PKCS12_SHROUDED_KEY_BAG_ID);
  const plain = safeBags.find((bag) => bag.bagId === PKCS12_KEY_BAG_ID);
  if (!shrouded && !plain) {
    fail("UNSUPPORTED_KEY", "The PKCS#12 container has no private key.");
  }

  let pkcs8Der: Uint8Array;
  if (shrouded) {
    const bagValue = shrouded.bagValue as PKCS8ShroudedKeyBag;
    try {
      await (bagValue as unknown as ShroudedKeyBagWithDecryption).parseInternalValues({ password });
    } catch (cause) {
      fail("INVALID_PASSWORD", "The PKCS#12 private key could not be decrypted.", cause);
    }
    const parsed = bagValue.parsedValue;
    if (!parsed) {
      fail("INVALID_CONTAINER", "The PKCS#12 private key bag is empty.");
    }
    pkcs8Der = new Uint8Array(parsed.toSchema().toBER(false));
  } else {
    const bagValue = plain?.bagValue as PrivateKeyInfo;
    pkcs8Der = new Uint8Array(bagValue.toSchema().toBER(false));
  }

  try {
    return createPrivateKey({ key: Buffer.from(pkcs8Der), format: "der", type: "pkcs8" });
  } catch (cause) {
    fail("UNSUPPORTED_KEY", "The PKCS#12 private key is not a supported PKCS#8 key.", cause);
  }
}

/**
 * Extracts the certificate and its private key from a PKCS#12 container.
 *
 * Throws {@link Pkcs12ExtractionError} with a typed `failure` on every rejection
 * path: an unreadable container, a wrong password, a missing or ambiguous
 * certificate, a non-X.509 certificate bag, a missing or unsupported key, a key
 * that does not match the certificate, and an expired certificate.
 */
export async function extractSigningMaterial(
  args: ExtractSigningMaterialArgs
): Promise<ExtractedSigningMaterial> {
  const password = toArrayBuffer(Buffer.from(args.password, "utf8"));
  const safeBags = await readSafeBags(args.container, password);

  const certificate = readCertificate(safeBags);
  const keyObject = await readPrivateKey(safeBags, password);

  if (keyObject.asymmetricKeyType !== "rsa") {
    fail("UNSUPPORTED_KEY", "The PKCS#12 private key is not an RSA key.");
  }
  const modulusBits = keyObject.asymmetricKeyDetails?.modulusLength ?? 0;
  if (modulusBits < MINIMUM_RSA_MODULUS_BITS) {
    fail(
      "UNSUPPORTED_KEY",
      `The PKCS#12 private key must be RSA with at least ${MINIMUM_RSA_MODULUS_BITS} bits.`
    );
  }

  // The runtime proves the pair, so a container holding a certificate and an
  // unrelated key is refused here rather than at the first signature.
  if (!certificate.checkPrivateKey(keyObject)) {
    fail(
      "KEY_CERTIFICATE_MISMATCH",
      "The PKCS#12 private key does not match the certificate in the container."
    );
  }

  const now = args.now ?? new Date();
  if (certificate.validToDate.getTime() <= now.getTime()) {
    fail("CERTIFICATE_EXPIRED", "The PKCS#12 certificate has expired.");
  }

  return {
    privateKeyPem: keyObject.export({ type: "pkcs8", format: "pem" }).toString(),
    certificatePem: certificate.toString(),
    certificateDer: new Uint8Array(certificate.raw),
    certificateSubject: certificate.subject,
    certificateSerial: certificate.serialNumber,
    certificateFingerprintSha256: certificate.fingerprint256,
    keyAlgorithm: `RSA_${modulusBits}`,
    notBefore: certificate.validFromDate,
    notAfter: certificate.validToDate,
  };
}
