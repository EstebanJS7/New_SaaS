/**
 * FISC-010 WU-B — the six services' shapes, and the constants that pin them.
 *
 * Sources, all quoted in `docs/06-fiscal/SIFEN-BASELINE.md` §23, which is this
 * module's protocol record of truth:
 *
 * ```text
 * 1  Recepción DE            rEnviDe / rRetEnviDe            §23.3  WS_SiRecepDE_v150.xsd
 * 2  Recepción lote DE       rEnvioLote / rResEnviLoteDe     §23.4  WS_SiRecepLoteDE_v141.xsd
 * 3  Consulta resultado lote rEnviConsLoteDe / …ConsLoteDe   §23.4  WS_SiConsLote_v141.xsd
 * 4  Consulta DE por CDC     rEnviConsDeRequest / …Response  §23.6  WS_SiConsDE_v141.xsd
 * 5  Consulta RUC            rEnviConsRUC / rResEnviConsRUC  §23.6  WS_SiConsRUC_v141.xsd
 * 6  Recepción evento        rEnviEventoDe / rRetEnviEventoDe §23.3 WS_SiRecepEvento_v150.xsd
 * ```
 *
 * Three decisions live here rather than in the serializer or the parser, so both
 * halves of the message layer cannot disagree about them:
 *
 * 1. **Namespaces and envelope element names.** The envelope is SOAP 1.2
 *    (`http://www.w3.org/2003/05/soap-envelope`, §23.4) and the body root carries
 *    `SIFEN_NAMESPACE` as its **default** namespace. The Manual's own envelope
 *    example is defective — it lowercases `<soap:body>` and mismatches its
 *    `env`/`soap` prefixes (§8) — so what is copied from §23.4's Guide example is
 *    the namespaces, not its prefixes: `<soap:Header/>` is present and empty, and
 *    nothing inside the body is prefixed.
 * 2. **The field domains.** Every pattern below is the schema's or the Manual's,
 *    with the section that states it on the constant. They are the domains the
 *    serializer writes and the parser validates, which is what makes ADR-008 §5's
 *    "validated against a known domain … never coerced" one rule instead of two.
 *    Each `RegExp` is declared **without the `g` or `y` flag**, so `.test()` is
 *    stateless and a shared constant cannot carry a `lastIndex` between calls.
 * 3. **Required versus optional, and the rule that decides it.** A response field
 *    is required when the schema marks it required (§23.3 marks `dFecProc`
 *    REQUIRED and the other `rProtDe` members optional; §23.4 marks all five
 *    `rResEnviLoteDe` members optional and none of `rResEnviConsLoteDe`'s three
 *    scalars) **or when the response cannot be turned into an answer without it**.
 *    The two exceptions that rule creates are documented on the fields
 *    themselves: `dCodRes` on the batch reception is optional in the schema but
 *    required by this reader, because without it a `0300`/`0301` answer is not an
 *    answer; and a repeating group is `0..maxOccurs` as the schema allows, with
 *    each present entry's own members required as the schema marks them.
 *
 * Two fields are **strings by policy** and not by accident: `dId` (a 15-digit
 * control number), `dProtConsLote` (28 digits, §23.4), `dProtAut` (§23.3's
 * `tdProtAut = xs:long`), every CDC and every result code. ADR-008 §5 rule 3
 * refuses value coercion, and a 28-digit batch number cannot survive a `number`.
 */

import type { SifenEstadoResultado } from "./sifen.codes.js";

/**
 * `http://ekuatia.set.gov.py/sifen/xsd` — the `targetNamespace` of every
 * published DNIT schema (§23.4), and the namespace of the DE that
 * `dte.types.ts` already declares as `DTE_NAMESPACE`.
 *
 * Declared here as a constant rather than re-exported from the DTE module,
 * because this module also names the **batch container**'s namespace, which
 * §23.4 records as unpinned and which must be able to move independently: a
 * homologation run flips one constant, not the DE's namespace.
 */
export const SIFEN_NAMESPACE = "http://ekuatia.set.gov.py/sifen/xsd" as const;

