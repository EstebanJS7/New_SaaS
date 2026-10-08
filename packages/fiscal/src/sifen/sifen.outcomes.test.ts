/**
 * FISC-010 WU-E — SIFEN's answers, mapped.
 *
 * Table-driven on purpose: every row of the Story's outcome table is a case
 * here, and the fixtures are **parsed answers** (the types `sifen.messages.ts`
 * declares) because that is what these functions take. Parsing itself is
 * `sifen.parser.test.ts`'s subject; this suite asserts what the mapping does
 * with what a parser produced.
 *
 * Three properties are asserted in more than one place because they are the ones
 * a later reader is most likely to break: the observation of an
 * `Aprobado con observación` surviving into `reason`, an unlisted but
 * well-formed code being carried rather than coerced, and every field of the
 * port's result being present with `null` where the answer is silent.
 */

import { describe, expect, it } from "vitest";

import { buildDteXml } from "../dte/dte.builder.js";
import { FIXTURE_CDC, validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import type {
  FiscalIssueOutcome,
  FiscalIssueResult,
  FiscalQueryResult,
} from "../fiscal-provider.port.js";
import { SIFEN_BATCH_POLL_INTERVAL_MS, type SifenEstadoResultado } from "./sifen.codes.js";
import type {
  SifenBatchQueryDeResult,
  SifenBatchQueryResponse,
  SifenBatchReceptionResponse,
  SifenCdcQueryResponse,
  SifenDeContent,
  SifenProcessingProtocol,
  SifenRucQueryResponse,
  SifenRucStatus,
} from "./sifen.messages.js";
import {
  mapBatchQueryOutcome,
  mapBatchReceptionOutcome,
  mapCdcQueryOutcome,
  mapReceptionOutcome,
  mapRucQueryOutcome,
  SIFEN_BATCH_CONCLUDED_WITHOUT_RESULTS_REASON,
  SIFEN_BATCH_RECEPTION_MESSAGE_ABSENT_REASON,
  SIFEN_BATCH_WINDOW_CLOSED_REASON,
  SIFEN_OBSERVATION_UNSTATED_REASON,
  SIFEN_RECEPTION_FATE_ABSENT_REASON,
  SIFEN_RECEPTION_MESSAGE_ABSENT_REASON,
  type SifenOutcomeContext,
} from "./sifen.outcomes.js";

/** §22.9's specimen CDC, which `tCDC` admits. */
const CDC = FIXTURE_CDC;

/** A second CDC, for the cases that need two identities at once. */
const OTHER_CDC = `02${"1234567A"}${"0".repeat(34)}`;

/** §23.4's 28-digit batch number, which never survives a `number`. */
const BATCH_NUMBER = "9999999999999999999999999999";

const PROTOCOL_NUMBER = "0123456789";

/**
 * The DE this package actually produces, which is what a `0422` answer carries.
 * Its `<DE Id>` is `FIXTURE_CDC` (§4: the attribute is required, and it is the
 * CDC).
 */
const DE_ELEMENT = buildDteXml(validFacturaElectronicaRequest()).trimEnd();

const PROVIDER_REQUEST = Object.freeze({ endpoint: "/de/ws/sync/recibe.wsdl" });
const PROVIDER_RESPONSE = Object.freeze({ arrivedAs: "application/soap+xml" });
const RESOLVED_AT = "2026-10-08T15:30:00.000Z";

/** The context on every call: the snapshots travel raw and are only echoed. */
function context(): SifenOutcomeContext {
  return {
    providerRequest: PROVIDER_REQUEST,
    providerResponse: PROVIDER_RESPONSE,
    resolvedAt: RESOLVED_AT,
  };
}

function expectContextCarried(result: FiscalIssueResult | FiscalQueryResult): void {
  expect(result.providerRequest).toBe(PROVIDER_REQUEST);
  expect(result.providerResponse).toBe(PROVIDER_RESPONSE);
  expect(result.resolvedAt).toBe(RESOLVED_AT);
}

const ISSUE_RESULT_FIELDS = [
  "cdc",
  "externalId",
  "outcome",
  "providerReference",
  "providerRequest",
  "providerResponse",
  "reason",
  "reasonCode",
  "resolvedAt",
  "retryAfterMs",
];

const QUERY_RESULT_FIELDS = [
  "cdc",
  "externalId",
  "outcome",
  "providerRequest",
  "providerResponse",
  "reason",
  "reasonCode",
  "resolvedAt",
  "retryAfterMs",
];

function protocol(overrides: Partial<SifenProcessingProtocol> = {}): SifenProcessingProtocol {
  return {
    cdc: CDC,
    dFecProc: "2026-10-08T12:00:00-03:00",
    dDigVal: undefined,
    dEstRes: "Aprobado",
    dProtAut: PROTOCOL_NUMBER,
    gResProc: [],
    ...overrides,
  };
}

function batchReception(
  overrides: Partial<SifenBatchReceptionResponse> = {}
): SifenBatchReceptionResponse {
  return {
    dFecProc: "2026-10-08T12:05:00-03:00",
    dCodRes: "0300",
    dMsgRes: "Lote recibido con éxito",
    dProtConsLote: BATCH_NUMBER,
    dTpoProces: "1",
    ...overrides,
  };
}

function queryGroup(overrides: Partial<SifenBatchQueryDeResult> = {}): SifenBatchQueryDeResult {
  return {
    cdc: CDC,
    dEstRes: "Aprobado",
    dProtAut: PROTOCOL_NUMBER,
    gResProc: [{ dCodRes: "0300", dMsgRes: "ok" }],
    ...overrides,
  };
}

function batchQuery(overrides: Partial<SifenBatchQueryResponse> = {}): SifenBatchQueryResponse {
  return {
    dFecProc: "2026-10-08T12:15:00-03:00",
    dCodResLot: "0362",
    dMsgResLot: "Lote procesado",
    gResProcLote: [queryGroup()],
    ...overrides,
  };
}

function deContent(overrides: Partial<SifenDeContent> = {}): SifenDeContent {
  return {
    deXml: DE_ELEMENT,
    dProtAut: undefined,
    wrappedInContainer: false,
    ...overrides,
  };
}

function cdcQuery(overrides: Partial<SifenCdcQueryResponse> = {}): SifenCdcQueryResponse {
  return {
    dFecProc: "2026-10-08T16:00:00-03:00",
    dCodRes: "0422",
    dMsgRes: "CDC encontrado",
    xContenDE: deContent(),
    ...overrides,
  };
}

const RUC_STATUS: SifenRucStatus = {
  dRUCCons: "80012345",
  dRazCons: "EMPRESA DE PRUEBA S.A.",
  dCodEstCons: "001",
  dDesEstCons: "ACTIVO",
  dRUCFactElec: "S",
};

function rucQuery(overrides: Partial<SifenRucQueryResponse> = {}): SifenRucQueryResponse {
  return {
    dCodRes: "0502",
    dMsgRes: "RUC encontrado",
    xContRUC: RUC_STATUS,
    ...overrides,
  };
}

describe("mapReceptionOutcome", () => {
  interface ReceptionCase {
    readonly dEstRes: SifenEstadoResultado;
    readonly outcome: FiscalIssueOutcome;
    readonly message: string;
  }

  const CASES: readonly ReceptionCase[] = [
    { dEstRes: "Aprobado", outcome: "APPROVED", message: "Procesado con éxito" },
    {
      dEstRes: "Aprobado con observación",
      outcome: "APPROVED",
      message: "RUC del receptor inactivo",
    },
    { dEstRes: "Rechazado", outcome: "REJECTED", message: "XML malformado" },
  ];

  it.each(CASES)("maps dEstRes $dEstRes to $outcome", (row) => {
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({
        dEstRes: row.dEstRes,
        gResProc: [{ dCodRes: "0160", dMsgRes: row.message }],
      }),
    });

    expect(result.outcome).toBe(row.outcome);
    expect(result.reasonCode).toBe("0160");
    expect(result.reason).toBe(row.message);
    expect(result.cdc).toBe(CDC);
    expect(result.externalId).toBe(PROTOCOL_NUMBER);
    // A synchronous answer resolves the document: there is no operation handle
    // to poll and no wait to schedule.
    expect(result.providerReference).toBeNull();
    expect(result.retryAfterMs).toBeNull();
    expectContextCarried(result);
  });

  it("preserves an approval's observation in reason", () => {
    const observation = "Aprobado con observación: el emisor no es facturador electrónico";
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({
        dEstRes: "Aprobado con observación",
        gResProc: [{ dCodRes: "0422", dMsgRes: observation }],
      }),
    });

    expect(result.outcome).toBe("APPROVED");
    expect(result.reason).toContain(observation);
  });

  it("rejects an answer whose protocol never states the document's fate", () => {
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({ dEstRes: undefined, dProtAut: undefined, gResProc: [] }),
    });

    expect(result.outcome).toBe("FUNCTIONAL_REJECTION");
    expect(result.reason).toBe(SIFEN_RECEPTION_FATE_ABSENT_REASON);
    expect(result.externalId).toBeNull();
    expect(result.reasonCode).toBeNull();
  });

  it("keeps a message that arrived beside an absent dEstRes", () => {
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({
        dEstRes: undefined,
        gResProc: [{ dCodRes: "0160", dMsgRes: "XML malformado" }],
      }),
    });

    expect(result.outcome).toBe("FUNCTIONAL_REJECTION");
    expect(result.reason).toBe("XML malformado");
  });

  it("says an observation was left unstated when the status announced one", () => {
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({ dEstRes: "Aprobado con observación", gResProc: [] }),
    });

    expect(result.outcome).toBe("APPROVED");
    expect(result.reason).toBe(SIFEN_OBSERVATION_UNSTATED_REASON);
  });

  it("reports the absence of a message on a plain approval", () => {
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({ dEstRes: "Aprobado", gResProc: [] }),
    });

    expect(result.reason).toBe(SIFEN_RECEPTION_MESSAGE_ABSENT_REASON);
  });

  it("joins every dMsgRes and reports the first code the answer actually carries", () => {
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({
        dEstRes: "Aprobado con observación",
        gResProc: [
          { dCodRes: undefined, dMsgRes: "primera observación" },
          { dCodRes: "0300", dMsgRes: "segunda observación" },
        ],
      }),
    });

    expect(result.reasonCode).toBe("0300");
    expect(result.reason).toBe("primera observación; segunda observación");
  });

  it("carries an unlisted result code rather than coercing it", () => {
    // §23.8 item 7: the catalogue is open, and the Manual's own §10 example is
    // this code — which §23.7 does not list.
    const result = mapReceptionOutcome({
      ...context(),
      protocol: protocol({
        dEstRes: "Rechazado",
        gResProc: [{ dCodRes: "0160", dMsgRes: "XML malformado" }],
      }),
    });

    expect(result.outcome).toBe("REJECTED");
    expect(result.reasonCode).toBe("0160");
  });

  it("sets every field of the port's result", () => {
    const result = mapReceptionOutcome({ ...context(), protocol: protocol() });

    expect(Object.keys(result).sort()).toEqual(ISSUE_RESULT_FIELDS);
  });
});

