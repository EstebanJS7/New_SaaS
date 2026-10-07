/**
 * FISC-009 WU-B — the signature profile of baseline §5, asserted element by
 * element.
 *
 * "It produced XML" is not the acceptance criterion here: a wrong signature is
 * not a build failure, it is a document SIFEN rejects, and the Manual's §6.5
 * means a rejected DE is resubmitted with the **same** CDC. So the suite asserts
 * the profile's constants, the forbidden elements, the signature's position, the
 * round trip, and purity.
 *
 * The assertions read the produced XML as text rather than through a DOM, which
 * is also how `dte.signing.ts` works — see the note there on why
 * `@xmldom/xmldom` stays transitive.
 */

import { SignedXml } from "xml-crypto";
import { describe, expect, it } from "vitest";
import { TEST_CERTIFICATE_DER_BASE64 } from "../signing-material/pkcs12.fixture.js";
import { SIGNATURE_PLACEHOLDER, buildDteXml } from "./dte.builder.js";
import {
  FIXTURE_CDC,
  FIXTURE_CERTIFICATE_PEM,
  FIXTURE_PRIVATE_KEY_PEM,
  validFacturaElectronicaRequest,
} from "./dte.fixture.js";
import {
  DteSigningError,
  ENVELOPED_TRANSFORM,
  EXCLUSIVE_CANONICALIZATION,
  FORBIDDEN_KEY_INFO_ELEMENTS,
  SIGNATURE_CANONICALIZATION,
  SIGNATURE_DIGEST_METHOD,
  SIGNATURE_METHOD,
  signDteXml,
} from "./dte.signing.js";

const CERTIFICATE_PEM = FIXTURE_CERTIFICATE_PEM;
const PRIVATE_KEY_PEM = FIXTURE_PRIVATE_KEY_PEM;

function unsignedDe(): string {
  return buildDteXml(validFacturaElectronicaRequest());
}

function signedDe(): string {
  return signDteXml({
    xml: unsignedDe(),
    privateKeyPem: PRIVATE_KEY_PEM,
    certificatePem: CERTIFICATE_PEM,
    cdc: FIXTURE_CDC,
  });
}

/** The signature's own subtree, which is where every profile constant lives. */
function signatureOf(xml: string): string {
  const match = /<Signature[\s\S]*?<\/Signature>/.exec(xml);
  expect(match, "the signed document carries a complete <Signature>").not.toBeNull();
  return match?.[0] ?? "";
}

function algorithmOf(signature: string, name: string): string | null {
  return new RegExp(`<${name}\\s+Algorithm="([^"]*)"`).exec(signature)?.[1] ?? null;
}

function transformsOf(signature: string): string[] {
  return [...signature.matchAll(/<Transform\s+Algorithm="([^"]*)"/g)].map((match) => match[1]);
}

function textOf(signature: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(signature)?.[1] ?? null;
}

describe("the signature profile", () => {
  it("uses the inclusive 2001 c14n as CanonicalizationMethod, not exclusive", () => {
    expect(algorithmOf(signatureOf(signedDe()), "CanonicalizationMethod")).toBe(
      SIGNATURE_CANONICALIZATION
    );
  });

  it("uses rsa-sha256 as SignatureMethod", () => {
    expect(algorithmOf(signatureOf(signedDe()), "SignatureMethod")).toBe(SIGNATURE_METHOD);
  });

  it("uses sha256 as DigestMethod", () => {
    expect(algorithmOf(signatureOf(signedDe()), "DigestMethod")).toBe(SIGNATURE_DIGEST_METHOD);
  });

  it("references the CDC, preceded by #", () => {
    expect(/<Reference\s+URI="([^"]*)"/.exec(signatureOf(signedDe()))?.[1]).toBe(`#${FIXTURE_CDC}`);
  });

  it("carries exactly two transforms, in the profile's order", () => {
    expect(transformsOf(signatureOf(signedDe()))).toEqual([
      ENVELOPED_TRANSFORM,
      EXCLUSIVE_CANONICALIZATION,
    ]);
  });

  it("carries the certificate in X509Data > X509Certificate, in base64", () => {
    const signature = signatureOf(signedDe());
    expect(signature).toContain("<X509Data>");
    expect(textOf(signature, "X509Certificate")?.replace(/\s/g, "")).toBe(
      TEST_CERTIFICATE_DER_BASE64
    );
  });

  it.each(FORBIDDEN_KEY_INFO_ELEMENTS)("does not emit the forbidden <%s>", (forbidden) => {
    expect(signatureOf(signedDe())).not.toMatch(new RegExp(`<${forbidden}[\\s/>]`));
  });
});

