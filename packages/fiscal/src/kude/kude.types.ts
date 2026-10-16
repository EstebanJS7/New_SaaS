/**
 * FISC-013 WU-C — the KuDE's document model.
 *
 * A KuDE is the **printed representation of a signed DE**, and its one hard rule
 * is §13.2's: «No puede existir información en el KuDE que no forme parte del
 * formato del DE firmado». So every value here is read from `DteRequest` — the
 * same object `buildDteXml` serializes and the signer signs — and a field the DE
 * does not carry is reported as a {@link KudeAbsence} rather than invented.
 *
 * The **printed labels are Spanish on purpose**. They are the tax
 * administration's own literals, reproduced from the Manual's reference models
 * (§26.4.6), not prose this repository authors: a KuDE that translated them
 * would not be the document the chapter specifies.
 *
 * The shapes are §26.4.6's, read from the seven rasterized reference models:
 * **FE, NCE and NDE share one structure**; the **AFE** and the **NRE** each
 * carry their own. The two paper rolls (Gráficas N° 14 and N° 15) are *formats*
 * of the FE's KuDE rather than types, and §13.6 states their suitability rather
 * than a requirement, so this model covers the sheet layouts.
 */

import type { DteTipoDocumentoElectronico } from "../dte/dte.types.js";

/** The five document types §13.5 gives a reference model for. */
export const KUDE_DOCUMENT_TYPES = ["FE", "NCE", "NDE", "AFE", "NRE"] as const;
export type KudeDocumentType = (typeof KUDE_DOCUMENT_TYPES)[number];

/**
 * §26.4.6's four shapes, of which this model covers the three the sheet layouts
 * use. The seven models are **not** one layout with variations.
 */
export const KUDE_SHAPES = ["generic", "autofactura", "remision"] as const;
export type KudeShape = (typeof KUDE_SHAPES)[number];

/** One labelled row, with the label exactly as the reference model prints it. */
export interface KudeRow {
  readonly label: string;
  readonly value: string;
}

/**
 * A field the reference model prints and the signed DE does not carry.
 *
 * §13.2 forbids inventing it, and §13.5 delegates the mandatory-field list to
 * the AT's regulations, so the honest outcome is to name what is missing and
 * why rather than to leave a blank a reader would read as zero.
 */
export interface KudeAbsence {
  readonly label: string;
  readonly reason: string;
}

/**
 * One `gCamItem`, with its sale value and the column that value belongs in.
 *
 * §26.4.2's header row repeats the IVA-affectation label once per rate column,
 * and the chapter's worked example puts the item's value under `10%` — with the
 * IVA already inside it. So a column carries the DE's own item total, never a
 * value this renderer computes, and `column` is `null` for an affectation the
 * three columns cannot express (see {@link KUDE_ITEM_COLUMNS}).
 */
export interface KudeItem {
  readonly code: string;
  readonly description: string;
  readonly unitOfMeasure: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  /** `dTotOpeItem`, the item's own total after discounts, printed. */
  readonly total: string;
  /** Which of the three value columns holds {@link total}, or `null`. */
  readonly column: KudeItemColumn | null;
  /** The affectation and rate the DE states, so an unplaced item explains itself. */
  readonly affectation: string;
  readonly rate: string;
}

/** The three value columns, in the chapter's own order. */
export const KUDE_ITEM_COLUMNS = ["exempt", "five", "ten"] as const;
export type KudeItemColumn = (typeof KUDE_ITEM_COLUMNS)[number];

/**
 * The KuDE's own totals block. `subtotal`, `operation`, `guaranies` and the IVA
 * rows are the generic shape's; `payable` is the AFE's single row (§26.4.6).
 */
export interface KudeTotals {
  readonly subtotal: string | null;
  readonly operation: string | null;
  readonly guaranies: string | null;
  readonly ivaFive: string | null;
  readonly ivaTen: string | null;
  readonly ivaTotal: string | null;
  /** The AFE's only totals row. */
  readonly payable: string | null;
}

