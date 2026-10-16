/**
 * FISC-013 WU-C — the KuDE builder.
 *
 * It reads **`DteRequest`**: the object `buildDteXml` serializes and the signer
 * signs. That is the whole design, and it is what makes §13.2's hard rule —
 * «No puede existir información en el KuDE que no forme parte del formato del DE
 * firmado» — true by construction rather than by discipline: a value the request
 * does not carry cannot reach the page, and every field the reference models
 * print that the request lacks is reported as a {@link KudeAbsence} with the
 * reason, never as a blank a reader would take for a zero.
 *
 * **The bound this builder found.** The repository's mapper emits
 * `gDtipDE: invoice.lines.map(itemElement)` — items and nothing else. So the
 * sale condition, the cuotas, the motive the NCE and the NDE print, the
 * per-rate IVA settlement, and every one of the AFE's and the NRE's own blocks
 * are fields the signed DE does not carry, and this builder says so. The AFE and
 * the NRE therefore render their header, their items and their CDC, and name the
 * rest; that is the honest outcome, not a defect of the renderer.
 */

import { addDecimals } from "../dte/dte.mapper.js";
import { DteValidationError } from "../dte/dte.rules.js";
import type { DteRequest, DteXmlElement } from "../dte/dte.types.js";
import {
  formatKudeAmount,
  formatKudeDate,
  formatKudeDateTime,
  groupKudeCdc,
} from "./kude.format.js";
import {
  KUDE_ADMINISTRATION_LEGEND,
  KUDE_CONSULTATION_URLS,
  KUDE_FOOTER_LINES,
  KUDE_LABELS,
  KUDE_REFUSALS,
  kudeProfileFor,
  type KudeAbsence,
  type KudeBuildResult,
  type KudeDocument,
  type KudeItem,
  type KudeItemColumn,
  type KudeRow,
  type KudeTotals,
} from "./kude.types.js";

/** Read a named child element of an ordered element list. */
function child(
  elements: readonly DteXmlElement[] | undefined,
  name: string
): DteXmlElement | undefined {
  return elements?.find((element) => element.name === name);
}

/** Read a named child's value. `undefined` means the DE does not carry it. */
function childValue(
  elements: readonly DteXmlElement[] | undefined,
  name: string
): string | undefined {
  return child(elements, name)?.value;
}

/**
 * Which of §26.4.6's three value columns holds an item's total.
 *
 * The models print `Exentas | 5% | 10%`, and `iAfecIVA` has four values, so two
 * of them have **no column**: `2` (Exonerado) and `4` (Gravado parcial, whose
 * exempt part the DE carries separately in `E737 dBasExe`). Splitting an item
 * across two columns would print numbers the DE states in one field each, so
 * those items keep their total and report `column: null` — the renderer shows
 * the total and the reader can see which affectation the DE declared.
 */
function itemColumn(
  affectation: string | undefined,
  rate: string | undefined
): KudeItemColumn | null {
  if (affectation === "3") return "exempt";
  if (affectation !== "1") return null;
  if (rate === "5") return "five";
  if (rate === "10") return "ten";
  return null;
}

/** One `gCamItem` as the items table needs it. */
function buildItem(element: DteXmlElement): KudeItem {
  const valueItem = child(element.children, "gValorItem");
  const iva = child(element.children, "gCamIVA");
  const affectation = childValue(iva?.children, "iAfecIVA");
  const rate = childValue(iva?.children, "dTasaIVA");
  const restaItem = child(valueItem?.children, "gValorRestaItem");
  // `dTotOpeItem` is the item's total after discounts and the only required
  // member of `gValorRestaItem`; it is what the models print.
  const total = childValue(restaItem?.children, "dTotOpeItem") ?? "0";
  return {
    code: childValue(element.children, "dCodInt") ?? "",
    description: childValue(element.children, "dDesProSer") ?? "",
    unitOfMeasure: childValue(element.children, "dDesUniMed") ?? "",
    quantity: formatKudeAmount(childValue(element.children, "dCantProSer") ?? "0"),
    unitPrice: formatKudeAmount(childValue(valueItem?.children, "dPUniProSer") ?? "0"),
    // The mapper applies no discount, and `gValorRestaItem`'s discount member is
    // optional: a DE that carried one would need the layout's own column, which
    // the three-column table does not have.
    discount: formatKudeAmount(childValue(restaItem?.children, "dDescItem") ?? "0"),
    total: formatKudeAmount(total),
    column: itemColumn(affectation, rate),
    affectation: affectation ?? "",
    rate: rate ?? "",
  };
}

