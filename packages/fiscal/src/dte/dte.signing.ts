/**
 * FISC-009 — signing the DE with XMLDSig.
 *
 * §5 of the baseline pins the profile completely, from the Manual's §7.6, §7.7
 * and Schema XML 1. Every constant below is one line of it:
 *
 * ```text
 * Standard                XML Digital Signature, Enveloped (W3C xmldsig-core)
 * CanonicalizationMethod  http://www.w3.org/TR/2001/REC-xml-c14n-20010315
 * SignatureMethod         http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
 * Reference URI           #<CDC>
 * Transforms (exactly 2)   .../xmldsig#enveloped-signature, then .../xml-exc-c14n#
 * DigestMethod            http://www.w3.org/2001/04/xmlenc#sha256
 * KeyInfo                 X509Data > X509Certificate
 * ```
 *
 * **This profile is XMLDSig, not XAdES.** `XAdES`, `QualifyingProperties` and
 * `SignedProperties` occur zero times in the three official schemas, and the
 * Manual's §7.9 synthesis reads "Firma XML Digital Signature, Enveloped". The
 * vault's "XAdES" wording is inherited from PRD §23, which is not edited;
 * [[ADR-006]] and [[FISC-009]] record that the target is the profile above.
 *
 * **Three things about this profile are easy to get subtly wrong, and each is
 * asserted rather than trusted:**
 *
 * 1. **The canonicalization pair is mixed.** `CanonicalizationMethod` is the
 *    **2001 inclusive** c14n while the second **transform** is **exclusive**.
 *    A library default that made both exclusive would verify locally and be
 *    rejected by SIFEN.
 * 2. **The signature is a SIBLING of `DE`, not a child.** The schema's `rDE`
 *    carries `<xs:element name="DE" type="tDE"/>` followed by
 *    `<xs:element ref="ds:Signature"/>`, and `tDE` does not contain a signature.
 *    So the enveloped transform removes nothing here — the signature is not a
 *    descendant of the referenced element — and the transform is present because
 *    the profile requires it, not because it changes the digest.
 * 3. **Eight elements are forbidden** in `KeyInfo`, because the certificate
 *    already carries them. A signature containing any of them is refused rather
 *    than emitted.
 *
 * **Why this module owns no XML parser.** The obvious helper here would be
 * `@xmldom/xmldom`, which `xml-crypto` already depends on. Its `index.d.ts` opens
 * with `/// <reference lib="dom" />`, and declaring it pulls the whole DOM lib
 * into this Node-only package's compilation — which already re-typed an unrelated
 * WebCrypto union in the PKCS#12 fixture and broke `typecheck`. So it stays a
 * transitive dependency, `xml-crypto` does every parse, and the two things this
 * module does itself are exact string operations over a document our own builder
 * produced.
 */

import { SignedXml } from "xml-crypto";
import { SIGNATURE_PLACEHOLDER } from "./dte.builder.js";

/** Baseline §5: the `CanonicalizationMethod`. Inclusive 2001 — **not** exclusive. */
export const SIGNATURE_CANONICALIZATION = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

/** Baseline §5: the `SignatureMethod`. */
export const SIGNATURE_METHOD = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

/** Baseline §5: the **first** transform, in this order. */
export const ENVELOPED_TRANSFORM = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/** Baseline §5: the **second** transform, in this order. */
export const EXCLUSIVE_CANONICALIZATION = "http://www.w3.org/2001/10/xml-exc-c14n#";

/** Baseline §5: the `DigestMethod`. */
export const SIGNATURE_DIGEST_METHOD = "http://www.w3.org/2001/04/xmlenc#sha256";

/**
 * Baseline §5: elements that must **not** appear in a signed DE, because the
 * certificate carries them. Checked against the produced signature, so a library
 * default cannot reintroduce one.
 */
export const FORBIDDEN_KEY_INFO_ELEMENTS = [
  "X509SubjectName",
  "X509IssuerSerial",
  "X509IssuerName",
  "X509SKI",
  "KeyValue",
  "RSAKeyValue",
  "Modulus",
  "Exponent",
] as const;

export type DteSigningFailure =
  | "MISSING_DE_ELEMENT"
  | "DE_ID_MISMATCH"
  | "MISSING_SIGNATURE_PLACEHOLDER"
  | "FORBIDDEN_KEY_INFO_ELEMENT"
  | "UNEXPECTED_SIGNATURE_SHAPE";

export class DteSigningError extends Error {
  readonly failure: DteSigningFailure;

  constructor(failure: DteSigningFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DteSigningError";
    this.failure = failure;
  }
}

export interface SignDteXmlArgs {
  /** The document `buildDteXml` produced, carrying its signature placeholder. */
  readonly xml: string;
  /** PKCS#8 PEM. RESTRICTED — [[ADR-005]]; never logged, never returned. */
  readonly privateKeyPem: string;
  /** PEM certificate, X.509 v3. Public material. */
  readonly certificatePem: string;
  /** The CDC carried by `DE/@Id`; the signature references it as `#<cdc>`. */
  readonly cdc: string;
}