/** The QR block: the code's content, its consultation URL and the printed CDC. */
export interface KudeQrBlock {
  /** `dCarQR`, the content `dte.qr.ts` builds (§24). */
  readonly content: string;
  /**
   * The sentence the model prints above the code, which **names the document
   * type** (§26.4.6). It travels on the document so the renderer has one source
   * for it rather than composing its own.
   */
  readonly sentence: string;
  /** §13.8.2's consultation URL, environment-dependent. */
  readonly consultationUrl: string;
  /** The CDC, printed **in groups of four** (§26.4.6). */
  readonly cdcGrouped: string;
}

export interface KudeDocument {
  readonly type: KudeDocumentType;
  readonly shape: KudeShape;
  /** §26.4.6's centred title strip. */
  readonly title: string;
  /** The printed document title. */
  readonly documentTitle: string;
  /** `dEst-dPunExp-dNumDoc`, the establishment–point–sequence form. */
  readonly number: string;
  /** The e-kuatia mark's legend, a fixed element of every layout. */
  readonly administrationLegend: string;
  /** The emitter's identity lines, printed as the model prints them. */
  readonly emitterIdentity: readonly string[];
  /** The emitter's fiscal rows: RUC, timbrado N° and start of validity. */
  readonly emitterFiscal: readonly KudeRow[];
  /** Fecha y hora de emisión, the sale conditions, the currency, the transaction. */
  readonly general: readonly KudeRow[];
  /** The receptor's block. */
  readonly receptor: readonly KudeRow[];
  readonly items: readonly KudeItem[];
  readonly totals: KudeTotals;
  readonly qr: KudeQrBlock;
  /** The footer's fixed lines (§26.4.6). */
  readonly footer: readonly string[];
  /** Everything the model prints and the DE does not carry. */
  readonly absences: readonly KudeAbsence[];
}

/** Why a document could not be rendered at all. */
export const KUDE_REFUSALS = {
  TYPE_NOT_PROFILED: "TYPE_NOT_PROFILED",
} as const;
export type KudeRefusal = (typeof KUDE_REFUSALS)[keyof typeof KUDE_REFUSALS];

export type KudeBuildResult =
  | { readonly outcome: "BUILT"; readonly document: KudeDocument }
  | { readonly outcome: "UNAVAILABLE"; readonly refusal: KudeRefusal; readonly message: string };

/**
 * The per-type facts §26.4.6 pins, as data.
 *
 * `carriesMotive` is the single row that separates the three generic types: the
 * NCE and the NDE print "Motivo de la emisión", the FE does not.
 */
export interface KudeTypeProfile {
  readonly type: KudeDocumentType;
  readonly code: DteTipoDocumentoElectronico;
  readonly shape: KudeShape;
  readonly title: string;
  readonly documentTitle: string;
  /** The QR sentence, which names the document type (§26.4.6). */
  readonly qrSentence: string;
  readonly carriesMotive: boolean;
}

/**
 * The five profiles, keyed by the type code the DE carries.
 *
 * Codes `9` and `10` are deliberately absent: the Manual's §13.3 denominations
 * and §13.5's models cover the five below, and no retrieved source shows a KuDE
 * layout for the boletas, so the builder refuses them instead of guessing
 * (§26.6.3 keeps the export and import layouts open for the same reason).
 */
