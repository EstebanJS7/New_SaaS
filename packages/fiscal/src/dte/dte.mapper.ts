/**
 * FISC-008 WU-C — mapping a confirmed invoice to a `DteRequest`.
 *
 * Authorized by [[DEC-054]] (accepted 2026-10-06, option B for its first
 * question): the **emitter fiscal profile and the timbrado are inputs**, and
 * where they are stored is [[FISC-011]]'s business. So this module is a pure
 * function of its arguments and nothing else:
 *
 * ```text
 * (invoice snapshot, emitter fiscal profile, document identity) -> DteRequest
 * ```
 *
 * No I/O, no ambient clock, no tenant context — the same discipline
 * `buildDteXml` follows, and for the same reason: determinism is an acceptance
 * criterion of this Story.
 *
 * ## Four things this mapper deliberately does NOT do
 *
 * **It does not re-derive tax.** NT 013 pins the per-item IVA arithmetic
 * (baseline §22.14) — `E735 dBasGravIVA = [100 * EA008 * E733] / [10000 + (E734 *
 * E733)]` and the new `E737 dBasExe` — but **it states no rounding rule**, and
 * the field is `N 1-15p(0-8)`. Re-deriving a base or a tax here would give money
 * a second source of truth and would have to guess that rounding. So the mapper
 * carries the **invoice's own** `taxableBase` and `taxAmount`, which Billing
 * already computed from an immutable snapshot.
 *
 * **It does not invent an affectation.** The invoice carries a `rateCode`; the DE
 * needs `iAfecIVA` (`E731`) and, for a partially taxed item, the proportionality
 * (`E733`). Those are DE concepts the invoice does not model, so the caller
 * resolves them. A default would be a guess about tax treatment.
 *
 * **It does not derive `F023`.** NT 008 says the guaraníes total is `F014 * D018`
 * for a global rate and the sum of the per-item guaraníes otherwise — and again
 * the result's rounding into `1-15p(0-8)` is not stated. For a foreign currency
 * the caller supplies it; for PYG it must not exist at all.
 *
 * **It does not mint the QR.** `dCarQR` is required by the schema and its content
 * depends on the CSC and the CDC, which [[FISC-012]] owns. It is an input.
 */

import { composeCdc } from "./dte.cdc.js";
import { DteValidationError } from "./dte.rules.js";
import {
  AFEC_IVA_DESCRIPTIONS,
  SIFEN_TEST_EMITTER_NAME,
  type DteAfectacionIva,
  type DteEmisor,
  type DteOperacionComercial,
  type DteReceptor,
  type DteRequest,
  type DteTimbrado,
  type DteTipoEmision,
  type DteTipoTransaccion,
  type DteXmlElement,
} from "./dte.types.js";

/** `tdTasaIVA` is a two-digit integer, so these are the rates a DE carries. */
export const DTE_IVA_RATES = [0, 5, 10] as const;
export type DteIvaRate = (typeof DTE_IVA_RATES)[number];

const QUANTITY_SCALE = 8;
const MONEY_SCALE = 8;
const PROPORTIONALITY_SCALE = 8;
const PROPORTIONALITY_FULL = "100.00000000";

export interface ConfirmedInvoiceLineSnapshot {
  /** `dCodInt` — 1..50 characters; the invoice's `catalogItemId` maps here. */
  readonly itemCode: string;
  /** `dDesProSer` — 1..2000 characters. */
  readonly description: string;
  /** `cUniMed`, from `Unidades_Medida_v141.xsd`. */
  readonly unitOfMeasureCode: string;
  /** `dDesUniMed`. */
  readonly unitOfMeasureDescription: string;
  /** `dCantProSer`, a decimal string. */
  readonly quantity: string;
  /** `dPUniProSer`, `tMontoBase`. */
  readonly unitPrice: string;
  /** `EA008`, the item's total, `tMontoBase`. */
  readonly lineTotal: string;
  /** The invoice's own taxable base, `tMontoBase`. Never re-derived here. */
  readonly taxableBase: string;
  /** The invoice's own tax for the line, `tMontoBase`. Never re-derived here. */
  readonly taxAmount: string;
  /** `E731 iAfecIVA`, resolved by the caller. */
  readonly affectation: DteAfectacionIva;
  /** `E734`, the IVA rate as the two-digit integer the DE carries. */
  readonly ivaRate: DteIvaRate;
  /** `E733 dPropIVA`; full proportionality unless the caller says otherwise. */
  readonly proportionality?: string;
  /** `E737 dBasExe`; 0 unless the item is partially taxed (NT 013). */
  readonly exemptBase?: string;
}

