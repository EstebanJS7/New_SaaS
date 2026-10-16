/**
 * FISC-013 WU-C — the KuDE's HTML renderer.
 *
 * §13.1 admits a KuDE "en formato físico o digitalizado" and §13.5 says it fits
 * "cualquier formato y tamaño de papel estándar", so the representation is a
 * standalone HTML document: printable by any browser, no dependency to add, and
 * nothing to deploy. The four paper formats the models show reduce to page rules
 * the caller can override, which is why the stylesheet carries a `@media print`
 * block rather than a fixed page size.
 *
 * **No route and no UI.** Printed and exported documents are outside Billing's
 * scope ([[DEC-039]], [[DEC-044]]), and FISC-013's exit criterion asks for the
 * KuDE's *generation*. So this module returns a string; exposing it is a
 * separate, later decision.
 *
 * **Everything from the DE is escaped.** The emitter's name, the receptor's
 * name, the descriptions, the address — all of it is tenant-supplied data that
 * reaches an HTML sink, so every interpolation goes through {@link escapeHtml}.
 * A renderer that trusted it would be an injection point, and the KuDE is
 * printed from a surface the tenant controls.
 *
 * **The absences are not printed.** They are metadata for the caller: the KuDE
 * is the official representation of a signed DE, and a field the DE does not
 * carry is simply not on the page. Printing a placeholder would put a value on
 * the document that the signed XML does not have, which is exactly what §13.2
 * forbids.
 */

import type { KudeDocument, KudeItem, KudeRow } from "./kude.types.js";

export interface KudeHtmlOptions {
  /**
   * The QR as a data URL, when the caller has an encoder. The repository has
   * none — `dte.qr.ts` builds the QR's *content* — so this is an input rather
   * than something this renderer invents, and its absence prints the content
   * instead of a code that would not scan.
   */
  readonly qrImageDataUrl?: string;
}

