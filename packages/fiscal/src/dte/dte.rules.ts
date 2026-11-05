/**
 * FISC-008 WU-A — validators.
 *
 * Every rule here traces to `docs/06-fiscal/SIFEN-BASELINE.md`: §21 (structure,
 * patterns, widths, scales, enumerations), §22.4 (`D015`/`D017`/`D018`, `D108`),
 * §22.5 (the test-environment literal) and §22.11 (the receptor block, last set
 * by NT 023 — NEVER §22.3).
 *
 * Two deliberate non-rules, recorded rather than worked around:
 *
 * - The CDC is validated, never composed, and its check digit is carried as
 *   supplied (§22.9: neither algorithm is pinned).
 * - `dCodSeg` is validated but never generated: randomness inside a pure
 *   builder would break the determinism this Story requires.
 */

import {
  AFEC_IVA_VALUES,
  COND_ANT_VALUES,
  COND_TI_CAM_VALUES,
  NAT_REC_VALUES,
  SIFEN_MIN_VALIDITY_DATE,
  SIFEN_TEST_EMITTER_NAME,
  TI_DE_VALUES,
  TIP_CONT_VALUES,
  TIP_DOC_REC_VALUES,
  TIP_EMI_VALUES,
  TIP_OPE_VALUES,
  TIP_TRA_VALUES,
  T_IMP_VALUES,
  type DteDecimalType,
  type DteEnumType,
  type DteIntegerType,
  type DteRequest,
  type DteXmlElement,
} from "./dte.types.js";
import {
  COND_OPE_DESCRIPTIONS,
  DEN_TARJ_DESCRIPTIONS,
  DEN_TARJ_OTRO,
  IND_PRES_DESCRIPTIONS,
  TIPO_PAGO_DESCRIPTIONS,
  TIPO_PAGO_OTRO,
} from "./dte.payment.js";

export type DteValidationFailure =
  | "INVALID_ACTIVITY_COUNT"
  | "INVALID_ASSOCIATED_DOCUMENT"
  | "INVALID_ASSOCIATED_DOCUMENT_COUNT"
  | "INVALID_CDC"
  | "INVALID_CDC_FIELD"
  | "INVALID_CURRENCY"
  | "INVALID_DATE_BOUND"
  | "INVALID_DOCUMENT_TYPE_GROUP"
  | "INVALID_DOCUMENT_NUMBER"
  | "INVALID_DV_ID"
  | "INVALID_EMITTER"
  | "INVALID_ENUM"
  | "INVALID_ESTABLISHMENT"
  | "INVALID_GENERAL_OPERATION"
  | "INVALID_INTEGER"
  | "INVALID_MONEY_SCALE"
  | "INVALID_POINT_OF_EXPEDITION"
  | "INVALID_RECEPTOR"
  | "INVALID_SECURITY_CODE"
  | "INVALID_SERIES"
  | "INVALID_TIMBRADO"
  | "INVALID_TIMESTAMP"
  | "INVALID_XML_ELEMENT";

export class DteValidationError extends Error {
  readonly failure: DteValidationFailure;

  constructor(failure: DteValidationFailure, message: string) {
    super(message);
    this.name = "DteValidationError";
    this.failure = failure;
  }
}

/** `tCDC` (§21.3): 44 characters, position 10 admits `A`-`D`. */
/** `tdDesMotEmi`, keyed by `tiMotEmi` (DE_Types_v150.xsd, Manual E401/E402). */
export const CREDIT_NOTE_MOTIVE_DESCRIPTIONS: Readonly<Record<number, string>> = Object.freeze({
  1: "Devolución y Ajuste de precios",
  2: "Devolución",
  3: "Descuento",
  4: "Bonificación",
  5: "Crédito incobrable",
  6: "Recupero de costo",
  7: "Recupero de gasto",
  8: "Ajuste de precio",
});

const CDC_PATTERN = /^[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}$/;
/** `tDVer` (§21.3). */
const SINGLE_DIGIT_PATTERN = /^[0-9]$/;
/** `fecHhmmss` (§21.3): no timezone suffix, no fractional seconds. */
const FEC_HHMMSS_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/;
/** `tdEst` / `tdPunExp` (§21.3). */
const THREE_DIGIT_PATTERN = /^[0-9]{3}$/;
/** `tdNumDoc` (§21.3). */
const DOCUMENT_NUMBER_PATTERN = /^(?:0+[1-9][0-9]*|[1-9]+[0-9]+)$/;
/** `tdNumTim` — exactly eight digits, zero-padded. */
const TIMBRADO_NUMBER_PATTERN = /^(?:0+[1-9][0-9]*|[1-9]+[0-9]+)$/;
/** `tdSerieNum` (§21.3). */
/**
 * `tdSerieNum` (§21.3): `[A-Z]{2}`. Exported because the Manual's §10.5 series
 * order is the same constant read in a different direction — `timbrado/series.ts`
 * generates the successors of this alphabet — and a second copy of it would be a
 * second place for the protocol to drift.
 */
