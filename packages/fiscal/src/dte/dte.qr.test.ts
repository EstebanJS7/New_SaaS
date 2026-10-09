/**
 * FISC-012 WU-C — baseline §24's QR, asserted against the Manual's own worked
 * example.
 *
 * The composition is pinned by the Manual's §13.8.2–§13.8.4, which §24 reads
 * with its retrieval record; where the Manual contradicts itself, §24.4's three
 * defects record which reading wins:
 *
 * 1. the consultation address carries no `www.` (§13.8.4.4's "Donde" adds it,
 *    §13.8.2 and the example do not);
 * 2. `nVersion` is 150 — the document's version — not the 142 §13.8.4.4's
 *    "Datos del Paso 1" prints while its own URL says 150;
 * 3. the total's parameter is `dTotGralOpe`, not §13.8.3's example-table
 *    `dTotOpe`.
 *
 * The worked example is the acceptance test: its URL is reproduced byte for
 * byte from its own inputs. Everything else here guards the ways the
 * composition can silently rot — the two hex conversions, the escape/fill pair,
 * and the placeholder the builder must carry — because a wrong QR is a document
 * SIFEN rejects, not a build failure.
 */

import { parseXml, type Element } from "libxmljs2";
import { describe, expect, it } from "vitest";
import { SignedXml } from "xml-crypto";
import { buildDteXml } from "./dte.builder.js";
import {
  FIXTURE_CDC,
  FIXTURE_CERTIFICATE_PEM,
  FIXTURE_PRIVATE_KEY_PEM,
  validFacturaElectronicaRequest,
} from "./dte.fixture.js";
import {
  buildQrContent,
  DteQrError,
  fillQrContent,
  QR_CONSULTATION_URLS,
  QR_CONTENT_MAX_LENGTH,
  QR_CONTENT_MIN_LENGTH,
  QR_PLACEHOLDER,
  type BuildQrContentArgs,
  type DteQrFailure,
} from "./dte.qr.js";
import { signDteXml } from "./dte.signing.js";
import { defaultDteSchemaDirectory, inspectDteSchemas } from "./xsd-artifacts.js";
import { validateDeAgainstOfficialXsd } from "./xsd-validator.js";

/** §24.3's worked example, from its own inputs (§13.8.4's "Datos del Paso 1"). */
const WORKED_EXAMPLE: BuildQrContentArgs = {
  environment: "production",
  cdc: "01444444017001001001452822017012515873260988",
  dFeEmiDE: "2017-01-25T09:35:17",
  dRucRec: "88899990",
  dTotGralOpe: "300000",
  dTotIVA: "27272",
  cItems: 2,
  digestValue: "yzGYhUx1/XYYzksWB+fPR3Qc50c=",
  idCsc: "0001",
  csc: "ABCD0000000000000000000000000000",
};

/** §24.3's worked example's own `cHashQR`, independently reproduced. */
const WORKED_EXAMPLE_HASH = "97ddbb3c1e7d65af03a70ffe21f2b34846ab1c89e0566c35222086766b7374ed";

/** §24.3's worked example's URL, byte for byte. */
const WORKED_EXAMPLE_URL =
  "https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=01444444017001001001452822017012515873260988" +
  "&dFeEmiDE=323031372d30312d32355430393a33353a3137&dRucRec=88899990&dTotGralOpe=300000" +
  "&dTotIVA=27272&cItems=2&DigestValue=797a4759685578312f5859597a6b7357422b6650523351633530633d" +
  `&IdCSC=0001&cHashQR=${WORKED_EXAMPLE_HASH}`;

/** A stand-in for the CSC, which SIFEN issues per taxpayer and is secret (§24.2). */
const TEST_CSC = "TEST0000000000000000000000000000";

function requestWithQrPlaceholder(): ReturnType<typeof validFacturaElectronicaRequest> {
  return { ...validFacturaElectronicaRequest(), gCamFuFD: { dCarQR: QR_PLACEHOLDER } };
}

function signedWithQrPlaceholder(): string {
  return signDteXml({
    xml: buildDteXml(requestWithQrPlaceholder()),
    privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
    certificatePem: FIXTURE_CERTIFICATE_PEM,
    cdc: FIXTURE_CDC,
  });
}

/** The signed `DE` subtree, which the QR fill must not touch. */
function deSubtreeOf(xml: string): string {
  const start = xml.indexOf("<DE ");
  const end = xml.indexOf("</DE>");
  expect(start, "the document carries a <DE> element").toBeGreaterThan(-1);
  expect(end, "the document closes its <DE> element").toBeGreaterThan(start);
  return xml.slice(start, end + "</DE>".length);
}

function signatureOf(xml: string): string {
  const match = /<Signature[\s\S]*?<\/Signature>/.exec(xml);
  expect(match, "the document carries a complete <Signature>").not.toBeNull();
  return match?.[0] ?? "";
}