/** Escape a value for an HTML text or attribute sink. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rowsHtml(rows: readonly KudeRow[]): string {
  return rows
    .map((row) => {
      if (row.value === "") return "";
      const label = row.label === "" ? "" : `<span class="label">${escapeHtml(row.label)}</span> `;
      return `<div class="row">${label}<span class="value">${escapeHtml(row.value)}</span></div>`;
    })
    .join("");
}

/** The generic shape's seven-column table (§26.4.6). */
function genericItemsTable(items: readonly KudeItem[]): string {
  const body = items
    .map((item) => {
      const cell = (column: KudeItem["column"]) =>
        item.column === column ? `<span>${escapeHtml(item.total)}</span>` : "<span></span>";
      return `<tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.unitOfMeasure)}</td>
      <td class="num">${escapeHtml(item.quantity)}</td>
      <td class="num">${escapeHtml(item.unitPrice)}</td>
      <td class="num">${escapeHtml(item.discount)}</td>
      <td class="num">${cell("exempt")}</td>
      <td class="num">${cell("five")}</td>
      <td class="num">${cell("ten")}</td>
    </tr>`;
    })
    .join("");
  return `<table class="items">
    <thead>
      <tr>
        <th>Cod</th><th>Descripción</th><th>Unidad de medida</th>
        <th class="num">Cantidad</th><th class="num">Precio Unitario</th><th class="num">Descuento</th>
        <th class="num" colspan="3">Valor de Venta</th>
      </tr>
      <tr class="sub"><th></th><th></th><th></th><th></th><th></th><th></th>
        <th class="num">Exentas</th><th class="num">5%</th><th class="num">10%</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** The autofactura's five columns: no unit, no discount, no IVA split. */
function autofacturaItemsTable(items: readonly KudeItem[]): string {
  const body = items
    .map(
      (item) => `<tr>
      <td>${escapeHtml(item.code)}</td>
      <td class="num">${escapeHtml(item.quantity)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td class="num">${escapeHtml(item.unitPrice)}</td>
      <td class="num">${escapeHtml(item.total)}</td>
    </tr>`
    )
    .join("");
  return `<table class="items">
    <thead>
      <tr>
        <th>Cod</th><th class="num">Cantidad</th><th>Descripción</th>
        <th class="num">Precio Unitario</th><th class="num">Valor de Venta</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** The nota de remisión's merchandise table: quantities and a detailed description. */
function remisionItemsTable(items: readonly KudeItem[]): string {
  const body = items
    .map(
      (item) => `<tr>
      <td class="num">${escapeHtml(item.quantity)}</td>
      <td>${escapeHtml(item.unitOfMeasure)}</td>
      <td>${escapeHtml(item.description)}</td>
    </tr>`
    )
    .join("");
  return `<table class="items">
    <thead>
      <tr><th class="num">Cantidad</th><th>Unidad de medida</th><th>Descripción detallada</th></tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function itemsTable(document: KudeDocument): string {
  if (document.shape === "autofactura") return autofacturaItemsTable(document.items);
  if (document.shape === "remision") return remisionItemsTable(document.items);
  return genericItemsTable(document.items);
}

/**
 * The totals block, per shape. The AFE prints one row and no settlement; the
 * NRE prints none at all, because a nota de remisión carries no prices.
 */
function totalsHtml(document: KudeDocument): string {
  if (document.shape === "remision") return "";
  const totals = document.totals;
  if (document.shape === "autofactura") {
    return `<table class="totals"><tbody>
      <tr><th>TOTAL A PAGAR:</th><td class="num">${escapeHtml(totals.payable ?? "")}</td></tr>
    </tbody></table>`;
  }
  const settlement = `<tr class="settlement">
    <th>LIQUIDACIÓN IVA:</th>
    <td class="num">(5%)</td><td class="num"></td>
    <td class="num">(10%)</td><td class="num"></td>
    <td class="num">TOTAL IVA:</td><td class="num">${escapeHtml(totals.ivaTotal ?? "")}</td>
  </tr>`;
  return `<table class="totals"><tbody>
    <tr><th>SUBTOTAL:</th><td class="num" colspan="6">${escapeHtml(totals.subtotal ?? "")}</td></tr>
    <tr><th>TOTAL DE LA OPERACIÓN:</th><td class="num" colspan="6">${escapeHtml(totals.operation ?? "")}</td></tr>
    <tr><th>TOTAL EN GUARANÍES</th><td class="num" colspan="6">${escapeHtml(totals.guaranies ?? "")}</td></tr>
    ${settlement}
  </tbody></table>`;
}

function qrHtml(document: KudeDocument, options: KudeHtmlOptions): string {
  const image =
    options.qrImageDataUrl === undefined
      ? `<p class="qr-content">${escapeHtml(document.qr.content)}</p>`
      : `<img class="qr" alt="QR" src="${escapeHtml(options.qrImageDataUrl)}" />`;
  return `<div class="qr-block">
    ${image}
    <div class="qr-text">
      <p>${escapeHtml(qrSentenceFor(document))}</p>
      <p class="url">${escapeHtml(document.qr.consultationUrl)}</p>
      <p class="cdc">CDC: ${escapeHtml(document.qr.cdcGrouped)}</p>
    </div>
  </div>`;
}

/**
 * The QR sentence names the document type (§26.4.6). It is rebuilt here from the
 * title rather than stored twice, and the shape's own title is the model's.
 */
function qrSentenceFor(document: KudeDocument): string {
  return document.type === "AFE"
    ? "Consulte la validez de esta Autofactura Electrónica con el número de CDC impreso abajo en:"
    : "Consulte la validez de este documento electrónico con el número de CDC impreso abajo en:";
}

/**
 * Render the KuDE as one standalone HTML document.
 *
 * The document is self-contained: no stylesheet, script or font is fetched, so a
 * printed copy and a saved copy are the same artifact. The mark is drawn as a
 * labelled placeholder because the administration's artwork is not vendored —
 * what matters for the layout is that the mark's **position and legend are
 * fixed**, which §26.4.6 records and this renderer keeps.
 */
export function renderKudeHtml(document: KudeDocument, options: KudeHtmlOptions = {}): string {
  const body = `
<header class="mark">
  <div class="logo" aria-label="e-kuatia">e-kuatia</div>
  <div class="legend">${escapeHtml(document.administrationLegend)}</div>
</header>
<section class="box">
  <div class="strip">${escapeHtml(document.title)}</div>
  <div class="emitter">
    <div class="emitter-identity">${document.emitterIdentity
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("")}</div>
    <div class="emitter-fiscal">${rowsHtml(document.emitterFiscal)}</div>
    <div class="emitter-document">
      <div class="document-title">${escapeHtml(document.documentTitle)}</div>
      <div class="document-number">${escapeHtml(document.number)}</div>
    </div>
  </div>
</section>
<section class="box">
  <div class="parties">
    <div class="general">${rowsHtml(document.general)}</div>
    <div class="receptor">${rowsHtml(document.receptor)}</div>
  </div>
</section>
${itemsTable(document)}
${totalsHtml(document)}
${qrHtml(document, options)}
<footer class="fixed">
  ${document.footer.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
</footer>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(document.title)} ${escapeHtml(document.number)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, sans-serif; font-size: 11px; margin: 0 auto; max-width: 210mm; padding: 8mm; color: #111; }
  .mark { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4mm; }
  .logo { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; }
  .legend { font-size: 10px; text-align: right; max-width: 40%; }
  .box { border: 1px solid #999; margin-bottom: 3mm; }
  .strip { background: #eee; text-align: center; padding: 1mm; font-size: 11px; }
  .emitter { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2mm; padding: 2mm; }
  .emitter-document { text-align: right; font-weight: 700; }
  .document-number { font-weight: 400; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; padding: 2mm; }
  .row { display: flex; gap: 1mm; }
  .label { color: #444; }
  .value { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
  th, td { border: 1px solid #999; padding: 1mm; vertical-align: top; }
  thead th { background: #f3f3f3; font-weight: 600; }
  .num { text-align: right; }
  .totals th { text-align: left; background: #f3f3f3; }
  .qr-block { display: flex; gap: 3mm; align-items: flex-start; margin-bottom: 3mm; }
  .qr { width: 25mm; height: 25mm; }
  .qr-content { font-family: ui-monospace, monospace; font-size: 8px; max-width: 25mm; word-break: break-all; }
  .cdc { font-family: ui-monospace, monospace; }
  .fixed p { margin: 0.5mm 0; }
  @media print { body { padding: 0; } .box { break-inside: avoid; } }
</style>
</head>
<body>${body}
</body>
</html>
`;
}
