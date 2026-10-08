/**
 * FISC-010 WU-B — the six request envelopes, as strings.
 *
 * Every function here is total from a validated request to an XML string: no
 * clock, no randomness, no I/O, no filesystem, no environment. The only
 * dependency is `fflate`, which ADR-008 chose for the batch container the service
 * requires (§23.4's `xDE` is `xs:base64Binary` with
 * `xmime:expectedContentTypes="application/zip"`).
 *
 * Four rules shape the module, and each one is a way of not inventing protocol:
 *
 * 1. **Escaping is explicit** for every text value, mirroring
 *    `dte.builder.ts`'s helper (`&`, `<`, `>`). Every published domain here is
 *    digits, alphanumerics or base64 — so the escape is the second line of
 *    defence and the domain validation is the first — and nothing is written into
 *    an attribute, so there is no attribute-value escape to go with it.
 * 2. **The embedded documents are inserted verbatim.** The signed DE and the
 *    event document are handed to the service as child elements
 *    (§23.3's `xDE`/`dEvReg` wildcards), never escaped and never base64, and
 *    never re-indented: they are signed bytes, and moving a whitespace character
 *    inside them would break the signature this package produced. The document's
 *    root is asserted before it is embedded (`<rDE`, `<rGesEve`), which is
 *    ADR-008's rule — "asserted to be the DE our own builder produced".
 * 3. **`dId`, `dProtConsLote` and every CDC stay strings.** A 15-digit control
 *    number and a 28-digit batch number do not survive `number`, and the
 *    published patterns are what the fields are checked against
 *    (`SIFEN_ID_PATTERN`, `SIFEN_BATCH_NUMBER_PATTERN`, `SIFEN_CDC_PATTERN`).
 * 4. **The two things §23.8 leaves unpinned are single constants**:
 *    {@link SIFEN_ZIP_ENTRY_NAME} and {@link SIFEN_BATCH_CONTAINER_NAMESPACE}. A
 *    homologation run flips them without touching this file's logic.
 *
 * The envelope: `<soap:Envelope xmlns:soap="…">` with an empty
 * `<soap:Header/>` and the body root carrying `SIFEN_NAMESPACE` as its **default
 * namespace**, so nothing inside the body is prefixed. That is the Guide's
 * example's namespaces (§23.4) without the Manual's defective prefixes (§8).
 */

import { strToU8, zipSync } from "fflate";

import {
  SIFEN_BATCH_NUMBER_PATTERN,
  SIFEN_CDC_PATTERN,
  SIFEN_ID_PATTERN,
  SIFEN_MAX_ID_DIGITS,
  SIFEN_NAMESPACE,
  SIFEN_RUC_MAX_LENGTH,
  SIFEN_RUC_MIN_LENGTH,
  SIFEN_RUC_PATTERN,
  SIFEN_SOAP_BODY,
  SIFEN_SOAP_ENVELOPE,
  SIFEN_SOAP_HEADER,
  SOAP_ENVELOPE_NAMESPACE,
  SOAP_ENVELOPE_PREFIX,
  type SifenBatchQueryRequest,
  type SifenBatchReceptionRequest,
  type SifenCdcQueryRequest,
  type SifenEventReceptionRequest,
  type SifenReceptionRequest,
  type SifenRucQueryRequest,
} from "./sifen.messages.js";

/** §23.7: "Enviar la máxima cantidad posible de documentos en un lote (hasta 50 documentos)". */
export const SIFEN_BATCH_MAX_DOCUMENTS = 50;

/**
 * The ZIP entry's name inside `xDE`.
 *
 * **Unpinned by every retrieved source** (§23.8 item 4): the container element is
 * `rLoteDE`, the compression is described but not parameterised, and no artifact
 * names the entry. One entry is what this client emits, this is its name, and it
 * is a single constant so a homologation run can flip it without touching the
 * serializer.
 */
export const SIFEN_ZIP_ENTRY_NAME = "lote.xml";

/**
 * The batch container's namespace.
 *
 * **Unpinned by every retrieved source** (§23.8 item 4): `rLoteDE` appears in no
 * published schema — the Manual's Schema XML 5A is one of the eleven 404s §23.2
 * records — and the Manual's table gives the element without a namespace. §23.4
 * decides what this client emits: **the SIFEN namespace**, because every
 * published DNIT schema declares that `targetNamespace` and the `rDE` inside the
 * container carries its own namespace declaration. A single constant, so a
 * homologation run can flip it without touching the serializer.
 */
export const SIFEN_BATCH_CONTAINER_NAMESPACE = SIFEN_NAMESPACE;