/**
 * The totals block, read from `gTotSub` by the element names §22 pins.
 *
 * §26.4.3 warns that the chapter's own F-codes contradict each other and §22, so
 * nothing here is selected by an F-code: the three subtotals are `dSubExe`,
 * `dSub5` and `dSub10`, the operation's total is `dTotOpe`, and the IVA total is
 * `dTotIVA`.
 *
 * The `TOTAL EN GUARANÍES` row prints `F023` when the DE carries it — a
 * non-PYG document — and the operation's own total when the currency is PYG.
 * That is not a conversion: NT 008 forbids informing `F023` for PYG, and the
 * Manual's worked example, which is a PYG document, prints the same number in
 * both rows. No exchange arithmetic happens here, and none may.
 */
function buildTotals(request: DteRequest): {
  readonly totals: KudeTotals;
  /** The subtotal fields the DE carries but this renderer cannot add. */
  readonly unreadableSubtotals: readonly string[];
} {
  const sub = request.gTotSub;
  const isPyg = request.gDatGralOpe.gOpeCom?.cMoneOpe === "PYG";
  const operation = childValue(sub, "dTotOpe");
  const ivaTotal = childValue(sub, "dTotIVA");
  // `SUBTOTAL` is "the three above" (§26.4.3), so it is their exact sum. A
  // document that carries none of the three reports no subtotal rather than a
  // zero it never stated, and one that carries a value this module cannot add
  // reports none either -- and **names the field**, so a reader knows what to
  // fix instead of being told the whole set is suspect.
  const carried = SUBTOTAL_FIELDS.map((name) => ({ name, value: childValue(sub, name) })).filter(
    (entry): entry is { name: (typeof SUBTOTAL_FIELDS)[number]; value: string } =>
      entry.value !== undefined
  );
  const unreadableSubtotals = carried
    .filter((entry) => !isKudeDecimal(entry.value))
    .map((entry) => entry.name);
  const summed =
    unreadableSubtotals.length > 0 || carried.length === 0
      ? undefined
      : carried
          .map((entry) => entry.value)
          .reduce<string | undefined>(
            (total, part) => (total === undefined ? undefined : addKudeDecimals(total, part)),
            "0"
          );
  return {
    totals: {
      subtotal: summed === undefined ? null : formatKudeAmount(summed),
      operation: operation === undefined ? null : formatKudeAmount(operation),
      guaranies:
        request.totalGuaranies !== undefined
          ? formatKudeAmount(request.totalGuaranies)
          : isPyg && operation !== undefined
            ? formatKudeAmount(operation)
            : null,
      ivaFive: null,
      ivaTen: null,
      ivaTotal: ivaTotal === undefined ? null : formatKudeAmount(ivaTotal),
      payable: operation === undefined ? null : formatKudeAmount(operation),
    },
    unreadableSubtotals,
  };
}

/** The three subtotal fields §26.4.3's map names, in the chapter's own order. */
const SUBTOTAL_FIELDS = ["dSubExe", "dSub5", "dSub10"] as const;

/** Whether the shared arithmetic accepts a value as money. */
function isKudeDecimal(value: string): boolean {
  return addKudeDecimals("0", value) !== undefined;
}

/**
 * Add two of the DE's own decimal strings, or answer `undefined` when one is not
 * a value the shared arithmetic accepts.
 *
 * **The sum is the mapper's `addDecimals`, not a copy of it.** That is the
 * package's one implementation of exact decimal addition: exported, tested where
 * it lives, and scale-aware by construction. This module carried a second one --
 * string surgery that padded to a scale -- and it had a sign bug the shared
 * version cannot have, because `padStart` pads *before* a sign. A duplicate is a
 * second set of edge cases, so the duplicate is gone.
 *
 * `addDecimals` refuses a value that is not a non-negative plain decimal by
 * throwing, which is right for the mapper and wrong for a renderer: the KuDE
 * degrades, it does not fail. So that one refusal is caught here and becomes the
 * absence the caller reports, and every other error still travels.
 */
