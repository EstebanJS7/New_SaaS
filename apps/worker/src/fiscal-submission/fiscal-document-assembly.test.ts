/**
 * FISC-015 WU-D2 — the assembly, asserted against the tenant's rows and the
 * protocol's own artifacts.
 *
 * The chain is proven three ways, because each catches a different failure:
 *
 * 1. **The serialized document**, field by field: the CDC the allocation's
 *    number composes, `gTimb`'s authorisation, the receptor the customer's rows
 *    produce, and the QR in its escaped form — the value is born after the
 *    document is serialized, so only the fill can carry it.
 * 2. **The signature**, cryptographically: `SignatureValue` is RSA-SHA256 over
 *    the canonicalized `SignedInfo`, checked with the certificate the document
 *    itself carries, and `DigestValue` is SHA-256 over the canonicalized `DE`
 *    subtree. `xml-crypto` is what the fiscal package verifies with and it is
 *    not a worker dependency (adding one is outside this unit's surfaces), so
 *    the two checks are made here with `node:crypto` — see
 *    {@link verifyDocumentSignature} for the canonicalization this document
 *    shape needs and why a wrong one cannot pass.
 * 3. **The official XSD** (`validateDeAgainstOfficialXsd`), which is the only
 *    check that says the document SIFEN receives is schema-valid rather than
 *    merely what we intended. It is skipped — visibly, in the title — when the
 *    schemas are absent, the same guard the other XSD suites use.
 *
 * Every `UNAVAILABLE` state has its own case and its reason code asserted, and
 * one case asserts the negative property the Story's exit criterion names: no
 * secret material is reachable from the result.
 */

import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildQrContent,
  composeCdc,
  DTE_NAMESPACE,
  QR_PLACEHOLDER,
  SIFEN_TEST_EMITTER_NAME,
  XMLDSIG_NAMESPACE,
  type FiscalCredentialPort,
  type FiscalTransportCredential,
} from "@newsaas/fiscal";
import {
  defaultDteSchemaDirectory,
  FIXTURE_CERTIFICATE_PEM,
  FIXTURE_PRIVATE_KEY_PEM,
  inspectDteSchemas,
  TEST_CERTIFICATE_NOT_AFTER,
  TEST_CERTIFICATE_NOT_BEFORE,
  validateDeAgainstOfficialXsd,
} from "@newsaas/fiscal/testing";
import type {
  CustomerAddressCountryRow,
  CustomerReceptorRow,
  DecimalColumn,
  FiscalCscPort,
  FiscalEmitterActivityRow,
  FiscalEmitterProfileRow,
  FiscalEstablishmentRow,
  InvoiceFiscalAllocation,
  InvoiceItemRow,
  InvoiceLineSnapshotRow,
  InvoiceRateRow,
  TenantTaxClassificationRow,
} from "@newsaas/fiscal-persistence";
import {
  createFiscalDocumentAssembly,
  FISCAL_ASSEMBLY_REASON_CODES,
  type FiscalDocumentAssemblyClient,
  type FiscalDocumentAssemblyInvoiceRow,
} from "./fiscal-document-assembly.js";
import type { FiscalDocumentBuildOutcome } from "./fiscal-document-builder.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const FISCAL_DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const INVOICE_ID = "33333333-3333-4333-8333-333333333333";
const CONSULTATION_ITEM_ID = "44444444-4444-4444-8444-444444444444";
const ANTIBIOTIC_ITEM_ID = "44444444-4444-4444-8444-444444444445";
const RANGE_ID = "55555555-5555-4555-8555-555555555555";
const ESTABLISHMENT_ID = "66666666-6666-4666-8666-666666666666";
const CUSTOMER_ID = "77777777-7777-4777-8777-777777777777";
const PROFILE_ID = "88888888-8888-4888-8888-888888888888";

