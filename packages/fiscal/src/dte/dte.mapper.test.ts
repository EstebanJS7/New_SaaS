import { describe, expect, it } from "vitest";
import { buildDteXml } from "./dte.builder.js";
import { composeCdc } from "./dte.cdc.js";
import { validFacturaElectronicaRequest } from "./dte.fixture.js";
import {
  addDecimals,
  buildDteRequestFromInvoice,
  emitterNameForEnvironment,
  scale,
  type ConfirmedInvoiceLineSnapshot,
  type DteMappingInput,
} from "./dte.mapper.js";
import { DteValidationError } from "./dte.rules.js";
import { SIFEN_TEST_EMITTER_NAME } from "./dte.types.js";

/**
 * The mapper's real proof is that its output survives `buildDteXml`, so the
 * happy-path case builds a document end to end rather than asserting a shape.
 * The emitter profile is taken from the schema-valid fixture, which keeps this
 * file about the mapping and not about re-declaring twenty emitter fields.
 */
const FIXTURE = validFacturaElectronicaRequest();

function mappingInput(overrides: Partial<DteMappingInput> = {}): DteMappingInput {
  const base: DteMappingInput = {
    invoice: {
      issuedAt: "2026-10-06T10:00:00",
      currency: "PYG",
      currencyDescription: "Guaraní",
      lines: [
        line({
          itemCode: "SKU001",
          ivaRate: 10,
          affectation: 1,
          lineTotal: "110.00",
          taxableBase: "100.00",
          taxAmount: "10.00",
        }),
        line({
          itemCode: "SKU002",
          ivaRate: 0,
          affectation: 3,
          lineTotal: "50.50",
          taxableBase: "0",
          taxAmount: "0",
        }),
      ],
      receptor: FIXTURE.gDatGralOpe.gDatRec,
    },
    profile: {
      emitter: FIXTURE.gDatGralOpe.gEmis,
      timbrado: FIXTURE.gTimb,
      operation: { iTImp: 1, dDesTImp: "IVA", iTipTra: 1, dDesTipTra: "Venta de mercadería" },
      emissionType: { code: 1, description: "Normal" },
    },
    identity: {
      cdc: FIXTURE.cdc,
      dDVId: FIXTURE.dDVId,
      securityCode: "123456789",
      environment: "test",
    },
    signatureTimestamp: "2026-10-06T10:00:05",
    qrContent: FIXTURE.gCamFuFD.dCarQR,
  };
  return { ...base, ...overrides };
}

function line(overrides: Partial<ConfirmedInvoiceLineSnapshot>): ConfirmedInvoiceLineSnapshot {
  return {
    itemCode: "SKU",
    description: "Servicio de prueba",
    unitOfMeasureCode: "77",
    unitOfMeasureDescription: "UNI",
    quantity: "1",
    unitPrice: "100",
    lineTotal: "100",
    taxableBase: "100",
    taxAmount: "0",
    affectation: 1,
    ivaRate: 10,
    ...overrides,
  };
}

