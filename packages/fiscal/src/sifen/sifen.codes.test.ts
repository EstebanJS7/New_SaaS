/**
 * FISC-010 WU-B — the result-code tables.
 *
 * The suite is written against the SOURCES, not the implementation: the codes
 * come from `SIFEN-BASELINE.md` §23.7 (the Guide's codes), §23.6 (the Manual's
 * Tabla G and Tabla H) and §10 (`dEstRes`'s three values), and the properties
 * asserted here are the ones §23.8's open question requires — a code nobody has
 * seen is carried and named `unknown`, never turned into an outcome.
 */

import { describe, expect, it } from "vitest";
import {
  SIFEN_BATCH_POLL_INTERVAL_MS,
  SIFEN_BATCH_QUERY_CODES,
  SIFEN_BATCH_QUERY_WINDOW_MS,
  SIFEN_BATCH_RECEPTION_CODES,
  SIFEN_CDC_QUERY_CODES,
  SIFEN_DE_STATUS_OUTCOMES,
  SIFEN_RUC_QUERY_CODES,
  describeBatchQuery,
  describeBatchReception,
  describeCdcQuery,
  describeDeStatus,
  describeRucQuery,
} from "./sifen.codes.js";
import { SIFEN_RESULT_CODE_WIDTH } from "./sifen.messages.js";

describe("dEstRes, the three values §10 publishes", () => {
  it("maps each published value to its outcome", () => {
    expect(describeDeStatus("Aprobado")).toEqual({
      outcome: "approved",
      dEstRes: "Aprobado",
    });
    expect(describeDeStatus("Aprobado con observación")).toEqual({
      outcome: "approved_with_observation",
      dEstRes: "Aprobado con observación",
    });
    expect(describeDeStatus("Rechazado")).toEqual({ outcome: "rejected", dEstRes: "Rechazado" });
  });

  it("preserves the observation rather than folding it into the outcome", () => {
    // §10 requires the observation to reach the caller; the descriptor's only job
    // is to say which approval it was.
    const descriptor = describeDeStatus("Aprobado con observación");
    expect(descriptor.outcome).toBe("approved_with_observation");
    expect(descriptor.dEstRes).toBe("Aprobado con observación");
    expect(descriptor.dEstRes).toContain("observación");
  });

  it("holds three values whose lengths fit §10's A, 8-30 column", () => {
    expect(SIFEN_DE_STATUS_OUTCOMES).toHaveLength(3);
    for (const entry of SIFEN_DE_STATUS_OUTCOMES) {
      expect(entry.dEstRes.length).toBeGreaterThanOrEqual(8);
      expect(entry.dEstRes.length).toBeLessThanOrEqual(30);
    }
  });

  it("matches case-sensitively, so the Guide's prose spelling is not a value", () => {
    // §23.7 quotes the Guide writing "Aprobado con Observación" with a capital O.
    // The Manual's field table, which is what the field carries, spells it with a
    // lowercase one — so this is `unknown` rather than silently the same value.
    expect(describeDeStatus("Aprobado con Observación").outcome).toBe("unknown");
    expect(describeDeStatus("APROBADO").outcome).toBe("unknown");
  });

  it("refuses to invent a status for anything else", () => {
    expect(describeDeStatus("")).toEqual({ outcome: "unknown", dEstRes: "" });
    expect(describeDeStatus("Pendiente").outcome).toBe("unknown");
  });
});

describe("the batch reception codes, §23.7", () => {
  it("carries the batch number a 0300 handed back", () => {
    const descriptor = describeBatchReception("0300", "9999999999999999999999999999");
    expect(descriptor).toEqual({
      outcome: "queued",
      dCodRes: "0300",
      dProtConsLote: "9999999999999999999999999999",
    });
  });

  it("keeps a 0300 without a batch number queued, because §23.7 has a path for it", () => {
    // "se puede consultar el lote con un CDC … solo en caso de no recibir el
    // Número de Lote": the code said queued, and the missing handle is a state the
    // caller has a recovery rule for.
    expect(describeBatchReception("0300", undefined)).toEqual({
      outcome: "queued",
      dCodRes: "0300",
      dProtConsLote: undefined,
    });
  });

  it("answers 0301 as the batch's own refusal", () => {
    // §23.7: "Lote no encolado para procesamiento, el lote NO será procesado" —
    // the batch, not the DE, which is why it is not a rejection outcome.
    expect(describeBatchReception("0301", undefined)).toEqual({
      outcome: "notQueued",
      dCodRes: "0301",
    });
    expect(describeBatchReception("0301", "1").outcome).toBe("notQueued");
  });
});