/** SOAP 1.2's envelope namespace (§23.4's Guide example; §7's protocol row). */
export const SOAP_ENVELOPE_NAMESPACE = "http://www.w3.org/2003/05/soap-envelope" as const;

/** The envelope elements, so the serializer and the parser spell them once. */
export const SIFEN_SOAP_ENVELOPE = "Envelope" as const;
export const SIFEN_SOAP_HEADER = "Header" as const;
export const SIFEN_SOAP_BODY = "Body" as const;

/**
 * The prefix the envelope's own elements carry.
 *
 * SOAP 1.2 pins no prefix — the namespace is what matters — but §23.4's Guide
 * example writes `soap:`, so this client keeps that spelling on the envelope
 * while the **body root carries the SIFEN namespace as the default one** and
 * nothing inside the body is prefixed. The parser does not read this constant:
 * it strips prefixes (§8's Manual defect is exactly a prefix mismatch), so the
 * two halves of the layer agree on the element names without either being keyed
 * on the prefix.
 */
export const SOAP_ENVELOPE_PREFIX = "soap" as const;

/** §23.3 / §23.4 / §9.2.1: `dId` is an integer of at most 15 digits. */
export const SIFEN_MAX_ID_DIGITS = 15;

/**
 * §23.3 / §23.4 / §9.2.1: one to fifteen digits, and **not all zero** — §23.4
 * gives the batch's own range as `1..999999999999999`, and §9.2.1 calls the
 * field a "Número secuencial autoincremental … responsabilidad del
 * contribuyente". `totalDigits 15` alone would admit `0`; a control number that
 * starts at zero is not what either source describes, so it is refused by name
 * rather than emitted.
 */
export const SIFEN_ID_PATTERN = /^(?!0+$)[0-9]{1,15}$/;

/** §23.6 `tCDC`: exactly 44 characters. */
export const SIFEN_CDC_LENGTH = 44;

/**
 * §23.6 `tCDC` (`FE_Types_v141.xsd`): `[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}`.
 *
 * `A-D` and not `A-Z`: the check digit's alphabet is narrower than hexadecimal,
 * so a CDC ending in `E` is malformed and is refused rather than passed on.
 */
export const SIFEN_CDC_PATTERN = /^[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}$/;

/** §23.6 `tRuc`: 5..8 characters, and never a leading zero. */
export const SIFEN_RUC_MIN_LENGTH = 5;
export const SIFEN_RUC_MAX_LENGTH = 8;
export const SIFEN_RUC_PATTERN = /^[1-9][0-9]*[0-9A-D]?$/;

/**
 * §10's tables type a result code `N, 4` and §23.4's `tgResProc` patterns it
 * `[0-9]{4}`; §23.7's codes (`0300`, `0361`, `0422`, `0502`) are all four digits.
 *
 * §23.3 records that the v150 schema is **looser here than the Manual** — it
 * declares `dCodRes` as `xs:string` with `minLength 1` and **no pattern** — and
 * says so in the same breath as the conclusion: "a client must validate the
 * domain itself rather than trusting the document to be well-typed". This reader
 * validates the four digits, uniformly, on every result code.
 */
export const SIFEN_RESULT_CODE_WIDTH = 4;
export const SIFEN_RESULT_CODE_PATTERN = /^[0-9]{4}$/;

/** §23.4: `dProtConsLote` is a decimal of 28 digits, kept as a string. */
export const SIFEN_BATCH_NUMBER_MAX_DIGITS = 28;
export const SIFEN_BATCH_NUMBER_PATTERN = /^[0-9]{1,28}$/;

/** §23.4: `tgResProcLote`'s `dProtAut` is `xs:integer` with pattern `[0-9]{1,10}`. */
export const SIFEN_BATCH_PROTOCOL_NUMBER_PATTERN = /^[0-9]{1,10}$/;

/** §23.3: `tdProtAut` is `xs:long`, i.e. at most 19 digits. */
export const SIFEN_PROTOCOL_NUMBER_PATTERN = /^[0-9]{1,19}$/;