/** `invoice.confirmed_at`: the instant `dFeEmiDE` comes from, rendered in UTC. */
const CONFIRMED_AT = new Date("2026-10-10T14:02:26.000Z");
const ISSUED_AT = "2026-10-10T14:02:26";
/** The signature's instant, injected so the test is not a function of the wall clock. */
const SIGNED_AT = new Date("2026-10-11T12:00:00.000Z");
const SIGNED_AT_TEXT = "2026-10-11T12:00:00";
/** The range's `dFeIniT`, which only the range row carries. */
const VALIDITY_START = new Date("2026-01-01T00:00:00.000Z");

/** A stand-in for the CSC, which SIFEN issues per taxpayer and is secret (§24.2). */
const TEST_CSC = "TEST0000000000000000000000000000";
const TEST_ID_CSC = "0001";

/** The mapper's totals for the two-line invoice below, at `tMontoBase`'s scale. */
const EXPECTED_TOTALS = { general: "200.00000000", taxAmount: "4.76000000" };

/** The private key's base64 body: what a leak of the key would carry. */
const PRIVATE_KEY_BODY = FIXTURE_PRIVATE_KEY_PEM.replace(/-----[^-]+-----/g, "")
  .replaceAll("\n", "")
  .slice(0, 64);

/** A Prisma `Decimal`, structurally: the readers ask for a scale and get a string. */
function dec(value: string): DecimalColumn {
  return { toFixed: (digits: number) => Number(value).toFixed(digits) };
}

const INVOICE_ROW: FiscalDocumentAssemblyInvoiceRow = {
  currency: "PYG",
  confirmedAt: CONFIRMED_AT,
  customerId: CUSTOMER_ID,
};

const CUSTOMER_ROW: CustomerReceptorRow = {
  kind: "COMPANY",
  displayName: "Cliente Principal",
  legalName: "Cliente Principal S.A.",
  taxId: "80012345",
  documentNumber: null,
  fiscalOperationType: "B2B",
};

const EXEMPT_CLASSIFICATION: TenantTaxClassificationRow = {
  rateCode: "EXEMPT",
  affectation: "EXENTO",
  proportionality: null,
};

const IVA_5_CLASSIFICATION: TenantTaxClassificationRow = {
  rateCode: "IVA_5",
  affectation: "GRAVADO_IVA",
  proportionality: null,
};

interface FixtureState {
  readonly document: { invoiceId: string } | null;
  readonly invoice: FiscalDocumentAssemblyInvoiceRow | null;
  readonly range: { validityStart: Date } | null;
  readonly profileRow: FiscalEmitterProfileRow | null;
  readonly activities: readonly FiscalEmitterActivityRow[];
  readonly establishment: FiscalEstablishmentRow | null;
  readonly customer: CustomerReceptorRow | null;
  readonly addresses: readonly CustomerAddressCountryRow[];
  readonly allocation: InvoiceFiscalAllocation | null;
  readonly lines: readonly InvoiceLineSnapshotRow[];
  readonly items: readonly InvoiceItemRow[];
  readonly taxRates: readonly InvoiceRateRow[];
  readonly classifications: readonly TenantTaxClassificationRow[];
}

/**
 * The happy path's rows: a company receptor declared B2B, one exempt line and
 * one 5%-taxed line, and a timbrado range with a series.
 */
