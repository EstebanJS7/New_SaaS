/**
 * FISC-008 WU-B — the schema-validation fixture.
 *
 * Test scaffolding, not part of the package's public contract: it is exported
 * from `@newsaas/fiscal/testing`, following the same rule as the PKCS#12
 * fixture.
 *
 * Two things about this fixture are deliberate and load-bearing:
 *
 * 1. **`gDtipDE` is supplied as an ordered element tree**, not through a typed
 *    group. Baseline §21.6 records that the members of `gDtipDE`, `gTotSub`,
 *    `gCamGen` and `gCamDEAsoc` are NOT transcribed, and §22.10 records that the
 *    item area is provisional. The XSD's own requirement is small — one
 *    `gCamItem` carrying `dCodInt`, `dDesProSer`, `cUniMed`, `dDesUniMed` and
 *    `dCantProSer` — so the fixture supplies exactly that and nothing is
 *    inferred about the rest.
 * 2. **The signature is structurally complete and cryptographically fake.**
 *    The XSD's `ds:Signature` is `ds:SignatureType`, whose `SignedInfo` is
 *    required, so the `<Signature/>` placeholder WU-A emits is *schema-invalid*.
 *    WU-A's Story puts signing out of scope, so the fixture substitutes a block
 *    with the real structure — the two ordered transforms, the SHA-256 digest
 *    method, `X509Data/X509Certificate` — and base64-valid but meaningless
 *    contents (`QUJDREVGRw==`). Producing the real signature is [[FISC-009]]'s.
 */

import { SIFEN_TEST_EMITTER_NAME, type DteRequest } from "./dte.types.js";

/**
 * The KuDE specimen's 44-digit grouping, recorded in baseline §22.9 as
 * `0144 4444 0170 0100 1001 4528 2201 7012 5158 7326 0988`. It is a specimen,
 * not a composed CDC — WU-A never composes one (§22.9). Written as its eleven
 * groups so the value cannot drift from the cited one on retyping.
 */
const SPECIMEN_GROUPS = [
  "0144",
  "4444",
  "0170",
  "0100",
  "1001",
  "4528",
  "2201",
  "7012",
  "5158",
  "7326",
  "0988",
] as const;

export const FIXTURE_CDC = SPECIMEN_GROUPS.join("");

export const FIXTURE_DOCUMENT_NUMBER = "0000002";
export const FIXTURE_SECURITY_CODE = "123456789";

export const STRUCTURAL_SIGNATURE = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
      <SignedInfo>
        <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
        <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
        <Reference URI="#${FIXTURE_CDC}">
          <Transforms>
            <Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
            <Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
          </Transforms>
          <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
          <DigestValue>Nt2UmpjUHuu2DT6CJc2mtKhhqbq94LHSak1IsEOtuWk=</DigestValue>
        </Reference>
      </SignedInfo>
      <SignatureValue>QUJDREVGRw==</SignatureValue>
      <KeyInfo>
        <X509Data>
          <X509Certificate>QUJDREVGRw==</X509Certificate>
        </X509Data>
      </KeyInfo>
    </Signature>`;

/** A 120-character `dCarQR`; the XSD requires 100..600 and FISC-012 owns the content. */
export const FIXTURE_QR =
  `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=${FIXTURE_CDC}`.padEnd(120, "0");

/**
 * A request that satisfies both the cited rules and the official schema: every
 * group the XSD requires, with the optional `gOpeCom`, `gTotSub`, `gCamGen` and
 * `gCamDEAsoc` in the state this fixture chooses.
 */
export function validFacturaElectronicaRequest(): DteRequest {
  return {
    cdc: FIXTURE_CDC,
    dDVId: "7",
    dFecFirma: "2026-10-05T12:34:56",
    environment: "test",
    gOpeDE: {
      iTipEmi: 1,
      dDesTipEmi: "Normal",
      dCodSeg: FIXTURE_SECURITY_CODE,
    },
    gTimb: {
      iTiDE: 1,
      dDesTiDE: "Factura electrónica",
      dNumTim: "12345678",
      dEst: "001",
      dPunExp: "002",
      dNumDoc: FIXTURE_DOCUMENT_NUMBER,
      dSerieNum: "AB",
      dFeIniT: "2018-05-01",
    },
    gDatGralOpe: {
      dFeEmiDE: "2026-10-05T12:34:56",
      gOpeCom: {
        iTipTra: 1,
        dDesTipTra: "Venta de mercadería",
        iTImp: 1,
        dDesTImp: "IVA",
        cMoneOpe: "PYG",
        dDesMoneOpe: "Guaraní",
      },
      gEmis: {
        dRucEm: "1234567",
        dDVEmi: "8",
        iTipCont: 2,
        dNomEmi: SIFEN_TEST_EMITTER_NAME,
        dDirEmi: "Av. Test 123",
        dNumCas: "0",
        cDepEmi: "1",
        dDesDepEmi: "CAPITAL",
        cCiuEmi: "1",
        dDesCiuEmi: "ASUNCION",
        dTelEmi: "021123456",
        dEmailE: "test@example.com",
        gActEco: [{ cActEco: "47730", dDesActEco: "Venta al por menor" }],
      },
      gDatRec: {
        iNatRec: 1,
        iTiOpe: 1,
        cPaisRec: "PRY",
        dDesPaisRe: "Paraguay",
        dRucRec: "7654321",
        dDVRec: "9",
        dNomRec: "Cliente Principal",
      },
    },
    gDtipDE: [
      {
        name: "gCamItem",
        children: [
          { name: "dCodInt", value: "SKU001" },
          { name: "dDesProSer", value: "Servicio de prueba" },
          { name: "cUniMed", value: "77" },
          { name: "dDesUniMed", value: "UNI" },
          { name: "dCantProSer", value: "1.00000000", decimalType: "tdCantProSer" },
        ],
      },
    ],
    gCamFuFD: { dCarQR: FIXTURE_QR },
  };
}

/**
 * Replaces WU-A's `<Signature/>` placeholder with the structurally complete
 * block, which is what makes an unsigned DE validatable at all. Test scaffolding
 * standing in for [[FISC-009]].
 */
export function withStructuralSignature(xml: string): string {
  const placeholder = '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>';
  if (!xml.includes(placeholder)) {
    throw new Error(
      `Expected the builder's signature placeholder; the fixture is out of step with dte.builder.ts.`
    );
  }
  return xml.replace(placeholder, STRUCTURAL_SIGNATURE);
}
