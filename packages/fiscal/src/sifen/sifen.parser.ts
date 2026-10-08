/**
 * FISC-010 WU-B — the six responses, as typed objects.
 *
 * The input is the **whole** SOAP response as text, and the output is a result
 * built field by field. Six rules come from ADR-008 §5 and one from §23.8 item 3,
 * and every one of them is asserted by this module's suite:
 *
 * 1. **`<!DOCTYPE` is refused before parsing.** No SIFEN response needs a
 *    document type declaration, and refusing the construct removes the entire
 *    entity-expansion class without disabling entity handling — which numeric
 *    character references need, because the Guide's own response example carries
 *    `&#233;` inside `dMsgRes` (§23.8, ADR-008).
 * 2. **The response is bounded before it is parsed**:
 *    {@link SIFEN_MAX_RESPONSE_BYTES}, 8 MiB, so a pathological document is
 *    bounded by bytes rather than by hope.
 * 3. **No value coercion.** `parseTagValue: false` and `parseAttributeValue:
 *    false`: a 15-digit `dId`, a 28-digit `dProtConsLote` and every CDC are
 *    strings here, and a result code keeps its leading zero.
 * 4. **`trimValues: false`.** The provider's bytes are kept as sent; nothing in
 *    this module trims a value, and a validator that has to look past white space
 *    (base64's lexical space) does so on a copy.
 * 5. **Every parsed value is validated against a published domain before it is
 *    used**, and anything outside that domain is a typed failure rather than a
 *    default. The one deliberate asymmetry is the result codes: §23.8 item 7
 *    records that no retrieved source enumerates the `dCodRes` catalogue, so a
 *    four-digit code this module has never seen is **carried, not refused** — and
 *    `sifen.codes.ts` answers `unknown` for it, which is the opposite of coercing
 *    it into an outcome. An unrecognized `dEstRes` is refused outright, because a
 *    status nobody understood leaves a document's fate unknown.
 * 6. **The reader constructs its result field by field**, never by spreading,
 *    merging or `Object.assign`-ing parsed data into a result — and never by
 *    indexing an object with a **parsed** key. Every key in this file is a literal
 *    written here, and the reads go through an own-property helper so a response
 *    cannot answer through a prototype.
 *
 * And the seventh, from §23.8 item 3: **`xContenDE` may arrive bare or wrapped in
 * `rContDe`, and the reader must not assume which** — see {@link readDeContent}.
 *
 * **Prefixes are stripped, not trusted.** `removeNSPrefix: true`, because the
 * response bodies are namespace-prefixed by their producer while the Manual's own
 * envelope example is defective in exactly this dimension (§8 records the
 * lowercase `<soap:body>` and the mismatched `env`/`soap` prefixes), and
 * ADR-008 records the Guide's answers arriving as
 * `<ns2:rResEnviLoteDe xmlns:ns2="…">`. A reader keyed on prefixes would inherit
 * the defect, so element **names** are matched and namespace declarations are not
 * validated. Domain validation is what bounds that choice, exactly as ADR-008 §5
 * rule 5 puts it.
 *
 * **This reader is not a validating parser, and that is worth knowing.** The
 * chosen library is a tree reader: `<a></b>` parses to something rather than
 * throwing, so a malformed document is in practice refused by the first step that
 * cannot find what the protocol requires ({@link bodyRoot}'s `MISSING_ELEMENT`),
 * while `MALFORMED_XML` covers the inputs the library does refuse (an unclosed
 * attribute, or nesting past {@link SIFEN_MAX_NESTED_TAGS}). Both are typed
 * failures; neither is a coerced default.
 */

import { XMLParser, type X2jOptions } from "fast-xml-parser";