function addKudeDecimals(left: string, right: string): string | undefined {
  try {
    return addDecimals(left, right);
  } catch (error) {
    if (error instanceof DteValidationError && error.failure === "INVALID_MONEY_SCALE") {
      return undefined;
    }
    throw error;
  }
}

/** The generic shape's own absences, which the AFE and the NRE share in part. */
const GENERIC_ABSENCES: readonly KudeAbsence[] = Object.freeze([
  Object.freeze({
    label: KUDE_LABELS.saleCondition,
    reason:
      "E602 iCondOpe is not in the signed DE: the assembly emits only the items under gDtipDE, " +
      "so §13.2's content rule forbids printing it.",
  }),
  Object.freeze({
    label: KUDE_LABELS.installments,
    reason: "E644 is not in the signed DE, for the same reason as the sale condition.",
  }),
  Object.freeze({
    label: "Liquidación IVA por tasa",
    reason:
      "gTotSub carries the per-rate bases (dSub5, dSub10) and the total IVA (dTotIVA), not the " +
      "per-rate settlement the model prints in the (5%) and (10%) cells.",
  }),
  Object.freeze({
    label: "Logo del emisor",
    reason:
      "Optional and the emitter's own: §13.2 names the logo as one of the content rule's two " +
      "exceptions, so no layout requires it and no DE carries it.",
  }),
] as const satisfies readonly KudeAbsence[]);

/** The AFE's own blocks, none of which the DE carries. */
const AUTOFACTURA_ABSENCES: readonly KudeAbsence[] = Object.freeze([
  Object.freeze({
    label: "Datos del vendedor y del comprador",
    reason:
      "The autofactura's seller and buyer blocks are gDtipDE members, and the mapper emits only " +
      "the items, so the signed DE carries none of them.",
  }),
  Object.freeze({
    label: "Tipo de constancia, N° Constancia, N° de Control, N° de Comprobante de retención",
    reason: "Same reason: none of the four is in the signed DE.",
  }),
] as const satisfies readonly KudeAbsence[]);

/** The NRE's six blocks, none of which the DE carries. */
const REMISION_ABSENCES: readonly KudeAbsence[] = Object.freeze(
  [
    "Documento asociado",
    "DESTINATARIO DE LA MERCADERÍA",
    "DATOS DEL TRASLADO",
    "DATOS DEL VEHÍCULO DEL TRANSPORTE",
    "DATOS DEL CONDUCTOR DEL VEHÍCULO",
    "DATOS DE LA MERCADERÍA",
  ].map((label) =>
    Object.freeze({
      label,
      reason:
        "The nota de remisión's own block is a gDtipDE member and the mapper emits only the " +
        "items, so the signed DE carries none of it.",
    })
  )
);

/**
 * Build the KuDE for a DE, or refuse with a named reason.
 *
 * The refusal is not a throw: FISC-015's assembly already answers `UNAVAILABLE`
 * with a reason code for every state it cannot build, and a renderer that threw
 * would make an unprofiled type look like a defect instead of a missing source.
 */
