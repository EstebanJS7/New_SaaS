/**
 * FISC-016 WU-B — the event's signature, asserted against baseline §25.4.
 *
 * §25.4 pins two things and leaves one to the Manual: the signature is
 * **required**, it is a **sibling** of `rEve` inside `rGesEve`, and the schema
 * imports the same `xmldsig-core-schema.xsd` the DE imports — so the profile is
 * the DE's (§5), not a second one. "It produced a signature" is not the
 * criterion: a signature that covers the wrong subtree, sits inside `rEve`, or
 * carries an element `KeyInfo` forbids is a document SIFEN rejects, and a lot
 * carries up to fifteen of them.
 *
 * The assertions read the produced XML as text, which is also how
 * `dte.event-signing.ts` works.
 */

import { SignedXml } from "xml-crypto";
import { describe, expect, it } from "vitest";
import { TEST_CERTIFICATE_DER_BASE64 } from "../signing-material/pkcs12.fixture.js";
import { EVENT_SIGNATURE_PLACEHOLDER, buildEventXml } from "./dte.event.js";
import { DteEventSigningError, signEventXml } from "./dte.event-signing.js";
import type { DteEventRequest } from "./dte.event.types.js";
import { FIXTURE_CERTIFICATE_PEM, FIXTURE_PRIVATE_KEY_PEM } from "./dte.fixture.js";
import {
  ENVELOPED_TRANSFORM,
  EXCLUSIVE_CANONICALIZATION,
  FORBIDDEN_KEY_INFO_ELEMENTS,
  SIGNATURE_CANONICALIZATION,
  SIGNATURE_DIGEST_METHOD,
  SIGNATURE_METHOD,
} from "./dte.signing.js";

const CERTIFICATE_PEM = FIXTURE_CERTIFICATE_PEM;
const PRIVATE_KEY_PEM = FIXTURE_PRIVATE_KEY_PEM;
const VALID_CDC = `12${"1234567A"}${"0".repeat(34)}`;
const REASON = "Servicio no prestado";
const ISSUED_AT = "2026-10-11T09:35:17";
const LOT_ID = "123456789012345";

function validRequest(overrides: Partial<DteEventRequest> = {}): DteEventRequest {
  return {
    dId: LOT_ID,
    events: [
      {
        id: "1",
        dFecFirma: ISSUED_AT,
        payload: { kind: "cancellation", cdc: VALID_CDC, reason: REASON },
      },
      {
        id: "2",
        dFecFirma: ISSUED_AT,
        payload: {
          kind: "inutilizacion",
          dNumTim: "12345678",
          dEst: "001",
          dPunExp: "002",
          dNumIn: "0000001",
          dNumFin: "0000010",
          iTiDE: 1,
          reason: REASON,
          dSerieNum: "AB",
        },
      },
    ],
    ...overrides,
  };
}

function unsignedLot(): string {
  return buildEventXml(validRequest());
}

function signedLot(): string {
  return signEventXml({
    xml: unsignedLot(),
    privateKeyPem: PRIVATE_KEY_PEM,
    certificatePem: CERTIFICATE_PEM,
  });
}

/** Every `<Signature>` subtree in the document, in document order. */
function signaturesOf(xml: string): string[] {
  const blocks = [...xml.matchAll(/<Signature[\s\S]*?<\/Signature>/g)].map((match) => match[0]);
  expect(blocks.length, "the signed lot carries a complete <Signature> per event").toBeGreaterThan(
    0
  );
  return blocks;
}

function algorithmOf(signature: string, name: string): string | null {
  return new RegExp(`<${name}\\s+Algorithm="([^"]*)"`).exec(signature)?.[1] ?? null;
}

function transformsOf(signature: string): string[] {
  return [...signature.matchAll(/<Transform\s+Algorithm="([^"]*)"/g)].map((match) => match[1]);
}

function referenceOf(signature: string): string | null {
  return /<Reference\s+URI="([^"]*)"/.exec(signature)?.[1] ?? null;
}

function textOf(signature: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(signature)?.[1] ?? null;
}