import { describeCdcQuery, describeDeStatus, type SifenEstadoResultado } from "./sifen.codes.js";
import {
  SIFEN_BASE64_PATTERN,
  SIFEN_BATCH_NUMBER_PATTERN,
  SIFEN_BATCH_PROTOCOL_NUMBER_PATTERN,
  SIFEN_BATCH_QUERY_MAX_CODES,
  SIFEN_BATCH_QUERY_MAX_RESULTS,
  SIFEN_CDC_PATTERN,
  SIFEN_EVENT_MAX_CODES,
  SIFEN_EVENT_MAX_RESULTS,
  SIFEN_EVENT_MIN_RESULTS,
  SIFEN_PROTOCOL_NUMBER_PATTERN,
  SIFEN_RECEPTION_MAX_CODES,
  SIFEN_RESULT_CODE_PATTERN,
  SIFEN_RESULT_MESSAGE_MAX_LENGTH,
  SIFEN_RUC_ELECTRONIC_VALUES,
  SIFEN_RUC_MAX_LENGTH,
  SIFEN_RUC_MIN_LENGTH,
  SIFEN_RUC_NAME_MAX_LENGTH,
  SIFEN_RUC_PATTERN,
  SIFEN_RUC_STATE_CODE_LENGTH,
  SIFEN_RUC_STATE_DESCRIPTION_MAX_LENGTH,
  SIFEN_SOAP_BODY,
  SIFEN_SOAP_ENVELOPE,
  type SifenBatchQueryDeResult,
  type SifenBatchQueryResponse,
  type SifenBatchQueryResultGroup,
  type SifenBatchReceptionResponse,
  type SifenCdcQueryResponse,
  type SifenDeContent,
  type SifenEventReceptionResponse,
  type SifenEventResult,
  type SifenProcessingResultGroup,
  type SifenReceptionResponse,
  type SifenRucElectronicFlag,
  type SifenRucQueryResponse,
  type SifenRucStatus,
} from "./sifen.messages.js";

/**
 * ADR-008: "response cap 8 MiB, then the call fails rather than buffering
 * unbounded", and rule 2 makes the cap precede the parser.
 */
export const SIFEN_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * How deep a response may nest before the library refuses it.
 *
 * Not a protocol constant: a SIFEN response is four elements deep
 * (`Envelope/Body/<response root>/<group>`), and the DE inside `xContenDE` is a
 * stop node and is not descended into, so 100 is generous by two orders of
 * magnitude. It is set explicitly rather than left to the library's default so
 * the bound is written down where the response is read.
 */
export const SIFEN_MAX_NESTED_TAGS = 100;

/** The attribute prefix the reader's own option selects, used by name here. */
const ATTRIBUTE_PREFIX = "@_" as const;

/**
 * ADR-008's parse options, in one place.
 *
 * `stopNodes: ["..xContenDE"]` keeps the consultation's DE unparsed, which is what
 * makes {@link readDeContent} possible; the leading `..` is the library's
 * deep-wildcard form — an unprefixed name is a full-path pattern and would never
 * match (verified against 5.11.2, not assumed).
 *
 * `htmlEntities: true` is the flag that looks wrong and is not. `processEntities`
 * decodes the five predefined entities but **not** numeric character references,
 * and the Guide's own response example carries `&#233;` inside `dMsgRes` (§23.8):
 * without this flag `dEstRes` arrives as `Aprobado con observaci&#243;n` and fails
 * its own three-value domain. The cost is the HTML named-entity table being
 * accepted too (`&nbsp;` becomes U+00A0), which is harmless here because
 * `<!DOCTYPE` is refused before the parser runs: no entity can be declared, so the
 * only references that exist are the predefined and numeric ones.
 */
const PARSER_OPTIONS: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true,
  maxNestedTags: SIFEN_MAX_NESTED_TAGS,
  stopNodes: ["..xContenDE"],
};

/** What a parser refused, so a caller can branch on the reason. */
export type SifenParseFailure =
  | "RESPONSE_TOO_LARGE"
  | "DOCTYPE_FORBIDDEN"
  | "MALFORMED_XML"
  | "MISSING_ELEMENT"
  | "DUPLICATE_ELEMENT"
  | "UNEXPECTED_SHAPE"
  | "INVALID_VALUE"
  | "INCONSISTENT_CONTENT";

export class SifenParseError extends Error {
  readonly failure: SifenParseFailure;

  constructor(failure: SifenParseFailure, message: string) {
    super(message);
    this.name = "SifenParseError";
    this.failure = failure;
  }
}

/** §23.3 — `rRetEnviDe { rProtDe }`, the synchronous reception's answer. */
export function parseReceptionResponse(xml: string): SifenReceptionResponse {
  const root = bodyRoot(xml, "rRetEnviDe");
  const protocol = mustChild(root, "rProtDe");

  return {
    protocol: {
      cdc: optionalCdcIdentifier(protocol, "Id"),
      dFecProc: mustTimestamp(protocol, "dFecProc"),
      dDigVal: optionalBase64(protocol, "dDigVal"),
      dEstRes: optionalDeStatus(protocol, "dEstRes"),
      dProtAut: optionalDigits(protocol, "dProtAut", SIFEN_PROTOCOL_NUMBER_PATTERN),
      gResProc: childGroup(protocol, "gResProc", 0, SIFEN_RECEPTION_MAX_CODES).map((entry) =>
        processingResultGroup(entry)
      ),
    },
  };
}

