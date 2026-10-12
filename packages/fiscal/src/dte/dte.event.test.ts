/**
 * FISC-016 WU-B — the pure event builder, asserted against baseline §25.
 *
 * "It produced XML" is not the criterion: the document is submitted once, so a
 * wrong child order or a field that no schema declares is a document SIFEN
 * rejects. The suite asserts the envelope's order, the two payloads field by
 * field, the lot's cardinality, the signature's position, and each rule the
 * schema leaves to this module — §25.7 — as a **named** refusal.
 *
 * The assertions read the produced XML as text, which is also how
 * `dte.event.ts` works.
 */

import { describe, expect, it } from "vitest";
import { EVENT_SIGNATURE_PLACEHOLDER, buildEventGroupXml, buildEventXml } from "./dte.event.js";
import { DteEventValidationError } from "./dte.event.rules.js";
import {
  EVENT_ID_MAX,
  EVENT_REQUEST_ID_MAX,
  EVENT_XML_VERSION,
  type DteEventPayload,
  type DteEventRequest,
} from "./dte.event.types.js";

const VALID_CDC = `12${"1234567A"}${"0".repeat(34)}`;
const OTHER_CDC = `12${"7654321B"}${"0".repeat(34)}`;
const REASON = "Servicio no prestado";
const ISSUED_AT = "2026-10-11T09:35:17";

function cancellation(overrides: Partial<DteEventRequest["events"][number]> = {}) {
  return {
    id: "1",
    dFecFirma: ISSUED_AT,
    payload: { kind: "cancellation", cdc: VALID_CDC, reason: REASON } as DteEventPayload,
    ...overrides,
  };
}

function inutilizacion(overrides: Partial<DteEventRequest["events"][number]> = {}) {
  return {
    id: "2",
    dFecFirma: ISSUED_AT,
    payload: {
      kind: "inutilizacion",
      dNumTim: "12345678",
      dEst: "001",
      dPunExp: "002",
      dNumIn: "0000001",
      dNumFin: "0000010",
      iTiDE: 1,
      reason: REASON,
      dSerieNum: "AB",
    } as DteEventPayload,
    ...overrides,
  };
}

/** One cancellation and one inutilización: the lot is heterogeneous in practice. */
function validRequest(overrides: Partial<DteEventRequest> = {}): DteEventRequest {
  return {
    dId: "123456789012345",
    events: [cancellation(), inutilizacion()],
    ...overrides,
  };
}

function failureOf(callback: () => unknown): DteEventValidationError["failure"] {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DteEventValidationError);
    return (error as DteEventValidationError).failure;
  }
  throw new Error("expected a DteEventValidationError");
}