describe("mapBatchReceptionOutcome", () => {
  it("maps 0300 to SUBMITTED with the batch number as the provider reference", () => {
    const result = mapBatchReceptionOutcome({ ...context(), response: batchReception() });

    expect(result.outcome).toBe("SUBMITTED");
    expect(result.providerReference).toBe(BATCH_NUMBER);
    expect(result.reasonCode).toBe("0300");
    expect(result.reason).toBe("Lote recibido con éxito");
    // The answer identifies an operation, never a document.
    expect(result.cdc).toBeNull();
    expect(result.externalId).toBeNull();
    expect(result.retryAfterMs).toBeNull();
    expectContextCarried(result);
  });

  it("maps a 0300 without a batch number to SUBMITTED anyway", () => {
    // §23.7's recovery rule exists for exactly this answer: the batch was
    // queued, the number was lost, and a CDC that travelled in the batch is
    // the fallback.
    const result = mapBatchReceptionOutcome({
      ...context(),
      response: batchReception({ dProtConsLote: undefined }),
    });

    expect(result.outcome).toBe("SUBMITTED");
    expect(result.providerReference).toBeNull();
  });

  it("maps 0301 to a functional rejection of the batch", () => {
    const result = mapBatchReceptionOutcome({
      ...context(),
      response: batchReception({
        dCodRes: "0301",
        dMsgRes: "Lote no encolado",
        dProtConsLote: undefined,
      }),
    });

    expect(result.outcome).toBe("FUNCTIONAL_REJECTION");
    expect(result.reasonCode).toBe("0301");
    expect(result.reason).toBe("Lote no encolado");
    expect(result.providerReference).toBeNull();
  });

  it("carries an unlisted batch code as the reason code", () => {
    const result = mapBatchReceptionOutcome({
      ...context(),
      response: batchReception({ dCodRes: "0399", dMsgRes: "código desconocido" }),
    });

    expect(result.outcome).toBe("FUNCTIONAL_REJECTION");
    expect(result.reasonCode).toBe("0399");
    expect(result.reason).toBe("código desconocido");
  });

  it("says so when the batch answer carries no message", () => {
    const result = mapBatchReceptionOutcome({
      ...context(),
      response: batchReception({ dCodRes: "0301", dMsgRes: undefined }),
    });

    expect(result.reason).toBe(SIFEN_BATCH_RECEPTION_MESSAGE_ABSENT_REASON);
  });

  it("sets every field of the port's result", () => {
    const result = mapBatchReceptionOutcome({ ...context(), response: batchReception() });

    expect(Object.keys(result).sort()).toEqual(ISSUE_RESULT_FIELDS);
  });
});

