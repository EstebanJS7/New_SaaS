/**
 * FISC-016 WU-B — the event request's validators.
 *
 * Every rule here traces to `docs/06-fiscal/SIFEN-BASELINE.md` §25: §25.1 (the
 * envelope and the lot's cardinality), §25.3 (the two payloads, field by field),
 * §25.6 (the clock) and §25.7 (what the schema leaves to us).
 *
 * **The schema's facets are re-stated, not inferred.** `tdIdEve`'s range,
 * `tmotEve`'s 5..500, `tdNumTim`'s eight digits, `tdEst`/`tdPunExp`'s three,
 * `tdNumDE`'s seven, `tiTiDEEv`'s 1..9, `tserieNum`'s `[A-Z]{2}` and the
 * 44-character `tId` are all read from the artifacts; the only rules that are
 * *ours* are `dNumIn <= dNumFin`, the lot's 1..15 and the two identifiers'
 * ranges — none of which the schemas assert (§25.7).
 *
 * Deliberate non-rules, recorded rather than worked around:
 *
 * - **The range's place inside the timbrado's grant is not checked here.**
 *   Nothing asserts that a range lies inside a timbrado or that `iTiDE` matches
 *   it (§25.7), and this builder has no timbrado to compare against — it is
 *   pure and receives only what the document carries. Comparing a range against
 *   the tenant's timbrado is the business operation's, not the document's.
 * - **Neither identifier is generated** (§25.7 states no uniqueness, no
 *   monotonicity and no relation between them), so a pure builder cannot invent
 *   one and must not.
 */

import { SERIES_PATTERN } from "./dte.rules.js";
import {
  EVENT_ID_MAX,
  EVENT_MAX_EVENTS_PER_LOT,
  EVENT_REASON_MAX_LENGTH,
  EVENT_REASON_MIN_LENGTH,
  EVENT_REQUEST_ID_MAX,
  INUTILIZACION_DOCUMENT_TYPE_VALUES,
  type DteEventPayload,
  type DteEventRequest,
} from "./dte.event.types.js";

export type DteEventValidationFailure =
  | "INVALID_CANCELLATION_CDC"
  | "INVALID_DOCUMENT_TYPE"
  | "INVALID_ESTABLISHMENT"
  | "INVALID_EVENT_COUNT"
  | "INVALID_EVENT_ID"
  | "INVALID_EVENT_KIND"
  | "INVALID_POINT_OF_EXPEDITION"
  | "INVALID_RANGE_END"
  | "INVALID_RANGE_ORDER"
  | "INVALID_RANGE_START"
  | "INVALID_REASON"
  | "INVALID_REQUEST_ID"
  | "INVALID_SERIES"
  | "INVALID_TIMBRADO_NUMBER"
  | "INVALID_TIMESTAMP";

export class DteEventValidationError extends Error {
  readonly failure: DteEventValidationFailure;

  constructor(failure: DteEventValidationFailure, message: string) {
    super(message);
    this.name = "DteEventValidationError";
    this.failure = failure;
  }
}

/**
 * `tId` (Evento_Types_v150.xsd:71): `[0-9]{2}([0-9]{7}[0-9A-D]?)[0-9]{34}` with
 * `length=44`. The schema's `?` is dead — a 43-character value cannot have
 * length 44 — so the check digit position is required, exactly as the DE's
 * `tCDC` requires it.
 */
const CDC_PATTERN = /^[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}$/;
/** `fecHhmmss` (DE_Types_v150.xsd:345): no timezone suffix, no fractional seconds. */
const FEC_HHMMSS_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/;
/** `tdNumTim` (DE_Types_v150.xsd:224): exactly eight digits, not zero. */
const TIMBRADO_NUMBER_PATTERN = /^(?:0+[1-9][0-9]*|[1-9]+[0-9]+)$/;
/** `tdEst` / `tdPunExp` (DE_Types_v150.xsd:242, :255). */
const THREE_DIGIT_PATTERN = /^[0-9]{3}$/;
/** `tdNumDE` (Evento_Types_v150.xsd:155): seven or more digits, not zero. */
const DOCUMENT_NUMBER_PATTERN = /^(?:0+[1-9][0-9]*|[1-9]+[0-9]+)$/;
/** `tdNumDE`'s `minLength=7`, which its pattern does not express. */
const RANGE_NUMBER_MIN_LENGTH = 7;
/** `dId`: an `xs:integer` of at most fifteen digits, so at least one. */
const REQUEST_ID_PATTERN = /^[0-9]{1,15}$/;
/** `tdIdEve`: `xs:integer` with pattern `[0-9]+`; its range is checked below. */
const EVENT_ID_PATTERN = /^[0-9]+$/;