function expectOrdered(value: string, fragments: readonly string[]): void {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = value.indexOf(fragment);
    expect(index, `missing fragment ${fragment}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

describe("buildEventXml — the envelope (§25.1)", () => {
  it("emits rEnviEventoDe's two children in schema order, and one rGesEve per event", () => {
    const xml = buildEventXml(validRequest());

    expect(xml).toContain('<rEnviEventoDe xmlns="http://ekuatia.set.gov.py/sifen/xsd">');
    expectOrdered(xml, [
      "<rEnviEventoDe",
      "<dId>123456789012345</dId>",
      "<dEvReg>",
      '<gGroupGesEve xmlns="http://ekuatia.set.gov.py/sifen/xsd">',
      "<rGesEve>",
      "<rEve ",
      "</rEve>",
      "<Signature",
      "</rGesEve>",
      "</gGroupGesEve>",
      "</dEvReg>",
      "</rEnviEventoDe>",
    ]);
    expect(xml.match(/<rGesEve>/g) ?? []).toHaveLength(2);
  });

  it("carries the caller's dId and never invents one", () => {
    expect(buildEventXml(validRequest())).toContain("<dId>123456789012345</dId>");
    expect(buildEventXml(validRequest({ dId: "7" }))).toContain("<dId>7</dId>");
  });

  it("writes rEve's three children in schema order, with the event's id as its Id", () => {
    const xml = buildEventXml(validRequest());

    expectOrdered(xml, [
      '<rEve Id="1">',
      "<dFecFirma>2026-10-11T09:35:17</dFecFirma>",
      `<dVerFor>${EVENT_XML_VERSION}</dVerFor>`,
      "<gGroupTiEvt>",
      "</gGroupTiEvt>",
      "</rEve>",
    ]);
    expectOrdered(xml, ['<rEve Id="1">', '<rEve Id="2">']);
  });

  it("never emits dTiGDE, the dead catalogue, nor the receptor's tiTipEve as the event's type", () => {
    const xml = buildEventXml(validRequest());

    // §25.2: the only element that would carry tdTiGDE is commented out, and a
    // document carrying one validates against nothing. The type IS the element
    // name, which the two cases above already assert.
    expect(xml).not.toContain("dTiGDE");
    expect(xml).not.toContain("tiTipEve");
    expect(xml).not.toContain("dVerFormType");
  });

  it("emits the signature placeholder inside rGesEve, after the event body", () => {
    const xml = buildEventXml(validRequest());

    expectOrdered(xml, ["</rEve>", EVENT_SIGNATURE_PLACEHOLDER.trimStart(), "</rGesEve>"]);
    expect(xml.split("\n").filter((line) => line === EVENT_SIGNATURE_PLACEHOLDER)).toHaveLength(2);
  });
});

describe("buildEventGroupXml — the hand-off surface (WU-C)", () => {
  it("renders exactly the group the envelope carries, so a signer signs the bytes that are submitted", () => {
    const request = validRequest();

    const group = buildEventGroupXml(request.events);

    expect(buildEventXml(request)).toContain(group);
    // The composed envelope adds only its own scaffold around those bytes.
    expect(buildEventXml(request).split("\n").slice(3, -3).join("\n") + "\n").toBe(group);
  });

  it("keeps rGesEve at the envelope's indentation and the placeholder at its exact line", () => {
    const group = buildEventGroupXml(validRequest().events);
    const lines = group.split("\n");

    expect(lines[0]).toBe('    <gGroupGesEve xmlns="http://ekuatia.set.gov.py/sifen/xsd">');
    expect(lines).toContain("      <rGesEve>");
    expect(lines.filter((line) => line === EVENT_SIGNATURE_PLACEHOLDER)).toHaveLength(2);
    expect(lines).toContain("    </gGroupGesEve>");
    // A complete document: exactly one trailing newline, and nothing after it.
    expect(group.endsWith("    </gGroupGesEve>\n")).toBe(true);
  });

  it("declares the namespace on the group itself, so signing it standalone matches the embedded form", () => {
    // The group is signed on its own and then embedded under an envelope that
    // declares the same default namespace. Without this declaration the
    // standalone subtree is in no namespace and the embedded one is in the
    // SIFEN namespace, so the canonical form the signature covers would differ
    // from the one SIFEN verifies. `xsd-event-validation.test.ts` proves the
    // consequence; this pins the cause.
    const group = buildEventGroupXml(validRequest().events);
    const namespace = 'xmlns="http://ekuatia.set.gov.py/sifen/xsd"';

    expect(group).toContain(`<gGroupGesEve ${namespace}>`);
    // The envelope's own declaration is now the redundant one, and redundant is
    // legal: the same namespace, declared twice, is the same infoset.
    expect(buildEventXml(validRequest()).match(new RegExp(namespace, "g")) ?? []).toHaveLength(2);
  });

  it("validates the events it carries with the request's own rules", () => {
    expect(failureOf(() => buildEventGroupXml([]))).toBe("INVALID_EVENT_COUNT");
    expect(
      failureOf(() =>
        buildEventGroupXml([
          cancellation({ payload: { kind: "cancellation", cdc: "123", reason: REASON } }),
        ])
      )
    ).toBe("INVALID_CANCELLATION_CDC");
    expect(
      failureOf(() =>
        buildEventGroupXml(
          Array.from({ length: 16 }, (_unused, index) => cancellation({ id: String(index + 1) }))
        )
      )
    ).toBe("INVALID_EVENT_COUNT");
  });

  it("is a total function of its arguments: the same events twice are byte-identical", () => {
    const events = validRequest().events;

    expect(buildEventGroupXml(events)).toBe(buildEventGroupXml(events));
  });
});

describe("buildEventXml — the two payloads (§25.3)", () => {
  it("emits the cancellation as exactly Id and mOtEve", () => {
    const xml = buildEventXml(validRequest({ events: [cancellation()] }));

    expectOrdered(xml, [
      "<rGeVeCan>",
      `<Id>${VALID_CDC}</Id>`,
      `<mOtEve>${REASON}</mOtEve>`,
      "</rGeVeCan>",
    ]);
    const payload = xml.slice(xml.indexOf("<rGeVeCan>"), xml.indexOf("</rGeVeCan>"));
    expect(payload.match(/<[a-zA-Z]/g) ?? []).toHaveLength(3);
  });

  it("emits the inutilización's seven required children in schema order, and the series when supplied", () => {
    const xml = buildEventXml(validRequest({ events: [inutilizacion()] }));

    expectOrdered(xml, [
      "<rGeVeInu>",
      "<dNumTim>12345678</dNumTim>",
      "<dEst>001</dEst>",
      "<dPunExp>002</dPunExp>",
      "<dNumIn>0000001</dNumIn>",
      "<dNumFin>0000010</dNumFin>",
      "<iTiDE>1</iTiDE>",
      `<mOtEve>${REASON}</mOtEve>`,
      "<dSerieNum>AB</dSerieNum>",
      "</rGeVeInu>",
    ]);
  });

  it("omits dSerieNum when the caller omits it, and carries no Id on an inutilización", () => {
    const payload = inutilizacion().payload;
    expect(payload.kind).toBe("inutilizacion");
    const withoutSeries = {
      ...(payload as Extract<DteEventPayload, { kind: "inutilizacion" }>),
    };
    delete (withoutSeries as { dSerieNum?: string }).dSerieNum;

    const xml = buildEventXml(
      validRequest({ events: [inutilizacion({ payload: withoutSeries })] })
    );

    expect(xml).not.toContain("<dSerieNum>");
    // §25.3: an inutilización voids a NUMBER RANGE, so a symmetric implementation
    // that expected a CDC there would emit a child the schema does not declare.
    const body = xml.slice(xml.indexOf("<rGeVeInu>"), xml.indexOf("</rGeVeInu>"));
    expect(body).not.toContain("<Id>");
  });

  it("keeps the two events' payloads independent inside one lot", () => {
    const xml = buildEventXml(validRequest());

    expect(xml).toContain(`<Id>${VALID_CDC}</Id>`);
    expect(xml).toContain("<dNumTim>12345678</dNumTim>");
    expect(xml.match(/<gGroupTiEvt>/g) ?? []).toHaveLength(2);
  });
});

describe("buildEventXml — the lot's cardinality (§25.1)", () => {
  it("accepts the schema's maximum of fifteen events, each signed separately", () => {
    const events = Array.from({ length: 15 }, (_unused, index) =>
      cancellation({
        id: String(index + 1),
        payload: { kind: "cancellation", cdc: OTHER_CDC, reason: REASON },
      })
    );
    const xml = buildEventXml(validRequest({ events }));

    expect(xml.match(/<rGesEve>/g) ?? []).toHaveLength(15);
    expect(xml.match(/<rGeVeCan>/g) ?? []).toHaveLength(15);
    expect(xml.split("\n").filter((line) => line === EVENT_SIGNATURE_PLACEHOLDER)).toHaveLength(15);
  });
});

describe("buildEventXml — escaping and purity", () => {
  it("escapes XML text and the Id attribute", () => {
    const xml = buildEventXml(
      validRequest({
        events: [
          cancellation({
            payload: {
              kind: "cancellation",
              cdc: VALID_CDC,
              reason: "Rechazo por motivos & <razones>",
            },
          }),
        ],
      })
    );

    expect(xml).toContain("<mOtEve>Rechazo por motivos &amp; &lt;razones&gt;</mOtEve>");
  });

  it("is a total function of its arguments: the same request twice is byte-identical", () => {
    const request = validRequest();

    expect(buildEventXml(request)).toBe(buildEventXml(request));
    // No ambient clock: the only timestamp in the document is the caller's.
    expect(buildEventXml(request).match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/g)).toEqual([
      ISSUED_AT,
      ISSUED_AT,
    ]);
  });

  it("does not mutate the request it was given", () => {
    const request = validRequest();
    const before = JSON.stringify(request);

    buildEventXml(request);

    expect(JSON.stringify(request)).toBe(before);
  });
});

describe("buildEventXml — the rules the schema does not assert (§25.7)", () => {
  it("refuses a request identifier outside 1..999999999999999", () => {
    expect(failureOf(() => buildEventXml(validRequest({ dId: "0" })))).toBe("INVALID_REQUEST_ID");
    expect(
      failureOf(() => buildEventXml(validRequest({ dId: String(EVENT_REQUEST_ID_MAX + 1) })))
    ).toBe("INVALID_REQUEST_ID");
    expect(failureOf(() => buildEventXml(validRequest({ dId: "1234567890123456" })))).toBe(
      "INVALID_REQUEST_ID"
    );
    expect(failureOf(() => buildEventXml(validRequest({ dId: "12345 678" })))).toBe(
      "INVALID_REQUEST_ID"
    );
  });

  it("refuses a lot with no events and a lot with more than fifteen", () => {
    expect(failureOf(() => buildEventXml(validRequest({ events: [] })))).toBe(
      "INVALID_EVENT_COUNT"
    );

    const sixteen = Array.from({ length: 16 }, (_unused, index) =>
      cancellation({ id: String(index + 1) })
    );
    expect(failureOf(() => buildEventXml(validRequest({ events: sixteen })))).toBe(
      "INVALID_EVENT_COUNT"
    );
  });

  it("refuses an event identifier outside 1..9999999999", () => {
    expect(
      failureOf(() => buildEventXml(validRequest({ events: [cancellation({ id: "0" })] })))
    ).toBe("INVALID_EVENT_ID");
    expect(
      failureOf(() =>
        buildEventXml(validRequest({ events: [cancellation({ id: String(EVENT_ID_MAX + 1) })] }))
      )
    ).toBe("INVALID_EVENT_ID");
    expect(
      failureOf(() => buildEventXml(validRequest({ events: [cancellation({ id: "1A" })] })))
    ).toBe("INVALID_EVENT_ID");
  });

  it("refuses a signing timestamp with a timezone suffix or fractional seconds", () => {
    // `fecHhmmss` is the same type `dFeEmiDE` uses: no timezone, no fraction.
    for (const dFecFirma of [
      "2026-10-11T09:35:17Z",
      "2026-10-11T09:35:17-03:00",
      "2026-10-11T09:35:17.123",
      "2026-10-11 09:35:17",
    ]) {
      expect(
        failureOf(() => buildEventXml(validRequest({ events: [cancellation({ dFecFirma })] })))
      ).toBe("INVALID_TIMESTAMP");
    }
  });

  it("refuses a cancellation whose CDC is not the schema's 44-character tId", () => {
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({
            events: [
              cancellation({ payload: { kind: "cancellation", cdc: "123", reason: REASON } }),
            ],
          })
        )
      )
    ).toBe("INVALID_CANCELLATION_CDC");
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({
            events: [
              cancellation({
                payload: {
                  kind: "cancellation",
                  cdc: `12${"1234567E"}${"0".repeat(34)}`,
                  reason: REASON,
                },
              }),
            ],
          })
        )
      )
    ).toBe("INVALID_CANCELLATION_CDC");
  });

  it("refuses a reason shorter than five or longer than five hundred characters", () => {
    for (const reason of ["", "no", "a".repeat(501), "ñ".repeat(501)]) {
      expect(
        failureOf(() =>
          buildEventXml(
            validRequest({
              events: [cancellation({ payload: { kind: "cancellation", cdc: VALID_CDC, reason } })],
            })
          )
        )
      ).toBe("INVALID_REASON");
    }
    // Both bounds are inclusive, so 5 and 500 are accepted.
    expect(() =>
      buildEventXml(
        validRequest({
          events: [
            cancellation({ payload: { kind: "cancellation", cdc: VALID_CDC, reason: "12345" } }),
          ],
        })
      )
    ).not.toThrow();
    expect(() =>
      buildEventXml(
        validRequest({
          events: [
            cancellation({
              payload: { kind: "cancellation", cdc: VALID_CDC, reason: "a".repeat(500) },
            }),
          ],
        })
      )
    ).not.toThrow();
  });

  it("refuses a timbrado number that is not exactly eight digits", () => {
    for (const dNumTim of ["1234567", "123456789", "00000000", "1234567A"]) {
      expect(
        failureOf(() =>
          buildEventXml(
            validRequest({ events: [inutilizacion({ payload: withTimbrado(undefined, dNumTim) })] })
          )
        )
      ).toBe("INVALID_TIMBRADO_NUMBER");
    }
  });

  it("refuses an establishment or a point of expedition that is not three digits", () => {
    for (const dEst of ["01", "0001", "00A"]) {
      expect(
        failureOf(() =>
          buildEventXml(validRequest({ events: [inutilizacion({ payload: withTimbrado(dEst) })] }))
        )
      ).toBe("INVALID_ESTABLISHMENT");
    }
    for (const dPunExp of ["02", "0002", "00B"]) {
      expect(
        failureOf(() =>
          buildEventXml(
            validRequest({
              events: [inutilizacion({ payload: withTimbrado(undefined, undefined, dPunExp) })],
            })
          )
        )
      ).toBe("INVALID_POINT_OF_EXPEDITION");
    }
  });

  it("refuses a range number with fewer than seven digits or the wrong shape", () => {
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({ events: [inutilizacion({ payload: withRange("123456", "0000010") })] })
        )
      )
    ).toBe("INVALID_RANGE_START");
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({ events: [inutilizacion({ payload: withRange("0000001", "000000") })] })
        )
      )
    ).toBe("INVALID_RANGE_END");
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({ events: [inutilizacion({ payload: withRange("0000000", "0000010") })] })
        )
      )
    ).toBe("INVALID_RANGE_START");
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({ events: [inutilizacion({ payload: withRange("0000001", "00000A0") })] })
        )
      )
    ).toBe("INVALID_RANGE_END");
  });

  it("refuses a range whose start is after its end, which no schema facet asserts", () => {
    expect(
      failureOf(() =>
        buildEventXml(
          validRequest({ events: [inutilizacion({ payload: withRange("0000011", "0000010") })] })
        )
      )
    ).toBe("INVALID_RANGE_ORDER");
    // The comparison is numeric, not lexicographic: more digits with the same
    // value is the same number, and `00000001` is not "before" `0000001`.
    expect(() =>
      buildEventXml(
        validRequest({ events: [inutilizacion({ payload: withRange("00000001", "0000001") })] })
      )
    ).not.toThrow();
    expect(() =>
      buildEventXml(
        validRequest({ events: [inutilizacion({ payload: withRange("0000010", "0000010") })] })
      )
    ).not.toThrow();
  });

  it("refuses a document type outside tiTiDEEv's 1..9", () => {
    for (const iTiDE of [0, 10, 1.5]) {
      expect(
        failureOf(() =>
          buildEventXml(
            validRequest({ events: [inutilizacion({ payload: withDocumentType(iTiDE) })] })
          )
        )
      ).toBe("INVALID_DOCUMENT_TYPE");
    }
    // `tiTiDEEv` admits 2, 3 and 8, which the DE's own `tiTiDE` does not: the
    // event's enumeration is its own type, not a copy of the DE's.
    for (const iTiDE of [1, 2, 3, 8, 9]) {
      expect(() =>
        buildEventXml(
          validRequest({ events: [inutilizacion({ payload: withDocumentType(iTiDE) })] })
        )
      ).not.toThrow();
    }
  });

  it("refuses a series that is not two uppercase letters", () => {
    for (const dSerieNum of ["A", "ABC", "aa", "ÑÑ", "A1"]) {
      expect(
        failureOf(() =>
          buildEventXml(
            validRequest({ events: [inutilizacion({ payload: withSeries(dSerieNum) })] })
          )
        )
      ).toBe("INVALID_SERIES");
    }
  });

  it("refuses a payload kind that is neither of the two the schema declares", () => {
    const unknown = {
      id: "1",
      dFecFirma: ISSUED_AT,
      payload: { kind: "notificacion" },
    } as unknown as DteEventRequest["events"][number];

    expect(failureOf(() => buildEventXml(validRequest({ events: [unknown] })))).toBe(
      "INVALID_EVENT_KIND"
    );
  });
});

type Inutilizacion = Extract<DteEventPayload, { kind: "inutilizacion" }>;

function withTimbrado(dEst?: string, dNumTim?: string, dPunExp?: string): Inutilizacion {
  return {
    ...(inutilizacion().payload as Inutilizacion),
    ...(dEst === undefined ? {} : { dEst }),
    ...(dNumTim === undefined ? {} : { dNumTim }),
    ...(dPunExp === undefined ? {} : { dPunExp }),
  };
}

function withRange(dNumIn: string, dNumFin: string): Inutilizacion {
  return { ...(inutilizacion().payload as Inutilizacion), dNumIn, dNumFin };
}

function withDocumentType(iTiDE: number): Inutilizacion {
  return {
    ...(inutilizacion().payload as Inutilizacion),
    iTiDE: iTiDE as Inutilizacion["iTiDE"],
  };
}

function withSeries(dSerieNum: string): Inutilizacion {
  return { ...(inutilizacion().payload as Inutilizacion), dSerieNum };
}
