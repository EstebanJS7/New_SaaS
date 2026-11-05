import { describe, expect, it } from "vitest";
import { buildDteXml } from "./dte.builder.js";
import { composeCdc } from "./dte.cdc.js";
import { buildDteRequestFromCreditNote, type CreditNoteMappingInput } from "./dte.credit-note.js";
import { buildKudeDocument } from "../kude/kude.builder.js";
import { FIXTURE_CDC, validFacturaElectronicaRequest } from "./dte.fixture.js";
import { DteValidationError, assertValidDteRequest } from "./dte.rules.js";
import type { DteRequest } from "./dte.types.js";

const FIXTURE = validFacturaElectronicaRequest();

const NOTE_IDENTITY = composeCdc({
  iTiDE: 5,
  dRucEm: "1234567",
  dDVEmi: "8",
  dEst: "001",
  dPunExp: "002",
  dNumDoc: "0000001",
  iTipCont: 2,
  dFeEmiDE: "20261104",
  iTipEmi: 1,
  dCodSeg: "123456789",
});

function input(overrides: Partial<CreditNoteMappingInput> = {}): CreditNoteMappingInput {
  return {
    invoice: {
      issuedAt: "2026-11-04T09:00:00",
      currency: "PYG",
      currencyDescription: "Guaraní",
      lines: [
        {
          itemCode: "SKU001",
          description: "Consulta",
          unitOfMeasureCode: "77",
          unitOfMeasureDescription: "UNI",
          quantity: "1",
          unitPrice: "110000",
          lineTotal: "110000",
          taxableBase: "100000",
          taxAmount: "10000",
          affectation: 1,
          ivaRate: 10,
        },
      ],
      receptor: FIXTURE.gDatGralOpe.gDatRec,
    },
    profile: {
      emitter: FIXTURE.gDatGralOpe.gEmis,
      timbrado: {
        ...FIXTURE.gTimb,
        iTiDE: 5,
        dDesTiDE: "Nota de crédito electrónica",
        dNumDoc: "0000001",
      },
      operation: { iTImp: 1, dDesTImp: "IVA", iTipTra: 2, dDesTipTra: "Prestación de servicios" },
      emissionType: { code: 1, description: "Normal" },
    },
    identity: {
      cdc: NOTE_IDENTITY.cdc,
      dDVId: NOTE_IDENTITY.dDVId,
      securityCode: "123456789",
      environment: "test",
    },
    signatureTimestamp: "2026-11-04T09:00:05",
    qrContent: FIXTURE.gCamFuFD.dCarQR,
    motive: 2,
    associatedCdc: FIXTURE_CDC,
    ...overrides,
  };
}

describe("buildDteRequestFromCreditNote (NCE-001)", () => {
  it("opens gDtipDE with gCamNCDE and references the factura once", () => {
    const { request, totals } = buildDteRequestFromCreditNote(input());
    const xml = buildDteXml(request).replace(/>\s+</g, "><");

    expect(xml).toContain(
      "<gCamNCDE><iMotEmi>2</iMotEmi><dDesMotEmi>Devolución</dDesMotEmi></gCamNCDE>"
    );
    expect(xml.indexOf("<gCamNCDE>")).toBeLessThan(xml.indexOf("<gCamItem>"));
    expect(xml).toContain(
      `<gCamDEAsoc><iTipDocAso>1</iTipDocAso><dDesTipDocAso>Electrónico</dDesTipDocAso>` +
        `<dCdCDERef>${FIXTURE_CDC}</dCdCDERef></gCamDEAsoc>`
    );
    expect(xml.match(/<gCamDEAsoc>/g)).toHaveLength(1);
    expect(xml).toContain("<iTiDE>5</iTiDE>");
    expect(totals.general).toBe("110000.00000000");
  });

  it("does not inform iTipTra (D011: only for types 1 and 4)", () => {
    const { request } = buildDteRequestFromCreditNote(input());
    expect(request.gDatGralOpe.gOpeCom?.iTipTra).toBeUndefined();
    expect(buildDteXml(request)).not.toContain("<iTipTra>");
  });

  it("refuses an unknown motive", () => {
    expect(() => buildDteRequestFromCreditNote(input({ motive: 9 }))).toThrow(DteValidationError);
  });

  it("refuses a timbrado that is not for document type 5", () => {
    expect(() =>
      buildDteRequestFromCreditNote(
        input({ profile: { ...input().profile, timbrado: FIXTURE.gTimb } })
      )
    ).toThrow(/document type 5/);
  });
});