/**
 * Signs the `DE` element of a built document and returns it with the signature in
 * place of the placeholder.
 *
 * Pure with respect to its inputs: no ambient clock, no ambient tenant, no I/O.
 * The same arguments produce byte-identical output.
 */
export function signDteXml(args: SignDteXmlArgs): string {
  assertDeCarriesCdc(args.xml, args.cdc);
  const unsigned = removePlaceholder(args.xml);
  // The profile refers to the signed subtree by the CDC, and the schema puts that
  // same CDC on `DE/@Id`. One XPath serves both the reference and the insertion
  // point, so they cannot drift apart.
  const deXpath = `//*[@Id='${args.cdc}']`;

  const signedXml = new SignedXml({
    privateKey: args.privateKeyPem,
    publicCert: args.certificatePem,
    signatureAlgorithm: SIGNATURE_METHOD,
    canonicalizationAlgorithm: SIGNATURE_CANONICALIZATION,
  });
  signedXml.addReference({
    xpath: deXpath,
    uri: `#${args.cdc}`,
    // Ordered, and exactly two: the profile states the order, and a third would
    // change the bytes that are digested.
    transforms: [ENVELOPED_TRANSFORM, EXCLUSIVE_CANONICALIZATION],
    digestAlgorithm: SIGNATURE_DIGEST_METHOD,
  });

  try {
    signedXml.computeSignature(unsigned, {
      // `after DE` is the position the schema pins, between `</DE>` and
      // `gCamFuFD`.
      location: { reference: deXpath, action: "after" },
    });
  } catch (cause) {
    throw new DteSigningError(
      "UNEXPECTED_SIGNATURE_SHAPE",
      "Signing failed; the cause is reported without the key material.",
      { cause }
    );
  }

  const signed = signedXml.getSignedXml();
  assertSignatureShape(signedXml.getSignatureXml(), signed);
  return signed;
}

/** `DE` is unique and carries the CDC on its `Id`; either fact missing is a bug. */
function assertDeCarriesCdc(xml: string, cdc: string): void {
  if (!/<DE[\s>]/.test(xml)) {
    throw new DteSigningError(
      "MISSING_DE_ELEMENT",
      "The document carries no <DE> element; it was not produced by buildDteXml."
    );
  }
  const matches = xml.match(/<DE\s+Id="([^"]*)"/g) ?? [];
  const declared = matches.map((match) => match.replace(/^<DE\s+Id="/, "").replace(/"$/, ""));
  if (declared.length !== 1 || declared[0] !== cdc) {
    throw new DteSigningError(
      "DE_ID_MISMATCH",
      `Expected exactly one <DE> whose Id is the CDC, found ${String(declared.length)}; ` +
        "the reference would resolve against nothing."
    );
  }
}

/** Removes exactly the line the builder emitted, wherever it sits. */
function removePlaceholder(xml: string): string {
  const lines = xml.split("\n");
  const index = lines.indexOf(SIGNATURE_PLACEHOLDER);
  if (index === -1) {
    throw new DteSigningError(
      "MISSING_SIGNATURE_PLACEHOLDER",
      "The document carries no signature placeholder; it was not produced by buildDteXml, " +
        "or it was already signed."
    );
  }
  lines.splice(index, 1);
  return lines.join("\n");
}

/**
 * Asserts the facts about the produced signature that a library default could
 * otherwise break: one signature in the document, no forbidden element, and the
 * mixed canonicalization pair the profile pins.
 */
function assertSignatureShape(signatureXml: string, signed: string): void {
  // `[\s>]` matters: without it this also counts `<SignatureValue>` and
  // `<SignatureMethod>`, which are children of the one signature.
  const signatures = signed.match(/<Signature[\s>]/g) ?? [];
  if (signatures.length !== 1) {
    throw new DteSigningError(
      "UNEXPECTED_SIGNATURE_SHAPE",
      `The signed document carries ${String(signatures.length)} signatures; rDE allows exactly one.`
    );
  }
  for (const forbidden of FORBIDDEN_KEY_INFO_ELEMENTS) {
    if (new RegExp(`<${forbidden}[\\s/>]`).test(signatureXml)) {
      throw new DteSigningError(
        "FORBIDDEN_KEY_INFO_ELEMENT",
        `<${forbidden}> must not appear in a signed DE: the certificate already carries it.`
      );
    }
  }
  if (!signatureXml.includes(`Algorithm="${SIGNATURE_CANONICALIZATION}"`)) {
    throw new DteSigningError(
      "UNEXPECTED_SIGNATURE_SHAPE",
      "CanonicalizationMethod is not the profile's inclusive 2001 c14n."
    );
  }
}