export function assertValidEventRequest(request: DteEventRequest): void {
  assertRequestId(request.dId);
  assertEventCount(request.events.length);
  for (const event of request.events) {
    assertEventId(event.id);
    assertTimestamp(event.dFecFirma);
    assertValidPayload(event.payload);
  }
}

/** `dId`: 1..999999999999999 (`totalDigits=15`). The range is ours, the width is the schema's. */
function assertRequestId(dId: string): void {
  if (!REQUEST_ID_PATTERN.test(dId) || Number(dId) < 1 || Number(dId) > EVENT_REQUEST_ID_MAX) {
    throw new DteEventValidationError(
      "INVALID_REQUEST_ID",
      `dId must be an integer within 1..${String(EVENT_REQUEST_ID_MAX)}; received ${JSON.stringify(dId)}.`
    );
  }
}

/** `tgGroupGesEve` holds 1..15 events: `rGesEve`'s `maxOccurs` with the default `minOccurs`. */
function assertEventCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > EVENT_MAX_EVENTS_PER_LOT) {
    throw new DteEventValidationError(
      "INVALID_EVENT_COUNT",
      `A lot carries 1..${String(EVENT_MAX_EVENTS_PER_LOT)} events; received ${String(count)}.`
    );
  }
}

/** `tdIdEve`: an integer within 1..9999999999. */
function assertEventId(id: string): void {
  if (!EVENT_ID_PATTERN.test(id) || Number(id) < 1 || Number(id) > EVENT_ID_MAX) {
    throw new DteEventValidationError(
      "INVALID_EVENT_ID",
      `rEve/@Id must be an integer within 1..${String(EVENT_ID_MAX)}; received ${JSON.stringify(id)}.`
    );
  }
}

/** `fecHhmmss`, the same local type `dFeEmiDE` uses (§25.6). */
function assertTimestamp(dFecFirma: string): void {
  if (!FEC_HHMMSS_PATTERN.test(dFecFirma)) {
    throw new DteEventValidationError(
      "INVALID_TIMESTAMP",
      `dFecFirma must be AAAA-MM-DDThh:mm:ss with no timezone suffix and no fractional seconds; ` +
        `received ${JSON.stringify(dFecFirma)}.`
    );
  }
}

/**
 * `gGroupTiEvt`'s `xs:choice`: exactly one payload element, and the element name
 * **is** the event's type (§25.2). The `default` is unreachable from typed
 * TypeScript and reachable from JavaScript, where a wrong `kind` would otherwise
 * be rendered as a payload the schema does not declare.
 */
function assertValidPayload(payload: DteEventPayload): void {
  switch (payload.kind) {
    case "cancellation":
      assertCancellation(payload.cdc);
      assertReason(payload.reason);
      return;
    case "inutilizacion":
      assertTimbradoNumber(payload.dNumTim);
      assertThreeDigits(payload.dEst, "INVALID_ESTABLISHMENT", "dEst");
      assertThreeDigits(payload.dPunExp, "INVALID_POINT_OF_EXPEDITION", "dPunExp");
      assertRangeNumber(payload.dNumIn, "INVALID_RANGE_START", "dNumIn");
      assertRangeNumber(payload.dNumFin, "INVALID_RANGE_END", "dNumFin");
      assertRangeOrder(payload.dNumIn, payload.dNumFin);
      assertDocumentType(payload.iTiDE);
      assertReason(payload.reason);
      if (payload.dSerieNum !== undefined) {
        assertSeries(payload.dSerieNum);
      }
      return;
    default:
      throw new DteEventValidationError(
        "INVALID_EVENT_KIND",
        `The payload's kind must be "cancellation" or "inutilizacion"; the event's type is the element ` +
          `the schema receives and there are two of them.`
      );
  }
}

/** `tId`: the CDC of the DTE being cancelled. */
function assertCancellation(cdc: string): void {
  if (!CDC_PATTERN.test(cdc)) {
    throw new DteEventValidationError(
      "INVALID_CANCELLATION_CDC",
      `The cancellation's Id is the CDC of the DTE being cancelled: 44 characters matching ` +
        `[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}; received ${JSON.stringify(cdc)}.`
    );
  }
}