describe("the event signature's profile (§25.4, from §5)", () => {
  it("uses the DE's profile in every signature of the lot, not a second one", () => {
    const signatures = signaturesOf(signedLot());

    expect(signatures).toHaveLength(2);
    for (const signature of signatures) {
      expect(algorithmOf(signature, "CanonicalizationMethod")).toBe(SIGNATURE_CANONICALIZATION);
      expect(algorithmOf(signature, "SignatureMethod")).toBe(SIGNATURE_METHOD);
      expect(algorithmOf(signature, "DigestMethod")).toBe(SIGNATURE_DIGEST_METHOD);
    }
  });

  it("carries exactly two transforms per signature, in the profile's order", () => {
    for (const signature of signaturesOf(signedLot())) {
      expect(transformsOf(signature)).toEqual([ENVELOPED_TRANSFORM, EXCLUSIVE_CANONICALIZATION]);
    }
  });

  it("carries the certificate in X509Data > X509Certificate, in base64", () => {
    for (const signature of signaturesOf(signedLot())) {
      expect(signature).toContain("<X509Data>");
      expect(textOf(signature, "X509Certificate")?.replace(/\s/g, "")).toBe(
        TEST_CERTIFICATE_DER_BASE64
      );
    }
  });

  it.each(FORBIDDEN_KEY_INFO_ELEMENTS)("does not emit the forbidden <%s>", (forbidden) => {
    for (const signature of signaturesOf(signedLot())) {
      expect(signature).not.toMatch(new RegExp(`<${forbidden}[\\s/>]`));
    }
  });
});

describe("the event signature's reference and position (§25.1, §25.4)", () => {
  it("references the event body, #<rEve/@Id>, one signature per event", () => {
    expect(signaturesOf(signedLot()).map(referenceOf)).toEqual(["#1", "#2"]);
    // The lot's dId is not an event: a signature referencing it would cover the
    // whole envelope and no event.
    expect(signaturesOf(signedLot()).map(referenceOf)).not.toContain(`#${LOT_ID}`);
  });

  it("resolves against an rEve that carries the referenced Id", () => {
    const signed = signedLot();

    for (const id of ["1", "2"]) {
      expect(signed).toContain(`<rEve Id="${id}">`);
      expect(signed).toContain(`URI="#${id}"`);
    }
  });

  it("sits immediately after </rEve>, inside its own rGesEve", () => {
    const signed = signedLot();
    const endOfEvent = signed.indexOf("</rEve>");
    const signature = signed.indexOf("<Signature");
    const endOfGroup = signed.indexOf("</rGesEve>");

    expect(endOfEvent).toBeGreaterThan(-1);
    expect(signature).toBeGreaterThan(endOfEvent);
    expect(endOfGroup).toBeGreaterThan(signature);
    // Nothing but whitespace between them: the signature is a sibling of rEve
    // and the schema admits no element in between.
    expect(signed.slice(endOfEvent + "</rEve>".length, signature).trim()).toBe("");
  });

  it("replaces every placeholder rather than keeping one alongside a signature", () => {
    const signed = signedLot();

    expect(signed).not.toContain(EVENT_SIGNATURE_PLACEHOLDER);
    // `[\s>]` matters: `<Signature` alone also counts `<SignatureValue>`.
    expect(signed.match(/<Signature[\s>]/g) ?? []).toHaveLength(2);
  });

  it("leaves the envelope and every event body in place", () => {
    const signed = signedLot();

    expect(signed).toContain(`<dId>${LOT_ID}</dId>`);
    expect(signed).toContain(`<rEve Id="1">`);
    expect(signed).toContain(`<rEve Id="2">`);
    expect(signed).toContain(`<Id>${VALID_CDC}</Id>`);
    expect(signed).toContain("<dNumTim>12345678</dNumTim>");
    expect(signed).toContain("<dSerieNum>AB</dSerieNum>");
    expect(signed).toContain("</rEnviEventoDe>");
    expect(signed.match(/<rGesEve>/g) ?? []).toHaveLength(2);
  });
});