export interface ConfirmedInvoiceSnapshot {
  /** `D002 dFeEmiDE`, as `fecHhmmss`. */
  readonly issuedAt: string;
  /** `D015 cMoneOpe`: one currency for every item of the DE (§22.4). */
  readonly currency: string;
  /** `D016 dDesMoneOpe`. */
  readonly currencyDescription: string;
  readonly lines: readonly ConfirmedInvoiceLineSnapshot[];
  readonly receptor: DteReceptor;
}

/**
 * The tenant's fiscal identity and its timbrado. **Supplied, not looked up**:
 * [[DEC-054]] gives that storage to [[FISC-011]].
 */
export interface EmitterFiscalProfile {
  readonly emitter: DteEmisor;
  readonly timbrado: DteTimbrado;
  readonly operation: Pick<DteOperacionComercial, "iTImp" | "dDesTImp"> & {
    readonly iTipTra?: DteTipoTransaccion;
    readonly dDesTipTra?: string;
  };
  readonly emissionType: {
    readonly code: DteTipoEmision;
    readonly description: "Normal" | "Contingencia";
  };
}

/**
 * The document's identity. `composeCdc` is exported from this package for a
 * caller that wants to build one instead of holding it.
 */
export interface DocumentIdentity {
  readonly cdc: string;
  readonly dDVId: string;
  /**
   * `B004`: nine digits, never equal to `dNumDoc`. `generateSecurityCode` in
   * `dte.codseg.ts` produces one from an injected random source; the mapper takes
   * it as an input so it stays pure.
   */
  readonly securityCode: string;
  readonly environment: "test" | "production";
}

export interface DteMappingInput {
  readonly invoice: ConfirmedInvoiceSnapshot;
  readonly profile: EmitterFiscalProfile;
  readonly identity: DocumentIdentity;
  /** `dFecFirma`, as `fecHhmmss`. */
  readonly signatureTimestamp: string;
  /** `gCamFuFD dCarQR`; [[FISC-012]] owns its content. */
  readonly qrContent: string;
  /**
   * `F023 dTotalGs`, **required when the currency is not PYG and forbidden when
   * it is** (NT 008, baseline §22.12). The mapper does not derive it: the
   * conversion's rounding into `1-15p(0-8)` is not stated anywhere.
   */
  readonly totalGuaranies?: string;
}

export interface MappedDteTotals {
  /** `F002 dSubExe`. */
  readonly exempt: string;
  /** `F003 dSubExo`, the exonerated subtotal (affectation 2). */
  readonly exonerated: string;
  /** `F004 dSub5`. */
  readonly five: string;
  /** `F005 dSub10`. */
  readonly ten: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
  /** `F014 dTotGralOpe`. */
  readonly general: string;
}

export interface MappedDteRequest {
  readonly request: DteRequest;
  readonly totals: MappedDteTotals;
}

/** The §22.5 literal is a rule no schema encodes. */
export function emitterNameForEnvironment(
  environment: "test" | "production",
  productionName: string
): string {
  return environment === "test" ? SIFEN_TEST_EMITTER_NAME : productionName;
}

