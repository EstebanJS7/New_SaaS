/**
 * FISC-008 WU-A — typed request for the DE XML builder.
 *
 * Structure and element order follow the official schemas
 * (`DE_v150.xsd` / `DE_Types_v150.xsd`, retrieved 2026-10-04, not vendored);
 * the conditional rules and cross-field invariants follow
 * `docs/06-fiscal/SIFEN-BASELINE.md` §21, §22.4, §22.5, §22.9 and §22.11.
 *
 * Groups whose members are not yet transcribed (`gDtipDE`, `gTotSub`,
 * `gCamGen`, `gCamDEAsoc`) are carried as ordered element trees instead of
 * invented typed shapes: §22.10 records that the item, imputation and title
 * areas are still provisional.
 */

export const DTE_XML_VERSION = "150" as const;
export const DTE_NAMESPACE = "http://ekuatia.set.gov.py/sifen/xsd" as const;
export const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#" as const;
export const SIFEN_MIN_VALIDITY_DATE = "2018-05-01" as const;
export const SIFEN_TEST_EMITTER_NAME =
  "DE generado en ambiente de prueba - sin valor comercial ni fiscal" as const;

/** §21.5 `/ tiTipEmi`: `[1-2]`. */
export const TIP_EMI_VALUES = [1, 2] as const;
/** §21.5 `/ tiTiDE`: `1|[4-7]|9|10`. */
export const TI_DE_VALUES = [1, 4, 5, 6, 7, 9, 10] as const;
/** §21.5 `/ tiTipTra`: 1..13. */
export const TIP_TRA_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
/** §21.5 `/ tiTImp`: 1..5. */
export const T_IMP_VALUES = [1, 2, 3, 4, 5] as const;
/** `tiAfecIVA` (§21.5): 1..4. */
export const AFEC_IVA_VALUES = [1, 2, 3, 4] as const;
/**
 * `tdDesAfecIVA`'s values and their pairing with the codes. **The schema states
 * that pairing in its own comments** ("Corresponde al Codigo N del campo
 * iAfecIVA"), so this is a schema-pinned mapping rather than a reading of the
 * Manual's tables — which is why it is encoded while the `tdDes*` strings of
 * other groups are not.
 */
export const AFEC_IVA_DESCRIPTIONS = {
  1: "Gravado IVA",
  2: "Exonerado (Art. 100 - Ley 6380/2019)",
  3: "Exento",
  4: "Gravado parcial (Grav- Exento)",
} as const;

/** §21.5 `/ tiTipCont`: 1|2. */
export const TIP_CONT_VALUES = [1, 2] as const;
/** §21.5 `/ tiNatRec`: 1|2. */
export const NAT_REC_VALUES = [1, 2] as const;
/** §22.11 `/ D208 iTipIDRec`, type `tiTipDocRec`: `[1-6]|9`. NOT `tiTipDoc`. */
export const TIP_DOC_REC_VALUES = [1, 2, 3, 4, 5, 6, 9] as const;
/** `tiTiOpe` (`[1-4]`): 3 is B2G, 4 is B2C (§22.11). */
export const TIP_OPE_VALUES = [1, 2, 3, 4] as const;
/** `tdCondTiCam`: 1 = global, 2 = por ítem. */
export const COND_TI_CAM_VALUES = [1, 2] as const;
/** `tiCondAnt`: 1 = global, 2 = por ítem. */
export const COND_ANT_VALUES = [1, 2] as const;

export type DteTipoEmision = (typeof TIP_EMI_VALUES)[number];
export type DteTipoDocumentoElectronico = (typeof TI_DE_VALUES)[number];
export type DteTipoTransaccion = (typeof TIP_TRA_VALUES)[number];
export type DteTipoImpuesto = (typeof T_IMP_VALUES)[number];
export type DteTipoContribuyente = (typeof TIP_CONT_VALUES)[number];
export type DteAfectacionIva = (typeof AFEC_IVA_VALUES)[number];
export type DteNaturalezaReceptor = (typeof NAT_REC_VALUES)[number];
export type DteTipoDocumentoReceptor = (typeof TIP_DOC_REC_VALUES)[number];
export type DteTipoOperacion = (typeof TIP_OPE_VALUES)[number];
export type DteCondicionTipoCambio = (typeof COND_TI_CAM_VALUES)[number];
export type DteCondicionAnticipo = (typeof COND_ANT_VALUES)[number];

/** Money / quantity types with their own scale (§21.4). */
export type DteDecimalType =
  "tMontoBase" | "tMontoBase4" | "tMontoBase6" | "tTipoCambioBase" | "tPorcDesc8" | "tdCantProSer";

/** Integer types (§21.4). */
export type DteIntegerType = "tdTasaIVA";

/** Enumerated code types recorded in §21.5 / §22.11. */
export type DteEnumType =
  | "tiTipEmi"
  | "tiTiDE"
  | "tiTipTra"
  | "tiTImp"
  | "tiTipCont"
  | "tiAfecIVA"
  | "tiNatRec"
  | "tiTiOpe"
  | "tiTipDocRec";

