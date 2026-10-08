/**
 * FISC-010 WU-B — the protocol's shape vocabulary.
 *
 * Two things are worth testing in a module that is mostly types, and both are
 * here: the constants and patterns that pin the field domains (§23.3, §23.4,
 * §23.6 — the CDC's `tCDC`, the RUC's `tRuc`, `dId`'s 15 digits, the result
 * code's four), and the fact that the six shapes are buildable exactly as the
 * sources describe them.
 */

import { describe, expect, it } from "vitest";
import {
  SIFEN_BASE64_PATTERN,
  SIFEN_BATCH_NUMBER_PATTERN,
  SIFEN_CDC_LENGTH,
  SIFEN_CDC_PATTERN,
  SIFEN_ID_PATTERN,
  SIFEN_MAX_ID_DIGITS,
  SIFEN_NAMESPACE,
  SIFEN_RESULT_CODE_PATTERN,
  SIFEN_RUC_ELECTRONIC_VALUES,
  SIFEN_RUC_MAX_LENGTH,
  SIFEN_RUC_MIN_LENGTH,
  SIFEN_RUC_PATTERN,
  SIFEN_SOAP_BODY,
  SIFEN_SOAP_ENVELOPE,
  SIFEN_SOAP_HEADER,
  SOAP_ENVELOPE_NAMESPACE,
  type SifenBatchQueryResponse,
  type SifenBatchReceptionResponse,
  type SifenCdcQueryResponse,
  type SifenEventReceptionResponse,
  type SifenReceptionResponse,
  type SifenRucQueryResponse,
} from "./sifen.messages.js";

/** The specimen CDC the baseline records for the KuDE's 44 digits (§22.9). */
const CDC = `01${"1234567A"}${"0".repeat(34)}`;

describe("the namespaces and the envelope's element names", () => {
  it("pins the two namespaces §23.4's example carries", () => {
    expect(SIFEN_NAMESPACE).toBe("http://ekuatia.set.gov.py/sifen/xsd");
    expect(SOAP_ENVELOPE_NAMESPACE).toBe("http://www.w3.org/2003/05/soap-envelope");
  });

  it("spells the envelope elements once, for both halves of the layer", () => {
    expect(SIFEN_SOAP_ENVELOPE).toBe("Envelope");
    expect(SIFEN_SOAP_HEADER).toBe("Header");
    expect(SIFEN_SOAP_BODY).toBe("Body");
  });
});

describe("dId, the control number", () => {
  it("accepts one to fifteen digits and refuses anything else", () => {
    expect(SIFEN_ID_PATTERN.test("1")).toBe(true);
    expect(SIFEN_ID_PATTERN.test("20240926")).toBe(true);
    expect(SIFEN_ID_PATTERN.test("9".repeat(SIFEN_MAX_ID_DIGITS))).toBe(true);
  });

  it("refuses a sixteenth digit, a sign, a letter and an empty value", () => {
    expect(SIFEN_ID_PATTERN.test("9".repeat(SIFEN_MAX_ID_DIGITS + 1))).toBe(false);
    expect(SIFEN_ID_PATTERN.test("+1")).toBe(false);
    expect(SIFEN_ID_PATTERN.test("1e5")).toBe(false);
    expect(SIFEN_ID_PATTERN.test("")).toBe(false);
  });

  it("refuses an all-zero control number, which §23.4's range excludes", () => {
    // §23.3's `totalDigits 15` alone would admit it; §23.4 gives the batch's
    // range as 1..999999999999999 and §9.2.1 calls the field a sequential
    // counter, so it is refused by name rather than emitted.
    expect(SIFEN_ID_PATTERN.test("0")).toBe(false);
    expect(SIFEN_ID_PATTERN.test("000000000000000")).toBe(false);
    expect(SIFEN_ID_PATTERN.test("000000000000001")).toBe(true);
  });
});