export const SERIES_PATTERN = /^[A-Z]{2}$/;
/** `tiCodSe`: nine digits, `minInclusive=1` — so `000000000` is not a value. */
const SECURITY_CODE_PATTERN = /^[0-9]{9}$/;
/** `tRuc` (§21.3): the check letter is optional here. */
const RUC_PATTERN = /^[1-9][0-9]*[0-9A-D]?$/;
/** `tdNumDocId`: 1..20 of `[0-9A-Za-z-]`. */
const ID_DOCUMENT_NUMBER_PATTERN = /^[0-9A-Za-z-]{1,20}$/;
/** `tdNumTim` / `tdNumCas` / `tcActEco` / `cTipReg` shape checks. */
const NUM_CAS_PATTERN = /^[0-9]{1,6}$/;
const ACT_ECO_CODE_PATTERN = /^[0-9A-Z]{1,8}$/;
const TIP_REG_PATTERN = /^[1-8]$/;
const YYYY_MM_DD_PATTERN = /^\d{4}-\d\d-\d\d$/;
const DATE_TIME_PATTERN = FEC_HHMMSS_PATTERN;
const XML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const DECIMAL_SPECS = {
  tMontoBase: { totalDigits: 23, fractionDigits: 8, strictlyPositive: false, max: undefined },
  tMontoBase4: { totalDigits: 19, fractionDigits: 4, strictlyPositive: false, max: undefined },
  tMontoBase6: { totalDigits: 10, fractionDigits: 4, strictlyPositive: false, max: undefined },
  tTipoCambioBase: { totalDigits: 9, fractionDigits: 4, strictlyPositive: true, max: undefined },
  tPorcDesc8: { totalDigits: 11, fractionDigits: 8, strictlyPositive: false, max: "100" },
  tdCantProSer: { totalDigits: 18, fractionDigits: 8, strictlyPositive: false, max: undefined },
} as const satisfies Record<
  DteDecimalType,
  {
    readonly totalDigits: number;
    readonly fractionDigits: number;
    readonly strictlyPositive: boolean;
    readonly max: string | undefined;
  }
>;

const INTEGER_SPECS = {
  tdTasaIVA: { totalDigits: 2 },
} as const satisfies Record<DteIntegerType, { readonly totalDigits: number }>;

const ENUM_VALUES = {
  tiTipEmi: TIP_EMI_VALUES,
  tiTiDE: TI_DE_VALUES,
  tiTipTra: TIP_TRA_VALUES,
  tiTImp: T_IMP_VALUES,
  tiTipCont: TIP_CONT_VALUES,
  tiAfecIVA: AFEC_IVA_VALUES,
  tiNatRec: NAT_REC_VALUES,
  tiTiOpe: TIP_OPE_VALUES,
  tiTipDocRec: TIP_DOC_REC_VALUES,
} as const satisfies Record<DteEnumType, readonly number[]>;

export function assertValidDteRequest(request: DteRequest): void {
  assertTcdc(request.cdc);
  if (!SINGLE_DIGIT_PATTERN.test(request.dDVId)) {
    throw new DteValidationError(
      "INVALID_DV_ID",
      "dDVId must be exactly one digit and is carried as supplied."
    );
  }
  assertFecHhmmss(request.dFecFirma, "dFecFirma");
  assertOperationEmission(request);
  assertTimbrado(request);
  assertGeneralOperation(request);
  assertCamposFueraFirma(request);
  assertDocumentTypeGroups(request);
}

