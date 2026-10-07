/**
 * FISC-011 WU-E part 2 — the profile assembly.
 *
 * The acceptance criterion is not a shape: it is that the assembled profile
 * **satisfies the mapper**. So the happy path goes all the way to `buildDteXml`
 * and asserts the emitted elements, which is the only thing that proves the
 * columns became the DE fields the schema wants.
 */

import { describe, expect, it } from "vitest";
import { buildDteXml } from "../dte/dte.builder.js";
import { FIXTURE_CDC, FIXTURE_QR, validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import {
  buildDteRequestFromInvoice,
  type ConfirmedInvoiceLineSnapshot,
  type DteMappingInput,
} from "../dte/dte.mapper.js";
import {
  type AllocatedNumber,
  type AssembleEmitterProfileArgs,
  EmitterProfileAssemblyError,
  assembleEmitterProfile,
} from "./emitter-profile.js";

const ALLOCATED: AllocatedNumber = { documentNumber: "0000042", series: null };

function args(overrides: Partial<AssembleEmitterProfileArgs> = {}): AssembleEmitterProfileArgs {
  const base: AssembleEmitterProfileArgs = {
    profile: {
      ruc: "80012345",
      checkDigit: "6",
      taxpayerType: 2,
      regimeCode: 8,
      legalName: "Clínica Veterinaria del Sur S.A.",
      tradeName: "VetSur",
      responsibleIssuerType: null,
      responsibleIssuerTypeName: null,
      responsibleIssuerId: null,
      responsibleIssuerName: null,
      responsibleIssuerRole: null,
      transactionType: 1,
      taxType: 1,
      emissionType: 1,
    },
    establishment: {
      code: "001",
      addressLine: "Av. Mcal. López",
      houseNumber: 1234,
      addressComplement1: "Edificio Torre Sur",
      addressComplement2: null,
      departmentCode: 1,
      districtCode: 3,
      districtName: "ASUNCION (DISTRITO)",
      cityCode: 7,
      cityName: "ASUNCION",
      phone: "021123456",
      email: "fiscal@vetsur.example",
      branchName: null,
    },
    activities: [{ code: "47730", description: "Venta al por menor de productos veterinarios" }],
    range: {
      timbradoNumber: "12345678",
      expeditionPoint: "001",
      documentType: 1,
      validityStart: new Date("2019-09-01T00:00:00Z"),
    },
    allocated: ALLOCATED,
  };
  return { ...base, ...overrides };
}

describe("the assembled emitter", () => {
  it("takes the tenant's identity from the profile and the address from the establishment", () => {
    const { emitter } = assembleEmitterProfile(args());

    expect(emitter.dRucEm).toBe("80012345");
    expect(emitter.dDVEmi).toBe("6");
    expect(emitter.iTipCont).toBe(2);
    expect(emitter.cTipReg).toBe("8");
    expect(emitter.dNomEmi).toBe("Clínica Veterinaria del Sur S.A.");
    expect(emitter.dNomFanEmi).toBe("VetSur");
    expect(emitter.dDirEmi).toBe("Av. Mcal. López");
    expect(emitter.dCompDir1).toBe("Edificio Torre Sur");
    expect(emitter.dTelEmi).toBe("021123456");
    expect(emitter.dEmailE).toBe("fiscal@vetsur.example");
  });

  it("carries the integer fields as the strings the DE wants", () => {
    const { emitter } = assembleEmitterProfile(args());
    // `tdNumCas`, `tDepartamentos` and `tcCiuEmi` are integers in the schema and
    // strings in the DE.
    expect(emitter.dNumCas).toBe("1234");
    expect(emitter.cDepEmi).toBe("1");
    expect(emitter.cCiuEmi).toBe("7");
    expect(typeof emitter.dNumCas).toBe("string");
  });

  it("derives the department name from the code rather than storing it", () => {
    expect(assembleEmitterProfile(args()).emitter.dDesDepEmi).toBe("CAPITAL");
    expect(
      assembleEmitterProfile(
        args({ establishment: { ...args().establishment, departmentCode: 20 } })
      ).emitter.dDesDepEmi
    ).toBe("NUEVA ASUNCION");
  });

  it("keeps the district and city names, which are not enumerable", () => {
    const { emitter } = assembleEmitterProfile(args());
    expect(emitter.cDisEmi).toBe("3");
    expect(emitter.dDesDisEmi).toBe("ASUNCION (DISTRITO)");
    expect(emitter.dDesCiuEmi).toBe("ASUNCION");
  });

  it("omits every optional group that is null rather than emitting an empty one", () => {
    const { emitter } = assembleEmitterProfile(args());
    expect(emitter).not.toHaveProperty("dCompDir2");
    expect(emitter).not.toHaveProperty("dDenSuc");
    expect(emitter).not.toHaveProperty("gRespDE");
  });

  it("carries the activities in their stored order", () => {
    const { emitter } = assembleEmitterProfile(
      args({
        activities: [
          { code: "47730", description: "Venta al por menor" },
          { code: "75000", description: "Actividades veterinarias" },
        ],
      })
    );
    expect(emitter.gActEco).toEqual([
      { cActEco: "47730", dDesActEco: "Venta al por menor" },
      { cActEco: "75000", dDesActEco: "Actividades veterinarias" },
    ]);
  });

  it("includes gRespDE only when the whole group is present", () => {
    const { emitter } = assembleEmitterProfile(
      args({
        profile: {
          ...args().profile,
          responsibleIssuerType: 1,
          responsibleIssuerTypeName: "Cédula paraguaya",
          responsibleIssuerId: "1234567",
          responsibleIssuerName: "Ana Pérez",
          responsibleIssuerRole: "Contadora",
        },
      })
    );
    expect(emitter.gRespDE).toEqual({
      iTipIDRespDE: 1,
      dDTipIDRespDE: "Cédula paraguaya",
      dNumIDRespDE: "1234567",
      dNomRespDE: "Ana Pérez",
      dCarRespDE: "Contadora",
    });
  });
});

describe("the assembled timbrado", () => {
  it("carries the Manual's identifying sequence", () => {
    const { timbrado } = assembleEmitterProfile(args());
    expect(timbrado).toEqual({
      iTiDE: 1,
      dDesTiDE: "Factura electrónica",
      dNumTim: "12345678",
      dEst: "001",
      dPunExp: "001",
      dNumDoc: "0000042",
      dFeIniT: "2019-09-01",
    });
  });

  it("takes dEst from the establishment and dPunExp from the range", () => {
    // They come from different rows, and the Manual's sequence names both.
    const { timbrado } = assembleEmitterProfile(
      args({ range: { ...args().range, expeditionPoint: "003" } })
    );
    expect(timbrado.dEst).toBe("001");
    expect(timbrado.dPunExp).toBe("003");
  });

  it("emits dFeIniT as a date, not as the stored instant", () => {
    // The column is a timestamptz anchored to midnight UTC; tdFeIniT is a date.
    const { timbrado } = assembleEmitterProfile(
      args({ range: { ...args().range, validityStart: new Date("2026-03-15T00:00:00Z") } })
    );
    expect(timbrado.dFeIniT).toBe("2026-03-15");
    expect(timbrado.dFeIniT).not.toContain("T");
  });

  it("omits dSerieNum for the seriesless initial range and carries it otherwise", () => {
    expect(assembleEmitterProfile(args()).timbrado).not.toHaveProperty("dSerieNum");
    const withSeries = assembleEmitterProfile(
      args({ allocated: { documentNumber: "0000001", series: "AA" } })
    );
    expect(withSeries.timbrado.dSerieNum).toBe("AA");
  });
});

describe("the operation and emission defaults", () => {
  it("derives the tax and transaction descriptions from their codes", () => {
    const { operation } = assembleEmitterProfile(args());
    expect(operation).toEqual({
      iTImp: 1,
      dDesTImp: "IVA",
      iTipTra: 1,
      dDesTipTra: "Venta de mercadería",
    });
  });

  it("carries the Manual's description for a code the XSD's enum omits", () => {
    // `tiTipTra` 3 and 7 have descriptions in the Manual and not in tdDesTiTran.
    const { operation } = assembleEmitterProfile(
      args({ profile: { ...args().profile, transactionType: 3 } })
    );
    expect(operation.dDesTipTra).toBe("Mixto (Venta de mercadería y servicios)");
  });

  it("omits the transaction type entirely when the profile has none", () => {
    const { operation } = assembleEmitterProfile(
      args({ profile: { ...args().profile, transactionType: null } })
    );
    expect(operation).not.toHaveProperty("iTipTra");
    expect(operation).not.toHaveProperty("dDesTipTra");
  });

  it("narrows the emission description to the two the type admits", () => {
    expect(assembleEmitterProfile(args()).emissionType).toEqual({
      code: 1,
      description: "Normal",
    });
    expect(
      assembleEmitterProfile(args({ profile: { ...args().profile, emissionType: 2 } })).emissionType
    ).toEqual({ code: 2, description: "Contingencia" });
  });
});

describe("the acceptance criterion: the mapper accepts it unchanged", () => {
  function invoice(): DteMappingInput["invoice"] {
    const line = (
      overrides: Partial<ConfirmedInvoiceLineSnapshot>
    ): ConfirmedInvoiceLineSnapshot => ({
      itemCode: "SKU",
      description: "Consulta",
      unitOfMeasureCode: "77",
      unitOfMeasureDescription: "UNI",
      quantity: "1",
      unitPrice: "100",
      lineTotal: "110",
      taxableBase: "100",
      taxAmount: "10",
      affectation: 1,
      ivaRate: 10,
      ...overrides,
    });
    return {
      issuedAt: "2026-10-07T10:00:00",
      currency: "PYG",
      currencyDescription: "Guaraní",
      lines: [line({})],
      // The receptor comes from the schema-valid fixture: it satisfies §22.11's
      // conditional rules, which are not what this suite is about.
      receptor: validFacturaElectronicaRequest().gDatGralOpe.gDatRec,
    };
  }

  it("produces a request the builder turns into a schema-shaped document", () => {
    const profile = assembleEmitterProfile(args());
    const { request } = buildDteRequestFromInvoice({
      invoice: invoice(),
      profile,
      identity: {
        // The Manual's specimen, from the fixture: a hand-typed CDC is a
        // 44-character tCDC and the validator refuses anything else.
        cdc: FIXTURE_CDC,
        dDVId: "1",
        securityCode: "123456789",
        // PRODUCTION, because in the test environment the Manual requires a fixed
        // emitter literal and the mapper substitutes it (§22.5). The next case
        // asserts that substitution, so this one can assert the real name.
        environment: "production",
      },
      signatureTimestamp: "2026-10-07T10:00:05",
      // dCarQR is 100..600 characters; FISC-012 owns its content.
      qrContent: FIXTURE_QR,
    });
    const xml = buildDteXml(request);

    // The document carries what the assembled rows said, in the DE's own names.
    expect(xml).toContain("<dRucEm>80012345</dRucEm>");
    expect(xml).toContain("<dNomEmi>Clínica Veterinaria del Sur S.A.</dNomEmi>");
    expect(xml).toContain("<dDesDepEmi>CAPITAL</dDesDepEmi>");
    expect(xml).toContain("<dNumTim>12345678</dNumTim>");
    expect(xml).toContain("<dEst>001</dEst>");
    expect(xml).toContain("<dPunExp>001</dPunExp>");
    expect(xml).toContain("<dNumDoc>0000042</dNumDoc>");
    expect(xml).toContain("<dFeIniT>2019-09-01</dFeIniT>");
    expect(xml).toContain("<dDesTiDE>Factura electrónica</dDesTiDE>");
    expect(xml).toContain("<dDesTImp>IVA</dDesTImp>");
    expect(xml).toContain("<cActEco>47730</cActEco>");
    // And no empty optional element crept in.
    expect(xml).not.toContain("<dSerieNum></dSerieNum>");
    expect(xml).not.toContain("<gRespDE>");
  });

  it("lets the mapper substitute the test-environment emitter literal", () => {
    // §22.5: the literal is mandatory in test, so the assembled name does NOT
    // reach the document there. Asserting it here keeps the case above honest.
    const { request } = buildDteRequestFromInvoice({
      invoice: invoice(),
      profile: assembleEmitterProfile(args()),
      identity: {
        cdc: FIXTURE_CDC,
        dDVId: "1",
        securityCode: "123456789",
        environment: "test",
      },
      signatureTimestamp: "2026-10-07T10:00:05",
      qrContent: FIXTURE_QR,
    });
    const xml = buildDteXml(request);
    expect(xml).not.toContain("<dNomEmi>Clínica Veterinaria del Sur S.A.</dNomEmi>");
    expect(xml).toMatch(/<dNomEmi>[^<]+<\/dNomEmi>/);
  });
});

describe("an input that did not come from the database is refused", () => {
  /** The failure code a call raises, which is the part a caller branches on. */
  function failureOf(call: () => unknown): string {
    try {
      call();
    } catch (error) {
      if (error instanceof EmitterProfileAssemblyError) {
        return error.failure;
      }
      throw error;
    }
    throw new Error("expected the call to throw");
  }

  it("refuses an empty gActEco, which the schema requires", () => {
    expect(failureOf(() => assembleEmitterProfile(args({ activities: [] })))).toBe("NO_ACTIVITY");
  });

  it("refuses a gRespDE missing a field", () => {
    const half = args({
      profile: { ...args().profile, responsibleIssuerType: 1, responsibleIssuerTypeName: null },
    });
    expect(failureOf(() => assembleEmitterProfile(half))).toBe("INCOMPLETE_RESPONSIBLE_ISSUER");
  });

  it("refuses a gRespDE whose type is missing but whose fields are set", () => {
    // The other direction: returning undefined here would DROP the four fields
    // rather than complain, which is the guessing this module refuses to do.
    const half = args({
      profile: {
        ...args().profile,
        responsibleIssuerType: null,
        responsibleIssuerTypeName: "Cédula paraguaya",
        responsibleIssuerId: "1234567",
        responsibleIssuerName: "Ana Pérez",
        responsibleIssuerRole: "Contadora",
      },
    });
    expect(failureOf(() => assembleEmitterProfile(half))).toBe("INCOMPLETE_RESPONSIBLE_ISSUER");
  });

  it("refuses a district with a code and no name, rather than emitting an empty one", () => {
    // tdDesDisEmi is 1..30: an empty description is not a value the schema
    // carries, so a default would emit a document the XSD rejects.
    const half = args({
      establishment: { ...args().establishment, districtName: null },
    });
    expect(failureOf(() => assembleEmitterProfile(half))).toBe("INCOMPLETE_DISTRICT");
  });

  it("omits the district when neither half is set", () => {
    const none = args({
      establishment: { ...args().establishment, districtCode: null, districtName: null },
    });
    const { emitter } = assembleEmitterProfile(none);
    expect(emitter).not.toHaveProperty("cDisEmi");
    expect(emitter).not.toHaveProperty("dDesDisEmi");
  });

  it.each([["000004"], ["00000422"], ["000004A"], ["0000000"]])(
    "refuses the document number %s",
    (documentNumber) => {
      const bad = args({ allocated: { documentNumber, series: null } });
      expect(failureOf(() => assembleEmitterProfile(bad))).toBe("INVALID_DOCUMENT_NUMBER");
    }
  );

  it("names the catalogue when a code is not in it", () => {
    const bad = args({ range: { ...args().range, documentType: 2 } });
    expect(() => assembleEmitterProfile(bad)).toThrow(/2 is not a document type/);
  });
});
