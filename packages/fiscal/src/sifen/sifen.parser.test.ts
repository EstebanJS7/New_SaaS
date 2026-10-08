/**
 * FISC-010 WU-B — the six responses.
 *
 * The suite is written against §23's shapes and against ADR-008 §5's guardrails,
 * and the two halves are deliberately kept apart: the fixtures are what SIFEN
 * publishes (the schemas' element order, the Guide's own codes, the Manual's
 * `dEstRes` values and the `&#233;` the Guide's example carries), and the
 * assertions are the properties that make the reader safe — a bounded input, no
 * DOCTYPE, no coercion, every value validated against a published domain, and a
 * result built field by field rather than merged from whatever arrived.
 *
 * The real signed DE — `buildDteXml` over the FISC-008 fixture — is used as the
 * consultation's payload, so the DE that travels in `xContenDE` is the document
 * this package actually produces.
 */

import { describe, expect, it } from "vitest";
import { buildDteXml } from "../dte/dte.builder.js";
import { FIXTURE_CDC, validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import { describeBatchReception, describeCdcQuery, describeDeStatus } from "./sifen.codes.js";
import { SIFEN_MAX_RESPONSE_BYTES } from "./sifen.parser.js";
import {
  SifenParseError,
  parseBatchQueryResponse,
  parseBatchReceptionResponse,
  parseCdcQueryResponse,
  parseEventReceptionResponse,
  parseReceptionResponse,
  parseRucQueryResponse,
} from "./sifen.parser.js";
import type { SifenParseFailure } from "./sifen.parser.js";

const SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";
const SOAP_NS = "http://www.w3.org/2003/05/soap-envelope";

/**
 * The CDC the fixtures use: the specimen the baseline records (§22.9), which
 * also matches §23.6's `tCDC` and is therefore what a real `id` looks like.
 */
const CDC = FIXTURE_CDC;

/** A different CDC, for the one test that needs two of them at once. */
const OTHER_CDC = `02${"1234567A"}${"0".repeat(34)}`;

const DE = buildDteXml(validFacturaElectronicaRequest());

/**
 * The DE **element**, which is what `xContenDE` carries: the builder ends its
 * output with a newline after `</rDE>`, and that byte sits outside the element.
 */
const DE_ELEMENT = DE.trimEnd();

function envelope(body: string): string {
  return `<soap:Envelope xmlns:soap="${SOAP_NS}"><soap:Header/><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

/** A response as it really arrives: an XML declaration, then the envelope. */
function declaredEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${envelope(body)}`;
}

function sifen(element: string, inner: string): string {
  return `<${element} xmlns="${SIFEN_NS}">${inner}</${element}>`;
}

function reception(protocol: string): string {
  return envelope(sifen("rRetEnviDe", `<rProtDe Id="${CDC}">${protocol}</rProtDe>`));
}

const RECEPTION_FIELDS = [
  "<dFecProc>2026-10-08T12:00:00-03:00</dFecProc>",
  "<dDigVal>QUJDREVGRw==</dDigVal>",
  "<dEstRes>Aprobado con observación</dEstRes>",
  "<dProtAut>0123456789</dProtAut>",
  "<gResProc><dCodRes>0300</dCodRes><dMsgRes>Lote recibido con éxito</dMsgRes></gResProc>",
].join("");

function batchReception(fields: string): string {
  return envelope(sifen("rResEnviLoteDe", fields));
}

const BATCH_RECEPTION_FIELDS = [
  "<dFecProc>2026-10-08T12:00:00-03:00</dFecProc>",
  "<dCodRes>0300</dCodRes>",
  "<dMsgRes>Lote recibido con éxito</dMsgRes>",
  "<dProtConsLote>9999999999999999999999999999</dProtConsLote>",
  "<dTpoProces>1</dTpoProces>",
].join("");

function batchQuery(groupCount: number, codesPerGroup: number): string {
  const groups = Array.from({ length: groupCount }, () =>
    [
      `<gResProcLote id="${CDC}">`,
      "<dEstRes>Aprobado</dEstRes>",
      "<dProtAut>0123456789</dProtAut>",
      ...Array.from(
        { length: codesPerGroup },
        () => "<gResProc><dCodRes>0300</dCodRes><dMsgRes>ok</dMsgRes></gResProc>"
      ),
      "</gResProcLote>",
    ].join("")
  ).join("");

  return envelope(
    sifen(
      "rResEnviConsLoteDe",
      [
        "<dFecProc>2026-10-08T12:00:00-03:00</dFecProc>",
        "<dCodResLot>0362</dCodResLot>",
        "<dMsgResLot>Lote procesado</dMsgResLot>",
        groups,
      ].join("")
    )
  );
}

/**
 * A document carried as text inside `xs:string` field, escaped as XML requires.
 *
 * `&` first and on its own pass: the DE already carries `&amp;` inside its QR, so
 * a fixture that escaped only `<` and `>` would silently un-escape the document
 * when the reader decoded it — which is the whole reason the order is written out
 * here instead of reusing the serializer's escaper.
 */
function escaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function cdcQuery(code: string, content: string | undefined, asText = false): string {
  const body =
    content === undefined ? "" : `<xContenDE>${asText ? escaped(content) : content}</xContenDE>`;

  return envelope(
    sifen(
      "rEnviConsDeResponse",
      [
        "<dFecProc>2026-10-08T12:00:00-03:00</dFecProc>",
        `<dCodRes>${code}</dCodRes>`,
        "<dMsgRes>CDC encontrado</dMsgRes>",
        body,
      ].join("")
    )
  );
}

const DE_WRAPPED_IN_CONTAINER = `<rContDe>${DE}<dProtAut>0123456789</dProtAut></rContDe>`;

function rucQuery(fields: string): string {
  return envelope(sifen("rResEnviConsRUC", fields));
}

const RUC_FIELDS = [
  "<dCodRes>0502</dCodRes>",
  "<dMsgRes>RUC encontrado</dMsgRes>",
  "<xContRUC>",
  "<dRUCCons>80012345</dRUCCons>",
  "<dRazCons>RAZON SOCIAL SA</dRazCons>",
  "<dCodEstCons>001</dCodEstCons>",
  "<dDesEstCons>ACTIVO</dDesEstCons>",
  "<dRUCFactElec>S</dRUCFactElec>",
  "</xContRUC>",
].join("");

function eventReception(...results: readonly string[]): string {
  return envelope(
    sifen(
      "rRetEnviEventoDe",
      `<dFecProc>2026-10-08T12:00:00-03:00</dFecProc>${results
        .map((result) => `<gResProcEVe>${result}</gResProcEVe>`)
        .join("")}`
    )
  );
}

const EVENT_RESULT = [
  "<id>1</id>",
  "<dEstRes>Aprobado</dEstRes>",
  "<dProtAut>0123456789</dProtAut>",
  "<gResProc><dCodRes>0300</dCodRes><dMsgRes>ok</dMsgRes></gResProc>",
].join("");

/** The failure code a call raises, which is the part a caller branches on. */
function failureOf(call: () => unknown): SifenParseFailure {
  try {
    call();
  } catch (error) {
    if (error instanceof SifenParseError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

describe("the reception response, §23.3", () => {
  it("reads rProtDe's fields, with the Id attribute as the CDC", () => {
    const response = parseReceptionResponse(reception(RECEPTION_FIELDS));
    expect(response.protocol).toEqual({
      cdc: CDC,
      dFecProc: "2026-10-08T12:00:00-03:00",
      dDigVal: "QUJDREVGRw==",
      dEstRes: "Aprobado con observación",
      dProtAut: "0123456789",
      gResProc: [{ dCodRes: "0300", dMsgRes: "Lote recibido con éxito" }],
    });
  });

  it("accepts an optional member that was not informed", () => {
    const response = parseReceptionResponse(reception("<dFecProc>2026-10-08T12:00:00</dFecProc>"));
    expect(response.protocol.cdc).toBe(CDC);
    expect(response.protocol.dEstRes).toBeUndefined();
    expect(response.protocol.dProtAut).toBeUndefined();
    expect(response.protocol.gResProc).toEqual([]);
  });

  it("refuses a protocol without dFecProc, which §23.3 marks REQUIRED", () => {
    expect(failureOf(() => parseReceptionResponse(reception("<dEstRes>Aprobado</dEstRes>")))).toBe(
      "MISSING_ELEMENT"
    );
    expect(failureOf(() => parseReceptionResponse(reception("<dFecProc></dFecProc>")))).toBe(
      "INVALID_VALUE"
    );
  });

  it("reads the CDC whether it arrives as an attribute or as an element", () => {
    const asElement = envelope(
      sifen(
        "rRetEnviDe",
        `<rProtDe><Id>${CDC}</Id><dFecProc>2026-10-08T12:00:00</dFecProc></rProtDe>`
      )
    );
    expect(parseReceptionResponse(asElement).protocol.cdc).toBe(CDC);
  });

  it("refuses a CDC that appears twice with different values", () => {
    const conflicting = envelope(
      sifen(
        "rRetEnviDe",
        `<rProtDe Id="${CDC}"><Id>${OTHER_CDC}</Id>` +
          "<dFecProc>2026-10-08T12:00:00</dFecProc></rProtDe>"
      )
    );
    expect(failureOf(() => parseReceptionResponse(conflicting))).toBe("INCONSISTENT_CONTENT");
  });

  it("refuses an rRetEnviDe without an rProtDe", () => {
    expect(failureOf(() => parseReceptionResponse(envelope(sifen("rRetEnviDe", ""))))).toBe(
      "MISSING_ELEMENT"
    );
  });
});

describe("the batch reception response, §23.4", () => {
  it("reads all five members", () => {
    expect(parseBatchReceptionResponse(batchReception(BATCH_RECEPTION_FIELDS))).toEqual({
      dFecProc: "2026-10-08T12:00:00-03:00",
      dCodRes: "0300",
      dMsgRes: "Lote recibido con éxito",
      dProtConsLote: "9999999999999999999999999999",
      dTpoProces: "1",
    });
  });

  it("keeps the 28-digit batch number a string, because a number cannot hold it", () => {
    const value = parseBatchReceptionResponse(batchReception(BATCH_RECEPTION_FIELDS)).dProtConsLote;
    expect(typeof value).toBe("string");
    expect(value).toBe("9999999999999999999999999999");
    // The reason for the rule, in one line: the double cannot round-trip it.
    expect(String(Number(value))).not.toBe(value);
  });

  it("hands the batch number to the code table, which calls 0300 queued", () => {
    const response = parseBatchReceptionResponse(batchReception(BATCH_RECEPTION_FIELDS));
    expect(describeBatchReception(response.dCodRes, response.dProtConsLote)).toEqual({
      outcome: "queued",
      dCodRes: "0300",
      dProtConsLote: "9999999999999999999999999999",
    });
  });

  it("carries a code this client has never seen instead of coercing it", () => {
    // §23.8 item 7: no retrieved source enumerates the catalogue, so an unlisted
    // four-digit code is data — and the table answers `unknown` for it.
    const response = parseBatchReceptionResponse(
      batchReception("<dCodRes>0399</dCodRes><dMsgRes>?</dMsgRes>")
    );
    expect(response.dCodRes).toBe("0399");
    expect(describeBatchReception(response.dCodRes, undefined).outcome).toBe("unknown");
  });

  it("refuses a response with no dCodRes, because it would not be an answer", () => {
    expect(
      failureOf(() => parseBatchReceptionResponse(batchReception("<dMsgRes>ok</dMsgRes>")))
    ).toBe("MISSING_ELEMENT");
  });

  it("refuses a code that is not four digits and a dTpoProces that is not an integer", () => {
    expect(
      failureOf(() => parseBatchReceptionResponse(batchReception("<dCodRes>300</dCodRes>")))
    ).toBe("INVALID_VALUE");
    expect(
      failureOf(() =>
        parseBatchReceptionResponse(
          batchReception("<dCodRes>0300</dCodRes><dTpoProces>x</dTpoProces>")
        )
      )
    ).toBe("INVALID_VALUE");
  });
});

describe("the batch query response, §23.4", () => {
  it("reads each result group, with the CDC in id", () => {
    const response = parseBatchQueryResponse(batchQuery(1, 1));
    expect(response.dFecProc).toBe("2026-10-08T12:00:00-03:00");
    expect(response.dCodResLot).toBe("0362");
    expect(response.dMsgResLot).toBe("Lote procesado");
    expect(response.gResProcLote).toEqual([
      {
        cdc: CDC,
        dEstRes: "Aprobado",
        dProtAut: "0123456789",
        gResProc: [{ dCodRes: "0300", dMsgRes: "ok" }],
      },
    ]);
  });

  it("accepts fifty groups and refuses a fifty-first", () => {
    expect(parseBatchQueryResponse(batchQuery(50, 1)).gResProcLote).toHaveLength(50);
    expect(failureOf(() => parseBatchQueryResponse(batchQuery(51, 1)))).toBe("INVALID_VALUE");
  });

  it("accepts five codes per group and refuses a sixth", () => {
    expect(parseBatchQueryResponse(batchQuery(1, 5)).gResProcLote[0].gResProc).toHaveLength(5);
    expect(failureOf(() => parseBatchQueryResponse(batchQuery(1, 6)))).toBe("INVALID_VALUE");
  });

  it("accepts a group with no codes at all, which is what a clean approval looks like", () => {
    expect(parseBatchQueryResponse(batchQuery(1, 0)).gResProcLote[0].gResProc).toEqual([]);
  });

  it("refuses an id that is not a CDC and a dEstRes that is not published", () => {
    const badId = batchQuery(1, 1).replace(`id="${CDC}"`, `id="${CDC.slice(0, 43)}"`);
    expect(failureOf(() => parseBatchQueryResponse(badId))).toBe("INVALID_VALUE");
    const badStatus = batchQuery(1, 1).replace("Aprobado", "Pendiente");
    expect(failureOf(() => parseBatchQueryResponse(badStatus))).toBe("INVALID_VALUE");
  });
  it("reads a prefixed response root, which is how the Guide's answers arrive", () => {
    const prefixed = declaredEnvelope(
      `<ns2:rResEnviConsLoteDe xmlns:ns2="${SIFEN_NS}">` +
        "<dFecProc>2026-10-08T12:00:00</dFecProc><dCodResLot>0364</dCodResLot>" +
        "<dMsgResLot>Plazo vencido</dMsgResLot></ns2:rResEnviConsLoteDe>"
    );
    expect(parseBatchQueryResponse(prefixed).dCodResLot).toBe("0364");
  });
});

describe("the CDC query response, §23.6 and §23.8 item 3", () => {
  it("reads the scalars and the DE that arrived as markup", () => {
    const response = parseCdcQueryResponse(cdcQuery("0422", DE));
    expect(response.dCodRes).toBe("0422");
    expect(response.dMsgRes).toBe("CDC encontrado");
    expect(response.xContenDE).toEqual({
      deXml: DE_ELEMENT,
      dProtAut: undefined,
      wrappedInContainer: false,
    });
  });

  it("reads the same DE when it arrived as escaped text", () => {
    // The artifact types xContenDE as xs:string, so the DE can be escaped; the
    // decoded value must be the same document, byte for byte.
    const asText = parseCdcQueryResponse(cdcQuery("0422", DE, true));
    expect(asText.xContenDE?.deXml).toBe(DE_ELEMENT);
    expect(asText.xContenDE?.wrappedInContainer).toBe(false);
  });

  it("reads the Manual's rContDe container, keeping the protocol number", () => {
    const wrapped = parseCdcQueryResponse(cdcQuery("0422", DE_WRAPPED_IN_CONTAINER));
    expect(wrapped.xContenDE).toEqual({
      deXml: DE_ELEMENT,
      dProtAut: "0123456789",
      wrappedInContainer: true,
    });
  });

  it("reads the container when the whole container arrived escaped", () => {
    const wrapped = parseCdcQueryResponse(cdcQuery("0422", DE_WRAPPED_IN_CONTAINER, true));
    expect(wrapped.xContenDE?.deXml).toBe(DE_ELEMENT);
    expect(wrapped.xContenDE?.dProtAut).toBe("0123456789");
    expect(wrapped.xContenDE?.wrappedInContainer).toBe(true);
  });

  it("reads the real signed DE, in every shape §23.8 item 3 allows", () => {
    // The payload is the document this package's own builder produces, so the
    // bytes that come back out are the bytes a signature covers.
    expect(parseCdcQueryResponse(cdcQuery("0422", DE)).xContenDE?.deXml).toBe(DE_ELEMENT);
    expect(parseCdcQueryResponse(cdcQuery("0422", DE, true)).xContenDE?.deXml).toBe(DE_ELEMENT);
    expect(parseCdcQueryResponse(cdcQuery("0422", DE_WRAPPED_IN_CONTAINER)).xContenDE?.deXml).toBe(
      DE_ELEMENT
    );
  });

  it("reads a prefixed rDE inside the container", () => {
    const withPrefix = `<rContDe><sifen:rDE xmlns:sifen="${SIFEN_NS}"><DE/></sifen:rDE></rContDe>`;
    const response = parseCdcQueryResponse(cdcQuery("0422", withPrefix));
    expect(response.xContenDE?.deXml).toBe(
      `<sifen:rDE xmlns:sifen="${SIFEN_NS}"><DE/></sifen:rDE>`
    );
  });

  it("never reads a dProtAut that belongs to the DE rather than to the container", () => {
    const bare = parseCdcQueryResponse(
      cdcQuery("0422", `<rDE xmlns="${SIFEN_NS}"><dProtAut>999</dProtAut></rDE>`)
    );
    expect(bare.xContenDE?.deXml).toContain("999");
    expect(bare.xContenDE?.dProtAut).toBeUndefined();
    expect(bare.xContenDE?.wrappedInContainer).toBe(false);
  });

  it("treats an empty xContenDE as not informed", () => {
    const response = parseCdcQueryResponse(cdcQuery("0420", ""));
    expect(response.xContenDE).toBeUndefined();
    expect(response.dCodRes).toBe("0420");
  });

  it("refuses content under a code that cannot carry it, §23.6's Tabla G", () => {
    expect(failureOf(() => parseCdcQueryResponse(cdcQuery("0420", DE)))).toBe(
      "INCONSISTENT_CONTENT"
    );
    expect(failureOf(() => parseCdcQueryResponse(cdcQuery("0421", DE)))).toBe(
      "INCONSISTENT_CONTENT"
    );
    // And the code table says the same thing the reader does.
    expect(describeCdcQuery("0422").outcome).toBe("found");
  });

  it("refuses content that carries no DE, or one that never closes", () => {
    expect(failureOf(() => parseCdcQueryResponse(cdcQuery("0422", "<rContDe/>")))).toBe(
      "INVALID_VALUE"
    );
    expect(failureOf(() => parseCdcQueryResponse(cdcQuery("0422", "<rDE><DE>")))).toBe(
      "INVALID_VALUE"
    );
  });

  it("refuses a dProtAut in the container that is not a protocol number", () => {
    const bad = `<rContDe>${DE}<dProtAut>abc</dProtAut></rContDe>`;
    expect(failureOf(() => parseCdcQueryResponse(cdcQuery("0422", bad)))).toBe("INVALID_VALUE");
  });
});

describe("the RUC query response, §23.6", () => {
  it("reads the container's five fields", () => {
    expect(parseRucQueryResponse(rucQuery(RUC_FIELDS))).toEqual({
      dCodRes: "0502",
      dMsgRes: "RUC encontrado",
      xContRUC: {
        dRUCCons: "80012345",
        dRazCons: "RAZON SOCIAL SA",
        dCodEstCons: "001",
        dDesEstCons: "ACTIVO",
        dRUCFactElec: "S",
      },
    });
  });

  it("accepts N as the electronic-invoicer flag", () => {
    const response = parseRucQueryResponse(rucQuery(RUC_FIELDS.replace(">S<", ">N<")));
    expect(response.xContRUC?.dRUCFactElec).toBe("N");
  });

  it("leaves the container absent when the RUC was not found", () => {
    const response = parseRucQueryResponse(
      rucQuery("<dCodRes>0500</dCodRes><dMsgRes>RUC no existe</dMsgRes>")
    );
    expect(response.xContRUC).toBeUndefined();
    expect(response.dCodRes).toBe("0500");
  });

  it("refuses a RUC that does not match tRuc and a flag that is neither S nor N", () => {
    expect(
      failureOf(() => parseRucQueryResponse(rucQuery(RUC_FIELDS.replace("80012345", "08001234"))))
    ).toBe("INVALID_VALUE");
    expect(failureOf(() => parseRucQueryResponse(rucQuery(RUC_FIELDS.replace(">S<", ">X<"))))).toBe(
      "INVALID_VALUE"
    );
  });

  it("refuses a state code that is not three characters and a name over 250", () => {
    expect(
      failureOf(() => parseRucQueryResponse(rucQuery(RUC_FIELDS.replace(">001<", ">01<"))))
    ).toBe("INVALID_VALUE");
    expect(
      failureOf(() =>
        parseRucQueryResponse(rucQuery(RUC_FIELDS.replace("RAZON SOCIAL SA", "R".repeat(251))))
      )
    ).toBe("INVALID_VALUE");
  });
});

describe("the event reception response, §23.3", () => {
  it("reads the 1..15 group and its per-event fields", () => {
    expect(parseEventReceptionResponse(eventReception(EVENT_RESULT))).toEqual({
      dFecProc: "2026-10-08T12:00:00-03:00",
      gResProcEVe: [
        {
          id: "1",
          dEstRes: "Aprobado",
          dProtAut: "0123456789",
          gResProc: [{ dCodRes: "0300", dMsgRes: "ok" }],
        },
      ],
    });
  });

  it("accepts fifteen results and refuses a sixteenth", () => {
    const fifteen = Array.from({ length: 15 }, () => EVENT_RESULT);
    expect(parseEventReceptionResponse(eventReception(...fifteen)).gResProcEVe).toHaveLength(15);
    const sixteen = Array.from({ length: 16 }, () => EVENT_RESULT);
    expect(failureOf(() => parseEventReceptionResponse(eventReception(...sixteen)))).toBe(
      "INVALID_VALUE"
    );
  });

  it("refuses a response carrying no result at all", () => {
    expect(failureOf(() => parseEventReceptionResponse(eventReception()))).toBe("MISSING_ELEMENT");
  });

  it("refuses an event result whose status is not published", () => {
    const bad = eventReception(EVENT_RESULT.replace("Aprobado", "En proceso"));
    expect(failureOf(() => parseEventReceptionResponse(bad))).toBe("INVALID_VALUE");
  });
});

describe("ADR-008's guardrails, on the bytes before the parser", () => {
  it("refuses a document carrying a DOCTYPE, before the parser can expand it", () => {
    // A document type declaration in its legal place, declaring an entity that a
    // REQUIRED field then references: the refusal is what the reader answers, so
    // the reference was never expanded.
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE soap:Envelope [ <!ENTITY x "boom"> ]>` +
      envelope(sifen("rRetEnviDe", "<rProtDe><dFecProc>&x;</dFecProc></rProtDe>"));
    expect(failureOf(() => parseReceptionResponse(xml))).toBe("DOCTYPE_FORBIDDEN");
  });

  it("refuses a DOCTYPE whatever case it is spelled in", () => {
    const xml = `<!doctype soap:Envelope>` + envelope(sifen("rRetEnviDe", "<rProtDe/>"));
    expect(failureOf(() => parseReceptionResponse(xml))).toBe("DOCTYPE_FORBIDDEN");
  });

  it("refuses a response over the cap, measured in bytes", () => {
    expect(SIFEN_MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
    expect(failureOf(() => parseReceptionResponse(" ".repeat(SIFEN_MAX_RESPONSE_BYTES + 1)))).toBe(
      "RESPONSE_TOO_LARGE"
    );
    // Four million accented characters are under the cap by length and over it by
    // bytes, which is the difference between a cap and a `length` check.
    const wide = "é".repeat(4 * 1024 * 1024 + 1);
    expect(wide.length).toBeLessThan(SIFEN_MAX_RESPONSE_BYTES);
    expect(failureOf(() => parseReceptionResponse(wide))).toBe("RESPONSE_TOO_LARGE");
  });

  it("refuses a document the parser itself cannot read", () => {
    expect(failureOf(() => parseReceptionResponse(`<a b="unclosed>`))).toBe("MALFORMED_XML");
    const deep = `${"<a>".repeat(150)}x${"</a>".repeat(150)}`;
    expect(failureOf(() => parseReceptionResponse(deep))).toBe("MALFORMED_XML");
  });

  it("refuses a body that is not a SOAP envelope at all", () => {
    expect(failureOf(() => parseReceptionResponse(sifen("rRetEnviDe", "")))).toBe(
      "MISSING_ELEMENT"
    );
    expect(failureOf(() => parseReceptionResponse(""))).toBe("MISSING_ELEMENT");
    expect(failureOf(() => parseReceptionResponse("<Envelope><Body/></Envelope>"))).toBe(
      "MISSING_ELEMENT"
    );
  });
});

describe("no value is coerced, and the provider's bytes are kept as sent", () => {
  it("decodes numeric character references, which the Guide's example carries", () => {
    const response = parseReceptionResponse(
      reception(
        "<dFecProc>2026-10-08T12:00:00</dFecProc>" +
          "<dEstRes>Aprobado con observaci&#243;n</dEstRes>" +
          "<gResProc><dCodRes>0300</dCodRes><dMsgRes>Recibido con &#233;xito &#xE9;xito</dMsgRes></gResProc>"
      )
    );
    expect(response.protocol.dEstRes).toBe("Aprobado con observación");
    expect(describeDeStatus(response.protocol.dEstRes ?? "").outcome).toBe(
      "approved_with_observation"
    );
    expect(response.protocol.gResProc[0].dMsgRes).toBe("Recibido con éxito éxito");
  });

  it("keeps a leading zero on a code and on a protocol number", () => {
    const response = parseReceptionResponse(reception(RECEPTION_FIELDS));
    expect(typeof response.protocol.dProtAut).toBe("string");
    expect(response.protocol.dProtAut).toBe("0123456789");
    expect(response.protocol.gResProc[0].dCodRes).toBe("0300");
  });

  it("keeps whitespace exactly as the provider sent it", () => {
    // ADR-008 rule 4: `trimValues: false`. A message is a sequence of bytes, and
    // SIFEN's own rules care about whitespace.
    const padded = parseReceptionResponse(
      reception("<dFecProc> 2026-10-08T12:00:00 </dFecProc><dDigVal> QUJDREVGRw== </dDigVal>")
    );
    expect(padded.protocol.dFecProc).toBe(" 2026-10-08T12:00:00 ");
    expect(padded.protocol.dDigVal).toBe(" QUJDREVGRw== ");
  });
});

describe("every parsed value is validated against a published domain", () => {
  it("refuses an unknown dEstRes rather than inventing a status", () => {
    expect(
      failureOf(() =>
        parseReceptionResponse(
          reception("<dFecProc>2026-10-08T12:00:00</dFecProc><dEstRes>Pendiente</dEstRes>")
        )
      )
    ).toBe("INVALID_VALUE");
  });

  it("refuses a dDigVal that is not base64", () => {
    expect(
      failureOf(() =>
        parseReceptionResponse(
          reception("<dFecProc>2026-10-08T12:00:00</dFecProc><dDigVal>not*base64</dDigVal>")
        )
      )
    ).toBe("INVALID_VALUE");
  });

  it("refuses a dProtAut with letters in it", () => {
    const bad = RECEPTION_FIELDS.replace(">0123456789<", ">0123456789A<");
    expect(failureOf(() => parseReceptionResponse(reception(bad)))).toBe("INVALID_VALUE");
  });

  it("refuses a dProtAut longer than the batch pattern allows", () => {
    const bad = batchQuery(1, 1).replace(">0123456789<", ">" + "9".repeat(11) + "<");
    expect(failureOf(() => parseBatchQueryResponse(bad))).toBe("INVALID_VALUE");
  });

  it("refuses a dFecProc that is not a date-time", () => {
    expect(failureOf(() => parseReceptionResponse(reception("<dFecProc>ayer</dFecProc>")))).toBe(
      "INVALID_VALUE"
    );
  });
});

describe("the result is built field by field", () => {
  it("refuses a field that arrives twice", () => {
    const duplicated = reception(
      "<dFecProc>2026-10-08T12:00:00</dFecProc><dFecProc>2026-10-08T13:00:00</dFecProc>"
    );
    expect(failureOf(() => parseReceptionResponse(duplicated))).toBe("DUPLICATE_ELEMENT");
  });

  it("refuses a scalar that arrived as an element with children", () => {
    const nested = reception("<dFecProc>2026-10-08T12:00:00</dFecProc><dEstRes><x/></dEstRes>");
    expect(failureOf(() => parseReceptionResponse(nested))).toBe("UNEXPECTED_SHAPE");
  });

  it("refuses a gResProc entry that reports nothing", () => {
    const empty = reception(
      "<dFecProc>2026-10-08T12:00:00</dFecProc><gResProc><dCodRes></dCodRes></gResProc>"
    );
    expect(failureOf(() => parseReceptionResponse(empty))).toBe("INVALID_VALUE");
  });

  it("carries nothing from the parsed document into the result, whatever it is named", () => {
    // The prototype-pollution shape the guardrail guards against: a document that
    // names its elements after `Object.prototype`'s own slots. Nothing is spread,
    // merged or indexed by a parsed key, so nothing is installed — and the result
    // still carries exactly the fields the protocol declares.
    const hostile = reception(
      RECEPTION_FIELDS +
        "<toString><polluted>1</polluted></toString>" +
        "<hasOwnProperty><polluted>1</polluted></hasOwnProperty>" +
        "<valueOf><polluted>1</polluted></valueOf>"
    );
    const response = parseReceptionResponse(hostile);
    expect(response.protocol.dEstRes).toBe("Aprobado con observación");

    const fresh: Record<string, unknown> = {};
    expect(Object.hasOwn(fresh, "polluted")).toBe(false);
    const prototype = Object.prototype as unknown as Record<string, unknown>;
    expect(prototype.polluted).toBeUndefined();
    expect(prototype.prototype).toBeUndefined();
  });

  it("refuses a document whose element names are JavaScript's reserved ones", () => {
    // A second layer, and the library's: `__proto__`, `constructor` and
    // `prototype` are refused before this reader sees a single value.
    for (const name of ["__proto__", "constructor", "prototype"]) {
      const hostile = reception(RECEPTION_FIELDS + `<${name}>x</${name}>`);
      expect(failureOf(() => parseReceptionResponse(hostile))).toBe("MALFORMED_XML");
    }
  });
});