/**
 * §23.7: "El mensaje de datos de entrada del WS no debe superar 1000 KB".
 *
 * **The `K` is the one thing this module reads rather than quotes**: the Guide
 * says 1000 KB and does not say 1000×1000 or 1000×1024, so the value is a single
 * named constant that a homologation run can correct, and it is enforced against
 * the `xDE` payload this module produces rather than against the whole HTTP body.
 * A batch that exceeds it must be **split by the caller**, not silently sent.
 */
export const SIFEN_MAX_REQUEST_BYTES = 1000 * 1024;

/** What a serializer refused to build, so a caller can branch on the reason. */
export type SifenSerializationFailure =
  | "INVALID_ID"
  | "INVALID_CDC"
  | "INVALID_RUC"
  | "INVALID_BATCH_NUMBER"
  | "INVALID_BATCH_SIZE"
  | "MISSING_BATCH_REFERENCE"
  | "REQUEST_TOO_LARGE"
  | "UNEXPECTED_DOCUMENT_ROOT";

export class SifenSerializationError extends Error {
  readonly failure: SifenSerializationFailure;

  constructor(failure: SifenSerializationFailure, message: string) {
    super(message);
    this.name = "SifenSerializationError";
    this.failure = failure;
  }
}

/**
 * The synchronous reception — §23.3, `WS_SiRecepDE_v150.xsd`.
 *
 * `xDE`'s content model is
 * `xs:any namespace="http://ekuatia.set.gov.py/sifen/xsd" processContents="skip"`,
 * so the DE is a child element. §23.3 calls this "the single most likely place to
 * implement from memory and be wrong", because §23.4's batch service reuses the
 * same element name for a base64 ZIP.
 */
export function serializeReception(request: SifenReceptionRequest): string {
  const dId = assertDocumentId(request.dId);
  assertDocumentRoot(request.deXml, "rDE", "the signed DE");

  return envelope([
    `    <rEnviDe xmlns="${SIFEN_NAMESPACE}">`,
    `      <dId>${escapeXmlText(dId)}</dId>`,
    `      <xDE>${request.deXml}</xDE>`,
    `    </rEnviDe>`,
  ]);
}

/**
 * The asynchronous batch reception — §23.4, `WS_SiRecepLoteDE_v141.xsd`.
 *
 * The container {@link buildBatchContainer} produces is compressed and
 * base64-encoded into `xDE`, which is the Guide's steps 1–4 (§23.4) and the only
 * shape in this module that is not plain markup.
 */
export function serializeBatchReception(request: SifenBatchReceptionRequest): string {
  const dId = assertDocumentId(request.dId);

  const container = buildBatchContainer(request.deXmls);
  const zipped = zipSync({ [SIFEN_ZIP_ENTRY_NAME]: strToU8(container) });
  const xDE = Buffer.from(zipped).toString("base64");

  if (Buffer.byteLength(xDE, "utf8") > SIFEN_MAX_REQUEST_BYTES) {
    throw new SifenSerializationError(
      "REQUEST_TOO_LARGE",
      `The base64 batch payload is ${String(Buffer.byteLength(xDE, "utf8"))} bytes; §23.7 ` +
        `bounds the service's input message at ${String(SIFEN_MAX_REQUEST_BYTES)}. Split the batch.`
    );
  }

  return envelope([
    `    <rEnvioLote xmlns="${SIFEN_NAMESPACE}">`,
    `      <dId>${escapeXmlText(dId)}</dId>`,
    `      <xDE>${xDE}</xDE>`,
    `    </rEnvioLote>`,
  ]);
}

/**
 * The batch-result query — §23.4, `WS_SiConsLote_v141.xsd`:
 * `rEnviConsLoteDe { dId, dProtConsLote?, dCDC? }`.
 *
 * At least one of the two references is required. §23.7's recovery rule is what
 * makes the CDC form legitimate ("se puede consultar el lote con un CDC que fue
 * enviado en el lote respectivo … Utilizar esta opción solo en caso de no recibir
 * el Número de Lote"), so this serializer accepts either and refuses neither.
 */
export function serializeBatchQuery(request: SifenBatchQueryRequest): string {
  const dId = assertDocumentId(request.dId);
  const dProtConsLote =
    request.dProtConsLote === undefined ? undefined : assertBatchNumber(request.dProtConsLote);
  const dCDC = request.dCDC === undefined ? undefined : assertCdc(request.dCDC);

  const references: string[] = [];
  if (dProtConsLote !== undefined) {
    references.push(`      <dProtConsLote>${escapeXmlText(dProtConsLote)}</dProtConsLote>`);
  }
  if (dCDC !== undefined) {
    references.push(`      <dCDC>${escapeXmlText(dCDC)}</dCDC>`);
  }
  if (references.length === 0) {
    throw new SifenSerializationError(
      "MISSING_BATCH_REFERENCE",
      "A batch query carries a dProtConsLote or a dCDC; §23.4's rEnviConsLoteDe " +
        "leaves both optional and a request with neither cannot be answered (§23.7)."
    );
  }

  return envelope([
    `    <rEnviConsLoteDe xmlns="${SIFEN_NAMESPACE}">`,
    `      <dId>${escapeXmlText(dId)}</dId>`,
    ...references,
    `    </rEnviConsLoteDe>`,
  ]);
}