describe("mapBatchQueryOutcome", () => {
  it("maps 0360 to a terminal configuration error", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({ dCodResLot: "0360", dMsgResLot: "Número de lote inexistente" }),
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("0360");
    expect(result.reason).toBe("Número de lote inexistente");
    expect(result.cdc).toBeNull();
    expect(result.externalId).toBeNull();
    expect(result.retryAfterMs).toBeNull();
    expectContextCarried(result);
  });

  it("maps 0361 to PROCESSING carrying the Guide's ten minutes", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({ dCodResLot: "0361", dMsgResLot: "Lote en procesamiento" }),
    });

    expect(result.outcome).toBe("PROCESSING");
    expect(result.retryAfterMs).toBe(SIFEN_BATCH_POLL_INTERVAL_MS);
    expect(result.retryAfterMs).toBe(10 * 60 * 1000);
    expect(result.reasonCode).toBe("0361");
  });

  it.each([
    { dEstRes: "Aprobado", outcome: "APPROVED" },
    { dEstRes: "Aprobado con observación", outcome: "APPROVED" },
    { dEstRes: "Rechazado", outcome: "REJECTED" },
  ] as const)("maps a 0362 first group of $dEstRes to $outcome", (row) => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({
        gResProcLote: [
          queryGroup({
            dEstRes: row.dEstRes,
            cdc: CDC,
            dProtAut: PROTOCOL_NUMBER,
            gResProc: [{ dCodRes: "0300", dMsgRes: "resultado" }],
          }),
        ],
      }),
    });

    expect(result.outcome).toBe(row.outcome);
    expect(result.cdc).toBe(CDC);
    expect(result.externalId).toBe(PROTOCOL_NUMBER);
    expect(result.reasonCode).toBe("0300");
    expect(result.reason).toBe("resultado");
  });

  it("takes the first group's fate and identity when a 0362 carries several", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({
        gResProcLote: [
          queryGroup({ cdc: CDC, dEstRes: "Rechazado", dProtAut: "0000000001" }),
          queryGroup({ cdc: OTHER_CDC, dEstRes: "Aprobado", dProtAut: "0000000002" }),
        ],
      }),
    });

    expect(result.outcome).toBe("REJECTED");
    expect(result.cdc).toBe(CDC);
    expect(result.externalId).toBe("0000000001");
  });

  it("falls back to the batch's own message when the first group reports no code", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({
        dMsgResLot: "Procesamiento concluido",
        gResProcLote: [queryGroup({ gResProc: [] })],
      }),
    });

    expect(result.outcome).toBe("APPROVED");
    expect(result.reasonCode).toBe("0362");
    expect(result.reason).toBe("Procesamiento concluido");
  });

  it("refuses a concluded batch that reports no DE result", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({ gResProcLote: [] }),
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("0362");
    expect(result.reason).toBe(SIFEN_BATCH_CONCLUDED_WITHOUT_RESULTS_REASON);
    expect(result.cdc).toBeNull();
  });

  it("maps 0364 to the closed window and names the per-CDC fallback", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      // §23.7's own words for this code, which the mapping replaces on purpose.
      response: batchQuery({ dCodResLot: "0364", dMsgResLot: "Consulta extemporánea" }),
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("0364");
    expect(result.reason).toBe(SIFEN_BATCH_WINDOW_CLOSED_REASON);
    expect(result.reason).toContain("48");
    expect(result.cdc).toBeNull();
  });

  it("carries an unlisted batch-query code as the reason code", () => {
    const result = mapBatchQueryOutcome({
      ...context(),
      response: batchQuery({ dCodResLot: "0370", dMsgResLot: "código desconocido" }),
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("0370");
    expect(result.reason).toBe("código desconocido");
  });

  it("sets every field of the port's result", () => {
    const result = mapBatchQueryOutcome({ ...context(), response: batchQuery() });

    expect(Object.keys(result).sort()).toEqual(QUERY_RESULT_FIELDS);
  });
});