/** §23.3: `gResProc` in the processing protocol is `maxOccurs 100`. */
export const SIFEN_RECEPTION_MAX_CODES = 100;

/** §23.4: `gResProcLote` is `maxOccurs 50` — the response's groups, not the batch. */
export const SIFEN_BATCH_QUERY_MAX_RESULTS = 50;

/** §23.4: `gResProc` inside a batch-query result group is `maxOccurs 5`. */
export const SIFEN_BATCH_QUERY_MAX_CODES = 5;

/** §23.3: `gResProcEVe` is `1..15`. */
export const SIFEN_EVENT_MAX_RESULTS = 15;
export const SIFEN_EVENT_MIN_RESULTS = 1;

/** §23.3: `gResProc` inside an event result is `maxOccurs 100`. */
export const SIFEN_EVENT_MAX_CODES = 100;

/** §23.4: `dMsgResLot` and a batch-query `gResProc`'s `dMsgRes` are 1..255 characters. */
export const SIFEN_RESULT_MESSAGE_MAX_LENGTH = 255;

/** §23.6: `rContRUC`'s `dRazCons` is 1..250 characters. */
export const SIFEN_RUC_NAME_MAX_LENGTH = 250;

/** §23.6: `dCodEstCons` is 3 characters; its catalogue is not retrieved. */
export const SIFEN_RUC_STATE_CODE_LENGTH = 3;

/**
 * §23.6 types `dDesEstCons` as `(6-25)`; this reader accepts any non-empty value
 * up to 25 characters, because a service that answers with a shorter description
 * is not answering with a malformed one.
 */
export const SIFEN_RUC_STATE_DESCRIPTION_MAX_LENGTH = 25;

/**
 * §23.6: `dRUCFactElec` is one character, `S` (facturador electrónico) or `N`.
 *
 * Its domain is the one place where a parsed value is narrowed to a **literal
 * union** rather than kept as a string: the two characters are the whole value
 * space, and a caller branching on it wants `S` to mean `S`.
 */
export const SIFEN_RUC_ELECTRONIC_VALUES = ["S", "N"] as const;
export type SifenRucElectronicFlag = (typeof SIFEN_RUC_ELECTRONIC_VALUES)[number];

/**
 * §23.3: `dDigVal` is the DE's hash, typed `xs:base64Binary`.
 *
 * XSD's `base64Binary` admits white space in its lexical space (its `whiteSpace`
 * is `collapse`), so the check runs on a whitespace-stripped copy and the value
 * itself is kept as sent — `trimValues: false` is not undone by a validator.
 */
export const SIFEN_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** §23.3 — `rEnviDe`: `dId` plus the signed DE **embedded as a child element**. */
export interface SifenReceptionRequest {
  readonly dId: string;
  /** The signed DE's XML, inserted verbatim; never escaped and never base64. */
  readonly deXml: string;
}

/** §23.3 / `protProcesDE_v150.xsd` — one `gResProc` entry. */
export interface SifenProcessingResultGroup {
  /** `dCodRes`: `xs:string` minLength 1 in the schema; §10 types it `N, 4`. */
  readonly dCodRes: string | undefined;
  /** `dMsgRes`: `xs:string` minLength 1; the field the Guide's `&#233;` appears in. */
  readonly dMsgRes: string | undefined;
}

/** §23.3 / `protProcesDE_v150.xsd` — `rProtDe`. */
export interface SifenProcessingProtocol {
  /** `Id`: the CDC this protocol answers for. */
  readonly cdc: string | undefined;
  /** `dFecProc`: **REQUIRED** by the schema, so a protocol without it is refused. */
  readonly dFecProc: string;
  /** `dDigVal`: base64 digest of the DE. */
  readonly dDigVal: string | undefined;
  /**
   * `dEstRes`: the schema declares a bare `xs:string`, so this reader enforces
   * §10's three values and refuses anything else.
   */
  readonly dEstRes: SifenEstadoResultado | undefined;
  /** `dProtAut`: `tdProtAut = xs:long`, kept as a string. */
  readonly dProtAut: string | undefined;
  /** `gResProc`: `0..100`. */
  readonly gResProc: readonly SifenProcessingResultGroup[];
}