/**
 * Manual Técnico v150 rules that tie groups to `C002 iTiDE` (SIFEN-BASELINE §27).
 * The schema makes every one of these groups optional, so only these rules can
 * stop a document SIFEN would reject on reception:
 *
 * ```text
 * D011 iTipTra     No informar si C002 ≠ 1 o 4
 * E400 gCamNCDE    1450 obligatorio si C002 = 5 o 6 ; 1451 no informar si C002 ≠ 5 o 6
 * E402 dDesMotEmi  1452 must match E401
 * H001 gCamDEAsoc  2400 obligatorio si C002 = 4, 5, 6 (NT 023) ; 2415 once for 4, 5, 6
 * H002/H004        2434 no Constancia (3) for 1, 5, 6, 7 ; 2402 CDC when H002 = 1
 * H004             2414 a note may only reference a Factura electrónica (CDC "01…")
 * ```
 *
 * PAY-DET-001 (DEC-091, TD-074) adds the factura's own groups:
 *
 * ```text
 * E010 gCamFE      1350 obligatorio si C002 = 1 ; 1351 no informar si C002 ≠ 1 ; 1352 E012
 * E600 gCamCond    1500 obligatorio si C002 = 1 o 4 ; 1501 no informar si ≠ ; 1502 E602
 * E605 gPaConEIni  1550 obligatorio si E601 = 1 ; 1554 E607 matches E606
 * E620 gPagTarCD   1600 si E606 = 3 o 4 ; 1601 no informar si ≠ ; 1602 E622 matches E621
 * E630 gPagCheq    se activa si E606 = 2 ; dNumCheq eight digits
 * ```
 */
function assertDocumentTypeGroups(request: DteRequest): void {
  const type = request.gTimb.iTiDE;
  const groups = request.gDtipDE ?? [];
  const notes = groups.filter((element) => element.name === "gCamNCDE");
  const isNote = type === 5 || type === 6;
  if (isNote && notes.length !== 1) {
    throw new DteValidationError(
      "INVALID_DOCUMENT_TYPE_GROUP",
      "E400/1450: a Nota de Crédito or Débito carries exactly one gCamNCDE."
    );
  }
  if (!isNote && notes.length > 0) {
    throw new DteValidationError(
      "INVALID_DOCUMENT_TYPE_GROUP",
      "E400a/1451: gCamNCDE must not be informed unless iTiDE is 5 or 6."
    );
  }
  const note = notes[0];
  if (note !== undefined) {
    const motive = note.children?.find((element) => element.name === "iMotEmi")?.value;
    const description = note.children?.find((element) => element.name === "dDesMotEmi")?.value;
    const expected =
      motive === undefined ? undefined : CREDIT_NOTE_MOTIVE_DESCRIPTIONS[Number(motive)];
    if (expected === undefined || description !== expected) {
      throw new DteValidationError(
        "INVALID_DOCUMENT_TYPE_GROUP",
        "E401/E402/1452: iMotEmi must be 1..8 and dDesMotEmi its exact description."
      );
    }
    const itemIndex = groups.findIndex((element) => element.name === "gCamItem");
    if (itemIndex !== -1 && itemIndex < groups.indexOf(note)) {
      throw new DteValidationError(
        "INVALID_DOCUMENT_TYPE_GROUP",
        "tgDtipDE orders gCamNCDE before gCamItem."
      );
    }
  }

  assertFacturaGroups(type, groups);

  const iTipTra = request.gDatGralOpe.gOpeCom?.iTipTra;
  if (iTipTra !== undefined && type !== 1 && type !== 4) {
    throw new DteValidationError(
      "INVALID_GENERAL_OPERATION",
      "D011: iTipTra must not be informed unless iTiDE is 1 or 4."
    );
  }

  const associated = request.gCamDEAsoc ?? [];
  if ([4, 5, 6].includes(type) && associated.length !== 1) {
    throw new DteValidationError(
      "INVALID_ASSOCIATED_DOCUMENT_COUNT",
      "H001/2400 and H001b/2415: document types 4, 5 and 6 carry exactly one gCamDEAsoc."
    );
  }
  if (isNote) {
    for (const group of associated) {
      const kind = group.find((element) => element.name === "iTipDocAso")?.value;
      const cdc = group.find((element) => element.name === "dCdCDERef")?.value;
      if (kind === "3") {
        throw new DteValidationError(
          "INVALID_ASSOCIATED_DOCUMENT",
          "H002a/2434: a note cannot reference a Constancia electrónica."
        );
      }
      if (kind === "1") {
        if (cdc === undefined) {
          throw new DteValidationError(
            "INVALID_ASSOCIATED_DOCUMENT",
            "H004/2402: an electronic associated document needs dCdCDERef."
          );
        }
        assertTcdc(cdc);
        if (!cdc.startsWith("01")) {
          throw new DteValidationError(
            "INVALID_ASSOCIATED_DOCUMENT",
            "H001a/2414: a note may only reference a Factura electrónica (a CDC starting 01)."
          );
        }
      }
    }
  }
}

/** `tCDC` (§21.3). Exported so the case can be proven without building a DE. */
export function assertTcdc(value: string): void {
  if (value.length !== 44 || !CDC_PATTERN.test(value)) {
    throw new DteValidationError(
      "INVALID_CDC",
      "CDC must match tCDC: 44 characters whose 10th position is 0-9 or A-D."
    );
  }
}

