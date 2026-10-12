/**
 * FISC-016 WU-B — the typed request for an event lot.
 *
 * Structure, element order and the widths below come from the official event
 * schemas (`WS_SiRecepEvento_v150.xsd`, `Evento_v150.xsd`, `Evento_Types_v150.xsd`,
 * retrieved 2026-10-11, not vendored) and from
 * `docs/06-fiscal/SIFEN-BASELINE.md` §25.
 *
 * **The event's type is the element name, not a code.** `tdTiGDE` — the
 * enumeration documented "Tipo de Evento" — is a **dead catalogue**: the only
 * element that would carry it is commented out
 * (`Evento_Types_v150.xsd:134`) and no payload element references it, so a
 * builder that emitted a `dTiGDE` field would produce a document that validates
 * against nothing. The type is expressed by **which element is present** under
 * `gGroupTiEvt`, which is why this request models it as a discriminated union
 * instead of a code. (`tiTipEve`, despite a stray `<!-- Tipo de Evento -->`
 * comment above it, is the **receptor** type.)
 *
 * **Both identifiers are caller-supplied**, because the builder is pure: no
 * ambient clock, no randomness, no I/O, no tenant context. The profile states no
 * uniqueness or monotonicity for either (§25.7), and this module invents none —
 * the strategy is the caller's: the event's `@Id` is its ordinal within the lot
 * and the request's `dId` is one value per submission.
 */

/** `tVerFor` admits `141` or `150`; an emitted event uses **150** (§25.6). */
export const EVENT_XML_VERSION = "150" as const;

/** `tgGroupGesEve` (Evento_v150.xsd:561): `rGesEve` with `maxOccurs=15`. */
export const EVENT_MAX_EVENTS_PER_LOT = 15;

/** `tdIdEve` (Evento_Types_v150.xsd:167): integer 1..9999999999, pattern `[0-9]+`. */
export const EVENT_ID_MAX = 9_999_999_999;

/** `dId` (WS_SiRecepEvento_v150.xsd:22): `xs:integer` with `totalDigits=15`. */
export const EVENT_REQUEST_ID_MAX = 999_999_999_999_999;

/** `tmotEve` (Evento_Types_v150.xsd:86): 5..500. */
export const EVENT_REASON_MIN_LENGTH = 5;
export const EVENT_REASON_MAX_LENGTH = 500;

/**
 * `tiTiDEEv` (Evento_Types_v150.xsd:112): the document type an inutilización
 * voids, `1`..`9`. **It is its own type, not the DE's `tiTiDE`**: the event
 * enumeration also admits `2`, `3` and `8`, which the DE's `tiTiDE` does not.
 */
export const INUTILIZACION_DOCUMENT_TYPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type DteInutilizacionDocumentType = (typeof INUTILIZACION_DOCUMENT_TYPE_VALUES)[number];

/**
 * `rGeVeCan` / `trGeVeCan` (Evento_v150.xsd:18): exactly two required children.
 *
 * The `kind` is the element name, never a field of the document.
 */
export interface DteCancellationEventPayload {
  readonly kind: "cancellation";
  /** `<Id>`, type `tId`: the 44-character CDC of the DTE being cancelled. */
  readonly cdc: string;
  /** `mOtEve`, `tmotEve`: 5..500. */
  readonly reason: string;
}

/**
 * `rGeVeInu` / `trGeVeInu` (Evento_v150.xsd:30): seven required children and one
 * optional.
 *
 * **It carries no `Id`**: an inutilización voids a *number range*, not a
 * document, so a symmetric implementation that expected a CDC here would be
 * wrong.
 */
export interface DteInutilizacionEventPayload {
  readonly kind: "inutilizacion";
  /** `dNumTim`, `tdNumTim`: exactly eight digits, not zero. */
  readonly dNumTim: string;
  /** `dEst`, `tdEst`: `[0-9]{3}`. */
  readonly dEst: string;
  /** `dPunExp`, `tdPunExp`: `[0-9]{3}`. */
  readonly dPunExp: string;
  /** `dNumIn`, `tdNumDE`: seven or more digits; the range's first number. */
  readonly dNumIn: string;
  /** `dNumFin`, `tdNumDE`: the range's last number. */
  readonly dNumFin: string;
  /** `iTiDE`, `tiTiDEEv`: 1..9. */
  readonly iTiDE: DteInutilizacionDocumentType;
  /** `mOtEve`, `tmotEve`: 5..500. */
  readonly reason: string;
  /** `dSerieNum`, `tserieNum`: `[A-Z]{2}`, optional. */
  readonly dSerieNum?: string;
}

/** `gGroupTiEvt` (Evento_v150.xsd:363): the payload choice, keyed by element name. */
export type DteEventPayload = DteCancellationEventPayload | DteInutilizacionEventPayload;

/** `rEve` / `trEve` (Evento_v150.xsd:480): the body one `rGesEve` carries. */
export interface DteEvent {
  /**
   * `rEve/@Id`, type `tdIdEve`: 1..9999999999. **Caller-supplied**: the schema
   * states no rule beyond that range, so nothing is generated here.
   */
  readonly id: string;
  /**
   * `dFecFirma`, `fecHhmmss`: `AAAA-MM-DDThh:mm:ss` — **local**, with no
   * timezone suffix and no fractional seconds, the same type `dFeEmiDE` uses
   * (§25.6; `tDateTimeUTC` exists in the same file and is referenced nowhere).
   */
  readonly dFecFirma: string;
  readonly payload: DteEventPayload;
}

/**
 * `rEnviEventoDe` (WS_SiRecepEvento_v150.xsd:10): `dId` plus `dEvReg` carrying
 * one `gGroupGesEve` of 1..15 `rGesEve`.
 */
export interface DteEventRequest {
  /**
   * The lot's control identifier, 1..999999999999999. **Caller-supplied**: one
   * value per submission, and the schema relates it to the events' identifiers
   * in no way (§25.7).
   */
  readonly dId: string;
  readonly events: readonly DteEvent[];
}
