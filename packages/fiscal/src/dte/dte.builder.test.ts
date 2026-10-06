import { describe, expect, it } from "vitest";
import { buildDteXml } from "./dte.builder.js";
import { DteValidationError } from "./dte.rules.js";
import { SIFEN_TEST_EMITTER_NAME, type DteRequest } from "./dte.types.js";

const VALID_CDC = `12${"1234567A"}${"0".repeat(34)}`;
const QR = "x".repeat(120);

function validRequest(overrides: Partial<DteRequest> = {}): DteRequest {
  const base: DteRequest = {
    cdc: VALID_CDC,
    dDVId: "7",
    dFecFirma: "2026-10-05T12:34:56",
    environment: "test",
    gOpeDE: {
      iTipEmi: 1,
      dDesTipEmi: "Normal",
      dCodSeg: "000000001",
    },
    gTimb: {
      iTiDE: 1,
      dDesTiDE: "Factura electrónica",
      dNumTim: "12345678",
      dEst: "001",
      dPunExp: "002",
      dNumDoc: "0000002",
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
        dDirEmi: "Av. Test & Uno",
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
        dNomRec: "Cliente <Principal>",
      },
    },
    gCamFuFD: { dCarQR: QR },
    totalOperacion: "1000",
  };
  return { ...base, ...overrides };
}

function failureOf(callback: () => unknown): DteValidationError["failure"] {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DteValidationError);
    return (error as DteValidationError).failure;
  }
  throw new Error("expected a DteValidationError");
}

describe("buildDteXml — structure (§4, §21.1, §21.2)", () => {
  it("emits rDE's four children and DE's eleven in schema order", () => {
    const xml = buildDteXml(validRequest());

    expect(xml).toContain(`<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd">`);
    expect(xml).toContain(`<DE Id="${VALID_CDC}">`);
    expect(xml).toContain(`<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>`);
    expect(xml).toContain("<dVerFor>150</dVerFor>");
    expect(xml).toContain("<dSisFact>1</dSisFact>");

    expectOrdered(xml, ["<dVerFor>150</dVerFor>", "<DE ", "<Signature", "<gCamFuFD>"]);
    expectOrdered(xml, [
      "<dDVId>",
      "<dFecFirma>",
      "<dSisFact>",
      "<gOpeDE>",
      "<gTimb>",
      "<gDatGralOpe>",
      "<gDtipDE/>",
      "<gCamFuFD>",
    ]);
  });

  it("closes DE before the Signature placeholder and keeps gCamFuFD outside", () => {
    const xml = buildDteXml(validRequest());

    expectOrdered(xml, ["</DE>", "<Signature", "<gCamFuFD>", "</rDE>"]);
  });

  it("keeps the schema order inside gOpeDE, gTimb, gOpeCom, gEmis and gDatRec", () => {
    const xml = buildDteXml(validRequest());

    expectOrdered(xml, ["<iTipEmi>", "<dDesTipEmi>", "<dCodSeg>"]);
    expectOrdered(xml, [
      "<iTiDE>",
      "<dDesTiDE>",
      "<dNumTim>",
      "<dEst>",
      "<dPunExp>",
      "<dNumDoc>",
      "<dSerieNum>",
      "<dFeIniT>",
    ]);
    expectOrdered(xml, ["<dFeEmiDE>", "<gOpeCom>", "<gEmis>", "<gDatRec>"]);
    expectOrdered(xml, ["<iTipTra>", "<iTImp>", "<cMoneOpe>", "<dDesMoneOpe>"]);
    expectOrdered(xml, ["<dRucEm>", "<dDVEmi>", "<iTipCont>", "<dNomEmi>", "<gActEco>"]);
    expectOrdered(xml, [
      "<iNatRec>",
      "<iTiOpe>",
      "<cPaisRec>",
      "<dDesPaisRe>",
      "<dRucRec>",
      "<dDVRec>",
      "<dNomRec>",
    ]);
  });

  it("is deterministic and escapes XML text and the Id attribute", () => {
    const request = validRequest();

    expect(buildDteXml(request)).toBe(buildDteXml(request));
    expect(buildDteXml(request)).toContain("<dDirEmi>Av. Test &amp; Uno</dDirEmi>");
    expect(buildDteXml(request)).toContain("<dNomRec>Cliente &lt;Principal&gt;</dNomRec>");
  });
});

