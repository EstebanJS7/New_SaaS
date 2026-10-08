/**
 * FISC-010 WU-B — the six request envelopes.
 *
 * The assertions are on BYTES, because that is what the service receives: the
 * envelope's namespaces and its empty header (§23.4, without the Manual's
 * defective prefixes from §8), the embedded DE's exact bytes (the signed document
 * is what a digest covers), and the batch's base64 ZIP decoded back through
 * `fflate` — the round trip the Story asks for.
 *
 * The DE used throughout is the one this package's own builder produces
 * (`buildDteXml` over the FISC-008 fixture), so "the document our own builder
 * produced" is literally the input, not a hand-written stand-in.
 */

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDteXml } from "../dte/dte.builder.js";
import { FIXTURE_CDC, validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import {
  SIFEN_BATCH_CONTAINER_NAMESPACE,
  SIFEN_BATCH_MAX_DOCUMENTS,
  SIFEN_MAX_REQUEST_BYTES,
  SIFEN_ZIP_ENTRY_NAME,
  SifenSerializationError,
  buildBatchContainer,
  serializeBatchQuery,
  serializeBatchReception,
  serializeCdcQuery,
  serializeEventReception,
  serializeReception,
  serializeRucQuery,
} from "./sifen.serializer.js";
import type { SifenSerializationFailure } from "./sifen.serializer.js";
import { SIFEN_NAMESPACE, SOAP_ENVELOPE_NAMESPACE } from "./sifen.messages.js";

const DE = buildDteXml(validFacturaElectronicaRequest());
const SOAP_OPEN = `<soap:Envelope xmlns:soap="${SOAP_ENVELOPE_NAMESPACE}">`;

/** A second, distinguishable DE: the fixture with a different security code. */
const SIGNED = validFacturaElectronicaRequest();
const OTHER_DE = buildDteXml({
  ...SIGNED,
  gOpeDE: { ...SIGNED.gOpeDE, dCodSeg: "987654321" },
});

/** The failure code a call raises, which is the part a caller branches on. */
function failureOf(call: () => unknown): SifenSerializationFailure {
  try {
    call();
  } catch (error) {
    if (error instanceof SifenSerializationError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

/** The body's own lines: everything between `<soap:Body>` and `</soap:Body>`. */
function bodyLines(xml: string): readonly string[] {
  const lines = xml.split("\n");
  return lines.slice(3, lines.length - 2);
}

/**
 * Deterministic, high-entropy text, so deflate cannot shrink it.
 *
 * §23.7's 1000 KB bound is on the message, and the message here is a compressed
 * ZIP: a filler made of a repeated character would compress to nothing and the
 * test would say more about deflate than about the cap.
 */
function incompressible(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let state = 0x2545f491;
  let text = "";
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    text += alphabet.charAt((state >>> 26) & 63);
  }
  return text;
}

describe("the envelope, shared by all six services", () => {
  it("opens with SOAP 1.2, an empty header and a body", () => {
    const xml = serializeRucQuery({ dId: "1", dRUCCons: "80012345" });
    const lines = xml.split("\n");
    expect(lines[0]).toBe(SOAP_OPEN);
    expect(lines[1]).toBe("  <soap:Header/>");
    expect(lines[2]).toBe("  <soap:Body>");
    expect(lines).toContain("  </soap:Body>");
    expect(lines[lines.length - 2]).toBe("</soap:Envelope>");
  });

  it("declares the body root's namespace as the DEFAULT, so nothing inside is prefixed", () => {
    // §23.4's Guide example uses `xsd:` prefixes; §8 records the Manual's own
    // envelope mismatching its prefixes. This client copies the namespaces and not
    // the prefixes.
    const xml = serializeRucQuery({ dId: "1", dRUCCons: "80012345" });
    expect(bodyLines(xml)[0]).toBe(`    <rEnviConsRUC xmlns="${SIFEN_NAMESPACE}">`);
    for (const line of bodyLines(xml)) {
      expect(line).not.toMatch(/<[A-Za-z_][\w.-]*:/);
    }
  });

  it("ends every envelope with a newline and nothing else", () => {
    for (const xml of [
      serializeReception({ dId: "1", deXml: DE }),
      serializeBatchQuery({ dId: "1", dCDC: FIXTURE_CDC }),
      serializeCdcQuery({ dId: "1", dCDC: FIXTURE_CDC }),
      serializeRucQuery({ dId: "1", dRUCCons: "80012345" }),
      serializeEventReception({ dId: "1", eventXml: "<rGesEve/>" }),
    ]) {
      expect(xml.endsWith("</soap:Envelope>\n")).toBe(true);
    }
  });
});

describe("the synchronous reception embeds the DE as a child element", () => {
  it("emits rEnviDe with the dId and the DE verbatim, never escaped", () => {
    const xml = serializeReception({ dId: "20240926", deXml: DE });
    expect(xml).toBe(
      [
        SOAP_OPEN,
        "  <soap:Header/>",
        "  <soap:Body>",
        `    <rEnviDe xmlns="${SIFEN_NAMESPACE}">`,
        "      <dId>20240926</dId>",
        `      <xDE>${DE}</xDE>`,
        "    </rEnviDe>",
        "  </soap:Body>",
        "</soap:Envelope>",
        "",
      ].join("\n")
    );
  });

  it("keeps the signed DE's bytes exactly, so its signature stays valid", () => {
    const xml = serializeReception({ dId: "1", deXml: DE });
    expect(xml).toContain(DE);
    expect(xml).toContain(`<DE Id="${FIXTURE_CDC}">`);
    // The QR is the DE's longest text value, and the builder escapes its `&`; the
    // serializer must move it, not re-encode it.
    const qrLine = DE.split("\n").find((line) => line.includes("<dCarQR>")) ?? "";
    expect(qrLine).toContain("&amp;");
    expect(xml).toContain(qrLine);
    expect(xml).not.toContain("&lt;rDE");
  });

  it("asserts the document is the one our builder produced, before embedding it", () => {
    expect(failureOf(() => serializeReception({ dId: "1", deXml: "<rDEs/>" }))).toBe(
      "UNEXPECTED_DOCUMENT_ROOT"
    );
    expect(failureOf(() => serializeReception({ dId: "1", deXml: " \n<rDE/>" }))).toBe(
      "UNEXPECTED_DOCUMENT_ROOT"
    );
    expect(failureOf(() => serializeReception({ dId: "1", deXml: "<Signature/>" }))).toBe(
      "UNEXPECTED_DOCUMENT_ROOT"
    );
    expect(() => serializeReception({ dId: "1", deXml: "<rDE/>" })).not.toThrow();
  });

  it("keeps a fifteen-digit control number a string", () => {
    const dId = "901234567890123";
    const xml = serializeReception({ dId, deXml: DE });
    expect(xml).toContain(`<dId>${dId}</dId>`);
    expect(dId.length).toBe(15);
  });

  it("refuses a dId outside its domain rather than escaping it into the message", () => {
    for (const dId of ["", "0", "000000000000000", "9".repeat(16), "1e5", "<script>"]) {
      expect(failureOf(() => serializeReception({ dId, deXml: DE }))).toBe("INVALID_ID");
    }
  });
});

describe("the batch container", () => {
  it("wraps the DEs in rLoteDE, in the namespace §23.4 decides", () => {
    expect(buildBatchContainer([DE, OTHER_DE])).toBe(
      `<rLoteDE xmlns="${SIFEN_BATCH_CONTAINER_NAMESPACE}">\n${DE}${OTHER_DE}</rLoteDE>\n`
    );
    expect(SIFEN_BATCH_CONTAINER_NAMESPACE).toBe(SIFEN_NAMESPACE);
  });

  it("adds nothing between two documents, so no signed byte moves", () => {
    const container = buildBatchContainer([DE, OTHER_DE]);
    expect(container.indexOf(DE)).toBe(container.indexOf("<rDE"));
    expect(container.indexOf(OTHER_DE)).toBeGreaterThan(container.indexOf(DE));
  });

  it("refuses an empty batch and more than fifty documents", () => {
    // §23.7: "hasta 50 documentos", and its blocking rule punishes empty lots.
    expect(failureOf(() => buildBatchContainer([]))).toBe("INVALID_BATCH_SIZE");
    expect(buildBatchContainer([DE])).toContain(DE);
    expect(
      buildBatchContainer(Array.from({ length: SIFEN_BATCH_MAX_DOCUMENTS }, () => DE))
    ).toContain(DE);
    expect(
      failureOf(() =>
        buildBatchContainer(Array.from({ length: SIFEN_BATCH_MAX_DOCUMENTS + 1 }, () => DE))
      )
    ).toBe("INVALID_BATCH_SIZE");
    expect(SIFEN_BATCH_MAX_DOCUMENTS).toBe(50);
  });

  it("refuses a document that is not an rDE, naming its position", () => {
    expect(failureOf(() => buildBatchContainer([DE, "<Signature/>"]))).toBe(
      "UNEXPECTED_DOCUMENT_ROOT"
    );
  });
});

describe("the batch reception compresses the container into xDE", () => {
  it("carries the base64 of a one-entry ZIP holding exactly the container", () => {
    const xml = serializeBatchReception({ dId: "20240926", deXmls: [DE, OTHER_DE] });
    const base64 = /<xDE>([^<]+)<\/xDE>/.exec(xml)?.[1];
    expect(base64).toBeDefined();
    expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    const entries = unzipSync(Buffer.from(base64 ?? "", "base64"));
    expect(Object.keys(entries)).toEqual([SIFEN_ZIP_ENTRY_NAME]);
    const container = buildBatchContainer([DE, OTHER_DE]);
    expect(strFromU8(entries[SIFEN_ZIP_ENTRY_NAME])).toBe(container);
  });

  it("round-trips the whole request: one entry, and the DEs inside it unchanged", () => {
    const xml = serializeBatchReception({ dId: "1", deXmls: [DE] });
    const base64 = /<xDE>([^<]+)<\/xDE>/.exec(xml)?.[1] ?? "";
    const entries = unzipSync(Buffer.from(base64, "base64"));
    const container = strFromU8(entries[SIFEN_ZIP_ENTRY_NAME]);
    expect(container.startsWith(`<rLoteDE xmlns="${SIFEN_NAMESPACE}">`)).toBe(true);
    expect(container).toContain(DE);
    expect(xml).toContain(`<rEnvioLote xmlns="${SIFEN_NAMESPACE}">`);
    expect(xml).not.toContain("<rLoteDE");
  });

  it("names the ZIP entry with a single constant, because §23.8 leaves it unpinned", () => {
    expect(typeof SIFEN_ZIP_ENTRY_NAME).toBe("string");
    expect(SIFEN_ZIP_ENTRY_NAME.length).toBeGreaterThan(0);
  });

  it("refuses a batch it could not legitimately send", () => {
    expect(failureOf(() => serializeBatchReception({ dId: "1", deXmls: [] }))).toBe(
      "INVALID_BATCH_SIZE"
    );
    expect(SIFEN_MAX_REQUEST_BYTES).toBe(1000 * 1024);
  });

  it("refuses a batch whose base64 payload exceeds §23.7's 1000 KB", () => {
    // "El mensaje de datos de entrada del WS no debe superar 1000 KB": the bound is
    // enforced on the payload this module produces, and a batch that exceeds it has
    // to be split by the caller rather than sent.
    const oversized = `<rDE>${incompressible(1_100_000)}</rDE>`;
    expect(failureOf(() => serializeBatchReception({ dId: "1", deXmls: [oversized] }))).toBe(
      "REQUEST_TOO_LARGE"
    );
  });
});

describe("the batch query carries one reference, and one is required", () => {
  it("emits the batch number when it has one", () => {
    const batchNumber = "9999999999999999999999999999";
    const xml = serializeBatchQuery({ dId: "1", dProtConsLote: batchNumber });
    expect(xml).toContain(`<dProtConsLote>${batchNumber}</dProtConsLote>`);
    expect(xml).not.toContain("<dCDC>");
    expect(batchNumber.length).toBe(28);
  });

  it("emits the CDC when the batch number was lost, §23.7's recovery path", () => {
    const xml = serializeBatchQuery({ dId: "1", dCDC: FIXTURE_CDC });
    expect(xml).toContain(`<dCDC>${FIXTURE_CDC}</dCDC>`);
    expect(xml).toContain(`<rEnviConsLoteDe xmlns="${SIFEN_NAMESPACE}">`);
  });

  it("emits both, in the schema's order, when the caller supplies both", () => {
    const xml = serializeBatchQuery({
      dId: "1",
      dProtConsLote: "1",
      dCDC: FIXTURE_CDC,
    });
    expect(xml.indexOf("<dProtConsLote>")).toBeLessThan(xml.indexOf("<dCDC>"));
  });

  it("refuses a request carrying neither reference", () => {
    expect(failureOf(() => serializeBatchQuery({ dId: "1" }))).toBe("MISSING_BATCH_REFERENCE");
  });

  it("refuses a batch number that is not a decimal of at most 28 digits", () => {
    expect(failureOf(() => serializeBatchQuery({ dId: "1", dProtConsLote: "9".repeat(29) }))).toBe(
      "INVALID_BATCH_NUMBER"
    );
    for (const value of ["", "1e28", "-1", "1.5"]) {
      expect(failureOf(() => serializeBatchQuery({ dId: "1", dProtConsLote: value }))).toBe(
        "INVALID_BATCH_NUMBER"
      );
    }
  });
});

describe("the two consultations, §23.6", () => {
  it("emits the artifact's element names, not the Manual's", () => {
    const cdc = serializeCdcQuery({ dId: "1", dCDC: FIXTURE_CDC });
    expect(cdc).toContain(`<rEnviConsDeRequest xmlns="${SIFEN_NAMESPACE}">`);
    expect(cdc).not.toContain("<rEnviConsDe>");
    const ruc = serializeRucQuery({ dId: "1", dRUCCons: "80012345" });
    expect(ruc).toContain(`<rEnviConsRUC xmlns="${SIFEN_NAMESPACE}">`);
  });

  it("carries no signature, which §23.6 is explicit about", () => {
    for (const xml of [
      serializeCdcQuery({ dId: "1", dCDC: FIXTURE_CDC }),
      serializeRucQuery({ dId: "1", dRUCCons: "80012345" }),
    ]) {
      expect(xml).not.toContain("Signature");
      expect(xml).not.toContain("xmldsig");
    }
  });

  it("validates the CDC against tCDC and the RUC against tRuc", () => {
    expect(failureOf(() => serializeCdcQuery({ dId: "1", dCDC: FIXTURE_CDC.slice(0, 43) }))).toBe(
      "INVALID_CDC"
    );
    expect(failureOf(() => serializeCdcQuery({ dId: "1", dCDC: `${FIXTURE_CDC}0` }))).toBe(
      "INVALID_CDC"
    );
    for (const dRUCCons of ["8001", "800123456", "08001234", "8001234a"]) {
      expect(failureOf(() => serializeRucQuery({ dId: "1", dRUCCons }))).toBe("INVALID_RUC");
    }
    for (const dRUCCons of ["80012345", "18001", "8001234A"]) {
      expect(serializeRucQuery({ dId: "1", dRUCCons })).toContain(
        `<dRUCCons>${dRUCCons}</dRUCCons>`
      );
    }
  });
});

describe("the event reception embeds the event document as a child element", () => {
  const EVENT = '<rGesEve xmlns="http://ekuatia.set.gov.py/sifen/xsd"><rEve Id="1"/></rGesEve>';

  it("emits rEnviEventoDe with dEvReg holding the document verbatim", () => {
    const xml = serializeEventReception({ dId: "1", eventXml: EVENT });
    expect(xml).toBe(
      [
        SOAP_OPEN,
        "  <soap:Header/>",
        "  <soap:Body>",
        `    <rEnviEventoDe xmlns="${SIFEN_NAMESPACE}">`,
        "      <dId>1</dId>",
        `      <dEvReg>${EVENT}</dEvReg>`,
        "    </rEnviEventoDe>",
        "  </soap:Body>",
        "</soap:Envelope>",
        "",
      ].join("\n")
    );
    expect(xml).not.toContain("&lt;rGesEve");
  });

  it("asserts the event's root, which §23.3 pins only as the group's element", () => {
    expect(failureOf(() => serializeEventReception({ dId: "1", eventXml: "<rEve/>" }))).toBe(
      "UNEXPECTED_DOCUMENT_ROOT"
    );
    expect(failureOf(() => serializeEventReception({ dId: "1", eventXml: "" }))).toBe(
      "UNEXPECTED_DOCUMENT_ROOT"
    );
  });
});