describe("tCDC, §23.6", () => {
  it("accepts a 44-character CDC whose check digit is A-D", () => {
    expect(CDC).toHaveLength(SIFEN_CDC_LENGTH);
    expect(SIFEN_CDC_PATTERN.test(CDC)).toBe(true);
    for (const checkDigit of ["0", "9", "A", "D"]) {
      expect(SIFEN_CDC_PATTERN.test(`01${"1234567"}${checkDigit}${"0".repeat(34)}`)).toBe(true);
    }
  });

  it("refuses a wrong length, a lowercase letter and E", () => {
    expect(SIFEN_CDC_PATTERN.test(CDC.slice(0, 43))).toBe(false);
    expect(SIFEN_CDC_PATTERN.test(`${CDC}0`)).toBe(false);
    // The alphabet is [0-9A-D], not hexadecimal: E is malformed.
    expect(SIFEN_CDC_PATTERN.test(`01${"1234567"}E${"0".repeat(34)}`)).toBe(false);
    expect(SIFEN_CDC_PATTERN.test(`01${"1234567"}a${"0".repeat(34)}`)).toBe(false);
  });
});

describe("tRuc, §23.6", () => {
  it("accepts five to eight characters without a leading zero", () => {
    for (const ruc of ["80012345", "8001234", "1800123", "18001", "8001234A", "8001234D"]) {
      expect(SIFEN_RUC_PATTERN.test(ruc)).toBe(true);
    }
  });

  it("refuses a leading zero and lowercase, which the pattern itself rules out", () => {
    expect(SIFEN_RUC_PATTERN.test("09999")).toBe(false);
    expect(SIFEN_RUC_PATTERN.test("8001234a")).toBe(false);
  });

  it("leaves the length to the width §23.6 states, which is a second rule", () => {
    // `tRuc` is "5..8" AND a pattern; the pattern carries no length, so both rules
    // travel together wherever a RUC is read or written — and both are asserted
    // where that happens, in the serializer's and the parser's suites.
    expect(SIFEN_RUC_MIN_LENGTH).toBe(5);
    expect(SIFEN_RUC_MAX_LENGTH).toBe(8);
    expect(SIFEN_RUC_PATTERN.test("8001")).toBe(true);
    expect(SIFEN_RUC_PATTERN.test("800123456")).toBe(true);
  });

  it("pins the one-character S/N domain of dRUCFactElec", () => {
    expect(SIFEN_RUC_ELECTRONIC_VALUES).toEqual(["S", "N"]);
  });
});

describe("the remaining domains", () => {
  it("requires a result code to be four digits", () => {
    expect(SIFEN_RESULT_CODE_PATTERN.test("0300")).toBe(true);
    for (const code of ["300", "03000", "", "0300 ", "0A00"]) {
      expect(SIFEN_RESULT_CODE_PATTERN.test(code)).toBe(false);
    }
  });

  it("accepts a 28-digit batch number and refuses a 29th digit", () => {
    expect(SIFEN_BATCH_NUMBER_PATTERN.test("9".repeat(28))).toBe(true);
    expect(SIFEN_BATCH_NUMBER_PATTERN.test("9".repeat(29))).toBe(false);
    expect(SIFEN_BATCH_NUMBER_PATTERN.test("1e28")).toBe(false);
  });

  it("checks base64 for dDigVal, in the padded lexical space xs:base64Binary has", () => {
    expect(SIFEN_BASE64_PATTERN.test("QUJDREVGRw==")).toBe(true);
    expect(SIFEN_BASE64_PATTERN.test("")).toBe(true);
    expect(SIFEN_BASE64_PATTERN.test("QUJDREVGRw")).toBe(false);
    expect(SIFEN_BASE64_PATTERN.test("QUJDREVGRw=")).toBe(false);
    expect(SIFEN_BASE64_PATTERN.test("<not base64>")).toBe(false);
  });

  it("declares every pattern stateless, so a shared constant carries no lastIndex", () => {
    for (const pattern of [
      SIFEN_ID_PATTERN,
      SIFEN_CDC_PATTERN,
      SIFEN_RUC_PATTERN,
      SIFEN_RESULT_CODE_PATTERN,
      SIFEN_BATCH_NUMBER_PATTERN,
      SIFEN_BASE64_PATTERN,
    ]) {
      expect(pattern.global).toBe(false);
      expect(pattern.sticky).toBe(false);
      // Two calls in a row must answer the same question.
      const first = pattern.test("9999");
      expect(pattern.test("9999")).toBe(first);
    }
  });
});