describe("buildDteXml — identity, numbering and dates (§21.3, §22.9)", () => {
  it("validates the CDC as input and carries dDVId without computing it", () => {
    const xml = buildDteXml(validRequest({ dDVId: "3" }));

    expect(xml).toContain(`<DE Id="${VALID_CDC}">`);
    expect(xml).toContain("<dDVId>3</dDVId>");
    expect(
      failureOf(() => buildDteXml(validRequest({ cdc: `12${"1234567E"}${"0".repeat(34)}` })))
    ).toBe("INVALID_CDC");
    expect(failureOf(() => buildDteXml(validRequest({ cdc: "1".repeat(43) })))).toBe("INVALID_CDC");
  });

  it("validates dCodSeg without generating randomness inside the builder", () => {
    expect(
      buildDteXml(validRequest({ gOpeDE: { ...validRequest().gOpeDE, dCodSeg: "999999999" } }))
    ).toContain("<dCodSeg>999999999</dCodSeg>");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gOpeDE: { ...validRequest().gOpeDE, dCodSeg: "12345678" } }))
      )
    ).toBe("INVALID_SECURITY_CODE");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gOpeDE: { ...validRequest().gOpeDE, dCodSeg: "000000000" } }))
      )
    ).toBe("INVALID_SECURITY_CODE");
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gOpeDE: { ...validRequest().gOpeDE, dCodSeg: "000000002" },
            gTimb: { ...validRequest().gTimb, dNumDoc: "000000002" },
          })
        )
      )
    ).toBe("INVALID_SECURITY_CODE");
  });

  it("enforces widths, series, timbrado number and the SIFEN date lower bound", () => {
    expect(
      failureOf(() => buildDteXml(validRequest({ gTimb: { ...validRequest().gTimb, dEst: "1" } })))
    ).toBe("INVALID_ESTABLISHMENT");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gTimb: { ...validRequest().gTimb, dPunExp: "02" } }))
      )
    ).toBe("INVALID_POINT_OF_EXPEDITION");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gTimb: { ...validRequest().gTimb, dNumDoc: "123456" } }))
      )
    ).toBe("INVALID_DOCUMENT_NUMBER");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gTimb: { ...validRequest().gTimb, dNumTim: "1234567" } }))
      )
    ).toBe("INVALID_TIMBRADO");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gTimb: { ...validRequest().gTimb, dSerieNum: "ÑA" } }))
      )
    ).toBe("INVALID_SERIES");
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gTimb: { ...validRequest().gTimb, dFeIniT: "2018-04-30" } }))
      )
    ).toBe("INVALID_DATE_BOUND");
  });

  it("rejects a timestamp with timezone or fractional seconds", () => {
    expect(failureOf(() => buildDteXml(validRequest({ dFecFirma: "2026-10-05T12:34:56Z" })))).toBe(
      "INVALID_TIMESTAMP"
    );
    expect(
      failureOf(() => buildDteXml(validRequest({ dFecFirma: "2026-10-05T12:34:56.000" })))
    ).toBe("INVALID_TIMESTAMP");
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gDatGralOpe: { ...validRequest().gDatGralOpe, dFeEmiDE: "2026-10-05T12:34:56-03:00" },
          })
        )
      )
    ).toBe("INVALID_TIMESTAMP");
  });
});

describe("buildDteXml — money, quantity and currency (§21.4, §22.4)", () => {
  it("applies each monetary type's own scale", () => {
    const xml = buildDteXml(validRequest({ gTotSub: moneyFields() }));

    expect(xml).toContain("<dMontoBase>999999999999999.12345678</dMontoBase>");
    expect(xml).toContain("<dTasaIVA>10</dTasaIVA>");
    expectMoneyFailure("1.00", "tMontoBase");
    expectMoneyFailure("999999999999999.12345", "tMontoBase4");
    expectMoneyFailure("9999999.1234", "tMontoBase6");
    expectMoneyFailure("0.0000", "tTipoCambioBase");
    expectMoneyFailure("100.00000001", "tPorcDesc8");
    expectMoneyFailure("1.1234567", "tdCantProSer");
  });

  it("rejects an integer type carrying fraction digits", () => {
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({ gTotSub: [{ name: "dTasaIVA", value: "1.0", integerType: "tdTasaIVA" }] })
        )
      )
    ).toBe("INVALID_INTEGER");
  });

  it("keeps dTiCam absent for PYG and obligatory for dCondTiCam=1 otherwise", () => {
    expect(buildDteXml(validRequest())).not.toContain("<dTiCam>");
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gDatGralOpe: {
              ...validRequest().gDatGralOpe,
              gOpeCom: { ...validRequest().gDatGralOpe.gOpeCom!, dTiCam: "7300.0000" },
            },
          })
        )
      )
    ).toBe("INVALID_CURRENCY");
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gDatGralOpe: {
              ...validRequest().gDatGralOpe,
              gOpeCom: { ...validRequest().gDatGralOpe.gOpeCom!, cMoneOpe: "USD", dCondTiCam: 1 },
            },
          })
        )
      )
    ).toBe("INVALID_CURRENCY");
    expect(
      buildDteXml(
        validRequest({
          gDatGralOpe: {
            ...validRequest().gDatGralOpe,
            gOpeCom: {
              ...validRequest().gDatGralOpe.gOpeCom!,
              cMoneOpe: "USD",
              dCondTiCam: 1,
              dTiCam: "7300.0000",
            },
          },
        })
      )
    ).toContain("<dTiCam>7300.0000</dTiCam>");
  });
});