/** §23.4 — `rResEnviLoteDe`, the asynchronous batch reception's answer. */
export function parseBatchReceptionResponse(xml: string): SifenBatchReceptionResponse {
  const root = bodyRoot(xml, "rResEnviLoteDe");

  return {
    dFecProc: optionalTimestamp(root, "dFecProc"),
    // Optional in the schema, required by this reader: without it the answer is
    // not an answer (§23.7's 0300/0301), and `unknown` is reserved for a code the
    // service sent that this client has never seen.
    dCodRes: mustResultCode(root, "dCodRes"),
    dMsgRes: optionalText(root, "dMsgRes"),
    dProtConsLote: optionalDigits(root, "dProtConsLote", SIFEN_BATCH_NUMBER_PATTERN),
    dTpoProces: optionalInteger(root, "dTpoProces"),
  };
}

/** §23.4 — `rResEnviConsLoteDe`, the batch-result query's answer. */
export function parseBatchQueryResponse(xml: string): SifenBatchQueryResponse {
  const root = bodyRoot(xml, "rResEnviConsLoteDe");

  return {
    dFecProc: mustTimestamp(root, "dFecProc"),
    dCodResLot: mustResultCode(root, "dCodResLot"),
    dMsgResLot: mustTextWithin(root, "dMsgResLot", SIFEN_RESULT_MESSAGE_MAX_LENGTH),
    gResProcLote: childGroup(root, "gResProcLote", 0, SIFEN_BATCH_QUERY_MAX_RESULTS).map((group) =>
      batchQueryDeResult(group)
    ),
  };
}

/** §23.6 — `rEnviConsDeResponse`, the CDC query's answer. */
export function parseCdcQueryResponse(xml: string): SifenCdcQueryResponse {
  const root = bodyRoot(xml, "rEnviConsDeResponse");
  const dCodRes = mustResultCode(root, "dCodRes");
  const content = optionalRawText(root, "xContenDE");

  return {
    dFecProc: mustTimestamp(root, "dFecProc"),
    dCodRes,
    dMsgRes: mustText(root, "dMsgRes"),
    xContenDE: content === undefined ? undefined : readDeContent(content, dCodRes),
  };
}

/** §23.6 — `rResEnviConsRUC`, the RUC status query's answer. */
export function parseRucQueryResponse(xml: string): SifenRucQueryResponse {
  const root = bodyRoot(xml, "rResEnviConsRUC");
  const container = optionalChild(root, "xContRUC");

  return {
    dCodRes: mustResultCode(root, "dCodRes"),
    dMsgRes: mustText(root, "dMsgRes"),
    xContRUC: container === undefined ? undefined : rucStatus(container),
  };
}

/** §23.3 — `rRetEnviEventoDe { dFecProc, gResProcEVe }`. */
export function parseEventReceptionResponse(xml: string): SifenEventReceptionResponse {
  const root = bodyRoot(xml, "rRetEnviEventoDe");

  return {
    dFecProc: mustTimestamp(root, "dFecProc"),
    gResProcEVe: childGroup(
      root,
      "gResProcEVe",
      SIFEN_EVENT_MIN_RESULTS,
      SIFEN_EVENT_MAX_RESULTS
    ).map((group) => eventResult(group)),
  };
}

/** §23.4 / `tgResProcLote` — one DE's result inside the batch. */
function batchQueryDeResult(group: Element): SifenBatchQueryDeResult {
  return {
    cdc: mustCdcIdentifier(group, "id"),
    dEstRes: mustDeStatus(group, "dEstRes"),
    dProtAut: optionalDigits(group, "dProtAut", SIFEN_BATCH_PROTOCOL_NUMBER_PATTERN),
    gResProc: childGroup(group, "gResProc", 0, SIFEN_BATCH_QUERY_MAX_CODES).map((entry) =>
      batchQueryResultGroup(entry)
    ),
  };
}

/** §23.4 / `tgResProc` — a batch-query result code and its message. */
function batchQueryResultGroup(entry: Element): SifenBatchQueryResultGroup {
  return {
    dCodRes: mustResultCode(entry, "dCodRes"),
    dMsgRes: mustTextWithin(entry, "dMsgRes", SIFEN_RESULT_MESSAGE_MAX_LENGTH),
  };
}