export function buildKudeDocument(request: DteRequest): KudeBuildResult {
  const profile = kudeProfileFor(request.gTimb.iTiDE);
  if (profile === undefined) {
    return {
      outcome: "UNAVAILABLE",
      refusal: KUDE_REFUSALS.TYPE_NOT_PROFILED,
      message:
        `The DE's type code ${request.gTimb.iTiDE} has no KuDE reference model in any retrieved ` +
        "source. §13.3's denominations and §13.5's models cover the factura, the autofactura and " +
        "the three notas, and §26.6.3 keeps the export and import layouts open. Rendering a " +
        "layout the chapter does not show would be inventing one.",
    };
  }

  const { gEmis: emitter, gDatRec: receptor, dFeEmiDE } = request.gDatGralOpe;
  const operation = request.gDatGralOpe.gOpeCom;
  const environment = request.environment === "test" ? "test" : "production";

  const emitterIdentity: string[] = [emitter.dNomEmi, emitter.dDirEmi];
  if (emitter.dDesCiuEmi !== undefined) emitterIdentity.push(`Ciudad: ${emitter.dDesCiuEmi}`);
  emitterIdentity.push(`Teléfono: ${emitter.dTelEmi}`);
  emitterIdentity.push(emitter.dEmailE);
  const activity = emitter.gActEco[0];
  if (activity !== undefined) emitterIdentity.push(`Actividad económica: ${activity.dDesActEco}`);

  const emitterFiscal: KudeRow[] = [
    { label: KUDE_LABELS.ruc, value: `${emitter.dRucEm}-${emitter.dDVEmi}` },
    { label: KUDE_LABELS.timbrado, value: request.gTimb.dNumTim },
    { label: KUDE_LABELS.validityStart, value: formatKudeDate(request.gTimb.dFeIniT) },
  ];

  const general: KudeRow[] = [
    { label: KUDE_LABELS.issuedAt, value: formatKudeDateTime(dFeEmiDE) },
    { label: KUDE_LABELS.currency, value: operation?.cMoneOpe ?? "" },
    { label: KUDE_LABELS.exchangeRate, value: operation?.dTiCam ?? "" },
    { label: KUDE_LABELS.transaction, value: operation?.dDesTipTra ?? "" },
  ];

  const receptorRows: KudeRow[] = [
    {
      label: KUDE_LABELS.receptorIdentity,
      // §26.4.6 prints one identity row: the RUC when the receptor is a
      // contributor and the identity document when it is not (§22.11's rule).
      value:
        receptor.dRucRec === undefined
          ? (receptor.dNumIDRec ?? "")
          : `${receptor.dRucRec}-${receptor.dDVRec ?? ""}`,
    },
    { label: KUDE_LABELS.receptorName, value: receptor.dNomRec },
    { label: KUDE_LABELS.receptorAddress, value: receptor.dDirRec ?? "" },
    { label: KUDE_LABELS.receptorPhone, value: receptor.dTelRec ?? "" },
    { label: KUDE_LABELS.receptorEmail, value: receptor.dEmailRec ?? "" },
  ];

  const items = (request.gDtipDE ?? [])
    .filter((element) => element.name === "gCamItem")
    .map(buildItem);

  const { totals, unreadableSubtotals } = buildTotals(request);
  const absences: KudeAbsence[] = [
    ...GENERIC_ABSENCES,
    ...(profile.shape === "autofactura" ? AUTOFACTURA_ABSENCES : []),
    ...(profile.shape === "remision" ? REMISION_ABSENCES : []),
    // A subtotal the DE carries but this renderer cannot add is named rather
    // than silently dropped, and the reason names the field that raised it: a
    // message that indicted all three would not say which one to fix.
    ...(unreadableSubtotals.length > 0
      ? [
          {
            label: "SUBTOTAL:",
            reason:
              `The DE's ${unreadableSubtotals.join(", ")} ` +
              (unreadableSubtotals.length === 1
                ? "is not a decimal value"
                : "are not decimal values") +
              " this renderer can sum exactly, and it does not round or coerce " +
              "(§26.6.7 leaves the rule open).",
          },
        ]
      : []),
  ];

  const document: KudeDocument = {
    type: profile.type,
    shape: profile.shape,
    title: profile.title,
    documentTitle: profile.documentTitle,
    number: `${request.gTimb.dEst}-${request.gTimb.dPunExp}-${request.gTimb.dNumDoc}`,
    administrationLegend: KUDE_ADMINISTRATION_LEGEND,
    emitterIdentity,
    emitterFiscal,
    general,
    receptor: receptorRows,
    items,
    totals,
    qr: {
      content: request.gCamFuFD.dCarQR,
      // The sentence that names the document type comes from the type's own
      // profile, so there is one source for it rather than two: the renderer
      // prints this and never composes one of its own (§26.4.6).
      sentence: profile.qrSentence,
      consultationUrl: KUDE_CONSULTATION_URLS[environment],
      cdcGrouped: groupKudeCdc(request.cdc),
    },
    footer: KUDE_FOOTER_LINES,
    absences: profile.carriesMotive
      ? [
          ...absences,
          {
            label: KUDE_LABELS.motive,
            reason:
              "The motive is a gDtipDE member, and the mapper emits only the items, so the " +
              "signed DE carries none of it. The model prints this row for the NCE and the NDE " +
              "and not for the FE (§26.4.6).",
          },
        ]
      : absences,
  };

  return { outcome: "BUILT", document };
}