/** §23.3 — `rRetEnviDe { rProtDe }`. */
export interface SifenReceptionResponse {
  readonly protocol: SifenProcessingProtocol;
}

/** §23.4 — `rEnvioLote`: `dId` plus `xDE` as a **base64 ZIP**, one entry. */
export interface SifenBatchReceptionRequest {
  readonly dId: string;
  /** The DEs to compress into the batch container, in the order they are emitted. */
  readonly deXmls: readonly string[];
}

/** §23.4 / `WS_SiRecepLoteDE_v141.xsd` — `rResEnviLoteDe`. */
export interface SifenBatchReceptionResponse {
  readonly dFecProc: string | undefined;
  /**
   * `dCodRes`: optional in the schema, **required by this reader** — §23.7's
   * `0300`/`0301` are the batch's answer, and a response that carries neither is
   * not one. An unrecognized-but-well-formed code is data, not a failure.
   */
  readonly dCodRes: string;
  readonly dMsgRes: string | undefined;
  /** `dProtConsLote`: the asynchronous handle, 28 digits, kept as a string. */
  readonly dProtConsLote: string | undefined;
  /** `dTpoProces`: `xs:integer`, kept as a string for the same reason as `dId`. */
  readonly dTpoProces: string | undefined;
}

/**
 * §23.4 — `rEnviConsLoteDe { dId, dProtConsLote?, dCDC? }`.
 *
 * At least one of `dProtConsLote` and `dCDC` is required by §23.7's own recovery
 * rule: the batch number is the normal handle, and a CDC is the fallback "solo en
 * caso de no recibir el Número de Lote". A request carrying neither could not be
 * answered, so the serializer refuses it.
 */
export interface SifenBatchQueryRequest {
  readonly dId: string;
  readonly dProtConsLote?: string;
  readonly dCDC?: string;
}

/** §23.4 / `tgResProc` inside a batch-query result group. */
export interface SifenBatchQueryResultGroup {
  readonly dCodRes: string;
  readonly dMsgRes: string;
}

/** §23.4 / `tgResProcLote` — one DE's result inside the batch. */
export interface SifenBatchQueryDeResult {
  /** `id`: the DE's CDC, validated against `tCDC` (§23.6). */
  readonly cdc: string;
  readonly dEstRes: SifenEstadoResultado;
  /** `dProtAut`: `[0-9]{1,10}` here, where §23.3's protocol uses `xs:long`. */
  readonly dProtAut: string | undefined;
  /** `gResProc`: `0..5`. */
  readonly gResProc: readonly SifenBatchQueryResultGroup[];
}

/** §23.4 — `rResEnviConsLoteDe`. */
export interface SifenBatchQueryResponse {
  readonly dFecProc: string;
  readonly dCodResLot: string;
  readonly dMsgResLot: string;
  /** `gResProcLote`: `0..50`. */
  readonly gResProcLote: readonly SifenBatchQueryDeResult[];
}

/**
 * §23.6 — `rEnviConsDeRequest { dId, dCDC }`, **unsigned**.
 *
 * The element name is the artifact's, not the Manual's: §23.6 records the
 * Manual's table calling it `rEnviConsDe` while `WS_SiConsDE_v141.xsd` — the only
 * published schema, §23.2 — declares `rEnviConsDeRequest`, and the Guide's own
 * example agrees with the schema. **The artifact wins.**
 */
export interface SifenCdcQueryRequest {
  readonly dId: string;
  readonly dCDC: string;
}

/**
 * The DE a consultation answered with, and how it arrived (§23.8 item 3).
 *
 * `WS_SiConsDE_v141.xsd` types `xContenDE` as `xs:string` while the Manual
 * describes a container `rContDe { rDE, dProtAut }` — so the reader accepts the
 * DE **bare or wrapped** and never assumes which. `deXml` is the DE's own bytes
 * either way: when the DE arrived as markup it is exactly what the service sent,
 * and when it arrived as `xs:string` it is the text those bytes were escaped
 * into. What it is **not** is anything that surrounded the element inside
 * `xContenDE` — whitespace included: the value is the `rDE` element, not the
 * field's content.
 */