describe("mapCdcQueryOutcome", () => {
  it.each([
    { dCodRes: "0420", message: "CDC inexistente" },
    { dCodRes: "0421", message: "RUC del certificado sin permiso" },
  ])("maps $dCodRes to a terminal configuration error", (row) => {
    const result = mapCdcQueryOutcome({
      ...context(),
      response: cdcQuery({
        dCodRes: row.dCodRes,
        dMsgRes: row.message,
        xContenDE: undefined,
      }),
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe(row.dCodRes);
    expect(result.reason).toBe(row.message);
    expect(result.cdc).toBeNull();
    expect(result.externalId).toBeNull();
    expect(result.retryAfterMs).toBeNull();
    expectContextCarried(result);
  });

  it("maps 0422 to APPROVED with the DE's own CDC from the answer", () => {
    const result = mapCdcQueryOutcome({ ...context(), response: cdcQuery() });

    expect(result.outcome).toBe("APPROVED");
    expect(result.cdc).toBe(FIXTURE_CDC);
    expect(result.externalId).toBeNull();
    expect(result.reasonCode).toBe("0422");
    expect(result.reason).toBe("CDC encontrado");
    expect(result.retryAfterMs).toBeNull();
  });

  it("records the authorization protocol when the answer wrapped the DE in rContDe", () => {
    const result = mapCdcQueryOutcome({
      ...context(),
      response: cdcQuery({
        xContenDE: deContent({ dProtAut: PROTOCOL_NUMBER, wrappedInContainer: true }),
      }),
    });

    expect(result.outcome).toBe("APPROVED");
    expect(result.cdc).toBe(FIXTURE_CDC);
    expect(result.externalId).toBe(PROTOCOL_NUMBER);
  });

  it("approves without an identity when the answer carried no DE", () => {
    const result = mapCdcQueryOutcome({
      ...context(),
      response: cdcQuery({ xContenDE: undefined }),
    });

    expect(result.outcome).toBe("APPROVED");
    expect(result.cdc).toBeNull();
    expect(result.externalId).toBeNull();
  });

  it.each([
    {
      name: "a malformed Id",
      deXml: `<rDE xmlns="${"http://ekuatia.set.gov.py/sifen/xsd"}"><DE Id="not-a-cdc"></DE></rDE>`,
    },
    {
      name: "no Id at all",
      deXml: `<rDE xmlns="${"http://ekuatia.set.gov.py/sifen/xsd"}"><DE></DE></rDE>`,
    },
  ])("does not echo $name as the document's identity", (row) => {
    const result = mapCdcQueryOutcome({
      ...context(),
      response: cdcQuery({ xContenDE: deContent({ deXml: row.deXml }) }),
    });

    expect(result.outcome).toBe("APPROVED");
    expect(result.cdc).toBeNull();
  });

  it("carries an unlisted consultation code as the reason code", () => {
    const result = mapCdcQueryOutcome({
      ...context(),
      response: cdcQuery({ dCodRes: "0430", dMsgRes: "código desconocido", xContenDE: undefined }),
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("0430");
  });

  it("sets every field of the port's result", () => {
    const result = mapCdcQueryOutcome({ ...context(), response: cdcQuery() });

    expect(Object.keys(result).sort()).toEqual(QUERY_RESULT_FIELDS);
  });
});

describe("mapRucQueryOutcome", () => {
  it.each([
    { dCodRes: "0500", outcome: "notFound", message: "RUC no existe" },
    { dCodRes: "0501", outcome: "notAuthorized", message: "RUC sin permiso de consulta" },
  ])("maps $dCodRes to $outcome with no status", (row) => {
    const result = mapRucQueryOutcome({
      ...context(),
      response: rucQuery({ dCodRes: row.dCodRes, dMsgRes: row.message, xContRUC: undefined }),
    });

    expect(result.outcome).toBe(row.outcome);
    expect(result.dCodRes).toBe(row.dCodRes);
    expect(result.status).toBeUndefined();
  });

  it("maps 0502 to found with the container as the status", () => {
    const result = mapRucQueryOutcome({ ...context(), response: rucQuery() });

    expect(result.outcome).toBe("found");
    expect(result.dCodRes).toBe("0502");
    expect(result.status).toBe(RUC_STATUS);
  });

  it("reports found without a container when the answer sent none", () => {
    const result = mapRucQueryOutcome({
      ...context(),
      response: rucQuery({ xContRUC: undefined }),
    });

    expect(result.outcome).toBe("found");
    expect(result.status).toBeUndefined();
  });

  it("carries an unlisted RUC code as the raw code", () => {
    const result = mapRucQueryOutcome({
      ...context(),
      response: rucQuery({ dCodRes: "0599", dMsgRes: "código desconocido", xContRUC: undefined }),
    });

    expect(result.outcome).toBe("unknown");
    expect(result.dCodRes).toBe("0599");
    expect(result.status).toBeUndefined();
  });

  it("ignores a container that arrived beside a code that is not 0502", () => {
    const result = mapRucQueryOutcome({
      ...context(),
      response: rucQuery({ dCodRes: "0500", dMsgRes: "RUC no existe" }),
    });

    expect(result.outcome).toBe("notFound");
    expect(result.status).toBeUndefined();
  });

  it("keeps the container of a code outside Tabla H, which has no port outcome", () => {
    const result = mapRucQueryOutcome({
      ...context(),
      response: rucQuery({ dCodRes: "0599", dMsgRes: "código desconocido" }),
    });

    // The diagnostic has no raw-response field, so dropping the container here
    // would lose the answer's only payload.
    expect(result.outcome).toBe("unknown");
    expect(result.status).toBe(RUC_STATUS);
  });

  it("is SIFEN-semantic: the three fields, and no port result", () => {
    const result = mapRucQueryOutcome({ ...context(), response: rucQuery() });

    expect(Object.keys(result).sort()).toEqual(["dCodRes", "outcome", "status"]);
  });
});