/** Money and quantity scales (§21.4). */
export function assertDecimalType(value: string, type: DteDecimalType): void {
  const spec = DECIMAL_SPECS[type];
  const pattern = new RegExp(`^(?:0|[1-9][0-9]*)\\.[0-9]{${spec.fractionDigits}}$`);
  if (!pattern.test(value)) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      `${type} must carry exactly ${spec.fractionDigits} fraction digits.`
    );
  }
  const [integerPart, fractionPart = ""] = value.split(".");
  const digits = `${integerPart}${fractionPart}`.replace(/^0+/, "") || "0";
  if (digits.length > spec.totalDigits) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      `${type} exceeds ${spec.totalDigits} total digits.`
    );
  }
  if (spec.strictlyPositive && compareDecimals(value, "0") <= 0) {
    throw new DteValidationError("INVALID_MONEY_SCALE", `${type} must be strictly positive.`);
  }
  if (spec.max !== undefined && compareDecimals(value, spec.max) > 0) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      `${type} must be less than or equal to ${spec.max}.`
    );
  }
}

/** Integer types (§21.4). */
export function assertIntegerType(value: string, type: DteIntegerType): void {
  const spec = INTEGER_SPECS[type];
  if (!/^[0-9]+$/.test(value) || value.length > spec.totalDigits) {
    throw new DteValidationError(
      "INVALID_INTEGER",
      `${type} must be an integer with at most ${spec.totalDigits} digits.`
    );
  }
}

/** Enumerated codes recorded in §21.5 / §22.11. */
export function assertEnumType(value: string, type: DteEnumType): void {
  if (!/^[0-9]+$/.test(value)) {
    throw new DteValidationError("INVALID_ENUM", `${type} must be a numeric code.`);
  }
  if (!(ENUM_VALUES[type] as readonly number[]).includes(Number(value))) {
    throw new DteValidationError(
      "INVALID_ENUM",
      `${type} value ${value} is not a recorded allowed value.`
    );
  }
}

function assertOperationEmission(request: DteRequest): void {
  const operation = request.gOpeDE;
  assertEnumType(String(operation.iTipEmi), "tiTipEmi");
  if (operation.dDesTipEmi !== "Normal" && operation.dDesTipEmi !== "Contingencia") {
    throw new DteValidationError(
      "INVALID_ENUM",
      "dDesTipEmi must be one of the recorded tiTipEmi descriptions."
    );
  }
  // §22.9 / Manual §10.3: nine digits, zero-padded, never equal to dNumDoc.
  if (!SECURITY_CODE_PATTERN.test(operation.dCodSeg) || Number(operation.dCodSeg) < 1) {
    throw new DteValidationError(
      "INVALID_SECURITY_CODE",
      "dCodSeg must be nine digits with a value of at least 1."
    );
  }
  if (operation.dCodSeg === request.gTimb.dNumDoc) {
    throw new DteValidationError("INVALID_SECURITY_CODE", "dCodSeg must never equal dNumDoc.");
  }
}

function assertTimbrado(request: DteRequest): void {
  const timbrado = request.gTimb;
  assertEnumType(String(timbrado.iTiDE), "tiTiDE");
  if (!/^\d{8}$/.test(timbrado.dNumTim) || !TIMBRADO_NUMBER_PATTERN.test(timbrado.dNumTim)) {
    throw new DteValidationError(
      "INVALID_TIMBRADO",
      "dNumTim must be exactly eight digits and match tdNumTim."
    );
  }
  if (!THREE_DIGIT_PATTERN.test(timbrado.dEst)) {
    throw new DteValidationError(
      "INVALID_ESTABLISHMENT",
      "dEst must be zero-padded to three digits."
    );
  }
  if (!THREE_DIGIT_PATTERN.test(timbrado.dPunExp)) {
    throw new DteValidationError(
      "INVALID_POINT_OF_EXPEDITION",
      "dPunExp must be zero-padded to three digits."
    );
  }
  if (timbrado.dNumDoc.length !== 7 || !DOCUMENT_NUMBER_PATTERN.test(timbrado.dNumDoc)) {
    throw new DteValidationError(
      "INVALID_DOCUMENT_NUMBER",
      "dNumDoc must be exactly seven digits and match tdNumDoc."
    );
  }
  if (timbrado.dSerieNum !== undefined && !SERIES_PATTERN.test(timbrado.dSerieNum)) {
    throw new DteValidationError("INVALID_SERIES", "dSerieNum must match [A-Z]{2}.");
  }
  assertDateNotBefore(timbrado.dFeIniT, "dFeIniT");
}