describe("the round trip", () => {
  it("verifies every signature of the lot with the certificate's public key", () => {
    const signed = signedLot();

    for (const signature of signaturesOf(signed)) {
      // v6 requires the signature to be loaded explicitly; `checkSignature`
      // alone throws "No signature found" rather than returning false.
      const verifier = new SignedXml({ publicCert: CERTIFICATE_PEM });
      verifier.loadSignature(signature);
      expect(verifier.checkSignature(signed)).toBe(true);
    }
  });

  it("fails to verify once the signed event is altered, and only that one", () => {
    const signed = signedLot();
    const [first, second] = signaturesOf(signed);
    const tampered = signed.replace(`<mOtEve>${REASON}</mOtEve>`, "<mOtEve>Otro motivo</mOtEve>");

    expect(tampered).not.toBe(signed);
    const firstVerifier = new SignedXml({ publicCert: CERTIFICATE_PEM });
    firstVerifier.loadSignature(first);
    expect(firstVerifier.checkSignature(tampered)).toBe(false);
    const secondVerifier = new SignedXml({ publicCert: CERTIFICATE_PEM });
    secondVerifier.loadSignature(second);
    expect(secondVerifier.checkSignature(tampered)).toBe(true);
  });
});

describe("purity", () => {
  it("produces byte-identical output for identical inputs", () => {
    expect(signedLot()).toBe(signedLot());
  });

  it("never returns the private key", () => {
    const body = PRIVATE_KEY_PEM.split("\n")[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(signedLot()).not.toContain(body);
  });
});

describe("refusals", () => {
  it("rejects a document that is not a built event lot", () => {
    const attempt = () =>
      signEventXml({
        xml: "<rEnviEventoDe/>",
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
      });

    expect(attempt).toThrow(DteEventSigningError);
    expect(attempt).toThrow(/no <rEve> element/);
  });

  it("rejects a document with no signature placeholder", () => {
    const attempt = () =>
      signEventXml({
        xml: unsignedLot().replaceAll(EVENT_SIGNATURE_PLACEHOLDER, ""),
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
      });

    expect(attempt).toThrow(DteEventSigningError);
    expect(attempt).toThrow(/placeholder/);
  });

  it("rejects a lot whose placeholder count does not match its events", () => {
    const attempt = () =>
      signEventXml({
        xml: unsignedLot().replace(`${EVENT_SIGNATURE_PLACEHOLDER}\n`, ""),
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
      });

    expect(attempt).toThrow(DteEventSigningError);
    expect(attempt).toThrow(/placeholder/);
  });

  it("rejects two events sharing an Id, which would make the reference ambiguous", () => {
    const duplicated = buildEventXml(
      validRequest({
        events: [
          {
            id: "1",
            dFecFirma: ISSUED_AT,
            payload: { kind: "cancellation", cdc: VALID_CDC, reason: REASON },
          },
          {
            id: "1",
            dFecFirma: ISSUED_AT,
            payload: {
              kind: "inutilizacion",
              dNumTim: "12345678",
              dEst: "001",
              dPunExp: "002",
              dNumIn: "0000001",
              dNumFin: "0000010",
              iTiDE: 1,
              reason: REASON,
            },
          },
        ],
      })
    );
    const attempt = () =>
      signEventXml({
        xml: duplicated,
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
      });

    expect(attempt).toThrow(DteEventSigningError);
    expect(attempt).toThrow(/share/);
    // The reference resolves against the FIRST element carrying the Id, so a lot
    // with a duplicate would sign one event and claim it signed two.
    expect(attempt).toThrow(/Id="1"/);
  });

  it("does not leak key material in the error it reports", () => {
    const body = PRIVATE_KEY_PEM.split("\n")[1] ?? "";
    try {
      signEventXml({
        xml: "<rEnviEventoDe/>",
        privateKeyPem: PRIVATE_KEY_PEM,
        certificatePem: CERTIFICATE_PEM,
      });
      expect.unreachable("signing an empty document must fail");
    } catch (error) {
      expect(String(error)).not.toContain(body);
    }
  });
});