/**
 * One element of an ordered tree for a group whose members are not yet
 * transcribed. `decimalType` / `integerType` / `enumType` /
 * `dateNotBefore20180501` attach the cited rule to the supplied value.
 */
export interface DteXmlElement {
  readonly name: string;
  readonly value?: string;
  readonly children?: readonly DteXmlElement[];
  readonly decimalType?: DteDecimalType;
  readonly integerType?: DteIntegerType;
  readonly enumType?: DteEnumType;
  readonly dateNotBefore20180501?: boolean;
}

/** `gOpeDE` / `tgCOpeDE` — §4 pins exactly these members. */
export interface DteOperationEmission {
  readonly iTipEmi: DteTipoEmision;
  /** `tdDesTipEmi`: `Normal` | `Contingencia` (§21.5). */
  readonly dDesTipEmi: "Normal" | "Contingencia";
  /** §22.9 / `D002`: nine digits, zero-padded, never equal to `dNumDoc`. */
  readonly dCodSeg: string;
  readonly dInfoEmi?: string;
  readonly dInfoFisc?: string;
}

/** `gTimb` / `tgDTim`. */
export interface DteTimbrado {
  readonly iTiDE: DteTipoDocumentoElectronico;
  readonly dDesTiDE: string;
  /** `tdNumTim`: exactly eight digits. */
  readonly dNumTim: string;
  /** `tdEst`: zero-padded to three digits. */
  readonly dEst: string;
  /** `tdPunExp`: zero-padded to three digits. */
  readonly dPunExp: string;
  /** `tdNumDoc`: exactly seven digits. */
  readonly dNumDoc: string;
  /** `tdSerieNum`: `[A-Z]{2}`. */
  readonly dSerieNum?: string;
  /** `tdFeIniT`: `minInclusive=2018-05-01`. */
  readonly dFeIniT: string;
}

/** `gOblAfe` / `tgOblAfe` (§22.10 profiles `D140`/`D141`/`D142` as provisional). */
export interface DteObligacionAfectada {
  readonly cOblAfe: string;
  readonly dDesOblAfe: string;
}

/** `gOpeCom` / `tgOpeCom`. */
export interface DteOperacionComercial {
  readonly iTipTra?: DteTipoTransaccion;
  readonly dDesTipTra?: string;
  readonly iTImp: DteTipoImpuesto;
  readonly dDesTImp: string;
  /** `D015 cMoneOpe`: one currency for every item of the DE (§22.4). */
  readonly cMoneOpe: string;
  readonly dDesMoneOpe: string;
  readonly dCondTiCam?: DteCondicionTipoCambio;
  /** `D018 dTiCam`, type `tTipoCambioBase`; absent when `cMoneOpe` is PYG (§22.4). */
  readonly dTiCam?: string;
  readonly iCondAnt?: DteCondicionAnticipo;
  readonly dDesCondAnt?: string;
  readonly gOblAfe?: readonly DteObligacionAfectada[];
}

/** `gActEco` / `tgActEco`. */
export interface DteActividadEconomica {
  /** `D131 cActEco`: `[0-9A-Z]{1,8}`; its catalogue is not retrieved. */
  readonly cActEco: string;
  readonly dDesActEco: string;
}

/** `gRespDE` / `tgRespDE`. */
export interface DteResponsableEmision {
  readonly iTipIDRespDE: number;
  readonly dDTipIDRespDE: string;
  readonly dNumIDRespDE: string;
  readonly dNomRespDE: string;
  readonly dCarRespDE: string;
}

/** `gEmis` / `tgEmis`, in schema order. */
export interface DteEmisor {
  /** `D101 dRucEm`, `tRuc`; must match the signing certificate's RUC (§22.4). */
  readonly dRucEm: string;
  /** `D102 dDVEmi`, `tDVer`. */
  readonly dDVEmi: string;
  /** `D103 iTipCont`. */
  readonly iTipCont: DteTipoContribuyente;
  /** `cTipReg`; `Tabla 1 – Tipo de Régimen` is not retrieved (§22.7 of the story). */
  readonly cTipReg?: string;
  /** `D105 dNomEmi`; the test-environment literal is mandatory in test (§22.5). */
  readonly dNomEmi: string;
  readonly dNomFanEmi?: string;
  readonly dDirEmi: string;
  /** `D108 dNumCas`: "si no tiene numeración, colocar 0" (§22.4). */
  readonly dNumCas: string;
  readonly dCompDir1?: string;
  readonly dCompDir2?: string;
  /** `D111 cDepEmi`, per `Departamentos_v141.xsd` (§22.6). */
  readonly cDepEmi: string;
  readonly dDesDepEmi: string;
  /** `D113 cDisEmi`, Tabla 2.1 Distritos (§22.6). */
  readonly cDisEmi?: string;
  readonly dDesDisEmi?: string;
  /** `D115 cCiuEmi`, Tabla 2.2 Ciudades (§22.6). */
  readonly cCiuEmi: string;
  readonly dDesCiuEmi: string;
  readonly dTelEmi: string;
  readonly dEmailE: string;
  readonly dDenSuc?: string;
  readonly gActEco: readonly DteActividadEconomica[];
  readonly gRespDE?: DteResponsableEmision;
}