/** `tmotEve`: 5..500 characters. Counted in code points, which is what the facet counts. */
function assertReason(reason: string): void {
  const length = [...reason].length;
  if (length < EVENT_REASON_MIN_LENGTH || length > EVENT_REASON_MAX_LENGTH) {
    throw new DteEventValidationError(
      "INVALID_REASON",
      `mOtEve must carry ${String(EVENT_REASON_MIN_LENGTH)}..${String(EVENT_REASON_MAX_LENGTH)} ` +
        `characters; received ${String(length)}.`
    );
  }
}

/** `tdNumTim`: exactly eight digits, and not a timbrado number of zero. */
function assertTimbradoNumber(dNumTim: string): void {
  if (dNumTim.length !== 8 || !TIMBRADO_NUMBER_PATTERN.test(dNumTim)) {
    throw new DteEventValidationError(
      "INVALID_TIMBRADO_NUMBER",
      `dNumTim must be a timbrado number of exactly eight digits; received ${JSON.stringify(dNumTim)}.`
    );
  }
}

/** `tdEst` / `tdPunExp`: three digits, zero-padded. */
function assertThreeDigits(
  value: string,
  failure: "INVALID_ESTABLISHMENT" | "INVALID_POINT_OF_EXPEDITION",
  field: string
): void {
  if (!THREE_DIGIT_PATTERN.test(value)) {
    throw new DteEventValidationError(
      failure,
      `${field} must be three digits; received ${JSON.stringify(value)}.`
    );
  }
}

/** `tdNumDE`: seven or more digits, not a number of zero, without a maximum. */
function assertRangeNumber(
  value: string,
  failure: "INVALID_RANGE_START" | "INVALID_RANGE_END",
  field: string
): void {
  if (value.length < RANGE_NUMBER_MIN_LENGTH || !DOCUMENT_NUMBER_PATTERN.test(value)) {
    throw new DteEventValidationError(
      failure,
      `${field} must be a document number of at least ${String(RANGE_NUMBER_MIN_LENGTH)} digits; ` +
        `received ${JSON.stringify(value)}.`
    );
  }
}

/**
 * `dNumIn <= dNumFin`. **No schema facet asserts it** (§25.7), and a range sent
 * backwards would void nothing while SIFEN accepts the lot: this rule exists
 * because the document would be a lie, not because it would be rejected.
 *
 * The comparison is numeric and exact. Both operands are digit strings of any
 * length, so neither `Number` nor lexicographic order is usable: the first
 * overflows and the second makes `0000010` "before" `0000009`.
 */
function assertRangeOrder(dNumIn: string, dNumFin: string): void {
  if (compareDecimal(dNumIn, dNumFin) > 0) {
    throw new DteEventValidationError(
      "INVALID_RANGE_ORDER",
      `The range's first number (${dNumIn}) is after its last (${dNumFin}); the schema admits it and ` +
        `the operation would void nothing.`
    );
  }
}

/** `tiTiDEEv`: 1..9, which is this family's own enumeration. */
function assertDocumentType(iTiDE: number): void {
  if (!(INUTILIZACION_DOCUMENT_TYPE_VALUES as readonly number[]).includes(iTiDE)) {
    throw new DteEventValidationError(
      "INVALID_DOCUMENT_TYPE",
      `iTiDE must be one of ${INUTILIZACION_DOCUMENT_TYPE_VALUES.join(", ")}; received ${String(iTiDE)}.`
    );
  }
}

/** `tserieNum`: `[A-Z]{2}`. The alphabet is `dte.rules.ts`'s, shared, not copied. */
function assertSeries(dSerieNum: string): void {
  if (!SERIES_PATTERN.test(dSerieNum)) {
    throw new DteEventValidationError(
      "INVALID_SERIES",
      `dSerieNum must be two uppercase letters; received ${JSON.stringify(dSerieNum)}.`
    );
  }
}

/** Compares two decimal digit strings exactly: -1, 0 or 1. */
function compareDecimal(left: string, right: string): number {
  const a = left.replace(/^0+/, "");
  const b = right.replace(/^0+/, "");
  if (a.length !== b.length) {
    return a.length < b.length ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
