/**
 * FISC-013 WU-C — the KuDE's HTML renderer.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 * 1. **Escaping.** Every value on the page comes from the DE, and the DE comes
 *    from tenant-supplied data — the emitter's name, the receptor's name, the
 *    item descriptions. So the renderer is an HTML sink, and a test that a
 *    hostile name stays inert is a security test, not a formatting one.
 * 2. **The absences stay off the page.** The KuDE is the official
 *    representation of a signed DE: a field the DE does not carry is not
 *    printed, and a placeholder would put a value on the document the signed
 *    XML does not have (§13.2). The model's absence list is for the caller.
 */

import { describe, expect, it } from "vitest";
import { validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import type { DteRequest, DteXmlElement } from "../dte/dte.types.js";
import { buildKudeDocument } from "./kude.builder.js";
import { escapeHtml, renderKudeHtml } from "./kude.html.js";

function withLine(
  overrides: Partial<{ typeCode: number; emitterName: string; description: string }>
) {
  const base = validFacturaElectronicaRequest();
  const item: DteXmlElement = {
    name: "gCamItem",
    children: [
      { name: "dCodInt", value: "SKU001" },
      { name: "dDesProSer", value: overrides.description ?? "Servicio de prueba" },
      { name: "dUniMed", value: "77" },
      { name: "dDesUniMed", value: "UNI" },
      { name: "dCantProSer", value: "1.00000000" },
      {
        name: "gValorItem",
        children: [
          { name: "dPUniProSer", value: "110000.0000" },
          { name: "gValorRestaItem", children: [{ name: "dTotOpeItem", value: "110000.0000" }] },
        ],
      },
      {
        name: "gCamIVA",
        children: [
          { name: "iAfecIVA", value: "1" },
          { name: "dTasaIVA", value: "10" },
          { name: "dBasGravIVA", value: "100000.0000" },
          { name: "dLiqIVAItem", value: "10000.0000" },
        ],
      },
    ],
  };
  const request: DteRequest = {
    ...base,
    gTimb: { ...base.gTimb, iTiDE: (overrides.typeCode ?? 1) as DteRequest["gTimb"]["iTiDE"] },
    gDatGralOpe: {
      ...base.gDatGralOpe,
      gEmis: {
        ...base.gDatGralOpe.gEmis,
        dNomEmi: overrides.emitterName ?? base.gDatGralOpe.gEmis.dNomEmi,
      },
    },
    gDtipDE: [item],
    gTotSub: [
      { name: "dSubExe", value: "0.0000" },
      { name: "dSub5", value: "0.0000" },
      { name: "dSub10", value: "100000.0000" },
      { name: "dTotOpe", value: "110000.0000" },
      { name: "dTotIVA", value: "10000.0000" },
    ],
  };
  const result = buildKudeDocument(request);
  if (result.outcome !== "BUILT") throw new Error(`expected BUILT, got ${result.refusal}`);
  return renderKudeHtml(result.document);
}

describe("the KuDE's HTML · the document", () => {
  it("is standalone: nothing is fetched to print it", () => {
    const html = withLine({});
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="es">');
    // No stylesheet, script, font or image is loaded from anywhere: a saved copy
    // and a printed copy are the same artifact.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('src="http');
    expect(html).toContain("@media print");
  });

  it("prints the administration's legend, the title and the document number", () => {
    const html = withLine({});
    expect(html).toContain("Sistema Integrado de Facturación Electrónica Nacional");
    expect(html).toContain("KuDE de Factura Electrónica");
    expect(html).toContain("FACTURA ELECTRÓNICA");
    expect(html).toContain("001-002-0000002");
  });

  it("prints the CDC grouped in fours and the consultation address", () => {
    const html = withLine({});
    // The fixture's own CDC, grouped the way §26.4.6 prints it.
    expect(html).toContain("0144 4444 0170 0100 1001 4528 2201 7012 5158 7326 0988");
    // The printed address is the consultation page. The QR's own content, which
    // the same block prints when it has no image, is the composition URL -- a
    // different string for a different purpose.
    expect(html).toContain("https://ekuatia.set.gov.py/consultas-test/");
    expect(html).not.toContain("consultas-test/qr?");
  });

  it("does not print the absences: they are the caller's metadata", () => {
    const html = withLine({});
    // The generic shape's absences name the sale condition, the cuotas and the
    // per-rate settlement. None of them may reach the page.
    expect(html).not.toContain("Condición de venta");
    expect(html).not.toContain("Cuotas");
    expect(html).not.toContain("Liquidación IVA por tasa");
  });
});

describe("the KuDE's HTML · escaping", () => {
  it("keeps a hostile emitter name inert", () => {
    const html = withLine({ emitterName: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("keeps a hostile item description inert", () => {
    const html = withLine({ description: '<img src=x onerror="steal()">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;steal()&quot;&gt;");
  });

  it("escapes the five characters that matter, in both text and attributes", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    // The ampersand is escaped first, so an already-escaped entity is not
    // double-decoded into markup.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("the KuDE's HTML · the shapes' tables", () => {
  it("gives the generic shape the three value columns", () => {
    const html = withLine({ typeCode: 1 });
    expect(html).toContain("Exentas");
    expect(html).toContain("Unidad de medida");
    expect(html).toContain("Descuento");
    expect(html).toContain("110.000");
    expect(html).toContain("TOTAL DE LA OPERACIÓN:");
    expect(html).toContain("LIQUIDACIÓN IVA:");
  });

  it("gives the autofactura five columns and a single total", () => {
    const html = withLine({ typeCode: 4 });
    expect(html).toContain("AUTOFACTURA ELECTRÓNICA");
    expect(html).toContain("TOTAL A PAGAR:");
    // The narrower table: no unit of measure, no discount, no IVA split.
    expect(html).not.toContain("Exentas");
    expect(html).not.toContain("Unidad de medida");
    expect(html).not.toContain("TOTAL DE LA OPERACIÓN:");
  });

  it("gives the nota de remisión its merchandise table and no totals at all", () => {
    const html = withLine({ typeCode: 7 });
    expect(html).toContain("NOTA DE REMISIÓN ELECTRÓNICA");
    expect(html).toContain("Descripción detallada");
    expect(html).not.toContain("Precio Unitario");
    expect(html).not.toContain("TOTAL A PAGAR:");
    expect(html).not.toContain("TOTAL DE LA OPERACIÓN:");
  });
});

describe("the KuDE's HTML · the QR", () => {
  it("prints the QR's content when no encoder supplied an image", () => {
    const html = withLine({});
    // The fixture carries a real `dCarQR`, not the builder's placeholder, so the
    // content is what the page shows when no image is available.
    expect(html).toContain("nVersion=150");
    expect(html).toContain('class="qr-content"');
    expect(html).not.toContain('<img class="qr"');
  });

  it("prints the image when the caller supplies one", () => {
    const base = validFacturaElectronicaRequest();
    const result = buildKudeDocument(base);
    if (result.outcome !== "BUILT") throw new Error("expected BUILT");
    const html = renderKudeHtml(result.document, {
      qrImageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    });
    expect(html).toContain('<img class="qr"');
    expect(html).toContain("data:image/svg+xml;base64,PHN2Zy8+");
  });

  it("escapes a supplied image URL rather than trusting it", () => {
    const result = buildKudeDocument(validFacturaElectronicaRequest());
    if (result.outcome !== "BUILT") throw new Error("expected BUILT");
    const html = renderKudeHtml(result.document, {
      qrImageDataUrl: 'x" onerror="steal()',
    });
    expect(html).not.toContain('onerror="steal()"');
    expect(html).toContain("&quot;");
  });
});