describe("buildDteXml — the receptor block (§22.11, NOT §22.3)", () => {
  function withReceptor(
    receptor: DteRequest["gDatGralOpe"]["gDatRec"],
    totalOperacion = "1000"
  ): DteRequest {
    return validRequest({
      totalOperacion,
      gDatGralOpe: { ...validRequest().gDatGralOpe, gDatRec: receptor },
    });
  }

  it("requires the RUC and its check digit for a contributor receptor", () => {
    const xml = buildDteXml(validRequest());

    expect(xml).toContain("<dRucRec>7654321</dRucRec>");
    expect(xml).toContain("<dDVRec>9</dDVRec>");
    expect(
      failureOf(() =>
        buildDteXml(
          withReceptor({
            iNatRec: 1,
            iTiOpe: 1,
            cPaisRec: "PRY",
            dDesPaisRe: "Paraguay",
            dNomRec: "Cliente",
          })
        )
      )
    ).toBe("INVALID_RECEPTOR");
  });

  it("forbids the identity document only when D201 = 1 (NT 023 removed the o D202=4 half)", () => {
    expect(
      failureOf(() =>
        buildDteXml(
          withReceptor({
            iNatRec: 1,
            iTiOpe: 1,
            cPaisRec: "PRY",
            dDesPaisRe: "Paraguay",
            dRucRec: "7654321",
            dDVRec: "9",
            iTipIDRec: 1,
            dDTipIDRec: "Cédula paraguaya",
            dNumIDRec: "1234567",
            dNomRec: "Cliente",
          })
        )
      )
    ).toBe("INVALID_RECEPTOR");
  });

  it("allows an identity document for a B2C receptor, which §22.3's old clause rejected", () => {
    const xml = buildDteXml(
      withReceptor({
        iNatRec: 2,
        iTiOpe: 4,
        cPaisRec: "PRY",
        dDesPaisRe: "Paraguay",
        iTipIDRec: 6,
        dDTipIDRec: "Tarjeta Diplomática de exoneración fiscal",
        dNumIDRec: "ABC123",
        dNomRec: "Consumidor final",
      })
    );

    expect(xml).toContain("<iTipIDRec>6</iTipIDRec>");
  });

  it("requires the identity document when D201 = 2 and D202 != 4 (D210/1314)", () => {
    expect(
      failureOf(() =>
        buildDteXml(
          withReceptor({
            iNatRec: 2,
            iTiOpe: 2,
            cPaisRec: "PRY",
            dDesPaisRe: "Paraguay",
            dNomRec: "Consumidor",
          })
        )
      )
    ).toBe("INVALID_RECEPTOR");
  });

  it("enforces D202/1300 and D202b/1332", () => {
    expect(
      failureOf(() =>
        buildDteXml(
          withReceptor({
            iNatRec: 2,
            iTiOpe: 3,
            cPaisRec: "PRY",
            dDesPaisRe: "Paraguay",
            dNomRec: "Estado",
          })
        )
      )
    ).toBe("INVALID_RECEPTOR");
    expect(
      failureOf(() =>
        buildDteXml(
          withReceptor({
            iNatRec: 1,
            iTiOpe: 1,
            cPaisRec: "PRY",
            dDesPaisRe: "Paraguay",
            dRucRec: "7654321",
            dDVRec: "9",
            dNomRec: "Entidad del Estado",
            isStateEntity: true,
          })
        )
      )
    ).toBe("INVALID_RECEPTOR");
  });

  it("uses tiTipDocRec, which admits 5 Innominado and 6 Tarjeta Diplomática", () => {
    const xml = buildDteXml(
      withReceptor({
        iNatRec: 2,
        iTiOpe: 2,
        cPaisRec: "PRY",
        dDesPaisRe: "Paraguay",
        iTipIDRec: 5,
        dDTipIDRec: "Innominado",
        dNumIDRec: "0",
        dNomRec: "Sin nombre",
      })
    );

    expect(xml).toContain("<iTipIDRec>5</iTipIDRec>");
    expect(
      failureOf(() =>
        buildDteXml(
          withReceptor({
            iNatRec: 2,
            iTiOpe: 2,
            cPaisRec: "PRY",
            dDesPaisRe: "Paraguay",
            iTipIDRec: 7 as never,
            dDTipIDRec: "No permitido",
            dNumIDRec: "1",
            dNomRec: "Sin nombre",
          })
        )
      )
    ).toBe("INVALID_ENUM");
  });

  it("enforces D208b/1319 and D208f/1333, D208e/1331 and D208c/1321", () => {
    const innominado = {
      iNatRec: 2 as const,
      cPaisRec: "PRY",
      dDesPaisRe: "Paraguay",
      iTipIDRec: 5 as const,
      dDTipIDRec: "Innominado",
      dNumIDRec: "0",
      dNomRec: "Sin nombre",
    };

    expect(failureOf(() => buildDteXml(withReceptor({ ...innominado, iTiOpe: 4 })))).toBe(
      "INVALID_RECEPTOR"
    );
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gTimb: { ...validRequest().gTimb, iTiDE: 5, dDesTiDE: "Nota de crédito electrónica" },
            gDatGralOpe: { ...validRequest().gDatGralOpe, gDatRec: { ...innominado, iTiOpe: 2 } },
          })
        )
      )
    ).toBe("INVALID_RECEPTOR");
    expect(
      failureOf(() => buildDteXml(withReceptor({ ...innominado, iTiOpe: 2 }, "7000000")))
    ).toBe("INVALID_RECEPTOR");
    expect(buildDteXml(withReceptor({ ...innominado, iTiOpe: 2 }, "6999999"))).toContain(
      "<iTipIDRec>5</iTipIDRec>"
    );
    expect(
      buildDteXml(
        validRequest({
          totalOperacion: "7000000",
          gDatGralOpe: {
            ...validRequest().gDatGralOpe,
            gOpeCom: {
              ...validRequest().gDatGralOpe.gOpeCom!,
              iTipTra: 13,
              dDesTipTra: "Muestras médicas",
            },
            gDatRec: { ...innominado, iTiOpe: 2 },
          },
        })
      )
    ).toContain("<iTipIDRec>5</iTipIDRec>");
  });

  it("selects D208c's total by currency: F014 for PYG, F023 otherwise", () => {
    const innominado = {
      iNatRec: 2 as const,
      iTiOpe: 2 as const,
      cPaisRec: "PRY",
      dDesPaisRe: "Paraguay",
      iTipIDRec: 5 as const,
      dDTipIDRec: "Innominado",
      dNumIDRec: "0",
      dNomRec: "Sin nombre",
    };
    const pyg = (totals: Pick<DteRequest, "totalOperacion" | "totalGuaranies">): DteRequest =>
      validRequest({
        ...totals,
        gDatGralOpe: { ...validRequest().gDatGralOpe, gDatRec: innominado },
      });
    const foreign = (totals: Pick<DteRequest, "totalOperacion" | "totalGuaranies">): DteRequest =>
      validRequest({
        ...totals,
        gDatGralOpe: {
          ...validRequest().gDatGralOpe,
          gOpeCom: {
            ...validRequest().gDatGralOpe.gOpeCom!,
            cMoneOpe: "USD",
            dCondTiCam: 1,
            dTiCam: "7300.0000",
          },
          gDatRec: innominado,
        },
      });

    // PYG: the rule names F014, so F014 at the threshold triggers it...
    expect(failureOf(() => buildDteXml(pyg({ totalOperacion: "7000000" })))).toBe(
      "INVALID_RECEPTOR"
    );
    // ...and below it does not.
    expect(buildDteXml(pyg({ totalOperacion: "6999999" }))).toContain("<iTipIDRec>5</iTipIDRec>");
    // PYG + F023 informed at all is a field-rule violation (NT 008), whether or
    // not it is above the threshold.
    expect(failureOf(() => buildDteXml(pyg({ totalGuaranies: "1000" })))).toBe("INVALID_CURRENCY");

    // Foreign currency: the rule names F023, so F023 at the threshold triggers
    // it and F014 is ignored.
    expect(failureOf(() => buildDteXml(foreign({ totalGuaranies: "7000000" })))).toBe(
      "INVALID_RECEPTOR"
    );
    expect(buildDteXml(foreign({ totalOperacion: "7000000", totalGuaranies: "1000" }))).toContain(
      "<iTipIDRec>5</iTipIDRec>"
    );
  });

  it("does not reject a B2G document for a missing gCompPub (NT 26 excluded those rules)", () => {
    const xml = buildDteXml(
      withReceptor({
        iNatRec: 1,
        iTiOpe: 3,
        cPaisRec: "PRY",
        dDesPaisRe: "Paraguay",
        dRucRec: "7654321",
        dDVRec: "9",
        dNomRec: "Entidad del Estado",
      })
    );

    expect(xml).not.toContain("<gCompPub>");
  });
});