export function buildDteRequestFromInvoice(input: DteMappingInput): MappedDteRequest {
  const { invoice, profile, identity } = input;
  if (invoice.lines.length === 0) {
    throw new DteValidationError(
      "INVALID_GENERAL_OPERATION",
      "A DE needs at least one item: gCamItem is required by the schema."
    );
  }
  const isPyg = invoice.currency === "PYG";
  if (!isPyg && input.totalGuaranies === undefined) {
    throw new DteValidationError(
      "INVALID_CURRENCY",
      "F023 totalGuaranies is required for a foreign currency: NT 008 defines it as F014 * D018 " +
        "(or the per-item sum) and its rounding is not stated, so the caller supplies it."
    );
  }
  if (isPyg && input.totalGuaranies !== undefined) {
    throw new DteValidationError(
      "INVALID_CURRENCY",
      "F023 totalGuaranies must not be informed when the currency is PYG (NT 008)."
    );
  }

  const totals = computeTotals(invoice.lines);
  const request: DteRequest = {
    cdc: identity.cdc,
    dDVId: identity.dDVId,
    dFecFirma: input.signatureTimestamp,
    environment: identity.environment,
    gOpeDE: {
      iTipEmi: profile.emissionType.code,
      dDesTipEmi: profile.emissionType.description,
      dCodSeg: identity.securityCode,
    },
    gTimb: profile.timbrado,
    gDatGralOpe: {
      dFeEmiDE: invoice.issuedAt,
      gOpeCom: {
        ...profile.operation,
        cMoneOpe: invoice.currency,
        dDesMoneOpe: invoice.currencyDescription,
      },
      gEmis: {
        ...profile.emitter,
        dNomEmi: emitterNameForEnvironment(identity.environment, profile.emitter.dNomEmi),
      },
      gDatRec: invoice.receptor,
    },
    gDtipDE: invoice.lines.map(itemElement),
    gTotSub: totalsElement(totals),
    // `R3-D208C-OPTIN`: D208c is evaluated only when a total is present, so the
    // mapper always supplies the one the currency names -- `F014` for PYG, `F023`
    // otherwise (§22.12). Omitting both would let an Innominado receptor slip past
    // the threshold rule, which is the failure mode that advisory names.
    ...(isPyg
      ? { totalOperacion: totals.general }
      : { totalGuaranies: input.totalGuaranies ?? "" }),
    gCamFuFD: { dCarQR: input.qrContent },
  };

  return { request, totals };
}

/** One `gCamItem`: the five required members, plus its value and IVA groups. */
function itemElement(line: ConfirmedInvoiceLineSnapshot): DteXmlElement {
  return {
    name: "gCamItem",
    children: [
      { name: "dCodInt", value: line.itemCode },
      { name: "dDesProSer", value: line.description },
      { name: "cUniMed", value: line.unitOfMeasureCode },
      { name: "dDesUniMed", value: line.unitOfMeasureDescription },
      {
        name: "dCantProSer",
        value: scale(line.quantity, QUANTITY_SCALE, "quantity"),
        decimalType: "tdCantProSer",
      },
      {
        name: "gValorItem",
        children: [
          {
            name: "dPUniProSer",
            value: scale(line.unitPrice, MONEY_SCALE, "unitPrice"),
            decimalType: "tMontoBase",
          },
          {
            name: "dTotBruOpeItem",
            value: scale(line.lineTotal, MONEY_SCALE, "lineTotal"),
            decimalType: "tMontoBase",
          },
          {
            // `tgValorItem` requires `gValorRestaItem`, and of its seven members
            // only `dTotOpeItem` is required: the item's total after discounts,
            // which this mapper does not apply, so it equals the line's total.
            name: "gValorRestaItem",
            children: [
              {
                name: "dTotOpeItem",
                value: scale(line.lineTotal, MONEY_SCALE, "lineTotal"),
                decimalType: "tMontoBase",
              },
            ],
          },
        ],
      },
      {
        // `tgCamIVA` requires SEVEN children, in this order, and the schema states
        // the code-to-description pairing in its own comments.
        name: "gCamIVA",
        children: [
          { name: "iAfecIVA", value: String(line.affectation), enumType: "tiAfecIVA" },
          { name: "dDesAfecIVA", value: AFEC_IVA_DESCRIPTIONS[line.affectation] },
          {
            name: "dPropIVA",
            value: scale(
              line.proportionality ?? PROPORTIONALITY_FULL,
              PROPORTIONALITY_SCALE,
              "proportionality"
            ),
            decimalType: "tPorcDesc8",
          },
          { name: "dTasaIVA", value: String(line.ivaRate), integerType: "tdTasaIVA" },
          // The invoice's own base and tax. NT 013 says what these must equal;
          // repeating its division here would need a rounding rule the note does
          // not state, and would give money a second source of truth.
          {
            name: "dBasGravIVA",
            value: scale(line.taxableBase, MONEY_SCALE, "taxableBase"),
            decimalType: "tMontoBase",
          },
          {
            name: "dLiqIVAItem",
            value: scale(line.taxAmount, MONEY_SCALE, "taxAmount"),
            decimalType: "tMontoBase",
          },
          // `E737 dBasExe` is required by the schema and is 0 unless the item is
          // partially taxed (NT 013), so the caller supplies it and zero is the
          // default for the affectations where the note says it must be 0.
          {
            name: "dBasExe",
            value: scale(line.exemptBase ?? "0", MONEY_SCALE, "exemptBase"),
            decimalType: "tMontoBase",
          },
        ],
      },
    ],
  };
}