const HAPPY_PATH: FixtureState = {
  document: { invoiceId: INVOICE_ID },
  invoice: INVOICE_ROW,
  range: { validityStart: VALIDITY_START },
  profileRow: {
    id: PROFILE_ID,
    ruc: "80012345",
    checkDigit: "0",
    taxpayerType: 2,
    regimeCode: null,
    legalName: "Veterinaria Sur S.A.",
    tradeName: null,
    responsibleIssuerType: null,
    responsibleIssuerTypeName: null,
    responsibleIssuerId: null,
    responsibleIssuerName: null,
    responsibleIssuerRole: null,
    transactionType: 1,
    taxType: 1,
    emissionType: 1,
    defaultEstablishmentId: ESTABLISHMENT_ID,
    defaultExpeditionPoint: "002",
    defaultDocumentType: 1,
  },
  activities: [{ code: "47730", description: "Venta al por menor" }],
  establishment: {
    code: "001",
    addressLine: "Av. Test 123",
    houseNumber: 123,
    addressComplement1: null,
    addressComplement2: null,
    departmentCode: 1,
    districtCode: null,
    districtName: null,
    cityCode: 1,
    cityName: "ASUNCION",
    phone: "021123456",
    email: "test@example.com",
    branchName: null,
  },
  customer: CUSTOMER_ROW,
  addresses: [],
  allocation: {
    rangeId: RANGE_ID,
    timbradoNumber: "12345678",
    establishmentId: ESTABLISHMENT_ID,
    expeditionPoint: "002",
    documentType: 1,
    series: "AB",
    documentNumber: "0000007",
  },
  lines: [
    {
      catalogItemId: CONSULTATION_ITEM_ID,
      description: "Consulta veterinaria",
      rateCode: "EXEMPT",
      quantity: dec("1.000"),
      unitPrice: dec("100.00"),
      lineTotal: dec("100.00"),
      taxableBase: dec("100.00"),
      taxAmount: dec("0.00"),
    },
    {
      catalogItemId: ANTIBIOTIC_ITEM_ID,
      description: "Antibiótico",
      rateCode: "IVA_5",
      quantity: dec("2.000"),
      unitPrice: dec("50.00"),
      lineTotal: dec("100.00"),
      taxableBase: dec("95.24"),
      taxAmount: dec("4.76"),
    },
  ],
  items: [
    { id: CONSULTATION_ITEM_ID, unitOfMeasureCode: "77" },
    { id: ANTIBIOTIC_ITEM_ID, unitOfMeasureCode: "77" },
  ],
  taxRates: [
    { code: "EXEMPT", rate: dec("0.00") },
    { code: "IVA_5", rate: dec("5.00") },
  ],
  classifications: [EXEMPT_CLASSIFICATION, IVA_5_CLASSIFICATION],
};

/** The credential the fixture certificate carries: valid, and inside its window. */
function fixtureCredential(): FiscalTransportCredential {
  return {
    certificatePem: FIXTURE_CERTIFICATE_PEM,
    privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
    notBefore: new Date(TEST_CERTIFICATE_NOT_BEFORE),
    notAfter: new Date(TEST_CERTIFICATE_NOT_AFTER),
  };
}

/**
 * The client the assembly reads through: one statement per member, exactly the
 * shape `PrismaService` provides — and no `$transaction`, which is the assembly's
 * "no transaction of its own" stated as a fact of its input.
 */
function createFakeClient(state: FixtureState): FiscalDocumentAssemblyClient {
  return {
    fiscalDocument: { findFirst: () => Promise.resolve(state.document) },
    invoice: { findFirst: () => Promise.resolve(state.invoice) },
    fiscalTimbradoRange: { findFirst: () => Promise.resolve(state.range) },
    fiscalEmitterProfile: { findUnique: () => Promise.resolve(state.profileRow) },
    fiscalEmitterActivity: { findMany: () => Promise.resolve(state.activities) },
    fiscalEstablishment: { findFirst: () => Promise.resolve(state.establishment) },
    customer: { findFirst: () => Promise.resolve(state.customer) },
    customerAddress: { findMany: () => Promise.resolve(state.addresses) },
    invoiceFiscalAllocation: { findFirst: () => Promise.resolve(state.allocation) },
    invoiceLine: { findMany: () => Promise.resolve(state.lines) },
    catalogItem: { findMany: () => Promise.resolve(state.items) },
    taxRate: { findMany: () => Promise.resolve(state.taxRates) },
    tenantTaxClassification: {
      findFirst: () => Promise.resolve(state.classifications[0] ?? null),
      findMany: () => Promise.resolve(state.classifications),
    },
  };
}