export interface SifenDeContent {
  readonly deXml: string;
  /** `dProtAut`, only when the DE arrived inside `rContDe`. */
  readonly dProtAut: string | undefined;
  /** Which of the two shapes it was, recorded instead of guessed at. */
  readonly wrappedInContainer: boolean;
}

/** §23.6 — `rEnviConsDeResponse`. */
export interface SifenCdcQueryResponse {
  readonly dFecProc: string;
  readonly dCodRes: string;
  readonly dMsgRes: string;
  /** Present — and only meaningfully so — when `dCodRes` is `0422` (Tabla G). */
  readonly xContenDE: SifenDeContent | undefined;
}

/**
 * §23.6 — `rEnviConsRUC { dId, dRUCCons }`, **unsigned**.
 *
 * `dRUCCons` is `tRuc`: 5..8 characters, no leading zero. The Manual notes the
 * query carries the RUC "sin dígito verificador" while the type's pattern admits
 * a trailing `[0-9A-D]`, so both forms are accepted.
 */
export interface SifenRucQueryRequest {
  readonly dId: string;
  readonly dRUCCons: string;
}

/** §23.6 — `tContenedorRuc`, the five fields `xContRUC` carries. */
export interface SifenRucStatus {
  readonly dRUCCons: string;
  /** `dRazCons`: 1..250 characters. */
  readonly dRazCons: string;
  /** `dCodEstCons`: 3 characters; its catalogue is not retrieved, so no class. */
  readonly dCodEstCons: string;
  /** `dDesEstCons`: up to 25 characters. */
  readonly dDesEstCons: string;
  readonly dRUCFactElec: SifenRucElectronicFlag;
}

/** §23.6 — `rResEnviConsRUC`. */
export interface SifenRucQueryResponse {
  readonly dCodRes: string;
  readonly dMsgRes: string;
  /** Present when `dCodRes` is `0502`; absent for Tabla H's other two codes. */
  readonly xContRUC: SifenRucStatus | undefined;
}

/**
 * §23.3 — `rEnviEventoDe { dId, dEvReg { gGroupGesEve } }`.
 *
 * The **event document is embedded as a child element**, exactly as the DE is in
 * the synchronous reception. Which element that is: §23.3 records that
 * `siRecepEvento_v150.xsd` declares `gGroupGesEve` as `tgGroupGesEve`, defined in
 * `Evento_v150.xsd`, and that the three directions' wrapper schemas declare
 * `rGesEve` as `trGesEveEmi`/`trGesEveRecep`/`trGesEveSet`. `Evento_v150.xsd` is
 * retrieved but **not profiled** (§23.8 item 6), so this reader asserts the root
 * is `rGesEve` and does not profile what that element carries — building an
 * event's payload is the caller's, exactly as building a DE is.
 */
export interface SifenEventReceptionRequest {
  readonly dId: string;
  /** The event document's XML, inserted verbatim; never escaped and never base64. */
  readonly eventXml: string;
}

/** §23.3 — one `gResProcEVe` entry. */
export interface SifenEventResult {
  /** `id`: the emitter's own identifier for what the event is about. */
  readonly id: string;
  readonly dEstRes: SifenEstadoResultado;
  /** `dProtAut`: `xs:long`, kept as a string. */
  readonly dProtAut: string | undefined;
  /** `gResProc`: `0..100`; a clean approval may carry no observation at all. */
  readonly gResProc: readonly SifenProcessingResultGroup[];
}

/** §23.3 — `rRetEnviEventoDe { dFecProc, gResProcEVe }`, the latter `1..15`. */
export interface SifenEventReceptionResponse {
  readonly dFecProc: string;
  readonly gResProcEVe: readonly SifenEventResult[];
}