/** §23.3 / `gResProcEVe` — one event's result. */
function eventResult(group: Element): SifenEventResult {
  return {
    id: mustText(group, "id"),
    dEstRes: mustDeStatus(group, "dEstRes"),
    dProtAut: optionalDigits(group, "dProtAut", SIFEN_PROTOCOL_NUMBER_PATTERN),
    gResProc: childGroup(group, "gResProc", 0, SIFEN_EVENT_MAX_CODES).map((entry) =>
      processingResultGroup(entry)
    ),
  };
}

/**
 * §23.3 / `tgResProc` — a processing-protocol result code and its message.
 *
 * The schema marks both members optional (§23.3 spells them `dCodRes?` and
 * `dMsgRes?`), so either alone is accepted; an entry carrying neither reports
 * nothing and is refused rather than kept.
 */
function processingResultGroup(entry: Element): SifenProcessingResultGroup {
  const dCodRes = optionalResultCode(entry, "dCodRes");
  const dMsgRes = optionalText(entry, "dMsgRes");
  if (dCodRes === undefined && dMsgRes === undefined) {
    throw invalid(entry.name, "carries neither a dCodRes nor a dMsgRes, so it reports nothing");
  }
  return { dCodRes, dMsgRes };
}

/** §23.6 / `tContenedorRuc` — the RUC's five fields, each one validated. */
function rucStatus(container: Element): SifenRucStatus {
  return {
    dRUCCons: mustRuc(container, "dRUCCons"),
    dRazCons: mustTextWithin(container, "dRazCons", SIFEN_RUC_NAME_MAX_LENGTH),
    dCodEstCons: mustTextOfLength(container, "dCodEstCons", SIFEN_RUC_STATE_CODE_LENGTH),
    dDesEstCons: mustTextWithin(container, "dDesEstCons", SIFEN_RUC_STATE_DESCRIPTION_MAX_LENGTH),
    dRUCFactElec: mustElectronicFlag(container, "dRUCFactElec"),
  };
}

/**
 * §23.8 item 3 — the DE inside `xContenDE`, bare or wrapped in `rContDe`.
 *
 * `WS_SiConsDE_v141.xsd` types the field `xs:string` and the Manual describes a
 * container `rContDe { rDE, dProtAut }`, so there are four shapes to accept: the
 * DE as markup or as escaped text, each with or without the container. The
 * element is a **stop node**, so what arrives here is the raw content between its
 * tags — undecoded, which is what lets the two encodings be told apart and lets
 * the markup case keep the service's exact bytes. Escaped content is decoded by
 * the same parser every other field goes through (inside a one-element wrapper
 * document this module builds itself), so there is exactly one entity decoder in
 * this file.
 *
 * The DE's own root is `rDE`, and a DE cannot nest another `rDE` (`DE_v150.xsd`'s
 * structure), so the first matching close is the DE's. `dProtAut` is read from the
 * container's text **outside** the DE: inside it, a protocol number would belong
 * to the document rather than to the exchange.
 */
function readDeContent(content: string, dCodRes: string): SifenDeContent {
  const markup = content.trimStart().startsWith("<") ? content : decodeEscapedText(content);

  const open = /<(?:[A-Za-z_][\w.-]*:)?rDE(?=[\s/>])/.exec(markup);
  if (open === null) {
    throw invalid(
      "xContenDE",
      "does not carry an rDE element; §23.3's wildcards carry the DE's own XML"
    );
  }
  const tail = markup.slice(open.index);
  const close = /<\/(?:[A-Za-z_][\w.-]*:)?rDE\s*>/.exec(tail);
  if (close === null) {
    throw invalid("xContenDE", "carries an rDE element that is never closed");
  }

  const deXml = tail.slice(0, close.index + close[0].length);
  const surrounding = `${markup.slice(0, open.index)}${tail.slice(close.index + close[0].length)}`;
  const wrappedInContainer = /<\s*(?:[A-Za-z_][\w.-]*:)?rContDe[\s/>]/.test(surrounding);
  const dProtAut = wrappedInContainer ? textOfElement(surrounding, "dProtAut") : undefined;

  // §23.6's Tabla G: "xContenDE? (present only if dCodRes = 0422)". Content under
  // any other code contradicts the source it arrived from, so it is refused
  // rather than half-read. An **empty** element is not content and was treated as
  // absent before this function was called, which is why the check lives here.
  if (describeCdcQuery(dCodRes).outcome !== "found") {
    throw new SifenParseError(
      "INCONSISTENT_CONTENT",
      `<xContenDE> carries the DE while <dCodRes> is ${describe(dCodRes)}; §23.6's Tabla G ` +
        "has the container present only for the code that means the CDC was found."
    );
  }

  return {
    deXml,
    dProtAut:
      dProtAut === undefined
        ? undefined
        : validatedDigits("dProtAut", dProtAut, SIFEN_PROTOCOL_NUMBER_PATTERN),
    wrappedInContainer,
  };
}