function assertGeneralOperation(request: DteRequest): void {
  const general = request.gDatGralOpe;
  assertFecHhmmss(general.dFeEmiDE, "dFeEmiDE");
  if (general.gOpeCom !== undefined) {
    assertOperacionComercial(request);
  }
  assertEmisor(request);
  assertReceptor(request);
}

/**
 * §22.4: `D018 dTiCam` is obligatory when `D017 dCondTiCam = 1`, and must not be
 * informed when `D015 cMoneOpe` is `PYG`. `D015` is also one currency for every
 * item of the DE.
 */
function assertOperacionComercial(request: DteRequest): void {
  const commercial = request.gDatGralOpe.gOpeCom;
  if (commercial === undefined) {
    return;
  }
  assertEnumType(String(commercial.iTImp), "tiTImp");
  if (commercial.iTipTra !== undefined) {
    assertEnumType(String(commercial.iTipTra), "tiTipTra");
  }
  if (
    commercial.dCondTiCam !== undefined &&
    !(COND_TI_CAM_VALUES as readonly number[]).includes(commercial.dCondTiCam)
  ) {
    throw new DteValidationError("INVALID_ENUM", "dCondTiCam must be 1 or 2.");
  }
  if (
    commercial.iCondAnt !== undefined &&
    !(COND_ANT_VALUES as readonly number[]).includes(commercial.iCondAnt)
  ) {
    throw new DteValidationError("INVALID_ENUM", "iCondAnt must be 1 or 2.");
  }
  if (commercial.cMoneOpe === "PYG" && commercial.dTiCam !== undefined) {
    throw new DteValidationError(
      "INVALID_CURRENCY",
      "dTiCam must not be informed when cMoneOpe is PYG."
    );
  }
  // NT 008 (baseline §22.12): F023 "No informar si D015 = PYG".
  if (commercial.cMoneOpe === "PYG" && request.totalGuaranies !== undefined) {
    throw new DteValidationError(
      "INVALID_CURRENCY",
      "F023 totalGuaranies must not be informed when cMoneOpe is PYG; use totalOperacion (F014)."
    );
  }
  if (
    commercial.cMoneOpe !== "PYG" &&
    commercial.dCondTiCam === 1 &&
    commercial.dTiCam === undefined
  ) {
    throw new DteValidationError(
      "INVALID_CURRENCY",
      "dTiCam is obligatory when dCondTiCam = 1 and the currency is not PYG."
    );
  }
  if (commercial.dTiCam !== undefined) {
    assertDecimalType(commercial.dTiCam, "tTipoCambioBase");
  }
}

function assertEmisor(request: DteRequest): void {
  const emitter = request.gDatGralOpe.gEmis;
  if (!isValidRuc(emitter.dRucEm)) {
    throw new DteValidationError("INVALID_EMITTER", "dRucEm must match tRuc.");
  }
  if (!SINGLE_DIGIT_PATTERN.test(emitter.dDVEmi)) {
    throw new DteValidationError("INVALID_EMITTER", "dDVEmi must be one digit.");
  }
  assertEnumType(String(emitter.iTipCont), "tiTipCont");
  if (emitter.cTipReg !== undefined && !TIP_REG_PATTERN.test(emitter.cTipReg)) {
    throw new DteValidationError("INVALID_EMITTER", "cTipReg must match tcTipReg: [1-8].");
  }
  // §22.5: homologation depends on this literal in the test environment.
  if (request.environment === "test" && emitter.dNomEmi !== SIFEN_TEST_EMITTER_NAME) {
    throw new DteValidationError(
      "INVALID_EMITTER",
      "In the test environment dNomEmi must be the exact SIFEN literal."
    );
  }
  // §22.4: "si no tiene numeración, colocar 0".
  if (!NUM_CAS_PATTERN.test(emitter.dNumCas)) {
    throw new DteValidationError("INVALID_EMITTER", "dNumCas must be up to six digits.");
  }
  if (emitter.gActEco.length < 1 || emitter.gActEco.length > 9) {
    throw new DteValidationError(
      "INVALID_ACTIVITY_COUNT",
      "gActEco admits between 1 and 9 occurrences."
    );
  }
  for (const activity of emitter.gActEco) {
    if (!ACT_ECO_CODE_PATTERN.test(activity.cActEco)) {
      throw new DteValidationError("INVALID_EMITTER", "cActEco must match [0-9A-Z]{1,8}.");
    }
  }
}

/**
 * The receptor block, §22.11 — the consolidated rules, each quoted from the
 * Nota Técnica that last set it. §22.3's `No informar si D201 = 1 o D202=4`
 * clause is superseded by NT 023 and is NOT implemented here.
 */
