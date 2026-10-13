/**
 * FISC-016 WU-B — signing an event lot with XMLDSig.
 *
 * §25.4 pins the shape and the baseline's §5 pins the profile, and they are the
 * DE's: `rGesEve` is `{ rEve, ds:Signature }` with the signature **required** as
 * a **sibling** of the event, and `Evento_v150.xsd` imports the same
 * `xmldsig-core-schema.xsd` the DE imports, so there is no second profile to
 * invent. The schema pins no algorithm — `CanonicalizationMethod` and
 * `SignatureMethod` are bare `anyURI` attributes — so every constant comes from
 * the Manual's technology section, which `dte.signing.ts` already encodes. This
 * module **imports** those constants rather than restating them: a second copy
 * of the profile is a second place for it to drift, and the value it would drift
 * to is a document SIFEN rejects.
 *
 * **Three things are easy to get subtly wrong here, and each is asserted rather
 * than trusted:**
 *
 * 1. **The reference is the event, `#<rEve/@Id>`, not the lot.** The request's
 *    `dId` names the submission; the signature covers one event body. The two
 *    are different values and the schema relates them in no way (§25.7).
 * 2. **The signature goes after `rEve`, inside `rGesEve`** — the analogue of the
 *    DE's signature after `DE`. One XPath serves both the reference and the
 *    insertion point, so they cannot drift apart.
 * 3. **One signature per event.** A lot carries up to fifteen events and each is
 *    signed separately, so a single signature over the envelope would sign
 *    nothing the schema accepts.
 *
 * **Why this module owns no XML parser**, and why the ids are read with a
 * regular expression: the note in `dte.signing.ts` applies unchanged.
 * `@xmldom/xmldom`'s type declarations pull the whole DOM lib into this
 * Node-only package's compilation, so it stays a transitive dependency of
 * `xml-crypto`, `xml-crypto` does every parse, and the two string operations
 * this module performs itself are exact matches over a document our own builder
 * produced.
 */

import { SignedXml } from "xml-crypto";
import { EVENT_SIGNATURE_PLACEHOLDER } from "./dte.event.js";
import {
  ENVELOPED_TRANSFORM,
  EXCLUSIVE_CANONICALIZATION,
  FORBIDDEN_KEY_INFO_ELEMENTS,
  SIGNATURE_CANONICALIZATION,
  SIGNATURE_DIGEST_METHOD,
  SIGNATURE_METHOD,
} from "./dte.signing.js";

export type DteEventSigningFailure =
  | "MISSING_EVENT_ELEMENT"
  | "MISSING_SIGNATURE_PLACEHOLDER"
  | "DUPLICATE_EVENT_ID"
  | "FORBIDDEN_KEY_INFO_ELEMENT"
  | "UNEXPECTED_SIGNATURE_SHAPE";

export class DteEventSigningError extends Error {
  readonly failure: DteEventSigningFailure;

  constructor(failure: DteEventSigningFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DteEventSigningError";
    this.failure = failure;
  }
}

export interface SignEventXmlArgs {
  /** The lot `buildEventXml` produced, carrying one placeholder per event. */
  readonly xml: string;
  /** PKCS#8 PEM. RESTRICTED — [[ADR-005]]; never logged, never returned. */
  readonly privateKeyPem: string;
  /** PEM certificate, X.509 v3. Public material. */
  readonly certificatePem: string;
}

/**
 * Signs every event of a built lot and returns the document with one signature
 * in place of each placeholder.
 *
 * Pure with respect to its inputs: no ambient clock, no ambient tenant, no I/O.
 * The same arguments produce byte-identical output.
 */