/**
 * The text of a simple child element inside a fragment this module has not
 * parsed — used only for `rContDe`'s `dProtAut`, which no published schema types
 * and which §23.3's `tdProtAut = xs:long` makes a digits-only leaf. The element
 * name is a literal from this file, never a parsed value.
 */
function textOfElement(fragment: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([^<]*)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`
  );
  const match = pattern.exec(fragment);
  return match === null ? undefined : match[1];
}

/** Escaped XML text, decoded by the same parser every other field goes through. */
function decodeEscapedText(text: string): string {
  const parsed = new XMLParser({ ...PARSER_OPTIONS, stopNodes: [] }).parse(
    `<t>${text}</t>`
  ) as unknown;
  const fields = asFields(parsed);
  const value = fields === undefined ? undefined : own(fields, "t");
  if (typeof value !== "string") {
    throw invalid("xContenDE", "carries text that is neither XML nor escaped XML");
  }
  return value;
}

/** One parsed element, with the name it had, so a refusal can say where it looked. */
interface Element {
  readonly name: string;
  /** The parser's object form: child elements by name, attributes prefixed. */
  readonly fields: Record<string, unknown>;
}

/**
 * The response root, reached through `Envelope/Body`.
 *
 * The envelope is required: ADR-008 §1 types the body as `application/soap+xml`,
 * so what the transport hands over is the whole message and a bare fragment is a
 * malformed input rather than a tolerated one.
 */
function bodyRoot(xml: string, rootName: string): Element {
  assertWithinSizeCap(xml);
  assertNoDoctype(xml);

  const document = parseDocument(xml);
  const envelope = mustChild({ name: "the SOAP envelope", fields: document }, SIFEN_SOAP_ENVELOPE);
  const body = mustChild(envelope, SIFEN_SOAP_BODY);

  return mustChild(body, rootName);
}

/**
 * One parse, with a fresh parser.
 *
 * A new `XMLParser` per response is deliberate: the instance carries entity and
 * matcher state while it works, and nothing of one response should be able to
 * reach the next.
 */
function parseDocument(xml: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = new XMLParser({ ...PARSER_OPTIONS }).parse(xml) as unknown;
  } catch (error) {
    // The library also refuses a document whose element names are JavaScript's own
    // reserved ones (§5's prototype-pollution guard, `strictReservedNames`), which
    // lands here: this reader's answer is "the parser refused the response", and the
    // library's own reason travels in the message.
    throw new SifenParseError(
      "MALFORMED_XML",
      `The response is not well-formed XML: ${error instanceof Error ? error.message : "the parser refused it"}.`
    );
  }

  const fields = asFields(parsed);
  if (fields === undefined) {
    throw new SifenParseError(
      "MALFORMED_XML",
      "The response parsed to something that is not a document element."
    );
  }
  return fields;
}

/** Rule 2: the cap runs on bytes, and it runs before anything else touches the text. */
function assertWithinSizeCap(xml: string): void {
  const bytes = Buffer.byteLength(xml, "utf8");
  if (bytes > SIFEN_MAX_RESPONSE_BYTES) {
    throw new SifenParseError(
      "RESPONSE_TOO_LARGE",
      `The response is ${String(bytes)} bytes; this reader is capped at ` +
        `${String(SIFEN_MAX_RESPONSE_BYTES)} (ADR-008).`
    );
  }
}

/**
 * Rule 1: no document type declaration, case-insensitively, on the raw text.
 *
 * Case-insensitively because this is a refusal and not a parse: a document that
 * spells it `<!doctype` is turned away by the same line rather than handed to a
 * parser whose opinion of the spelling this module would have to know.
 */
function assertNoDoctype(xml: string): void {
  if (/<!\s*doctype/i.test(xml)) {
    throw new SifenParseError(
      "DOCTYPE_FORBIDDEN",
      "The response carries a document type declaration, which no SIFEN response needs " +
        "(ADR-008 rule 1)."
    );
  }
}

/** `dEstRes` where the schema leaves it optional; the domain is still enforced. */
function optionalDeStatus(element: Element, key: string): SifenEstadoResultado | undefined {
  const text = optionalText(element, key);
  return text === undefined ? undefined : validatedDeStatus(text);
}

/**
 * `dEstRes` where the answer depends on it.
 *
 * §23.3 records that the v150 schema declares `dEstRes` a bare `xs:string` while
 * the Manual publishes exactly three values, and concludes that a client must
 * validate the domain itself. This is that validation. A fourth string is a
 * **refusal** and not an `unknown` status, because an unrecognized status leaves
 * a document's fate unknown — which is a different and worse thing than an
 * unrecognized code beside a status that was understood.
 */
function mustDeStatus(element: Element, key: string): SifenEstadoResultado {
  return validatedDeStatus(mustText(element, key));
}

function validatedDeStatus(value: string): SifenEstadoResultado {
  const descriptor = describeDeStatus(value);
  if (descriptor.outcome === "unknown") {
    throw invalid("dEstRes", "is not one of §10's three published values");
  }
  return descriptor.dEstRes;
}

/**
 * The CDC that identifies a protocol or a per-DE result: `Id` on `rProtDe`,
 * `id` on `tgResProcLote`.
 *
 * §23.3 and §23.4 list both as members of their complex type without saying
 * whether the schema declares them as attributes or as child elements, and the
 * published XSDs are not readable from here beyond that listing. So both
 * spellings are accepted, each validated against `tCDC`, and a response carrying
 * both with **different** values is refused rather than guessed at.
 */
function optionalCdcIdentifier(element: Element, key: string): string | undefined {
  const attribute = optionalAttribute(element, key);
  const child = optionalText(element, key);
  if (attribute !== undefined && child !== undefined && attribute !== child) {
    throw new SifenParseError(
      "INCONSISTENT_CONTENT",
      `<${element.name}> carries ${key} twice with different values, as an attribute and ` +
        "as an element."
    );
  }
  const value = attribute ?? child;
  return value === undefined ? undefined : validatedCdc(key, value);
}

function mustCdcIdentifier(element: Element, key: string): string {
  const value = optionalCdcIdentifier(element, key);
  if (value === undefined) {
    throw new SifenParseError(
      "MISSING_ELEMENT",
      `<${key}> is missing from <${element.name}>; §23.4's tgResProcLote carries the DE's ` +
        "CDC there."
    );
  }
  return value;
}

function validatedCdc(key: string, value: string): string {
  if (!SIFEN_CDC_PATTERN.test(value)) {
    throw invalid(key, "does not match §23.6's tCDC (44 characters, [0-9A-D] check digit)");
  }
  return value;
}

/** `dRUCCons` inside the RUC container: §23.6's `tRuc`. */
function mustRuc(element: Element, key: string): string {
  const value = mustText(element, key);
  if (
    value.length < SIFEN_RUC_MIN_LENGTH ||
    value.length > SIFEN_RUC_MAX_LENGTH ||
    !SIFEN_RUC_PATTERN.test(value)
  ) {
    throw invalid(key, "does not match §23.6's tRuc (5 to 8 characters, no leading zero)");
  }
  return value;
}

/** `dRUCFactElec`: §23.6's one-character `S`/`N`, narrowed to the two literals. */
function mustElectronicFlag(element: Element, key: string): SifenRucElectronicFlag {
  const value = mustText(element, key);
  const found = SIFEN_RUC_ELECTRONIC_VALUES.find((candidate) => candidate === value);
  if (found === undefined) {
    throw invalid(key, "is neither S nor N; §23.6 types dRUCFactElec as one character");
  }
  return found;
}

/**
 * A result code, shape-checked but not enumerated.
 *
 * §23.3 records that the schema declares `dCodRes` `xs:string` with `minLength 1`
 * and no pattern while §10 types it `N, 4`, and that a client must therefore
 * validate the domain itself — so the width is enforced here. Which four digits
 * they are is the opposite question: §23.8 item 7 records that no retrieved
 * source enumerates the catalogue, so an unlisted code is **data**, carried as
 * sent, and `sifen.codes.ts` names it `unknown`.
 */
function mustResultCode(element: Element, key: string): string {
  return validatedResultCode(key, mustText(element, key));
}

function optionalResultCode(element: Element, key: string): string | undefined {
  const value = optionalText(element, key);
  return value === undefined ? undefined : validatedResultCode(key, value);
}

function validatedResultCode(key: string, value: string): string {
  if (!SIFEN_RESULT_CODE_PATTERN.test(value)) {
    throw invalid(key, "is not four digits; §10 types a result code N, 4");
  }
  return value;
}

/** `dProtAut` and `dProtConsLote`: digits, with the width the section that types them gives. */
function optionalDigits(element: Element, key: string, pattern: RegExp): string | undefined {
  const value = optionalText(element, key);
  return value === undefined ? undefined : validatedDigits(key, value, pattern);
}

function validatedDigits(key: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw invalid(key, "is not a digits-only value of the length its schema declares");
  }
  return value;
}

/** §23.4 types `dTpoProces` as `xs:integer`; its lexical space is what is checked. */
function optionalInteger(element: Element, key: string): string | undefined {
  const value = optionalText(element, key);
  if (value === undefined) {
    return undefined;
  }
  if (!/^[+-]?[0-9]+$/.test(value)) {
    throw invalid(key, "is not an xs:integer (§23.4)");
  }
  return value;
}

/** `dDigVal`: §23.3's `xs:base64Binary`, whose lexical space admits white space. */
function optionalBase64(element: Element, key: string): string | undefined {
  const value = optionalText(element, key);
  if (value === undefined) {
    return undefined;
  }
  if (!SIFEN_BASE64_PATTERN.test(value.replaceAll(/\s/g, ""))) {
    throw invalid(key, "is not a base64 value; §23.3 types dDigVal as xs:base64Binary");
  }
  return value;
}

/**
 * The shared `fecUTC` shape: a date and a time, in that order.
 *
 * §23.3 marks `dFecProc` REQUIRED and types it `fecUTC`; §23.6 records the other
 * family's `fecUTC` as `xs:dateTime, {AAAA-MM-DDThh:mm:ss-ss:ss}` — an offset the
 * sources spell differently and whose presence nothing pins. So the reader checks
 * the part they agree on and keeps the rest of the value as sent: it is an opaque
 * instant here, and no branch of this package compares it to a clock. Leading
 * white space is tolerated because XSD's `dateTime` has `whiteSpace: collapse`,
 * and it is still kept in the value — the check reads past it, nothing trims it.
 */
const TIMESTAMP_PATTERN = /^\s*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/;

function mustTimestamp(element: Element, key: string): string {
  return validatedTimestamp(key, mustText(element, key));
}

function optionalTimestamp(element: Element, key: string): string | undefined {
  const value = optionalText(element, key);
  return value === undefined ? undefined : validatedTimestamp(key, value);
}

function validatedTimestamp(key: string, value: string): string {
  if (!TIMESTAMP_PATTERN.test(value)) {
    throw invalid(key, "is not a fecUTC date-time (§23.3, §23.6)");
  }
  return value;
}

/** A required text leaf. An element that arrived empty is not an informed value. */
function mustText(element: Element, key: string): string {
  const value = optionalText(element, key);
  if (value === undefined) {
    const present = own(element.fields, key) !== undefined;
    throw new SifenParseError(
      present ? "INVALID_VALUE" : "MISSING_ELEMENT",
      present
        ? `<${key}> is present but empty in <${element.name}>, and every field this reader ` +
            "requires has a minimum length in the schema it comes from."
        : `<${key}> is missing from <${element.name}>.`
    );
  }
  return value;
}

function mustTextWithin(element: Element, key: string, max: number): string {
  const value = mustText(element, key);
  if (value.length > max) {
    throw invalid(key, `is longer than ${String(max)} characters in <${element.name}>`);
  }
  return value;
}

function mustTextOfLength(element: Element, key: string, length: number): string {
  const value = mustText(element, key);
  if (value.length !== length) {
    throw invalid(key, `is not ${String(length)} characters long in <${element.name}>`);
  }
  return value;
}

/** A text leaf, or `undefined` when the element is absent or arrived empty. */
function optionalText(element: Element, key: string): string | undefined {
  const value = own(element.fields, key);
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    throw new SifenParseError(
      "DUPLICATE_ELEMENT",
      `<${key}> appears more than once in <${element.name}>, and the schema it comes ` +
        "from declares it once."
    );
  }
  const fields = asFields(value);
  const text = fields === undefined ? undefined : own(fields, "#text");
  if (typeof text === "string" && text !== "") {
    return text;
  }
  throw new SifenParseError(
    "UNEXPECTED_SHAPE",
    `<${key}> in <${element.name}> is an element rather than a text value.`
  );
}

/**
 * The raw text of a stop node, kept undecoded on purpose.
 *
 * `xContenDE` is the only field read this way, and it is the only field whose
 * content is another document.
 */
function optionalRawText(element: Element, key: string): string | undefined {
  const value = own(element.fields, key);
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new SifenParseError(
      "UNEXPECTED_SHAPE",
      `<${key}> in <${element.name}> was parsed rather than kept whole, which means this ` +
        "reader's stop-node pattern no longer matches this parser version."
    );
  }
  return value;
}

function optionalAttribute(element: Element, key: string): string | undefined {
  const value = own(element.fields, `${ATTRIBUTE_PREFIX}${key}`);
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new SifenParseError(
      "UNEXPECTED_SHAPE",
      `The ${key} attribute of <${element.name}> is not a text value.`
    );
  }
  return value;
}

function mustChild(element: Element, key: string): Element {
  const child = optionalChild(element, key);
  if (child === undefined) {
    throw new SifenParseError("MISSING_ELEMENT", `<${key}> is missing from <${element.name}>.`);
  }
  return child;
}

function optionalChild(element: Element, key: string): Element | undefined {
  const value = own(element.fields, key);
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string") {
    throw new SifenParseError(
      "UNEXPECTED_SHAPE",
      `<${key}> in <${element.name}> is a text value where an element is expected.`
    );
  }
  if (Array.isArray(value)) {
    throw new SifenParseError(
      "DUPLICATE_ELEMENT",
      `<${key}> appears more than once in <${element.name}>, and the schema it comes ` +
        "from declares it once."
    );
  }
  const fields = asFields(value);
  if (fields === undefined) {
    throw new SifenParseError(
      "UNEXPECTED_SHAPE",
      `<${key}> in <${element.name}> is not an element.`
    );
  }
  return { name: key, fields };
}

/**
 * A repeating element, read as `min..max` entries.
 *
 * The parser collects repeated siblings into an array and leaves a single one as
 * an object; this reader normalises both, so nothing here depends on the
 * library's array behaviour. An empty element counts as no entries.
 */
function childGroup(element: Element, key: string, min: number, max: number): readonly Element[] {
  const value = own(element.fields, key);
  if (value === undefined || value === "") {
    if (min > 0) {
      throw new SifenParseError(
        "MISSING_ELEMENT",
        `<${element.name}> carries no <${key}>, and the schema declares between ` +
          `${String(min)} and ${String(max)}.`
      );
    }
    return [];
  }

  const entries = Array.isArray(value) ? value : [value];
  if (entries.length < min || entries.length > max) {
    throw new SifenParseError(
      "INVALID_VALUE",
      `<${element.name}> carries ${String(entries.length)} <${key}> entries; the schema ` +
        `declares between ${String(min)} and ${String(max)}.`
    );
  }

  return entries.map((entry, index) => {
    const fields = asFields(entry);
    if (fields === undefined) {
      throw new SifenParseError(
        "UNEXPECTED_SHAPE",
        `<${key}> entry ${String(index)} of <${element.name}> is not an element.`
      );
    }
    return { name: key, fields };
  });
}

/**
 * A parsed value as a field map, or `undefined` when it is not an object.
 *
 * Deliberately no `Object.keys` or `for…in` anywhere in this module: the readers
 * touch only keys written in this file, so a response cannot introduce one.
 */
function asFields(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** An own-property read, so a response cannot answer through a prototype. */
function own(fields: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(fields, key) ? fields[key] : undefined;
}

function invalid(key: string, reason: string): SifenParseError {
  return new SifenParseError("INVALID_VALUE", `<${key}> ${reason}.`);
}

/**
 * A value in a failure message: at most the first characters of it.
 *
 * ADR-008 §5's guardrail 8 forbids an error carrying the response body, and a
 * bounded echo of one short field is what keeps a refusal diagnosable without one.
 */
function describe(value: string): string {
  const bounded = value.slice(0, 32);
  return `"${bounded}${value.length > bounded.length ? "…" : ""}"`;
}