function assertReceptor(request: DteRequest): void {
  const receptor = request.gDatGralOpe.gDatRec;
  assertEnumType(String(receptor.iNatRec), "tiNatRec");
  assertEnumType(String(receptor.iTiOpe), "tiTiOpe");

  // D202b / 1332 (NT 020): a state-entity receptor requires B2G.
  if (receptor.isStateEntity === true && receptor.iTiOpe !== 3) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D202b/1332 requires iTiOpe = 3 when the receptor is a state entity."
    );
  }

  const identityFieldCount = [receptor.iTipIDRec, receptor.dDTipIDRec, receptor.dNumIDRec].filter(
    (value) => value !== undefined
  ).length;

  if (receptor.iNatRec === 1) {
    // D206 / D207: the contributor receptor is identified by its RUC.
    if (!isValidRuc(receptor.dRucRec ?? "") || !SINGLE_DIGIT_PATTERN.test(receptor.dDVRec ?? "")) {
      throw new DteValidationError(
        "INVALID_RECEPTOR",
        "A contributor receptor requires dRucRec and dDVRec."
      );
    }
    // D208 for D201 = 1 (NT 023): identity document is forbidden, not optional.
    if (identityFieldCount > 0) {
      throw new DteValidationError(
        "INVALID_RECEPTOR",
        "D208 must not be informed when iNatRec = 1."
      );
    }
    return;
  }

  // D202 / 1300 (NT 010): a non-contributor is B2C (2) or B2F (4).
  if (receptor.iTiOpe !== 2 && receptor.iTiOpe !== 4) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D202/1300 requires iTiOpe = 2 or 4 for a non-contributor receptor."
    );
  }

  // D208 / D210 for D201 = 2 and D202 != 4 (NT 023): the identity document is
  // obligatory. For B2F (D202 = 4) it is neither required nor forbidden.
  if (receptor.iTiOpe !== 4 && identityFieldCount < 3) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D210/1314 requires iTipIDRec, dDTipIDRec and dNumIDRec when iNatRec = 2 and iTiOpe != 4."
    );
  }
  if (identityFieldCount > 0 && identityFieldCount < 3) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "Identity document type, description and number must be supplied together."
    );
  }
  if (receptor.iTipIDRec !== undefined) {
    assertEnumType(String(receptor.iTipIDRec), "tiTipDocRec");
  }
  if (receptor.dNumIDRec !== undefined && !ID_DOCUMENT_NUMBER_PATTERN.test(receptor.dNumIDRec)) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D210 dNumIDRec must be 1 to 20 characters of [0-9A-Za-z-]."
    );
  }

  const innominado = receptor.iTipIDRec === 5;
  if (!innominado) {
    return;
  }
  // D208b / 1319 (NT 010) and D208f / 1333 (NT 023): same condition.
  if (receptor.iTiOpe !== 2) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D208b/D208f forbid Innominado unless iTiOpe = 2."
    );
  }
  // D208e / 1331 (NT 023): Nota de Crédito (5), Nota de Débito (6) and Nota de
  // Remisión (7) cannot carry an Innominado receptor.
  if ([5, 6, 7].includes(request.gTimb.iTiDE)) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D208e/1331 forbids Innominado for document types 5, 6 and 7."
    );
  }
  // D208c / 1321 (NT 024): threshold lowered from NT 021's 35,000,000.
  // The note selects the field BY CURRENCY (baseline §22.12): F023 when the
  // currency is foreign, F014 when it is PYG. It is not a disjunction, and NT 008
  // makes F023 non-informable for PYG, so the PYG branch cannot use it.
  const iTipTra = request.gDatGralOpe.gOpeCom?.iTipTra;
  const thresholdTotal =
    request.gDatGralOpe.gOpeCom?.cMoneOpe === "PYG"
      ? request.totalOperacion
      : request.totalGuaranies;
  if (
    iTipTra !== 13 &&
    thresholdTotal !== undefined &&
    compareDecimals(thresholdTotal, "7000000") >= 0
  ) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "D208c/1321 forbids Innominado at or above 7,000,000 unless iTipTra = 13."
    );
  }
}