export function signEventXml(args: SignEventXmlArgs): string {
  const ids = eventIds(args.xml);
  assertPlaceholderPerEvent(args.xml, ids.length);

  let signed = removePlaceholders(args.xml);
  for (const id of ids) {
    // The profile refers to the event by its `Id`, and the schema puts that same
    // `Id` on `rEve/@Id`. One XPath serves both the reference and the insertion
    // point, inside `rGesEve`.
    const eventXpath = `//*[@Id='${id}']`;
    const signature = new SignedXml({
      privateKey: args.privateKeyPem,
      publicCert: args.certificatePem,
      signatureAlgorithm: SIGNATURE_METHOD,
      canonicalizationAlgorithm: SIGNATURE_CANONICALIZATION,
    });
    signature.addReference({
      xpath: eventXpath,
      uri: `#${id}`,
      // Ordered, and exactly two: the profile states the order, and a third
      // would change the bytes that are digested.
      transforms: [ENVELOPED_TRANSFORM, EXCLUSIVE_CANONICALIZATION],
      digestAlgorithm: SIGNATURE_DIGEST_METHOD,
    });

    try {
      // `after rEve` is the position the schema pins: `rGesEve` is
      // `{ rEve, ds:Signature }`, and a signature inside `rEve` is a document
      // the schema refuses.
      signature.computeSignature(signed, {
        location: { reference: eventXpath, action: "after" },
      });
    } catch (cause) {
      throw new DteEventSigningError(
        "UNEXPECTED_SIGNATURE_SHAPE",
        `Signing the event with Id="${id}" failed; the cause is reported without the key material.`,
        { cause }
      );
    }
    signed = signature.getSignedXml();
  }

  assertSignatureShape(signed, ids.length);
  return signed;
}

/**
 * The `Id` of every event, in document order. `rEve` is unique by construction —
 * the builder emits one per event — and the attribute is written by our own
 * builder, so the extraction is an exact match rather than a parse.
 */
function eventIds(xml: string): readonly string[] {
  const ids = [...xml.matchAll(/<rEve\s+Id="([^"]*)"/g)].map((match) => match[1]);
  if (ids.length === 0) {
    throw new DteEventSigningError(
      "MISSING_EVENT_ELEMENT",
      "The document carries no <rEve> element; it was not produced by buildEventXml."
    );
  }

  // The reference `//*[@Id='n']` resolves against the FIRST element carrying the
  // Id, so a lot with a duplicate would sign one event and claim it signed two.
  // The schema asserts no uniqueness (§25.7), which is exactly why the assertion
  // lives where the reference is built.
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new DteEventSigningError(
        "DUPLICATE_EVENT_ID",
        `Two events share Id="${id}"; the reference would resolve against one of them and the other ` +
          "would be signed by nothing."
      );
    }
    seen.add(id);
  }
  return ids;
}

/** One signature per event, and the placeholder is the only proof of that count. */
function assertPlaceholderPerEvent(xml: string, eventCount: number): void {
  const placeholders = xml
    .split("\n")
    .filter((line) => line === EVENT_SIGNATURE_PLACEHOLDER).length;
  if (placeholders !== eventCount) {
    throw new DteEventSigningError(
      "MISSING_SIGNATURE_PLACEHOLDER",
      `The document carries ${String(placeholders)} signature placeholder(s) for ${String(eventCount)} ` +
        "event(s); it was not produced by buildEventXml, or it was already signed."
    );
  }
}

/** Removes exactly the lines the builder emitted, wherever they sit. */
function removePlaceholders(xml: string): string {
  return xml
    .split("\n")
    .filter((line) => line !== EVENT_SIGNATURE_PLACEHOLDER)
    .join("\n");
}

/**
 * Asserts the facts about the produced signatures that a library default could
 * otherwise break: one per event, no forbidden element, and the profile's
 * canonicalization in each of them.
 */
function assertSignatureShape(signed: string, eventCount: number): void {
  // `[\s>]` matters: without it this also counts `<SignatureValue>` and
  // `<SignatureMethod>`, which are children of the one signature.
  const signatures = signed.match(/<Signature[\s>]/g) ?? [];
  if (signatures.length !== eventCount) {
    throw new DteEventSigningError(
      "UNEXPECTED_SIGNATURE_SHAPE",
      `The signed document carries ${String(signatures.length)} signature(s) for ` +
        `${String(eventCount)} event(s); rGesEve requires exactly one each.`
    );
  }

  for (const block of signed.matchAll(/<Signature[\s\S]*?<\/Signature>/g)) {
    const signature = block[0];
    for (const forbidden of FORBIDDEN_KEY_INFO_ELEMENTS) {
      if (new RegExp(`<${forbidden}[\\s/>]`).test(signature)) {
        throw new DteEventSigningError(
          "FORBIDDEN_KEY_INFO_ELEMENT",
          `<${forbidden}> must not appear in a signed event: the certificate already carries it.`
        );
      }
    }
    if (!signature.includes(`Algorithm="${SIGNATURE_CANONICALIZATION}"`)) {
      throw new DteEventSigningError(
        "UNEXPECTED_SIGNATURE_SHAPE",
        "CanonicalizationMethod is not the profile's inclusive 2001 c14n."
      );
    }
  }
}