describe("the signature's position", () => {
  it("sits immediately after </DE>, before gCamFuFD", () => {
    const signed = signedDe();
    const endOfDe = signed.indexOf("</DE>");
    const signature = signed.indexOf("<Signature");
    const camposFueraFirma = signed.indexOf("<gCamFuFD");

    expect(endOfDe).toBeGreaterThan(-1);
    expect(signature).toBeGreaterThan(endOfDe);
    expect(camposFueraFirma).toBeGreaterThan(signature);
    // Nothing but whitespace between them: the signature is a sibling of DE, and
    // the schema admits no element in between.
    expect(signed.slice(endOfDe + "</DE>".length, signature).trim()).toBe("");
  });

  it("leaves DE's Id as the CDC, which is what the reference resolves against", () => {
    expect(signedDe()).toContain(`<DE Id="${FIXTURE_CDC}">`);
  });

  it("replaces the placeholder rather than keeping it alongside the signature", () => {
    const signed = signedDe();
    expect(signed).not.toContain(SIGNATURE_PLACEHOLDER);
    // `[\s>]` matters: `<Signature` alone also counts `<SignatureValue>` and
    // `<SignatureMethod>`.
    expect(signed.match(/<Signature[\s>]/g) ?? []).toHaveLength(1);
  });
});

describe("the round trip", () => {
  it("verifies with the certificate's public key", () => {
    const signed = signedDe();
    // v6 requires the signature to be loaded explicitly; `checkSignature` alone
    // throws "No signature found" rather than returning false.
    const verifier = new SignedXml({ publicCert: CERTIFICATE_PEM });
    verifier.loadSignature(signatureOf(signed));
    expect(verifier.checkSignature(signed)).toBe(true);
  });

  it("fails to verify once the signed content is altered", () => {
    const signed = signedDe();
    const tampered = signed.replace("<dSisFact>1</dSisFact>", "<dSisFact>2</dSisFact>");
    expect(tampered).not.toBe(signed);
    const verifier = new SignedXml({ publicCert: CERTIFICATE_PEM });
    verifier.loadSignature(signatureOf(signed));
    expect(verifier.checkSignature(tampered)).toBe(false);
  });
});

describe("purity", () => {
  it("produces byte-identical output for identical inputs", () => {
    expect(signedDe()).toBe(signedDe());
  });

  it("never returns the private key", () => {
    const body = PRIVATE_KEY_PEM.split("\n")[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(signedDe()).not.toContain(body);
  });
});

describe("refusals", () => {
  it("rejects a document whose DE does not carry the CDC", () => {
    const attempt = () =>
      signDteXml({
        xml: unsignedDe(),
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
        cdc: "0".repeat(44),
      });
    expect(attempt).toThrow(DteSigningError);
    expect(attempt).toThrow(/Id is the CDC/);
  });

  it("rejects a document that is not a built DE", () => {
    const attempt = () =>
      signDteXml({
        xml: "<rDE/>",
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
        cdc: FIXTURE_CDC,
      });
    expect(attempt).toThrow(DteSigningError);
    expect(attempt).toThrow(/no <DE> element/);
  });

  it("rejects a document with no signature placeholder", () => {
    const attempt = () =>
      signDteXml({
        xml: unsignedDe().replace(SIGNATURE_PLACEHOLDER, ""),
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
        cdc: FIXTURE_CDC,
      });
    expect(attempt).toThrow(DteSigningError);
    expect(attempt).toThrow(/no signature placeholder/);
  });

  it("does not leak key material in the error it reports", () => {
    const body = PRIVATE_KEY_PEM.split("\n")[1] ?? "";
    try {
      signDteXml({
        xml: "<rDE/>",
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
        cdc: FIXTURE_CDC,
      });
      expect.unreachable("signing an empty document must fail");
    } catch (error) {
      expect(String(error)).not.toContain(body);
    }
  });
});