/**
 * `F002`, `F004`, `F005` and the general totals, summed exactly over decimal
 * strings: no float ever touches money. Grouping follows NT 013 — `F002` by
 * `E731 = 3` and `F004`/`F005` by `E734` — using the caller's affectation and
 * rate rather than a guess.
 */
function computeTotals(lines: readonly ConfirmedInvoiceLineSnapshot[]): MappedDteTotals {
  let exempt = "0";
  let five = "0";
  let ten = "0";
  let taxableBase = "0";
  let taxAmount = "0";

  let exonerated = "0";
  for (const line of lines) {
    taxableBase = addDecimals(taxableBase, line.taxableBase);
    taxAmount = addDecimals(taxAmount, line.taxAmount);
    // NT 013, field by field. The subtotal a line feeds depends on its
    // AFFECTATION, not on its rate alone, and for a partially taxed item it is
    // `E735 + E736` -- the taxed base plus the tax -- and NOT the item's total.
    // Adding the total there double-counts the exempt half, which is what the
    // review caught; `E737` goes to F002 and the rest of EA008 is not counted
    // twice.
    const rateContribution =
      line.affectation === 4 ? addDecimals(line.taxableBase, line.taxAmount) : line.lineTotal;
    if (line.affectation === 1 || line.affectation === 4) {
      if (line.ivaRate === 5) {
        five = addDecimals(five, rateContribution);
      }
      if (line.ivaRate === 10) {
        ten = addDecimals(ten, rateContribution);
      }
    }
    // F002 takes EA008 for an exempt item (E731 = 3) and E737 for a partially
    // taxed one (E731 = 4). F003 (dSubExo) takes EA008 for an exonerated one.
    if (line.affectation === 3) {
      exempt = addDecimals(exempt, line.lineTotal);
    }
    if (line.affectation === 4) {
      exempt = addDecimals(exempt, line.exemptBase ?? "0");
    }
    if (line.affectation === 2) {
      exonerated = addDecimals(exonerated, line.lineTotal);
    }
  }

  // `dTotOpe` is the operation total BEFORE adjustments, so it is the sum of the
  // subtotals -- not the taxed base, which silently drops an exempt line. This
  // mapper applies no discount, no anticipo and no rounding, so `dTotGralOpe`
  // equals it; deriving both from the same value is what stops them drifting.
  const operationTotal = addDecimals(addDecimals(exempt, exonerated), addDecimals(five, ten));

  return {
    exempt: scale(exempt, MONEY_SCALE, "F002"),
    exonerated: scale(exonerated, MONEY_SCALE, "F003"),
    five: scale(five, MONEY_SCALE, "F004"),
    ten: scale(ten, MONEY_SCALE, "F005"),
    taxableBase: scale(taxableBase, MONEY_SCALE, "taxableBase"),
    taxAmount: scale(taxAmount, MONEY_SCALE, "taxAmount"),
    general: scale(operationTotal, MONEY_SCALE, "general"),
  };
}