describe("document-type group rules", () => {
  const note = (): DteRequest => buildDteRequestFromCreditNote(input()).request;

  it("accepts the note and the factura fixture as they are", () => {
    expect(() => assertValidDteRequest(note())).not.toThrow();
    expect(() => assertValidDteRequest(FIXTURE)).not.toThrow();
  });

  it("1450: a note without gCamNCDE is refused", () => {
    const request = note();
    const broken = {
      ...request,
      gDtipDE: (request.gDtipDE ?? []).filter((element) => element.name !== "gCamNCDE"),
    };
    expect(() => assertValidDteRequest(broken)).toThrow(/1450/);
  });

  it("1451: a factura carrying gCamNCDE is refused", () => {
    const broken = {
      ...FIXTURE,
      gDtipDE: [
        {
          name: "gCamNCDE",
          children: [
            { name: "iMotEmi", value: "2" },
            { name: "dDesMotEmi", value: "Devolución" },
          ],
        },
        ...(FIXTURE.gDtipDE ?? []),
      ],
    };
    expect(() => assertValidDteRequest(broken)).toThrow(/1451/);
  });

  it("1452: a description that does not match the motive is refused", () => {
    const request = note();
    const broken = {
      ...request,
      gDtipDE: (request.gDtipDE ?? []).map((element) =>
        element.name === "gCamNCDE"
          ? {
              name: "gCamNCDE",
              children: [
                { name: "iMotEmi", value: "2" },
                { name: "dDesMotEmi", value: "Descuento" },
              ],
            }
          : element
      ),
    };
    expect(() => assertValidDteRequest(broken)).toThrow(/1452/);
  });

  it("2400/2415: a note needs exactly one associated document", () => {
    expect(() => assertValidDteRequest({ ...note(), gCamDEAsoc: [] })).toThrow(/2400/);
    const twice = note();
    expect(() =>
      assertValidDteRequest({
        ...twice,
        gCamDEAsoc: [...(twice.gCamDEAsoc ?? []), ...(twice.gCamDEAsoc ?? [])],
      })
    ).toThrow(/2415/);
  });

  it("2414: a note may only reference a factura electrónica", () => {
    const otherNote = `05${FIXTURE_CDC.slice(2)}`;
    expect(() =>
      assertValidDteRequest({
        ...note(),
        gCamDEAsoc: [
          [
            { name: "iTipDocAso", value: "1" },
            { name: "dDesTipDocAso", value: "Electrónico" },
            { name: "dCdCDERef", value: otherNote },
          ],
        ],
      })
    ).toThrow(/2414/);
  });

  it("1351/1501: a note carrying the factura's gCamFE or gCamCond is refused", () => {
    const request = note();
    const facturaGroups = (FIXTURE.gDtipDE ?? []).filter(
      (element) => element.name === "gCamFE" || element.name === "gCamCond"
    );
    expect(facturaGroups).toHaveLength(2);
    expect(() =>
      assertValidDteRequest({ ...request, gDtipDE: [facturaGroups[0], ...(request.gDtipDE ?? [])] })
    ).toThrow(/1351/);
    expect(() =>
      assertValidDteRequest({
        ...request,
        gDtipDE: [
          ...(request.gDtipDE ?? []).slice(0, 1),
          facturaGroups[1],
          ...(request.gDtipDE ?? []).slice(1),
        ],
      })
    ).toThrow(/1501/);
  });

  it("D011: iTipTra on a note is refused", () => {
    const request = note();
    const gOpeCom = request.gDatGralOpe.gOpeCom;
    if (gOpeCom === undefined) throw new Error("fixture has gOpeCom");
    expect(() =>
      assertValidDteRequest({
        ...request,
        gDatGralOpe: {
          ...request.gDatGralOpe,
          gOpeCom: { ...gOpeCom, iTipTra: 1, dDesTipTra: "Venta de mercadería" },
        },
      })
    ).toThrow(/D011/);
  });
});

describe("the note's KuDE (§26.4.6)", () => {
  it("prints the motive and the associated factura instead of naming them absent", () => {
    const result = buildKudeDocument(buildDteRequestFromCreditNote(input()).request);
    if (result.outcome !== "BUILT") throw new Error(result.message);
    const rows = Object.fromEntries(result.document.general.map((row) => [row.label, row.value]));

    expect(result.document.title).toContain("Nota de Crédito");
    expect(rows["Motivo de la emisión:"]).toBe("Devolución");
    expect(rows["Tipo de documento asociado:"]).toBe("FE");
    expect(rows["Documento asociado CDC:"]?.replace(/\s/g, "")).toBe(FIXTURE_CDC);
    expect(result.document.absences.map((absence) => absence.label)).not.toContain(
      "Motivo de la emisión:"
    );
  });
});