describe("buildDteXml — enumerations, emitter and cardinality (§21.5, §22.5)", () => {
  it("requires the exact test-environment literal and ignores it in production", () => {
    expect(buildDteXml(validRequest())).toContain(`<dNomEmi>${SIFEN_TEST_EMITTER_NAME}</dNomEmi>`);
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gDatGralOpe: {
              ...validRequest().gDatGralOpe,
              gEmis: { ...validRequest().gDatGralOpe.gEmis, dNomEmi: "Veterinaria" },
            },
          })
        )
      )
    ).toBe("INVALID_EMITTER");
    expect(
      buildDteXml(
        validRequest({
          environment: "production",
          gDatGralOpe: {
            ...validRequest().gDatGralOpe,
            gEmis: { ...validRequest().gDatGralOpe.gEmis, dNomEmi: "Veterinaria" },
          },
        })
      )
    ).toContain("<dNomEmi>Veterinaria</dNomEmi>");
  });

  it("rejects values outside the recorded enumerations", () => {
    expect(
      failureOf(() =>
        buildDteXml(validRequest({ gOpeDE: { ...validRequest().gOpeDE, iTipEmi: 3 as never } }))
      )
    ).toBe("INVALID_ENUM");
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gTimb: {
              ...validRequest().gTimb,
              iTiDE: 2 as never,
              dDesTiDE: "Factura de exportación",
            },
          })
        )
      )
    ).toBe("INVALID_ENUM");
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gDatGralOpe: {
              ...validRequest().gDatGralOpe,
              gOpeCom: { ...validRequest().gDatGralOpe.gOpeCom!, iTipTra: 14 as never },
            },
          })
        )
      )
    ).toBe("INVALID_ENUM");
  });

  it("enforces gActEco (1..9) and gCamDEAsoc (0..99)", () => {
    expect(
      failureOf(() =>
        buildDteXml(
          validRequest({
            gDatGralOpe: {
              ...validRequest().gDatGralOpe,
              gEmis: { ...validRequest().gDatGralOpe.gEmis, gActEco: [] },
            },
          })
        )
      )
    ).toBe("INVALID_ACTIVITY_COUNT");

    const associated = Array.from({ length: 99 }, (_, index) => [
      { name: "iTipDocAso", value: "1" },
      { name: "dDesTipDocAso", value: `Documento ${index}` },
    ]);
    expect(buildDteXml(validRequest({ gCamDEAsoc: associated }))).toContain("<gCamDEAsoc>");
    expect(failureOf(() => buildDteXml(validRequest({ gCamDEAsoc: [...associated, []] })))).toBe(
      "INVALID_ASSOCIATED_DOCUMENT_COUNT"
    );
  });
});

function moneyFields(): DteRequest["gTotSub"] {
  return [
    { name: "dMontoBase", value: "999999999999999.12345678", decimalType: "tMontoBase" },
    { name: "dMontoBase4", value: "999999999999999.1234", decimalType: "tMontoBase4" },
    { name: "dMontoBase6", value: "999999.1234", decimalType: "tMontoBase6" },
    { name: "dPorcDescTotal", value: "100.00000000", decimalType: "tPorcDesc8" },
    { name: "dCantProSer", value: "9999999999.12345678", decimalType: "tdCantProSer" },
    { name: "dTasaIVA", value: "10", integerType: "tdTasaIVA" },
  ];
}

function expectMoneyFailure(
  value: string,
  decimalType: NonNullable<DteRequest["gTotSub"]>[number]["decimalType"]
): void {
  expect(
    failureOf(() =>
      buildDteXml(validRequest({ gTotSub: [{ name: "dMonto", value, decimalType }] }))
    )
  ).toBe("INVALID_MONEY_SCALE");
}

function expectOrdered(value: string, fragments: readonly string[]): void {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = value.indexOf(fragment);
    expect(index, `missing fragment ${fragment}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}