/**
 * The CDC query — §23.6, `WS_SiConsDE_v141.xsd`.
 *
 * **`rEnviConsDeRequest`, not the Manual's `rEnviConsDe`.** §23.6 records the
 * name difference between the Manual's §9.4 table and the only published schema
 * (§23.2) and decides it: the artifact wins, and the Guide's example agrees with
 * the artifact. The request carries **no signature** — §23.6 is explicit that
 * these two consultation services authenticate by mutual TLS alone.
 */
export function serializeCdcQuery(request: SifenCdcQueryRequest): string {
  const dId = assertDocumentId(request.dId);
  const dCDC = assertCdc(request.dCDC);

  return envelope([
    `    <rEnviConsDeRequest xmlns="${SIFEN_NAMESPACE}">`,
    `      <dId>${escapeXmlText(dId)}</dId>`,
    `      <dCDC>${escapeXmlText(dCDC)}</dCDC>`,
    `    </rEnviConsDeRequest>`,
  ]);
}

/**
 * The RUC status query — §23.6, `WS_SiConsRUC_v141.xsd`.
 *
 * `dRUCCons` is `tRuc` (5..8, no leading zero); the Manual notes the field is
 * the RUC "sin dígito verificador" while the type's pattern admits a trailing
 * `[0-9A-D]`, so both are accepted.
 */
export function serializeRucQuery(request: SifenRucQueryRequest): string {
  const dId = assertDocumentId(request.dId);
  const dRUCCons = assertRuc(request.dRUCCons);

  return envelope([
    `    <rEnviConsRUC xmlns="${SIFEN_NAMESPACE}">`,
    `      <dId>${escapeXmlText(dId)}</dId>`,
    `      <dRUCCons>${escapeXmlText(dRUCCons)}</dRUCCons>`,
    `    </rEnviConsRUC>`,
  ]);
}

/**
 * The event reception — §23.3, `WS_SiRecepEvento_v150.xsd`:
 * `rEnviEventoDe { dId, dEvReg { gGroupGesEve } }`.
 *
 * The event document is embedded verbatim, exactly as the DE is: this module
 * wraps what it is given and asserts its root is `rGesEve` (§23.3), and profiles
 * nothing inside it — `Evento_v150.xsd` is retrieved but not profiled (§23.8
 * item 6), and building an event's payload is the caller's.
 */
export function serializeEventReception(request: SifenEventReceptionRequest): string {
  const dId = assertDocumentId(request.dId);
  assertDocumentRoot(request.eventXml, "rGesEve", "the event document");

  return envelope([
    `    <rEnviEventoDe xmlns="${SIFEN_NAMESPACE}">`,
    `      <dId>${escapeXmlText(dId)}</dId>`,
    `      <dEvReg>${request.eventXml}</dEvReg>`,
    `    </rEnviEventoDe>`,
  ]);
}

/**
 * The batch container — the Guide's steps 1 and 2 (§23.4), which no published
 * schema defines:
 *
 * ```text
 * 1. Crear la estructura del lote   <rLoteDE> … </rLoteDE>
 * 2. Insertar los DE firmados       <rLoteDE><rDE>…</rDE><rDE>…</rDE></rLoteDE>
 * ```
 *
 * The DEs are concatenated **exactly as supplied**: the container adds its own
 * open and close tags and nothing else, so no byte inside a signed document
 * moves. An empty batch and a batch above §23.7's 50 are refused rather than
 * compressed — §23.7 records an empty or invalid lot as one of the things that
 * blocks reception for the emitter's RUC ("de 10 a 60 minutos, según la cantidad
 * de reincidencia").
 */
export function buildBatchContainer(deXmls: readonly string[]): string {
  if (deXmls.length < 1 || deXmls.length > SIFEN_BATCH_MAX_DOCUMENTS) {
    throw new SifenSerializationError(
      "INVALID_BATCH_SIZE",
      `A batch carries 1 to ${String(SIFEN_BATCH_MAX_DOCUMENTS)} documents (§23.7); received ` +
        `${String(deXmls.length)}.`
    );
  }

  const documents = deXmls.map((deXml, index) => {
    assertDocumentRoot(deXml, "rDE", `the document at position ${String(index)}`);
    return deXml;
  });

  return `<rLoteDE xmlns="${SIFEN_BATCH_CONTAINER_NAMESPACE}">\n${documents.join("")}</rLoteDE>\n`;
}