/**
 * `gDatRec` / `tgDatRec`, in schema order.
 *
 * The conditional rules are §22.11's (last set by NT 023), never §22.3's: the
 * identity document is forbidden **only** when `iNatRec = 1`.
 */
export interface DteReceptor {
  readonly iNatRec: DteNaturalezaReceptor;
  readonly iTiOpe: DteTipoOperacion;
  readonly cPaisRec: string;
  readonly dDesPaisRe: string;
  readonly iTiContRec?: DteTipoContribuyente;
  /** `D206 dRucRec`: obligatory when `iNatRec = 1`; not informed when `iNatRec = 2`. */
  readonly dRucRec?: string;
  /** `D207 dDVRec`: obligatory when `dRucRec` exists (módulo 11). */
  readonly dDVRec?: string;
  /** `D208 iTipIDRec`, type `tiTipDocRec` (§22.11). */
  readonly iTipIDRec?: DteTipoDocumentoReceptor;
  /** `D209 dDTipIDRec`. */
  readonly dDTipIDRec?: string;
  /** `D210 dNumIDRec`: 1..20 of `[0-9A-Za-z-]`; innominado is completed with 0. */
  readonly dNumIDRec?: string;
  readonly dNomRec: string;
  readonly dNomFanRec?: string;
  readonly dDirRec?: string;
  readonly dNumCasRec?: string;
  readonly cDepRec?: string;
  readonly dDesDepRec?: string;
  readonly cDisRec?: string;
  readonly dDesDisRec?: string;
  readonly cCiuRec?: string;
  readonly dDesCiuRec?: string;
  readonly dTelRec?: string;
  readonly dCelRec?: string;
  readonly dEmailRec?: string;
  readonly dCodCliente?: string;
  /**
   * Input for `D202b`/1332: whether `dRucRec` is an Organismo o Entidad del
   * Estado. The RUC itself does not reveal this, so the caller supplies it.
   */
  readonly isStateEntity?: boolean;
}

/** `gDatGralOpe` / `tgDaGOC`. */
export interface DteDatosGeneralesOperacion {
  /** `fecHhmmss`: no timezone suffix and no fractional seconds. */
  readonly dFeEmiDE: string;
  readonly gOpeCom?: DteOperacionComercial;
  readonly gEmis: DteEmisor;
  readonly gDatRec: DteReceptor;
}

/** `gCamFuFD` / `tgCamFuFD`, outside the signed `DE`. */
export interface DteCamposFueraFirma {
  /** `dCarQR`: 100..600 characters; its content is [[FISC-012]]'s. */
  readonly dCarQR: string;
  readonly dInfAdic?: string;
}

export interface DteRequest {
  /** `tCDC`: 44 characters, `[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}`. */
  readonly cdc: string;
  /** `dDVId`: carried as supplied; WU-A never computes the CDC check digit (§22.9). */
  readonly dDVId: string;
  /** `dFecFirma`: `AAAA-MM-DDThh:mm:ss`, no timezone, no fraction. */
  readonly dFecFirma: string;
  readonly environment: "test" | "production";
  readonly gOpeDE: DteOperationEmission;
  readonly gTimb: DteTimbrado;
  readonly gDatGralOpe: DteDatosGeneralesOperacion;
  /**
   * `gDtipDE`: document-type-specific. Its members are NOT transcribed, so the
   * caller supplies ordered elements (§22.10 marks this area provisional).
   */
  readonly gDtipDE?: readonly DteXmlElement[];
  /** `gTotSub`: not transcribed; monetary elements carry their `decimalType`. */
  readonly gTotSub?: readonly DteXmlElement[];
  /** `gCamGen`: not transcribed. */
  readonly gCamGen?: readonly DteXmlElement[];
  /** `gCamDEAsoc` at `0..99`. */
  readonly gCamDEAsoc?: readonly (readonly DteXmlElement[])[];
  readonly gCamFuFD: DteCamposFueraFirma;
  /**
   * `F014 dTotGralOpe`, the operation's general total. `D208c`/1321 compares
   * **this** field when the currency is PYG (§22.12).
   */
  readonly totalOperacion?: string;
  /**
   * `F023 dTotalGs`, the general total in guaraníes. `D208c`/1321 compares
   * **this** field when the currency is not PYG, and NT 008 adds that it must
   * **not** be informed at all when `D015 = PYG` (§22.12).
   */
  readonly totalGuaranies?: string;
}