interface BuildOverrides {
  readonly state?: Partial<FixtureState>;
  readonly environment?: "TEST" | "PRODUCTION";
  readonly credential?: FiscalTransportCredential | null;
  readonly csc?: { readonly idCsc: string; readonly csc: string } | null;
  readonly now?: Date;
  readonly randomDigit?: () => number;
  readonly credentialReads?: { tenantId: string; environment: string }[];
  readonly cscReads?: { tenantId: string; environment: string }[];
}

/** Runs one build over the fixture, with the state and the ports the case needs. */
async function build(
  overrides: BuildOverrides = {}
): Promise<{ readonly result: FiscalDocumentBuildOutcome; readonly state: FixtureState }> {
  const state: FixtureState = { ...HAPPY_PATH, ...overrides.state };
  const credentialReads = overrides.credentialReads ?? [];
  const cscReads = overrides.cscReads ?? [];

  const credentialPort: FiscalCredentialPort = {
    read: ({ tenantId, environment }) => {
      credentialReads.push({ tenantId, environment });
      return Promise.resolve(
        overrides.credential === undefined ? fixtureCredential() : overrides.credential
      );
    },
  };
  const cscPort: FiscalCscPort = {
    read: ({ tenantId, environment }) => {
      cscReads.push({ tenantId, environment });
      return Promise.resolve(
        overrides.csc === undefined ? { idCsc: TEST_ID_CSC, csc: TEST_CSC } : overrides.csc
      );
    },
  };

  const assembly = createFiscalDocumentAssembly({
    client: createFakeClient(state),
    credentialPort,
    cscPort,
    environment: overrides.environment ?? "TEST",
    now: () => overrides.now ?? SIGNED_AT,
    randomDigit: overrides.randomDigit ?? ((): number => 3),
  });

  const result = await assembly.build({
    tenantId: TENANT_ID,
    fiscalDocumentId: FISCAL_DOCUMENT_ID,
  });
  return { result, state };
}

/** The `BUILT` document, or a failed expectation naming the outcome it got. */
function built(result: FiscalDocumentBuildOutcome): {
  readonly cdc: string;
  readonly signedXml: string;
} {
  expect(result.outcome).toBe("BUILT");
  if (result.outcome !== "BUILT") {
    throw new Error(`expected BUILT, received ${result.outcome}`);
  }
  // `FiscalIssueDocument.cdc` is nullable since FISC-016: a range void has no
  // document identity to report, and the port says so instead of inventing one.
  // A BUILT document always carries its CDC, so this is the assertion that the
  // widening did not turn into a silent hole here.
  if (result.document.cdc === null) {
    throw new Error("a BUILT document always carries its CDC");
  }
  return { cdc: result.document.cdc, signedXml: result.document.signedXml };
}

/** Asserts one named refusal, and that no secret travels inside it. */
function expectUnavailable(result: FiscalDocumentBuildOutcome, reasonCode: string): void {
  expect(result.outcome).toBe("UNAVAILABLE");
  if (result.outcome !== "UNAVAILABLE") {
    throw new Error(`expected UNAVAILABLE, received ${result.outcome}`);
  }
  expect(result.reasonCode).toBe(reasonCode);
  expect(result.reason.length).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toContain(TEST_CSC);
  expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
}

/** The signed `DE` subtree, which the QR fill must not touch. */
function deSubtreeOf(xml: string): string {
  const start = xml.indexOf("<DE ");
  const end = xml.indexOf("</DE>");
  expect(start, "the document carries a <DE> element").toBeGreaterThan(-1);
  expect(end, "the document closes its <DE> element").toBeGreaterThan(start);
  return xml.slice(start, end + "</DE>".length);
}

/** The `Signature` block, or a failed expectation when it is absent. */
function signatureOf(xml: string): string {
  const start = xml.indexOf("<Signature");
  const end = xml.indexOf("</Signature>");
  expect(start, "the document carries a <Signature> element").toBeGreaterThan(-1);
  expect(end, "the document closes its <Signature> element").toBeGreaterThan(start);
  return xml.slice(start, end + "</Signature>".length);
}