function digestValueOf(signedXml: string): string {
  const digest = /<DigestValue>([^<]*)<\/DigestValue>/.exec(signedXml)?.[1];
  expect(digest, "the signed document carries the signature's DigestValue").toBeTruthy();
  return digest ?? "";
}

function failureOf(callback: () => unknown): DteQrFailure {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DteQrError);
    return (error as DteQrError).failure;
  }
  throw new Error("expected a DteQrError");
}

describe("buildQrContent — §13.8.4's worked example", () => {
  it("reproduces the example's URL byte for byte, cHashQR included", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).toBe(WORKED_EXAMPLE_URL);
  });

  it("encodes dFeEmiDE as the hex of its bytes, not a decoded timestamp", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).toContain(
      "&dFeEmiDE=323031372d30312d32355430393a33353a3137&"
    );
  });

  it("encodes DigestValue as the hex of its bytes", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).toContain(
      "&DigestValue=797a4759685578312f5859597a6b7357422b6650523351633530633d&"
    );
  });

  it("hashes the parameters plus the CSC and carries it as cHashQR", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).toContain(`&cHashQR=${WORKED_EXAMPLE_HASH}`);
  });

  it("never carries the CSC in the returned URL", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).not.toContain(WORKED_EXAMPLE.csc);
  });

  it("returns the URL unescaped: the `&amp;` belongs to the fill, not the URL", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).not.toContain("&amp;");
  });

  it("is pure: identical inputs give identical output", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).toBe(buildQrContent({ ...WORKED_EXAMPLE }));
  });
});

describe("buildQrContent — the absent totals, the host and the vocabulary", () => {
  it("substitutes 0 for an absent dTotGralOpe (§24.3's footnote)", () => {
    expect(buildQrContent({ ...WORKED_EXAMPLE, dTotGralOpe: null })).toContain("&dTotGralOpe=0&");
  });

  it("substitutes 0 for an absent dTotIVA (§24.3's footnote)", () => {
    expect(buildQrContent({ ...WORKED_EXAMPLE, dTotIVA: null })).toContain("&dTotIVA=0&");
  });

  it("passes a present total through unchanged", () => {
    expect(buildQrContent(WORKED_EXAMPLE)).toContain("&dTotGralOpe=300000&dTotIVA=27272&");
  });

  it("pins §24.3's two addresses, neither carrying www.", () => {
    expect(QR_CONSULTATION_URLS).toEqual({
      production: "https://ekuatia.set.gov.py/consultas/qr?",
      test: "https://ekuatia.set.gov.py/consultas-test/qr?",
    });
    expect(JSON.stringify(QR_CONSULTATION_URLS)).not.toContain("www.");
  });

  it("uses the production address for production", () => {
    expect(buildQrContent(WORKED_EXAMPLE).startsWith(QR_CONSULTATION_URLS.production)).toBe(true);
  });

  it("uses the test address for test", () => {
    const url = buildQrContent({ ...WORKED_EXAMPLE, environment: "test" });
    expect(url.startsWith(QR_CONSULTATION_URLS.test)).toBe(true);
    expect(url).not.toContain("www.");
  });
});

describe("QR_PLACEHOLDER", () => {
  it("is inside the builder's own 100..600 rule, so an unsigned DE can be built", () => {
    expect(QR_PLACEHOLDER.length).toBeGreaterThanOrEqual(100);
    expect(QR_PLACEHOLDER.length).toBeLessThanOrEqual(600);
  });

  it("carries no XML-special character, and the builder emits it verbatim", () => {
    expect(QR_PLACEHOLDER).not.toMatch(/[&<>]/);
    expect(buildDteXml(requestWithQrPlaceholder())).toContain(`<dCarQR>${QR_PLACEHOLDER}</dCarQR>`);
  });
});