describe("the batch query codes, §23.7", () => {
  it("answers the Guide's four codes", () => {
    expect(describeBatchQuery("0360").outcome).toBe("unknownLot");
    expect(describeBatchQuery("0362").outcome).toBe("concluded");
    expect(describeBatchQuery("0364").outcome).toBe("windowClosed");
  });

  it("carries the Guide's ten minutes on 0361 and on nothing else", () => {
    expect(describeBatchQuery("0361")).toEqual({
      outcome: "processing",
      dCodResLot: "0361",
      retryAfterMs: 10 * 60 * 1000,
    });
    expect(SIFEN_BATCH_POLL_INTERVAL_MS).toBe(600_000);
    for (const code of ["0360", "0362", "0364", "9999"]) {
      expect(describeBatchQuery(code)).not.toHaveProperty("retryAfterMs");
    }
  });

  it("exports the window 0364 closes as the Guide's 48 hours", () => {
    expect(SIFEN_BATCH_QUERY_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });
});

describe("the two consultation tables, §23.6", () => {
  it("answers Tabla G for the CDC query", () => {
    expect(describeCdcQuery("0420").outcome).toBe("notFound");
    expect(describeCdcQuery("0421").outcome).toBe("notAuthorized");
    expect(describeCdcQuery("0422").outcome).toBe("found");
  });

  it("answers Tabla H for the RUC query", () => {
    expect(describeRucQuery("0500").outcome).toBe("notFound");
    expect(describeRucQuery("0501").outcome).toBe("notAuthorized");
    expect(describeRucQuery("0502").outcome).toBe("found");
  });

  it("keeps the two code spaces apart: one table never answers for the other", () => {
    for (const code of SIFEN_RUC_QUERY_CODES.map((entry) => entry.dCodRes)) {
      expect(describeCdcQuery(code).outcome).toBe("unknown");
    }
    for (const code of SIFEN_CDC_QUERY_CODES.map((entry) => entry.dCodRes)) {
      expect(describeRucQuery(code).outcome).toBe("unknown");
    }
  });

  it("carries the raw code on every descriptor, known or not", () => {
    expect(describeCdcQuery("0420")).toEqual({ outcome: "notFound", dCodRes: "0420" });
    expect(describeCdcQuery("0499")).toEqual({ outcome: "unknown", dCodRes: "0499" });
  });
});

describe("no code is ever coerced into an outcome", () => {
  const oddCodes = ["", "0", "300", "0300 ", " 0300", "03000", "ABC", "9999", "03601"];

  it("names an unrecognized code unknown, with the code it saw", () => {
    for (const code of oddCodes) {
      expect(describeBatchReception(code, undefined)).toEqual({
        outcome: "unknown",
        dCodRes: code,
      });
      expect(describeBatchQuery(code).outcome).toBe("unknown");
      expect(describeCdcQuery(code)).toEqual({ outcome: "unknown", dCodRes: code });
      expect(describeRucQuery(code)).toEqual({ outcome: "unknown", dCodRes: code });
    }
  });

  it("gives every table entry a code of the width §10 pins", () => {
    const codes = [
      ...SIFEN_BATCH_RECEPTION_CODES.map((entry) => entry.dCodRes),
      ...SIFEN_BATCH_QUERY_CODES.map((entry) => entry.dCodResLot),
      ...SIFEN_CDC_QUERY_CODES.map((entry) => entry.dCodRes),
      ...SIFEN_RUC_QUERY_CODES.map((entry) => entry.dCodRes),
    ];
    expect(SIFEN_RESULT_CODE_WIDTH).toBe(4);
    for (const code of codes) {
      expect(code).toHaveLength(SIFEN_RESULT_CODE_WIDTH);
      expect(code).toMatch(/^[0-9]{4}$/);
    }
  });

  it("holds each table's codes exactly as §23.6 and §23.7 record them", () => {
    expect(SIFEN_BATCH_RECEPTION_CODES.map((entry) => entry.dCodRes)).toEqual(["0300", "0301"]);
    expect(SIFEN_BATCH_QUERY_CODES.map((entry) => entry.dCodResLot)).toEqual([
      "0360",
      "0361",
      "0362",
      "0364",
    ]);
    expect(SIFEN_CDC_QUERY_CODES.map((entry) => entry.dCodRes)).toEqual(["0420", "0421", "0422"]);
    expect(SIFEN_RUC_QUERY_CODES.map((entry) => entry.dCodRes)).toEqual(["0500", "0501", "0502"]);
  });
});