/** The signature's own digest, read from the document the signer produced. */
function digestValueOf(signedXml: string): string {
  const digest = /<DigestValue>([^<]*)<\/DigestValue>/.exec(signedXml)?.[1];
  expect(digest, "the signed document carries the signature's DigestValue").toBeTruthy();
  return digest ?? "";
}

/** The signature's value, base64 as the document carries it. */
function signatureValueOf(signedXml: string): string {
  const value = /<SignatureValue>([^<]*)<\/SignatureValue>/.exec(signedXml)?.[1];
  expect(value, "the signed document carries its SignatureValue").toBeTruthy();
  return value ?? "";
}

/** The certificate the document embeds, as the PEM `createPublicKey` takes. */
function certificateOf(signedXml: string): string {
  const body = /<X509Certificate>([^<]*)<\/X509Certificate>/.exec(signedXml)?.[1];
  expect(body, "the signed document carries its X509Certificate").toBeTruthy();
  const wrapped = (body ?? "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${wrapped.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/**
 * C14N, reduced to the two rules this document shape needs.
 *
 * The profile signs **inclusive 2001 c14n over `SignedInfo`** and digests the
 * `DE` subtree through **exclusive c14n** (§5). For a document `buildDteXml`
 * produces, the two agree with the serialized bytes except in two respects: an
 * apex element inherits a namespace declaration its parent carries (the
 * `xmlns` of `rDE` for `DE`, of `Signature` for `SignedInfo`), and an empty
 * element is written as a start/end pair rather than self-closed. Both are
 * applied here.
 *
 * This cannot pass wrongly: no canonical form other than the one the signer
 * used reproduces a digest or an RSA signature. A document shape that needed a
 * third rule — a comment, a CDATA section, a prefixed namespace — fails these
 * checks loudly instead.
 */
function canonicalize(xml: string, apex: string, namespace: string): string {
  return xml
    .replace(`<${apex}`, `<${apex} xmlns="${namespace}"`)
    .replace(/<([A-Za-z][A-Za-z0-9]*)([^>]*?)\/>/g, "<$1$2></$1>");
}

/** Whether the document's digest and signature verify against its own certificate. */
function verifyDocumentSignature(xml: string): {
  readonly digest: boolean;
  readonly signature: boolean;
} {
  const signedInfoStart = xml.indexOf("<SignedInfo>");
  const signedInfoEnd = xml.indexOf("</SignedInfo>");
  expect(signedInfoStart, "the signature carries its SignedInfo").toBeGreaterThan(-1);
  expect(signedInfoEnd).toBeGreaterThan(signedInfoStart);

  const digest =
    createHash("sha256")
      .update(canonicalize(deSubtreeOf(xml), "DE", DTE_NAMESPACE), "utf8")
      .digest("base64") === digestValueOf(xml);

  const signedInfo = canonicalize(
    xml.slice(signedInfoStart, signedInfoEnd + "</SignedInfo>".length),
    "SignedInfo",
    XMLDSIG_NAMESPACE
  );
  const signature = verify(
    "sha256",
    Buffer.from(signedInfo, "utf8"),
    createPublicKey(certificateOf(xml)),
    Buffer.from(signatureValueOf(xml), "base64")
  );

  return { digest, signature };
}

/** The CDC the allocation's number and the profile compose, recomputed here. */
function expectedCdc(securityCode: string): string {
  return composeCdc({
    iTiDE: 1,
    dRucEm: "80012345",
    dDVEmi: "0",
    dEst: "001",
    dPunExp: "002",
    dNumDoc: "0000007",
    iTipCont: 2,
    dFeEmiDE: ISSUED_AT,
    iTipEmi: 1,
    dCodSeg: securityCode,
  }).cdc;
}

/** The QR the chain must have filled in, recomputed from the document's own values. */
function expectedQrContent(cdc: string, digestValue: string): string {
  return buildQrContent({
    environment: "test",
    cdc,
    dFeEmiDE: ISSUED_AT,
    dRucRec: "80012345",
    dTotGralOpe: EXPECTED_TOTALS.general,
    dTotIVA: EXPECTED_TOTALS.taxAmount,
    cItems: 2,
    digestValue,
    idCsc: TEST_ID_CSC,
    csc: TEST_CSC,
  });
}

describe("the assembly — the chain", () => {
  it("builds the document from the tenant's rows: CDC, timbrado, receptor and QR", async () => {
    const { result } = await build();
    const document = built(result);

    // The identity: composed from the allocation's number and the timbrado, with
    // the security code drawn from the injected source.
    expect(document.cdc).toBe(expectedCdc("333333333"));
    expect(document.signedXml).toContain(`<DE Id="${document.cdc}">`);

    // `gTimb`: the allocation's authorisation snapshot, and the range's dFeIniT.
    expect(document.signedXml).toContain("<dNumTim>12345678</dNumTim>");
    expect(document.signedXml).toContain("<dEst>001</dEst>");
    expect(document.signedXml).toContain("<dPunExp>002</dPunExp>");
    expect(document.signedXml).toContain("<dNumDoc>0000007</dNumDoc>");
    expect(document.signedXml).toContain("<dSerieNum>AB</dSerieNum>");
    expect(document.signedXml).toContain("<dFeIniT>2026-01-01</dFeIniT>");

    // The emitter: the profile's identity, the establishment's address, the test
    // environment's name literal (§22.5) and the derived department name.
    expect(document.signedXml).toContain("<dRucEm>80012345</dRucEm>");
    expect(document.signedXml).toContain(`<dNomEmi>${SIFEN_TEST_EMITTER_NAME}</dNomEmi>`);
    expect(document.signedXml).toContain("<dDesDepEmi>CAPITAL</dDesDepEmi>");
    expect(document.signedXml).toContain("<cActEco>47730</cActEco>");

    // The receptor: the customer's own rows.
    expect(document.signedXml).toContain("<dRucRec>80012345</dRucRec>");
    expect(document.signedXml).toContain("<dDVRec>0</dDVRec>");
    expect(document.signedXml).toContain("<iTiOpe>1</iTiOpe>");
    expect(document.signedXml).toContain("<dNomRec>Cliente Principal S.A.</dNomRec>");
    expect(document.signedXml).toContain("<cPaisRec>PRY</cPaisRec>");

    // The document's own instants, and the security code the CDC carries too.
    expect(document.signedXml).toContain(`<dFeEmiDE>${ISSUED_AT}</dFeEmiDE>`);
    expect(document.signedXml).toContain(`<dFecFirma>${SIGNED_AT_TEXT}</dFecFirma>`);
    expect(document.signedXml).toContain("<dCodSeg>333333333</dCodSeg>");
  });

  it("fills the QR after signing, escaped, with the signature's own digest", async () => {
    const { result } = await build();
    const document = built(result);

    const digestValue = digestValueOf(document.signedXml);
    const qrContent = expectedQrContent(document.cdc, digestValue);

    // The placeholder is gone, and the escaped URL is exactly what §24.3's step 5
    // writes: the `&` of every parameter becomes `&amp;`.
    expect(document.signedXml).not.toContain(QR_PLACEHOLDER);
    expect(document.signedXml).toContain(`<dCarQR>${qrContent.replaceAll("&", "&amp;")}</dCarQR>`);
    expect(document.signedXml).not.toContain(`<dCarQR>${qrContent}</dCarQR>`);

    // The CSC was hashed, never emitted (§24.2).
    expect(document.signedXml).not.toContain(TEST_CSC);
  });

  it("still verifies its signature and its digest after the QR fill", async () => {
    const { result } = await build();
    const document = built(result);

    const verification = verifyDocumentSignature(document.signedXml);
    expect(verification.digest).toBe(true);
    expect(verification.signature).toBe(true);
    // The public half the signature needs is the fixture's, and it is the only
    // material the document carries.
    expect(certificateOf(document.signedXml).trim()).toBe(FIXTURE_CERTIFICATE_PEM.trim());
    expect(document.signedXml).not.toContain("PRIVATE KEY");

    // The profile's own invariants (§5), which a library default could break: one
    // signature, the mixed canonicalization pair in order, and no KeyInfo element
    // the certificate already carries.
    const signature = signatureOf(document.signedXml);
    expect(document.signedXml.match(/<Signature[\s>]/g)?.length).toBe(1);
    expect(signature).toContain(
      '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>'
    );
    expect(signature).toContain(
      '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>'
    );
    expect(signature).toContain('<Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>');
    expect(signature).toContain(
      '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>'
    );
    expect(signature).not.toMatch(/<X509SubjectName|<KeyValue|<RSAKeyValue/);
  });

  it("carries the certificate but no private key, no CSC and no PEM armor", async () => {
    const { result } = await build();
    const document = built(result);
    const serialized = JSON.stringify(result);

    // The public half is required by `KeyInfo` (§5) — the leak assertions below
    // are therefore not vacuous.
    expect(document.signedXml).toContain("<X509Certificate>");
    expect(serialized).not.toContain("-----BEGIN");
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(TEST_CSC);
    expect(serialized).not.toContain(PRIVATE_KEY_BODY);
  });

  it("reads the credential and the CSC once, for the deployment's environment", async () => {
    const credentialReads: { tenantId: string; environment: string }[] = [];
    const cscReads: { tenantId: string; environment: string }[] = [];
    const { result } = await build({ credentialReads, cscReads });
    built(result);

    expect(credentialReads).toEqual([{ tenantId: TENANT_ID, environment: "TEST" }]);
    expect(cscReads).toEqual([{ tenantId: TENANT_ID, environment: "TEST" }]);
  });

  it("maps the deployment's environment to the document's, in one place", async () => {
    const credentialReads: { tenantId: string; environment: string }[] = [];
    const { result } = await build({ environment: "PRODUCTION", credentialReads });
    const document = built(result);

    // The upper-case vocabulary is the deployment's: it reached the read.
    expect(credentialReads[0]?.environment).toBe("PRODUCTION");
    // The lower-case one is the document's: the tenant's own name is emitted
    // instead of §22.5's test literal, and the QR points at the production host.
    expect(document.signedXml).toContain("<dNomEmi>Veterinaria Sur S.A.</dNomEmi>");
    expect(document.signedXml).toContain(
      "<dCarQR>https://ekuatia.set.gov.py/consultas/qr?nVersion=150&amp;"
    );
  });

  it("keeps the QR outside the signed subtree", async () => {
    const { result } = await build();
    const document = built(result);

    // The QR is in `gCamFuFD`, after `</DE>` (§4), which is why the fill cannot
    // invalidate the signature — asserted structurally, not only by verifying it.
    expect(deSubtreeOf(document.signedXml)).not.toContain("dCarQR");
    expect(document.signedXml.indexOf("<dCarQR>")).toBeGreaterThan(
      document.signedXml.indexOf("</DE>")
    );
  });
});

describe("the assembly — every UNAVAILABLE state", () => {
  it("answers FISCAL_DOCUMENT_UNAVAILABLE when the claimed document is unreadable", async () => {
    const { result } = await build({ state: { document: null } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.DOCUMENT_UNAVAILABLE);
  });

  it("answers CREDENTIAL_UNAVAILABLE when the tenant has no ACTIVE signing material", async () => {
    const { result } = await build({ credential: null });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.CREDENTIAL_UNAVAILABLE);
  });

  it("answers CREDENTIAL_EXPIRED when the certificate's window has closed", async () => {
    const { result } = await build({
      credential: { ...fixtureCredential(), notAfter: SIGNED_AT },
    });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.CREDENTIAL_EXPIRED);
  });

  it("answers CREDENTIAL_NOT_YET_VALID when the certificate's window has not opened", async () => {
    const { result } = await build({
      // One second after the instant the document would be signed at: the lower
      // bound is inclusive (ADR-008 §2), so equality is fresh.
      credential: { ...fixtureCredential(), notBefore: new Date(SIGNED_AT.getTime() + 1000) },
    });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.CREDENTIAL_NOT_YET_VALID);
  });

  it("answers CSC_UNAVAILABLE when the tenant has no ACTIVE CSC", async () => {
    const { result } = await build({ csc: null });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.CSC_UNAVAILABLE);
  });

  it("answers FISCAL_NUMBER_NOT_ALLOCATED for a counter-path invoice", async () => {
    const { result } = await build({ state: { allocation: null } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.FISCAL_NUMBER_NOT_ALLOCATED);
    if (result.outcome === "UNAVAILABLE") {
      expect(result.reason).toContain("counter path");
    }
  });

  it("answers TIMBRADO_RANGE_UNAVAILABLE when the allocation's range is unreadable", async () => {
    const { result } = await build({ state: { range: null } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.TIMBRADO_RANGE_UNAVAILABLE);
  });

  it("answers FISCAL_PROFILE_UNAVAILABLE when the tenant has no fiscal profile", async () => {
    const { result } = await build({ state: { profileRow: null } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.FISCAL_PROFILE_UNAVAILABLE);
  });

  it("answers FISCAL_ESTABLISHMENT_UNAVAILABLE when the establishment is unreadable", async () => {
    const { result } = await build({ state: { establishment: null } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.ESTABLISHMENT_UNAVAILABLE);
  });

  it("answers INVOICE_UNAVAILABLE when the invoice row is unreadable", async () => {
    const { result } = await build({ state: { invoice: null } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.INVOICE_UNAVAILABLE);
  });

  it("answers the receptor read's OPERATION_TYPE_NOT_DECLARED when iTiOpe is undeclared", async () => {
    const { result } = await build({
      state: { customer: { ...CUSTOMER_ROW, fiscalOperationType: null } },
    });
    expectUnavailable(result, "OPERATION_TYPE_NOT_DECLARED");
  });

  it("answers the receptor read's RECEPTOR_CUSTOMER_ABSENT for a walk-in invoice", async () => {
    const { result } = await build({ state: { invoice: { ...INVOICE_ROW, customerId: null } } });
    expectUnavailable(result, "RECEPTOR_CUSTOMER_ABSENT");
  });

  it("answers the snapshot read's RATE_NOT_CLASSIFIED when a line's rate has no declaration", async () => {
    const { result } = await build({ state: { classifications: [EXEMPT_CLASSIFICATION] } });
    expectUnavailable(result, "RATE_NOT_CLASSIFIED");
  });

  it("answers the snapshot read's ITEM_UNIT_NOT_DECLARED when the item declares no unit", async () => {
    const { result } = await build({
      state: { items: [{ id: CONSULTATION_ITEM_ID, unitOfMeasureCode: null }] },
    });
    expectUnavailable(result, "ITEM_UNIT_NOT_DECLARED");
  });

  it("answers CURRENCY_NOT_SUPPORTED for a non-PYG invoice", async () => {
    const { result } = await build({ state: { invoice: { ...INVOICE_ROW, currency: "USD" } } });
    expectUnavailable(result, FISCAL_ASSEMBLY_REASON_CODES.CURRENCY_NOT_SUPPORTED);
    if (result.outcome === "UNAVAILABLE") {
      expect(result.reason).toContain("F023");
    }
  });

  it("answers the profile assembly's NO_ACTIVITY when the tenant declares none", async () => {
    const { result } = await build({ state: { activities: [] } });
    expectUnavailable(result, "NO_ACTIVITY");
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
  `the built document and the official XSD${skipped ? ` ${skipReason}` : ""}`,
  () => {
    it("validates against the official schema, signature and QR included", async () => {
      const { result } = await build();
      const document = built(result);

      const validation = await validateDeAgainstOfficialXsd(document.signedXml, schemaDirectory);
      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);
    });
  }
);