describe("fillQrContent", () => {
  it("replaces the singleton placeholder with the escaped QR content", () => {
    const filled = fillQrContent({
      signedXml: signedWithQrPlaceholder(),
      qrContent: WORKED_EXAMPLE_URL,
    });

    expect(filled).not.toContain(QR_PLACEHOLDER);
    // The unescaped URL must be absent, which is what proves every `&` became
    // `&amp;` (§24.3's Paso 5, the step that actually occurs).
    expect(filled).not.toContain(WORKED_EXAMPLE_URL);
    expect(filled).toContain(`<dCarQR>${WORKED_EXAMPLE_URL.replaceAll("&", "&amp;")}</dCarQR>`);
  });

  it("still parses as XML, with dCarQR decoding back to the unescaped URL", () => {
    const filled = fillQrContent({
      signedXml: signedWithQrPlaceholder(),
      qrContent: WORKED_EXAMPLE_URL,
    });

    const document = parseXml(filled);
    expect(document.errors).toEqual([]);
    expect(document.get<Element>("//*[local-name()='dCarQR']")?.text()).toBe(WORKED_EXAMPLE_URL);
  });

  it("leaves the DE subtree's bytes identical: the QR sits outside the signature", () => {
    const signed = signedWithQrPlaceholder();
    const filled = fillQrContent({
      signedXml: signed,
      qrContent: WORKED_EXAMPLE_URL,
    });

    expect(filled).not.toBe(signed);
    expect(deSubtreeOf(filled)).toBe(deSubtreeOf(signed));
  });

  it("refuses a document carrying no placeholder", () => {
    const withoutPlaceholder = buildDteXml(validFacturaElectronicaRequest());
    expect(
      failureOf(() =>
        fillQrContent({ signedXml: withoutPlaceholder, qrContent: WORKED_EXAMPLE_URL })
      )
    ).toBe("MISSING_PLACEHOLDER");
  });

  it("refuses a document whose placeholder appears twice", () => {
    const duplicated = buildDteXml({
      ...validFacturaElectronicaRequest(),
      gCamFuFD: { dCarQR: QR_PLACEHOLDER, dInfAdic: QR_PLACEHOLDER },
    });
    expect(
      failureOf(() => fillQrContent({ signedXml: duplicated, qrContent: WORKED_EXAMPLE_URL }))
    ).toBe("MULTIPLE_PLACEHOLDERS");
  });

  it("refuses content below the XSD's minimum", () => {
    expect(
      failureOf(() =>
        fillQrContent({ signedXml: signedWithQrPlaceholder(), qrContent: "a".repeat(99) })
      )
    ).toBe("QR_CONTENT_OUT_OF_RANGE");
  });

  it("refuses content above the XSD's maximum", () => {
    expect(
      failureOf(() =>
        fillQrContent({ signedXml: signedWithQrPlaceholder(), qrContent: "a".repeat(601) })
      )
    ).toBe("QR_CONTENT_OUT_OF_RANGE");
  });

  it("accepts both boundaries the XSD states", () => {
    for (const length of [100, 600]) {
      const content = "a".repeat(length);
      const filled = fillQrContent({
        signedXml: signedWithQrPlaceholder(),
        qrContent: content,
      });
      expect(filled).toContain(content);
    }
  });

  it("pins the range to the schema's own 100..600", () => {
    expect([QR_CONTENT_MIN_LENGTH, QR_CONTENT_MAX_LENGTH]).toEqual([100, 600]);
  });
});

/**
 * The schema directory is the official one when it is present, and the suite is
 * skipped — visibly, in the title — when it is not: the schemas are copyrighted
 * and are never vendored. `DTE_XSD_REQUIRED=1` turns the absence into a failure
 * instead, so green cannot mean "validated nothing". Same guard as
 * `xsd-validation.test.ts`.
 */
const schemaDirectory = defaultDteSchemaDirectory();
const required = process.env.DTE_XSD_REQUIRED === "1";
const inspection = await inspectDteSchemas(schemaDirectory);
const skipped = !inspection.usable && !required;
const skipReason = `[SKIPPED: official schemas absent from ${schemaDirectory}; run pnpm fetch:dte-schemas]`;

describe.skipIf(skipped)(
  `the full chain — build, sign, QR, fill, XSD${skipped ? ` ${skipReason}` : ""}`,
  () => {
    it("validates against the official XSD and still verifies its signature", async () => {
      const request = requestWithQrPlaceholder();
      const signed = signDteXml({
        xml: buildDteXml(request),
        privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
        certificatePem: FIXTURE_CERTIFICATE_PEM,
        cdc: FIXTURE_CDC,
      });
      const dRucRec = request.gDatGralOpe.gDatRec.dRucRec;
      if (dRucRec === undefined) {
        throw new Error("the fixture's receptor carries no dRucRec; the QR's parameter needs one");
      }

      const filled = fillQrContent({
        signedXml: signed,
        qrContent: buildQrContent({
          environment: "test",
          cdc: FIXTURE_CDC,
          dFeEmiDE: request.gDatGralOpe.dFeEmiDE,
          dRucRec,
          dTotGralOpe: null,
          dTotIVA: null,
          cItems: 1,
          digestValue: digestValueOf(signed),
          idCsc: "0001",
          csc: TEST_CSC,
        }),
      });

      // The fill moved nothing inside the signed subtree, so the signature the
      // document was stored with still verifies.
      const verifier = new SignedXml({ publicCert: FIXTURE_CERTIFICATE_PEM });
      verifier.loadSignature(signatureOf(filled));
      expect(verifier.checkSignature(filled)).toBe(true);

      const result = await validateDeAgainstOfficialXsd(filled, schemaDirectory);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
);