function assertCamposFueraFirma(request: DteRequest): void {
  const qr = request.gCamFuFD.dCarQR;
  if (qr.length < 100 || qr.length > 600) {
    throw new DteValidationError(
      "INVALID_XML_ELEMENT",
      "gCamFuFD dCarQR must be 100 to 600 characters."
    );
  }
  const additional = request.gCamFuFD.dInfAdic;
  if (additional !== undefined && (additional.length < 1 || additional.length > 5000)) {
    throw new DteValidationError(
      "INVALID_XML_ELEMENT",
      "gCamFuFD dInfAdic must be 1 to 5000 characters."
    );
  }
  assertXmlElements(request.gDtipDE ?? []);
  assertXmlElements(request.gTotSub ?? []);
  assertXmlElements(request.gCamGen ?? []);
  for (const associated of request.gCamDEAsoc ?? []) {
    assertXmlElements(associated);
  }
  if ((request.gCamDEAsoc?.length ?? 0) > 99) {
    throw new DteValidationError(
      "INVALID_ASSOCIATED_DOCUMENT_COUNT",
      "gCamDEAsoc admits at most 99 occurrences."
    );
  }
}

function assertXmlElements(elements: readonly DteXmlElement[]): void {
  for (const element of elements) {
    if (!XML_NAME_PATTERN.test(element.name)) {
      throw new DteValidationError(
        "INVALID_XML_ELEMENT",
        `Invalid XML element name: ${element.name}`
      );
    }
    if (element.value !== undefined && element.children !== undefined) {
      throw new DteValidationError(
        "INVALID_XML_ELEMENT",
        `XML element ${element.name} cannot carry both a value and children.`
      );
    }
    if (element.decimalType !== undefined) {
      assertDecimalType(requireElementValue(element, element.decimalType), element.decimalType);
    }
    if (element.integerType !== undefined) {
      assertIntegerType(requireElementValue(element, element.integerType), element.integerType);
    }
    if (element.enumType !== undefined) {
      assertEnumType(requireElementValue(element, element.enumType), element.enumType);
    }
    if (element.dateNotBefore20180501 === true) {
      assertDateNotBefore(requireElementValue(element, "date"), element.name);
    }
    assertXmlElements(element.children ?? []);
  }
}

function requireElementValue(element: DteXmlElement, rule: string): string {
  if (element.value === undefined) {
    throw new DteValidationError(
      "INVALID_XML_ELEMENT",
      `XML element ${element.name} must carry a value to apply the ${rule} rule.`
    );
  }
  return element.value;
}

function assertFecHhmmss(value: string, fieldName: string): void {
  if (!DATE_TIME_PATTERN.test(value)) {
    throw new DteValidationError(
      "INVALID_TIMESTAMP",
      `${fieldName} must be AAAA-MM-DDThh:mm:ss with no timezone and no fractional seconds.`
    );
  }
}

function assertDateNotBefore(value: string, fieldName: string): void {
  if (!YYYY_MM_DD_PATTERN.test(value) || value < SIFEN_MIN_VALIDITY_DATE) {
    throw new DteValidationError(
      "INVALID_DATE_BOUND",
      `${fieldName} must not precede ${SIFEN_MIN_VALIDITY_DATE}.`
    );
  }
}

function isValidRuc(value: string): boolean {
  return value.length >= 3 && value.length <= 8 && RUC_PATTERN.test(value);
}

/** Exact decimal comparison over digit strings; money never becomes a float. */
function compareDecimals(left: string, right: string): number {
  const leftDecimal = normalizeDecimal(left);
  const rightDecimal = normalizeDecimal(right);
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftInteger = leftDecimal.integer * 10n ** BigInt(scale - leftDecimal.scale);
  const rightInteger = rightDecimal.integer * 10n ** BigInt(scale - rightDecimal.scale);
  if (leftInteger === rightInteger) {
    return 0;
  }
  return leftInteger > rightInteger ? 1 : -1;
}

function normalizeDecimal(value: string): { readonly integer: bigint; readonly scale: number } {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new DteValidationError(
      "INVALID_MONEY_SCALE",
      "Decimal values must be non-negative plain decimal strings."
    );
  }
  const [integerPart, fractionPart = ""] = value.split(".");
  return { integer: BigInt(`${integerPart}${fractionPart}`), scale: fractionPart.length };
}

function childValueOf(element: DteXmlElement, name: string): string | undefined {
  return element.children?.find((child) => child.name === name)?.value;
}

function groupRefusal(message: string): DteValidationError {
  return new DteValidationError("INVALID_DOCUMENT_TYPE_GROUP", message);
}

