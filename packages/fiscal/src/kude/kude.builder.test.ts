/**
 * FISC-013 WU-C — the KuDE builder, asserted against §26.4.6's layouts.
 *
 * The tests fall in four groups, and each guards a way the renderer can be
 * wrong rather than merely different:
 *
 * 1. **The hard rule** (§13.2). Everything the builder prints comes from
 *    `DteRequest`, and everything the reference models print that the request
 *    lacks is an absence. So a test that added a field the DE does not carry
 *    would fail here, which is the point.
 * 2. **The four shapes.** FE, NCE and NDE share one structure and a single row
 *    separates them; the AFE and the NRE each have their own. A type no source
 *    profiles is refused, never guessed.
 * 3. **The item columns.** The models print three value columns and `iAfecIVA`
 *    has four values, so two affectations cannot be placed and must say so.
 * 4. **The arithmetic.** The subtotal is a sum over decimal strings; the test
 *    that proves no float is involved is the one a float would fail.
 */

import { describe, expect, it } from "vitest";
import { FIXTURE_QR, validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import type { DteRequest, DteXmlElement } from "../dte/dte.types.js";
import { buildKudeDocument } from "./kude.builder.js";
import {
  formatKudeAmount,
  formatKudeDate,
  formatKudeDateTime,
  groupKudeCdc,
} from "./kude.format.js";

interface LineSpec {
  readonly code: string;
  readonly description: string;
  readonly affectation: string;
  readonly rate: string;
  readonly total: string;
}

function itemElement(line: LineSpec): DteXmlElement {
  return {
    name: "gCamItem",
    children: [
      { name: "dCodInt", value: line.code },
      { name: "dDesProSer", value: line.description },
      { name: "cUniMed", value: "77" },
      { name: "dDesUniMed", value: "UNI" },
      { name: "dCantProSer", value: "1.00000000" },
      {
        name: "gValorItem",
        children: [
          { name: "dPUniProSer", value: line.total },
          { name: "dTotBruOpeItem", value: line.total },
          { name: "gValorRestaItem", children: [{ name: "dTotOpeItem", value: line.total }] },
        ],
      },
      {
        name: "gCamIVA",
        children: [
          { name: "iAfecIVA", value: line.affectation },
          { name: "dDesAfecIVA", value: "Gravado IVA" },
          { name: "dPropIVA", value: "100.00000000" },
          { name: "dTasaIVA", value: line.rate },
          { name: "dBasGravIVA", value: line.total },
          { name: "dLiqIVAItem", value: "0.0000" },
          { name: "dBasExe", value: "0.0000" },
        ],
      },
    ],
  };
}

/** The fixture, with the groups the mapper emits and the fixture leaves out. */
function requestWith(options: {
  readonly typeCode?: number;
  readonly currency?: string;
  readonly totalGuaranies?: string;
  readonly lines?: readonly LineSpec[];
  readonly subExe?: string;
  readonly sub5?: string;
  readonly sub10?: string;
  readonly operationTotal?: string;
  readonly ivaTotal?: string;
  readonly emitterName?: string;
}): DteRequest {
  const base = validFacturaElectronicaRequest();
  const totals: DteXmlElement[] = [
    { name: "dSubExe", value: options.subExe ?? "0.0000" },
    { name: "dSub5", value: options.sub5 ?? "0.0000" },
    { name: "dSub10", value: options.sub10 ?? "0.0000" },
    { name: "dTotOpe", value: options.operationTotal ?? "0.0000" },
    { name: "dTotGralOpe", value: options.operationTotal ?? "0.0000" },
    { name: "dTotIVA", value: options.ivaTotal ?? "0.0000" },
  ];
  return {
    ...base,
    gTimb: { ...base.gTimb, iTiDE: (options.typeCode ?? 1) as DteRequest["gTimb"]["iTiDE"] },
    gDatGralOpe: {
      ...base.gDatGralOpe,
      gOpeCom: { ...base.gDatGralOpe.gOpeCom!, cMoneOpe: options.currency ?? "PYG" },
      gEmis: {
        ...base.gDatGralOpe.gEmis,
        dNomEmi: options.emitterName ?? base.gDatGralOpe.gEmis.dNomEmi,
      },
    },
    gDtipDE: (options.lines ?? []).map(itemElement),
    gTotSub: totals,
    ...(options.totalGuaranies === undefined ? {} : { totalGuaranies: options.totalGuaranies }),
  };
}

/** The document of a request that must build, with the refusal surfaced. */
function built(request: DteRequest) {
  const result = buildKudeDocument(request);
  if (result.outcome !== "BUILT") throw new Error(`expected BUILT, got ${result.refusal}`);
  return result.document;
}

describe("the KuDE builder · the hard rule (§13.2)", () => {
  it("prints only what the signed DE carries, and names the rest as absent", () => {
    const document = built(requestWith({}));

    // Nothing the DE does not carry is printed as a value: the sale condition,
    // the cuotas and the per-rate settlement are absences, and the absences are
    // the only place those labels appear.
    const labels = document.absences.map((absence) => absence.label);
    expect(labels).toContain("Condición de venta:");
    expect(labels).toContain("Cuotas:");
    expect(labels).toContain("Liquidación IVA por tasa");
    expect(document.totals.ivaFive).toBeNull();
    expect(document.totals.ivaTen).toBeNull();

    // Every absence carries a reason, because a label with no explanation is a
    // blank a reader would take for a zero.
    for (const absence of document.absences) expect(absence.reason.length).toBeGreaterThan(20);
  });

  it("keeps the administration's mark and the emitter's fiscal rows apart", () => {
    const document = built(requestWith({}));
    expect(document.administrationLegend).toBe(
      "Sistema Integrado de Facturación Electrónica Nacional"
    );
    // The fiscal rows are the DE's own fields, in §26.4.1's order.
    expect(document.emitterFiscal.map((row) => row.label)).toEqual([
      "RUC:",
      "Timbrado N°:",
      "Fecha de Inicio de Vigencia:",
    ]);
    expect(document.emitterFiscal[0]?.value).toBe("1234567-8");
    expect(document.emitterFiscal[1]?.value).toBe("12345678");
    expect(document.emitterFiscal[2]?.value).toBe("01/05/2018");
  });

  it("carries the QR's content and the CDC the DE states", () => {
    const document = built(requestWith({}));
    expect(document.qr.content).toBe(FIXTURE_QR);
    expect(document.qr.consultationUrl).toBe("https://ekuatia.set.gov.py/consultas-test/qr?");
    // §26.4.6 prints the CDC in groups of four, and the fixture's is 44 digits.
    expect(document.qr.cdcGrouped).toMatch(/^(\d{4} ){10}\d{4}$/);
    expect(document.qr.cdcGrouped.replace(/ /g, "")).toBe(validFacturaElectronicaRequest().cdc);
  });

  it("builds without items and without gTotSub rather than throwing", () => {
    // `gDtipDE` and `gTotSub` are optional, so a request without them is one the
    // schema admits: the renderer must answer, not throw.
    const full = validFacturaElectronicaRequest();
    const bare: DteRequest = {
      cdc: full.cdc,
      dDVId: full.dDVId,
      dFecFirma: full.dFecFirma,
      environment: full.environment,
      gOpeDE: full.gOpeDE,
      gTimb: full.gTimb,
      gDatGralOpe: full.gDatGralOpe,
      gCamFuFD: full.gCamFuFD,
    };
    const document = built(bare);
    expect(document.items).toEqual([]);
    expect(document.totals.operation).toBeNull();
    expect(document.totals.subtotal).toBeNull();
  });
});

describe("the KuDE builder · the four shapes (§26.4.6)", () => {
  it("separates the NCE and the NDE from the FE by the motive row alone", () => {
    const fe = built(requestWith({ typeCode: 1 }));
    const nce = built(requestWith({ typeCode: 5 }));
    const nde = built(requestWith({ typeCode: 6 }));

    expect([fe.shape, nce.shape, nde.shape]).toEqual(["generic", "generic", "generic"]);
    expect(fe.title).toBe("KuDE de Factura Electrónica");
    expect(nce.title).toBe("KuDE de Nota de Crédito Electrónica");
    expect(nde.title).toBe("KuDE de Nota de Débito Electrónica");
    expect([fe.documentTitle, nce.documentTitle, nde.documentTitle]).toEqual([
      "FACTURA ELECTRÓNICA",
      "NOTA DE CRÉDITO ELECTRÓNICA",
      "NOTA DE DÉBITO ELECTRÓNICA",
    ]);

    const motive = (document: typeof fe) =>
      document.absences.some((absence) => absence.label === "Motivo de la emisión:");
    expect(motive(fe)).toBe(false);
    expect(motive(nce)).toBe(true);
    expect(motive(nde)).toBe(true);
  });

  it("gives the autofactura its own shape and its own blocks", () => {
    const document = built(requestWith({ typeCode: 4 }));
    expect(document.shape).toBe("autofactura");
    expect(document.title).toBe("KuDE de Autofactura Electrónica");
    const labels = document.absences.map((absence) => absence.label);
    expect(labels).toContain("Datos del vendedor y del comprador");
    expect(labels).toContain(
      "Tipo de constancia, N° Constancia, N° de Control, N° de Comprobante de retención"
    );
    // The autofactura is not the generic shape, so it must not inherit the
    // generic shape's motive row.
    expect(labels).not.toContain("Motivo de la emisión:");
  });

  it("gives the nota de remisión its six blocks", () => {
    const document = built(requestWith({ typeCode: 7 }));
    expect(document.shape).toBe("remision");
    expect(document.title).toBe("KuDE de Nota de Remisión Electrónica");
    const labels = document.absences.map((absence) => absence.label);
    for (const block of [
      "Documento asociado",
      "DESTINATARIO DE LA MERCADERÍA",
      "DATOS DEL TRASLADO",
      "DATOS DEL VEHÍCULO DEL TRANSPORTE",
      "DATOS DEL CONDUCTOR DEL VEHÍCULO",
      "DATOS DE LA MERCADERÍA",
    ]) {
      expect(labels).toContain(block);
    }
  });

  it("refuses a type no retrieved source profiles, naming the reason", () => {
    for (const code of [9, 10]) {
      const result = buildKudeDocument(requestWith({ typeCode: code }));
      expect(result.outcome).toBe("UNAVAILABLE");
      if (result.outcome !== "UNAVAILABLE") continue;
      expect(result.refusal).toBe("TYPE_NOT_PROFILED");
      // The message names the sources that would have to answer, not a guess.
      expect(result.message).toContain("§13.3");
      expect(result.message).toContain("§26.6.3");
    }
  });
});

describe("the KuDE builder · the three value columns (§26.4.2)", () => {
  const columnOf = (affectation: string, rate: string) =>
    built(
      requestWith({
        lines: [{ code: "SKU001", description: "x", affectation, rate, total: "100.0000" }],
      })
    ).items[0]?.column;

  it("places a taxed item under its own rate column", () => {
    expect(columnOf("1", "5")).toBe("five");
    expect(columnOf("1", "10")).toBe("ten");
  });

  it("places an exempt item under Exentas", () => {
    expect(columnOf("3", "0")).toBe("exempt");
  });

  it("refuses to place the two affectations the three columns cannot express", () => {
    // 2 is Exonerado and 4 is Gravado parcial, whose exempt part the DE carries
    // in E737: printing either would need a split the model does not show.
    expect(columnOf("2", "0")).toBeNull();
    expect(columnOf("4", "10")).toBeNull();
    // A taxed item at 0% has no column either.
    expect(columnOf("1", "0")).toBeNull();
  });

  it("keeps the item's total and its declared affectation, so an unplaced row explains itself", () => {
    const item = built(
      requestWith({
        lines: [
          { code: "SKU001", description: "x", affectation: "2", rate: "0", total: "1234.5000" },
        ],
      })
    ).items[0];
    expect(item?.total).toBe("1.234,5".replace(",", "."));
    expect(item?.affectation).toBe("2");
    expect(item?.rate).toBe("0");
  });
});

describe("the KuDE builder · the totals (§26.4.3)", () => {
  it("sums the three subtotals exactly, without a float", () => {
    // The test a float fails: 0.1 + 0.2 is 0.30000000000000004 in binary
    // floating point, and money in this repository never goes through one.
    const document = built(requestWith({ subExe: "0.1000", sub5: "0.2000" }));
    expect(document.totals.subtotal).toBe("0.3");
  });

  it("prints the subtotal of the chapter's own example", () => {
    const document = built(requestWith({ sub10: "200000.0000", operationTotal: "200000.0000" }));
    expect(document.totals.subtotal).toBe("200.000");
    expect(document.totals.operation).toBe("200.000");
  });

  it("prints the guaraníes row from F023 when the DE carries it", () => {
    const document = built(
      requestWith({ currency: "USD", operationTotal: "100.0000", totalGuaranies: "730000.0000" })
    );
    expect(document.totals.guaranies).toBe("730.000");
  });

  it("prints the operation's own total in the guaraníes row for a PYG document", () => {
    // NT 008 forbids informing F023 for PYG, and the Manual's example — a PYG
    // document — prints the same number in both rows. No conversion happens.
    const document = built(requestWith({ currency: "PYG", operationTotal: "200000.0000" }));
    expect(document.totals.guaranies).toBe("200.000");
  });

  it("carries the total IVA and no per-rate settlement", () => {
    const document = built(requestWith({ ivaTotal: "18181.0000" }));
    expect(document.totals.ivaTotal).toBe("18.181");
    expect(document.totals.ivaFive).toBeNull();
    expect(document.totals.ivaTen).toBeNull();
  });

  it("gives the autofactura its single payable row", () => {
    const document = built(requestWith({ typeCode: 4, operationTotal: "200000.0000" }));
    expect(document.totals.payable).toBe("200.000");
  });
});

describe("the KuDE's printed forms", () => {
  it("groups an amount in threes and drops the trailing zeros without rounding", () => {
    expect(formatKudeAmount("110000.0000")).toBe("110.000");
    expect(formatKudeAmount("18181.0000")).toBe("18.181");
    expect(formatKudeAmount("0.0000")).toBe("0");
    expect(formatKudeAmount("1234567.8900")).toBe("1.234.567.89");
    expect(formatKudeAmount("1234.5678")).toBe("1.234.5678");
    expect(formatKudeAmount("-1500.5000")).toBe("-1.500,5".replace(",", "."));
  });

  it("leaves a value it cannot read alone rather than coercing it", () => {
    expect(formatKudeAmount("not a number")).toBe("not a number");
    expect(formatKudeAmount("")).toBe("");
  });

  it("slices the DE's dates instead of parsing them", () => {
    expect(formatKudeDate("2018-05-01")).toBe("01/05/2018");
    expect(formatKudeDateTime("2026-10-05T12:34:56")).toBe("05-10-2026 12:34:56");
    // An instant the DE does not carry in the documented shape is returned
    // unchanged: a `Date` would re-enter it through the host's timezone.
    expect(formatKudeDateTime("2026-10-05 12:34:56")).toBe("2026-10-05 12:34:56");
    expect(formatKudeDate("2018-5-1")).toBe("2018-5-1");
  });

  it("groups the CDC in fours, and only a 44-digit one", () => {
    const cdc = "01444444017001001001452822501201715873226094";
    expect(groupKudeCdc(cdc)).toBe("0144 4444 0170 0100 1001 4528 2250 1201 7158 7322 6094");
    expect(groupKudeCdc("123")).toBe("123");
  });
});