describe("buildDteRequestFromInvoice", () => {
  it("maps a confirmed invoice into a request the builder accepts", () => {
    const { request, totals } = buildDteRequestFromInvoice(mappingInput());
    const xml = buildDteXml(request);

    expect(xml).toContain("<gCamItem>");
    expect(xml).toContain("<dCodInt>SKU001</dCodInt>");
    expect(xml).toContain("<dCodInt>SKU002</dCodInt>");
    expect(xml).toContain("<dTotGralOpe>160.50000000</dTotGralOpe>");
    expect(totals).toEqual({
      exempt: "50.50000000",
      five: "0.00000000",
      ten: "110.00000000",
      taxableBase: "100.00000000",
      taxAmount: "10.00000000",
      general: "160.50000000",
    });
  });

  it("emits gCamIVA's seven required children in the schema's order", () => {
    const { request } = buildDteRequestFromInvoice(mappingInput());
    const item = request.gDtipDE?.[0];
    const iva = item?.children?.find((child) => child.name === "gCamIVA");

    expect(iva?.children?.map((child) => child.name)).toEqual([
      "iAfecIVA",
      "dDesAfecIVA",
      "dPropIVA",
      "dTasaIVA",
      "dBasGravIVA",
      "dLiqIVAItem",
      "dBasExe",
    ]);
    // The code-to-description pairing is the schema's own, not the Manual's table.
    expect(iva?.children?.[1]?.value).toBe("Gravado IVA");
  });

  it("always supplies the D208c total the currency names, so the rule cannot be skipped", () => {
    // `R3-D208C-OPTIN`: D208c runs only when a total is present.
    const pyg = buildDteRequestFromInvoice(mappingInput()).request;
    expect(pyg.totalOperacion).toBe("160.50000000");
    expect(pyg.totalGuaranies).toBeUndefined();

    const foreign = buildDteRequestFromInvoice(
      mappingInput({
        invoice: { ...mappingInput().invoice, currency: "USD", currencyDescription: "Dólar" },
        totalGuaranies: "1171650.00000000",
      })
    ).request;
    expect(foreign.totalGuaranies).toBe("1171650.00000000");
    expect(foreign.totalOperacion).toBeUndefined();
  });

  it("refuses a foreign currency without F023, and F023 on PYG", () => {
    // NT 008 defines F023 as F014 * D018 and its rounding is not stated, so the
    // mapper will not invent it.
    expect(() =>
      buildDteRequestFromInvoice(
        mappingInput({
          invoice: { ...mappingInput().invoice, currency: "USD", currencyDescription: "Dólar" },
        })
      )
    ).toThrow(DteValidationError);
    expect(() => buildDteRequestFromInvoice(mappingInput({ totalGuaranies: "1000" }))).toThrow(
      DteValidationError
    );
  });

  it("refuses an invoice with no items", () => {
    expect(() =>
      buildDteRequestFromInvoice(
        mappingInput({ invoice: { ...mappingInput().invoice, lines: [] } })
      )
    ).toThrow(DteValidationError);
  });

  it("uses the environment literal for the emitter name, and the real one otherwise", () => {
    expect(emitterNameForEnvironment("test", "Veterinaria")).toBe(SIFEN_TEST_EMITTER_NAME);
    expect(emitterNameForEnvironment("production", "Veterinaria")).toBe("Veterinaria");

    const production = buildDteRequestFromInvoice(
      mappingInput({
        identity: { ...mappingInput().identity, environment: "production" },
        profile: {
          ...mappingInput().profile,
          emitter: { ...FIXTURE.gDatGralOpe.gEmis, dNomEmi: "Veterinaria S.A." },
        },
      })
    );
    expect(production.request.gDatGralOpe.gEmis.dNomEmi).toBe("Veterinaria S.A.");
  });

  it("accepts a CDC composed by composeCdc as its identity", () => {
    const composed = composeCdc({
      iTiDE: 1,
      dRucEm: "1234567",
      dDVEmi: "8",
      dEst: "001",
      dPunExp: "002",
      dNumDoc: "0000002",
      iTipCont: 2,
      dFeEmiDE: "20261006",
      iTipEmi: 1,
      dCodSeg: "123456789",
    });
    const { request } = buildDteRequestFromInvoice(
      mappingInput({
        identity: {
          cdc: composed.cdc,
          dDVId: composed.dDVId,
          securityCode: "123456789",
          environment: "test",
        },
      })
    );

    expect(composed.cdc).toHaveLength(44);
    expect(request.cdc).toBe(composed.cdc);
    expect(buildDteXml(request)).toContain(`<DE Id="${composed.cdc}">`);
  });
});

describe("exact decimal helpers", () => {
  it("adds decimal strings without ever touching a float", () => {
    expect(addDecimals("0.1", "0.2")).toBe("0.3");
    expect(addDecimals("100.00", "50.50")).toBe("150.50");
    expect(addDecimals("0.00000001", "999999999999999.99999999")).toBe("1000000000000000.00000000");
    expect(addDecimals("10", "5")).toBe("15");
  });

  it("pads to a type's scale and refuses to round", () => {
    expect(scale("100", 8, "x")).toBe("100.00000000");
    expect(scale("100.5", 8, "x")).toBe("100.50000000");
    // Rounding money is a business decision, so an over-precise value is refused
    // rather than silently changed.
    expect(() => scale("100.123456789", 8, "x")).toThrow(DteValidationError);
    expect(() => scale("-1", 8, "x")).toThrow(DteValidationError);
    expect(() => scale("1e3", 8, "x")).toThrow(DteValidationError);
  });
});