export const KUDE_TYPE_PROFILES: Readonly<Record<KudeDocumentType, KudeTypeProfile>> =
  Object.freeze({
    FE: Object.freeze({
      type: "FE",
      code: 1,
      shape: "generic",
      title: "KuDE de Factura Electrónica",
      documentTitle: "FACTURA ELECTRÓNICA",
      qrSentence:
        "Consulte la validez de esta Factura Electrónica con el número de CDC impreso abajo en:",
      carriesMotive: false,
    }),
    NCE: Object.freeze({
      type: "NCE",
      code: 5,
      shape: "generic",
      title: "KuDE de Nota de Crédito Electrónica",
      documentTitle: "NOTA DE CRÉDITO ELECTRÓNICA",
      qrSentence:
        "Consulte la validez de esta Nota de Crédito Electrónica con el número de CDC impreso abajo en:",
      carriesMotive: true,
    }),
    NDE: Object.freeze({
      type: "NDE",
      code: 6,
      shape: "generic",
      title: "KuDE de Nota de Débito Electrónica",
      documentTitle: "NOTA DE DÉBITO ELECTRÓNICA",
      qrSentence:
        "Consulte la validez de esta Nota de Débito Electrónica con el número de CDC impreso abajo en:",
      carriesMotive: true,
    }),
    AFE: Object.freeze({
      type: "AFE",
      code: 4,
      shape: "autofactura",
      title: "KuDE de Autofactura Electrónica",
      documentTitle: "AUTOFACTURA ELECTRÓNICA",
      qrSentence:
        "Consulte la validez de esta Autofactura Electrónica con el número de CDC impreso abajo en:",
      carriesMotive: false,
    }),
    NRE: Object.freeze({
      type: "NRE",
      code: 7,
      shape: "remision",
      title: "KuDE de Nota de Remisión Electrónica",
      documentTitle: "NOTA DE REMISIÓN ELECTRÓNICA",
      qrSentence:
        "Consulte la validez de esta Nota de Remisión Electrónica con el número de CDC impreso abajo en:",
      carriesMotive: false,
    }),
  } satisfies Record<KudeDocumentType, KudeTypeProfile>);

/** The type code to profile, or `undefined` for a type no source shows a KuDE for. */
export function kudeProfileFor(code: number): KudeTypeProfile | undefined {
  return Object.values(KUDE_TYPE_PROFILES).find((profile) => profile.code === code);
}

/** §26.4.6's fixed footer, printed on the five sheet layouts. */
export const KUDE_FOOTER_LINES = Object.freeze([
  "ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)",
  "Información de interés del facturador electrónico emisor.",
  "Si su documento electrónico presenta algún error, podrá solicitar la modificación dentro de las 72 horas siguientes de la emisión de este comprobante.",
] as const);

/**
 * The e-kuatia legend. It is **the administration's mark, not the emitter's**,
 * which is why the KuDE admits no tenant branding (§26.4.6).
 */
export const KUDE_ADMINISTRATION_LEGEND =
  "Sistema Integrado de Facturación Electrónica Nacional" as const;

/**
 * The address the reference models print under the QR (§26.4.6).
 *
 * It is **not** `QR_CONSULTATION_URLS`. That constant is the prefix the QR's
 * *content* is composed from, and it ends in a bare `?`, so printing it would
 * send a reader to a page waiting for query parameters. What the models print is
 * the consultation page itself.
 *
 * The test value follows §13.8.2's own test URL with the same suffix removed,
 * which is the rule the production value states rather than a second invention.
 */
export const KUDE_CONSULTATION_URLS = Object.freeze({
  production: "https://ekuatia.set.gov.py/consultas/",
  test: "https://ekuatia.set.gov.py/consultas-test/",
} as const);

/** §13.4.1's labels, in the chapter's own order. */
export const KUDE_LABELS = Object.freeze({
  issuedAt: "Fecha y hora de emisión:",
  saleCondition: "Condición de venta:",
  installments: "Cuotas:",
  currency: "Moneda:",
  exchangeRate: "Tipo de Cambio:",
  transaction: "Tipo de transacción:",
  motive: "Motivo de la emisión:",
  receptorIdentity: "RUC/Documento de Identidad N°:",
  receptorName: "Nombre o Razón Social:",
  receptorAddress: "Dirección:",
  receptorPhone: "Teléfono:",
  receptorEmail: "Correo Electrónico:",
  ruc: "RUC:",
  timbrado: "Timbrado N°:",
  validityStart: "Fecha de Inicio de Vigencia:",
  itemCode: "Cod",
  itemDescription: "Descripción",
  itemUnit: "Unidad de medida",
  itemQuantity: "Cantidad",
  itemUnitPrice: "Precio Unitario",
  itemDiscount: "Descuento",
  itemValue: "Valor de Venta",
  exempt: "Exentas",
  five: "5%",
  ten: "10%",
  cdc: "CDC:",
} as const);
