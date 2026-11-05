/**
 * PAY-DET-001 / DEC-091 — the factura electrónica's `gCamFE` and `gCamCond`
 * (TD-074, SIFEN-BASELINE §27–28).
 *
 * The Manual Técnico v150 makes both obligatory for `C002 = 1` (rules 1350,
 * 1500) and the schema makes both optional, so only these builders and the
 * rules in `dte.rules.ts` stand between an invoice and a rejection on reception.
 *
 * Every code and description here is DE_Types_v150.xsd's own enumeration, as
 * retrieved on 2026-11-03: `tdDesTiPag`, `tdDesDenTarj`, `tdDesIndPres`,
 * `tdDCondOpe`. They are compared exactly by rule 1554/1602/1352/1502.
 */

import type { DteXmlElement } from "./dte.types.js";

/** `tiTiPago` (E606) → `tdDesTiPag` (E607). */
export const TIPO_PAGO_DESCRIPTIONS: Readonly<Record<number, string>> = Object.freeze({
  1: "Efectivo",
  2: "Cheque",
  3: "Tarjeta de crédito",
  4: "Tarjeta de débito",
  5: "Transferencia",
  6: "Giro",
  7: "Billetera electrónica",
  8: "Tarjeta empresarial",
  9: "Vale",
  10: "Retención",
  11: "Pago por anticipo",
  12: "Valor fiscal",
  13: "Valor comercial",
  14: "Compensación",
  15: "Permuta",
  16: "Pago bancario",
  17: "Pago Móvil",
  18: "Donación",
  19: "Promoción",
  20: "Consumo Interno",
  21: "Pago Electrónico",
});
/** `tiTiPago = 99`, "Otro": `dDesTiPag` is the caller's text, 4 to 30 characters. */
export const TIPO_PAGO_OTRO = 99;

/** `tiDenTarj` (E621) → `tdDesDenTarj` (E622). 99 "Otro" carries the caller's text. */
export const DEN_TARJ_DESCRIPTIONS: Readonly<Record<number, string>> = Object.freeze({
  1: "Visa",
  2: "Mastercard",
  3: "American Express",
  4: "Maestro",
  5: "Panal",
  6: "Cabal",
});
export const DEN_TARJ_OTRO = 99;

/** `tiIndPres` (E011) → `tdDesIndPres` (E012). */
export const IND_PRES_DESCRIPTIONS: Readonly<Record<number, string>> = Object.freeze({
  1: "Operación presencial",
  2: "Operación electrónica",
  3: "Operación telemarketing",
  4: "Venta a domicilio",
  5: "Operación bancaria",
  6: "Operación cíclica",
});

/** `tiCondOpe` (E601) → `tdDCondOpe` (E602). */
export const COND_OPE_DESCRIPTIONS: Readonly<Record<number, string>> = Object.freeze({
  1: "Contado",
  2: "Crédito",
});

/** `tiForProPa` (E626): 1 POS, 2 pago electrónico, 9 otro. */
export const FOR_PRO_PA_POS = 1;

/**
 * One payment, in the DE's own vocabulary. The persistence reader maps the
 * application's payment rows to this; the mapper never sees an application
 * method name.
 */
export interface DtePaymentSnapshot {
  /** `E606 iTiPago`. */
  readonly iTiPago: number;
  /** `E607 dDesTiPag` when `iTiPago = 99`; derived otherwise. */
  readonly otherDescription?: string;
  /** `E608 dMonTiPag`, a plain decimal string; emitted at scale 4 (`tMontoBase4`). */
  readonly amount: string;
  /** `gPagTarCD`, required when `iTiPago` is 3 or 4. */
  readonly card?: {
    /** `E621 iDenTarj`. */
    readonly iDenTarj: number;
    /** `E622 dDesDenTarj` when `iDenTarj = 99`. */
    readonly brandName?: string;
  };
  /** `gPagCheq`, required when `iTiPago` is 2. */
  readonly cheque?: {
    /** `dNumCheq`, eight digits. */
    readonly number: string;
    /** `dBcoEmi`, 4 to 20 characters. */
    readonly bank: string;
  };
}

/**
 * `gCamFE`: a clinic sells in person, so `iIndPres = 1` "Operación presencial"
 * (DEC-091). `dFecEmNR` and `gCompPub` are optional and not emitted.
 */
export function buildCamFE(): DteXmlElement {
  return {
    name: "gCamFE",
    children: [
      { name: "iIndPres", value: "1" },
      { name: "dDesIndPres", value: IND_PRES_DESCRIPTIONS[1] ?? "" },
    ],
  };
}

/**
 * `gCamCond` for a cash sale (`iCondOpe = 1`, "Contado"): the payments sum
 * exactly to the total (DEC-029), so there is no credit and no `gPagCred`.
 * One `gPaConEIni` per payment, in `tgPagCont`'s order.
 */
export function buildCamCond(args: {
  readonly payments: readonly DtePaymentSnapshot[];
  readonly currency: string;
  readonly currencyDescription: string;
  readonly scaleAmount: (value: string) => string;
}): DteXmlElement {
  return {
    name: "gCamCond",
    children: [
      { name: "iCondOpe", value: "1" },
      { name: "dDCondOpe", value: COND_OPE_DESCRIPTIONS[1] ?? "" },
      ...args.payments.map((payment) => paymentElement(payment, args)),
    ],
  };
}

function paymentElement(
  payment: DtePaymentSnapshot,
  args: {
    readonly currency: string;
    readonly currencyDescription: string;
    readonly scaleAmount: (value: string) => string;
  }
): DteXmlElement {
  const description =
    payment.iTiPago === TIPO_PAGO_OTRO
      ? (payment.otherDescription ?? "")
      : (TIPO_PAGO_DESCRIPTIONS[payment.iTiPago] ?? "");
  const children: DteXmlElement[] = [
    { name: "iTiPago", value: String(payment.iTiPago) },
    { name: "dDesTiPag", value: description },
    { name: "dMonTiPag", value: args.scaleAmount(payment.amount), decimalType: "tMontoBase4" },
    { name: "cMoneTiPag", value: args.currency },
    { name: "dDMoneTiPag", value: args.currencyDescription },
  ];
  if (payment.card !== undefined) {
    children.push({
      name: "gPagTarCD",
      children: [
        { name: "iDenTarj", value: String(payment.card.iDenTarj) },
        {
          name: "dDesDenTarj",
          value:
            payment.card.iDenTarj === DEN_TARJ_OTRO
              ? (payment.card.brandName ?? "")
              : (DEN_TARJ_DESCRIPTIONS[payment.card.iDenTarj] ?? ""),
        },
        // A clinic's card payment goes through a POS terminal (DEC-091).
        { name: "iForProPa", value: String(FOR_PRO_PA_POS) },
      ],
    });
  }
  if (payment.cheque !== undefined) {
    children.push({
      name: "gPagCheq",
      children: [
        { name: "dNumCheq", value: payment.cheque.number },
        { name: "dBcoEmi", value: payment.cheque.bank },
      ],
    });
  }
  return { name: "gPaConEIni", children };
}