describe("the six shapes are buildable as the sources describe them", () => {
  it("declares the reception response's protocol fields with their optionality", () => {
    const response: SifenReceptionResponse = {
      protocol: {
        cdc: CDC,
        dFecProc: "2026-10-08T12:00:00-03:00",
        dDigVal: "QUJDREVGRw==",
        dEstRes: "Aprobado",
        dProtAut: "0123456789",
        gResProc: [{ dCodRes: "0300", dMsgRes: "Lote recibido" }],
      },
    };
    // `dFecProc` is the only member §23.3 marks REQUIRED, and the parser test
    // refuses a protocol that arrives without it; every other member carries
    // `undefined` rather than being absent, because the reader builds each field.
    const withoutCodes: SifenReceptionResponse = {
      protocol: {
        cdc: undefined,
        dFecProc: "2026-10-08T12:00:00",
        dDigVal: undefined,
        dEstRes: undefined,
        dProtAut: undefined,
        gResProc: [],
      },
    };
    expect(response.protocol.cdc).toBe(CDC);
    expect(withoutCodes.protocol.dEstRes).toBeUndefined();
  });

  it("declares the batch reception, which keeps every number a string", () => {
    const response: SifenBatchReceptionResponse = {
      dFecProc: "2026-10-08T12:00:00-03:00",
      dCodRes: "0300",
      dMsgRes: "Lote recibido con éxito",
      dProtConsLote: "9999999999999999999999999999",
      dTpoProces: "1",
    };
    expect(typeof response.dProtConsLote).toBe("string");
  });

  it("declares the batch query's two levels of groups", () => {
    const response: SifenBatchQueryResponse = {
      dFecProc: "2026-10-08T12:00:00-03:00",
      dCodResLot: "0362",
      dMsgResLot: "Lote procesado",
      gResProcLote: [
        {
          cdc: CDC,
          dEstRes: "Aprobado con observación",
          dProtAut: "0123456789",
          gResProc: [{ dCodRes: "0300", dMsgRes: "ok" }],
        },
      ],
    };
    expect(response.gResProcLote[0].gResProc).toHaveLength(1);
  });

  it("declares the two consultations, whose requests carry no signature", () => {
    const cdc: SifenCdcQueryResponse = {
      dFecProc: "2026-10-08T12:00:00-03:00",
      dCodRes: "0422",
      dMsgRes: "CDC encontrado",
      xContenDE: { deXml: "<rDE/>", dProtAut: "0123456789", wrappedInContainer: false },
    };
    const ruc: SifenRucQueryResponse = {
      dCodRes: "0502",
      dMsgRes: "RUC encontrado",
      xContRUC: {
        dRUCCons: "80012345",
        dRazCons: "RAZON SOCIAL",
        dCodEstCons: "001",
        dDesEstCons: "ACTIVO",
        dRUCFactElec: "S",
      },
    };
    expect(cdc.xContenDE?.dProtAut).toBe("0123456789");
    expect(ruc.xContRUC?.dRUCFactElec).toBe("S");
  });

  it("declares the event reception, whose group is 1..15", () => {
    const response: SifenEventReceptionResponse = {
      dFecProc: "2026-10-08T12:00:00-03:00",
      gResProcEVe: [{ id: "1", dEstRes: "Aprobado", dProtAut: "0123456789", gResProc: [] }],
    };
    expect(response.gResProcEVe).toHaveLength(1);
  });
});
