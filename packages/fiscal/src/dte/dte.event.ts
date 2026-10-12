/**
 * FISC-016 WU-B — the pure event builder.
 *
 * `buildEventXml` is a total function from a validated request to an XML string:
 * no ambient clock, no randomness, no I/O, no tenant context. Element order is
 * the schema's — `rEnviEventoDe` with its two children, `dEvReg`, `gGroupGesEve`,
 * one `rGesEve` per event, and inside it `rEve` with its three children — so a
 * lot whose groups are reordered is invalid rather than merely unconventional
 * (`docs/06-fiscal/SIFEN-BASELINE.md` §25.1, §25.3).
 *
 * **Two things this module deliberately does not do:**
 *
 * 1. **It never emits `dTiGDE`.** The event's type *is* the element name: the
 *    enumeration documented "Tipo de Evento" is a dead catalogue whose only
 *    carrier element is commented out of `Evento_Types_v150.xsd`, so a document
 *    carrying it validates against nothing (§25.2).
 * 2. **It generates neither identifier.** `rEve/@Id` and the request's `dId`
 *    arrive as arguments, because the schema states no uniqueness, no
 *    monotonicity and no relation between them (§25.7) and a pure builder cannot
 *    invent one.
 *
 * The `<Signature>` element is emitted as a placeholder inside every `rGesEve`,
 * where the schema **requires** it as a sibling of `rEve`; producing its content
 * is `dte.event-signing.ts`'s job, the same split the DE's builder and signer
 * use.
 */

import { SIGNATURE_PLACEHOLDER } from "./dte.builder.js";
import { assertValidEventRequest } from "./dte.event.rules.js";
import {
  EVENT_XML_VERSION,
  type DteEvent,
  type DteEventPayload,
  type DteEventRequest,
} from "./dte.event.types.js";
import { DTE_NAMESPACE } from "./dte.types.js";

/**
 * The signature placeholder, as a complete line — indentation included.
 *
 * It is `dte.builder.ts`'s placeholder literal with **only** its indentation
 * changed, and exported for the reason that one is: the signer removes it by
 * exact match, which is what keeps the digest honest and what proves the
 * document was produced by this builder rather than already signed. A second
 * literal would be a second thing to keep in step.
 *
 * The XSD's `ds:Signature` is `ds:SignatureType`, whose `SignedInfo` is
 * required, so the placeholder makes an *unsigned* event schema-invalid on
 * purpose: it is a marker for "not signed yet", not a valid signature.
 */
const EVENT_SIGNATURE_INDENT = " ".repeat(8);
export const EVENT_SIGNATURE_PLACEHOLDER = `${EVENT_SIGNATURE_INDENT}${SIGNATURE_PLACEHOLDER.trimStart()}`;

/** The renderer's shape: a name, an optional `Id` attribute and its content. */
interface EventXmlElement {
  readonly name: string;
  readonly id?: string;
  readonly value?: string;
  readonly children?: readonly EventXmlElement[];
}

export function buildEventXml(request: DteEventRequest): string {
  assertValidEventRequest(request);

  const lines = [
    `<rEnviEventoDe xmlns="${DTE_NAMESPACE}">`,
    `  <dId>${escapeXmlText(request.dId)}</dId>`,
    `  <dEvReg>`,
    `    <gGroupGesEve>`,
    ...request.events.flatMap((event) => renderEvent(event, 6)),
    `    </gGroupGesEve>`,
    `  </dEvReg>`,
    `</rEnviEventoDe>`,
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * One `rGesEve` / `trGesEve`: the event body, then the signature the schema
 * requires beside it. Every event of a lot is signed separately, so every event
 * gets its own `rGesEve` and its own placeholder (§25.1).
 */
function renderEvent(event: DteEvent, indent: number): string[] {
  const prefix = " ".repeat(indent);
  return [
    `${prefix}<rGesEve>`,
    ...renderElement(eventBody(event), indent + 2),
    // One level below `rGesEve`, which is the indentation the placeholder
    // constant carries: this builder emits `rGesEve` at 6, always.
    EVENT_SIGNATURE_PLACEHOLDER,
    `${prefix}</rGesEve>`,
  ];
}

/** `rEve` / `trEve`: the timestamp, the format version and the payload choice. */
function eventBody(event: DteEvent): EventXmlElement {
  return {
    name: "rEve",
    id: event.id,
    children: [
      { name: "dFecFirma", value: event.dFecFirma },
      { name: "dVerFor", value: EVENT_XML_VERSION },
      { name: "gGroupTiEvt", children: renderPayload(event.payload) },
    ],
  };
}

/** `gGroupTiEvt` / `tgGroupEvt`: an `xs:choice`, so exactly one payload element. */
function renderPayload(payload: DteEventPayload): readonly EventXmlElement[] {
  switch (payload.kind) {
    case "cancellation":
      // `trGeVeCan`: the CDC of the DTE being cancelled, then the reason —
      // exactly two required children and nothing else.
      return [
        {
          name: "rGeVeCan",
          children: [
            { name: "Id", value: payload.cdc },
            { name: "mOtEve", value: payload.reason },
          ],
        },
      ];
    case "inutilizacion":
      // `trGeVeInu`, in schema order: seven required children, then the optional
      // series. There is no `Id`: a range is what this event names.
      return [
        {
          name: "rGeVeInu",
          children: [
            { name: "dNumTim", value: payload.dNumTim },
            { name: "dEst", value: payload.dEst },
            { name: "dPunExp", value: payload.dPunExp },
            { name: "dNumIn", value: payload.dNumIn },
            { name: "dNumFin", value: payload.dNumFin },
            { name: "iTiDE", value: String(payload.iTiDE) },
            { name: "mOtEve", value: payload.reason },
            ...(payload.dSerieNum === undefined
              ? []
              : [{ name: "dSerieNum", value: payload.dSerieNum }]),
          ],
        },
      ];
  }
}

function renderElement(element: EventXmlElement, indent: number): string[] {
  const prefix = " ".repeat(indent);
  const id = element.id === undefined ? "" : ` Id="${escapeXmlAttribute(element.id)}"`;
  const children = element.children ?? [];
  if (children.length > 0) {
    return [
      `${prefix}<${element.name}${id}>`,
      ...children.flatMap((child) => renderElement(child, indent + 2)),
      `${prefix}</${element.name}>`,
    ];
  }
  if (element.value !== undefined) {
    return [`${prefix}<${element.name}>${escapeXmlText(element.value)}</${element.name}>`];
  }
  return [`${prefix}<${element.name}${id}/>`];
}

/** The escaping `dte.builder.ts` applies, for the same reason: the text is ours, the values are not. */
function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