/**
 * `gTotSub`, in the schema's order and with **all ten required members**.
 *
 * `tgTotSub` requires `dTotOpe`, `dTotDesc`, `dTotDescGlotem`, `dTotAntItem`,
 * `dTotAnt`, `dPorcDescTotal`, `dDescTotal`, `dAnticipo`, `dRedon` and
 * `dTotGralOpe`; the subtotals by rate are optional and come first. An earlier
 * version of this function emitted six fields in a different order, which was
 * **schema-invalid** — a gap the builder's tests could not see and the
 * schema-validation suite caught once this mapping was put through it. The zeroes
 * are real values: this mapper applies no discount, no anticipo and no rounding.
 */
function totalsElement(totals: MappedDteTotals): readonly DteXmlElement[] {
  const zero = "0.00000000";
  return [
    { name: "dSubExe", value: totals.exempt, decimalType: "tMontoBase" },
    { name: "dSubExo", value: totals.exonerated, decimalType: "tMontoBase" },
    { name: "dSub5", value: totals.five, decimalType: "tMontoBase" },
    { name: "dSub10", value: totals.ten, decimalType: "tMontoBase" },
    // The operation total before adjustments. Wiring this to the taxed base was
    // the bug the review caught: an exempt line vanished from it, and it then
    // differed from dTotGralOpe while every adjustment was zero.
    { name: "dTotOpe", value: totals.general, decimalType: "tMontoBase" },
    { name: "dTotDesc", value: zero, decimalType: "tMontoBase" },
    { name: "dTotDescGlotem", value: zero, decimalType: "tMontoBase" },
    { name: "dTotAntItem", value: zero, decimalType: "tMontoBase" },
    { name: "dTotAnt", value: zero, decimalType: "tMontoBase" },
    { name: "dPorcDescTotal", value: zero, decimalType: "tPorcDesc8" },
    { name: "dDescTotal", value: zero, decimalType: "tMontoBase" },
    { name: "dAnticipo", value: zero, decimalType: "tMontoBase" },
    // `tdCRed` is 8 total digits and 4 fraction digits, bounded to 9999.9999 —
    // not one of the money types, which is why it carries its own marker.
    { name: "dRedon", value: "0.0000" },
    { name: "dTotGralOpe", value: totals.general, decimalType: "tMontoBase" },
    { name: "dTotIVA", value: totals.taxAmount, decimalType: "tMontoBase" },
  ];
}

/**
 * Formats a decimal string to a type's exact scale. It pads; it never rounds,
 * because rounding money is a business decision rather than a formatting one, and
 * a value that does not fit its type is refused rather than silently changed.
 */
export function scale(value: string, fractionDigits: number, field: string): string {
  const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (match === null) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      `${field} must be a non-negative plain decimal string, received "${value}".`
    );
  }
  const fraction = match[1] ?? "";
  if (fraction.length > fractionDigits) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      `${field} carries ${fraction.length} fraction digits and its type allows ${fractionDigits}; ` +
        "rounding it here would be a business decision, so it is refused instead."
    );
  }
  const [integerPart = "0"] = value.split(".");
  return `${integerPart}.${fraction.padEnd(fractionDigits, "0")}`;
}

/** Exact addition over decimal strings, at whatever scale the inputs carry. */
export function addDecimals(left: string, right: string): string {
  const a = normalize(left);
  const b = normalize(right);
  const sumScale = Math.max(a.scale, b.scale);
  const total =
    a.integer * 10n ** BigInt(sumScale - a.scale) + b.integer * 10n ** BigInt(sumScale - b.scale);
  const digits = total.toString().padStart(sumScale + 1, "0");
  if (sumScale === 0) {
    return digits;
  }
  return `${digits.slice(0, digits.length - sumScale)}.${digits.slice(digits.length - sumScale)}`;
}

function normalize(value: string): { readonly integer: bigint; readonly scale: number } {
  const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (match === null) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      `Decimal values must be non-negative plain decimal strings, received "${value}".`
    );
  }
  const fraction = match[1] ?? "";
  const [integerPart = "0"] = value.split(".");
  return { integer: BigInt(`${integerPart}${fraction}`), scale: fraction.length };
}

/** Composing the CDC is exported here too, so a mapper caller needs one import. */
export { composeCdc };