/**
 * The `soap:Envelope` around a body, with the empty `soap:Header` §23.4's example
 * carries. Body lines arrive already indented, because an embedded document's
 * lines must not be touched.
 */
function envelope(bodyLines: readonly string[]): string {
  const prefix = SOAP_ENVELOPE_PREFIX;
  return [
    `<${prefix}:${SIFEN_SOAP_ENVELOPE} xmlns:${prefix}="${SOAP_ENVELOPE_NAMESPACE}">`,
    `  <${prefix}:${SIFEN_SOAP_HEADER}/>`,
    `  <${prefix}:${SIFEN_SOAP_BODY}>`,
    ...bodyLines,
    `  </${prefix}:${SIFEN_SOAP_BODY}>`,
    `</${prefix}:${SIFEN_SOAP_ENVELOPE}>`,
    "",
  ].join("\n");
}

/**
 * `dId`: §23.3's `xs:integer` with `totalDigits 15`, §23.4's
 * `xs:long` over `1..999999999999999`, §9.2.1's "Número secuencial
 * autoincremental … responsabilidad del contribuyente".
 */
function assertDocumentId(dId: string): string {
  if (!SIFEN_ID_PATTERN.test(dId)) {
    throw new SifenSerializationError(
      "INVALID_ID",
      `A dId is 1 to ${String(SIFEN_MAX_ID_DIGITS)} digits and not all zero (§23.3, §23.4); ` +
        `received ${describe(dId)}.`
    );
  }
  return dId;
}

/** `dCDC`: §23.6's `tCDC`, 44 characters matching `[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}`. */
function assertCdc(dCDC: string): string {
  if (!SIFEN_CDC_PATTERN.test(dCDC)) {
    throw new SifenSerializationError(
      "INVALID_CDC",
      "A dCDC is 44 characters matching tCDC's pattern (§23.6); received a value that does not."
    );
  }
  return dCDC;
}

/** `dRUCCons`: §23.6's `tRuc`, 5..8 characters and never a leading zero. */
function assertRuc(dRUCCons: string): string {
  if (
    dRUCCons.length < SIFEN_RUC_MIN_LENGTH ||
    dRUCCons.length > SIFEN_RUC_MAX_LENGTH ||
    !SIFEN_RUC_PATTERN.test(dRUCCons)
  ) {
    throw new SifenSerializationError(
      "INVALID_RUC",
      `A dRUCCons is ${String(SIFEN_RUC_MIN_LENGTH)} to ${String(SIFEN_RUC_MAX_LENGTH)} ` +
        `characters matching tRuc's pattern (§23.6); received ${describe(dRUCCons)}.`
    );
  }
  return dRUCCons;
}

/** `dProtConsLote`: §23.4's 28-digit decimal, which never becomes a number. */
function assertBatchNumber(dProtConsLote: string): string {
  if (!SIFEN_BATCH_NUMBER_PATTERN.test(dProtConsLote)) {
    throw new SifenSerializationError(
      "INVALID_BATCH_NUMBER",
      "A dProtConsLote is up to 28 digits (§23.4); received a value that is not a " +
        "digits-only decimal."
    );
  }
  return dProtConsLote;
}

/**
 * The embedded document's root, asserted before it is embedded.
 *
 * `<rDE` and `<rGesEve` are this package's own bytes (ADR-008: "asserted to be
 * the DE our own builder produced"), so a leading namespace prefix is **not**
 * accepted: the builder emits `<rDE xmlns="…">` from column zero, and a document
 * that does not is not the one whose signature this envelope is meant to carry.
 */
function assertDocumentRoot(xml: string, root: string, what: string): void {
  const expected = `<${root}`;
  const following = xml.charAt(expected.length);
  const terminated = following === ">" || following === " " || following === "/";
  if (!xml.startsWith(expected) || !terminated) {
    throw new SifenSerializationError(
      "UNEXPECTED_DOCUMENT_ROOT",
      `${what} must start with ${expected}> and is embedded verbatim (§23.3); it starts ` +
        `with ${describe(xml.slice(0, 48))} instead.`
    );
  }
}

/**
 * A value in a failure message: the first characters, and never more than enough
 * to identify it. ADR-008 §5's guardrail 8 forbids carrying a body or a secret in
 * an error, and a bounded echo is what keeps a refusal diagnosable without one.
 */
function describe(value: string): string {
  const bounded = value.slice(0, 32);
  return `"${bounded}${value.length > bounded.length ? "…" : ""}"`;
}

/** Text escaping, mirroring `dte.builder.ts`: `&`, `<`, `>` and nothing else. */
function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