/** The `gCamFE` / `gCamCond` rules of PAY-DET-001 (see `assertDocumentTypeGroups`). */
function assertFacturaGroups(type: number, groups: readonly DteXmlElement[]): void {
  const fe = groups.filter((element) => element.name === "gCamFE");
  if (type === 1 && fe.length !== 1) {
    throw groupRefusal("E010/1350: a Factura electrónica carries exactly one gCamFE.");
  }
  if (type !== 1 && fe.length > 0) {
    throw groupRefusal("E010a/1351: gCamFE must not be informed unless iTiDE is 1.");
  }
  const feGroup = fe[0];
  if (feGroup !== undefined) {
    const code = Number(childValueOf(feGroup, "iIndPres"));
    const expected = IND_PRES_DESCRIPTIONS[code];
    const description = childValueOf(feGroup, "dDesIndPres") ?? "";
    const valid =
      code === 9 ? description.length >= 10 && description.length <= 30 : description === expected;
    if (!valid) {
      throw groupRefusal(
        "E011/E012/1352: iIndPres must be 1..6 or 9 and dDesIndPres its description."
      );
    }
  }

  const cond = groups.filter((element) => element.name === "gCamCond");
  const needsCond = type === 1 || type === 4;
  if (needsCond && cond.length !== 1) {
    throw groupRefusal("E600/1500: document types 1 and 4 carry exactly one gCamCond.");
  }
  if (!needsCond && cond.length > 0) {
    throw groupRefusal("E600a/1501: gCamCond must not be informed unless iTiDE is 1 or 4.");
  }
  const condGroup = cond[0];
  if (condGroup === undefined) return;
  const itemIndex = groups.findIndex((element) => element.name === "gCamItem");
  if (itemIndex !== -1 && itemIndex < groups.indexOf(condGroup)) {
    throw groupRefusal("tgDtipDE orders gCamCond before gCamItem.");
  }
  const condition = Number(childValueOf(condGroup, "iCondOpe"));
  if (COND_OPE_DESCRIPTIONS[condition] !== childValueOf(condGroup, "dDCondOpe")) {
    throw groupRefusal("E601/E602/1502: iCondOpe must be 1 or 2 and dDCondOpe its description.");
  }
  const payments = (condGroup.children ?? []).filter((element) => element.name === "gPaConEIni");
  if (condition === 1 && payments.length === 0) {
    throw groupRefusal("E605/1550: a cash operation (iCondOpe = 1) needs at least one gPaConEIni.");
  }
  for (const payment of payments) {
    assertPayment(payment);
  }
}

function assertPayment(payment: DteXmlElement): void {
  const kind = Number(childValueOf(payment, "iTiPago"));
  const description = childValueOf(payment, "dDesTiPag") ?? "";
  const known = TIPO_PAGO_DESCRIPTIONS[kind];
  if (kind === TIPO_PAGO_OTRO) {
    if (description.trim().length < 4 || description.length > 30) {
      throw groupRefusal("E607: an iTiPago = 99 payment describes itself in 4 to 30 characters.");
    }
  } else if (known === undefined || description !== known) {
    throw groupRefusal(
      "E606/E607/1554: iTiPago must be a tiTiPago code and dDesTiPag its description."
    );
  }

  const card = payment.children?.find((element) => element.name === "gPagTarCD");
  const isCard = kind === 3 || kind === 4;
  if (isCard && card === undefined) {
    throw groupRefusal("E620/1600: a card payment (iTiPago 3 or 4) needs gPagTarCD.");
  }
  if (!isCard && card !== undefined) {
    throw groupRefusal("E620a/1601: gPagTarCD is only for card payments.");
  }
  if (card !== undefined) {
    const brand = Number(childValueOf(card, "iDenTarj"));
    const brandDescription = childValueOf(card, "dDesDenTarj") ?? "";
    const validBrand =
      brand === DEN_TARJ_OTRO
        ? brandDescription.trim().length >= 4 && brandDescription.length <= 20
        : DEN_TARJ_DESCRIPTIONS[brand] === brandDescription;
    if (!validBrand) {
      throw groupRefusal(
        "E621/E622/1602: iDenTarj must be a tiDenTarj code and dDesDenTarj its description."
      );
    }
    if (!["1", "2", "9"].includes(childValueOf(card, "iForProPa") ?? "")) {
      throw groupRefusal("E626: iForProPa must be 1, 2 or 9.");
    }
  }

  const cheque = payment.children?.find((element) => element.name === "gPagCheq");
  if (kind === 2 && cheque === undefined) {
    throw groupRefusal("E630: a cheque payment (iTiPago 2) needs gPagCheq.");
  }
  if (kind !== 2 && cheque !== undefined) {
    throw groupRefusal("E630: gPagCheq is only for cheque payments.");
  }
  if (cheque !== undefined) {
    const bank = childValueOf(cheque, "dBcoEmi") ?? "";
    if (
      !/^[0-9]{8}$/.test(childValueOf(cheque, "dNumCheq") ?? "") ||
      bank.trim().length < 4 ||
      bank.length > 20
    ) {
      throw groupRefusal("E631/E632: dNumCheq is eight digits and dBcoEmi 4 to 20 characters.");
    }
  }
}
