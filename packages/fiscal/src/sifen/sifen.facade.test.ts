/**
 * FISC-010 WU-E — the facade, with the transport injected.
 *
 * No network here: the transport is a local double, so what this suite can
 * assert is exactly what the facade is responsible for — **which endpoint each
 * service is bound to**, **the envelope each one posts**, **that the credential
 * is read once per call and never held**, and **that the failures underneath it
 * travel out unchanged**. The TLS handshake itself is `sifen.transport.test.ts`'s
 * subject and the message shapes are `sifen.parser.test.ts`'s.
 *
 * The transport is a `vi.fn`, so what it received is asserted on the mock's own
 * record rather than on anything this suite reconstructs.
 */

import { describe, expect, it, vi, type Mock } from "vitest";

import { buildDteXml } from "../dte/dte.builder.js";
import { FIXTURE_CDC, validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import type {
  FiscalCredentialPort,
  FiscalSigningEnvironment,
  FiscalTransportCredential,
} from "../fiscal-credential.port.js";
import {
  SIFEN_SERVICE_PATHS,
  SifenFacadeError,
  createSifenServiceFacade,
  type SifenServiceFacade,
} from "./sifen.facade.js";
import { SifenParseError } from "./sifen.parser.js";
import { SifenSerializationError } from "./sifen.serializer.js";
import {
  SIFEN_ENVIRONMENT_HOSTS,
  SIFEN_SOAP_CONTENT_TYPE,
  sendSifenRequest,
  SifenTransportError,
  type SendSifenRequestArgs,
  type SifenTransportResponse,
} from "./sifen.transport.js";

const SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";
const SOAP_ENVELOPE_OPEN = '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">';

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ENVIRONMENT: FiscalSigningEnvironment = "TEST";
const BASE_URL = "https://sifen-test.set.gov.py";
const D_ID = "20261008";
const CDC = FIXTURE_CDC;
const BATCH_NUMBER = "9999999999999999999999999999";
const RUC = "80012345";
const CLOCK = new Date("2026-10-08T15:00:00.000Z");

const DE_XML = buildDteXml(validFacturaElectronicaRequest());
const DE_ELEMENT = DE_XML.trimEnd();
const EVENT_XML = `<rGesEve xmlns="${SIFEN_NS}"><gGroupGesEve><rGesEve/></gGroupGesEve></rGesEve>`;

const CREDENTIAL: FiscalTransportCredential = {
  certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2027-01-01T00:00:00.000Z"),
};

const OTHER_CREDENTIAL: FiscalTransportCredential = {
  ...CREDENTIAL,
  certificatePem: "-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----\n",
};

function envelope(body: string): string {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Header/><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

function sifen(element: string, inner: string): string {
  return `<${element} xmlns="${SIFEN_NS}">${inner}</${element}>`;
}

const RECEPTION_BODY = envelope(
  sifen(
    "rRetEnviDe",
    [
      `<rProtDe Id="${CDC}">`,
      "<dFecProc>2026-10-08T12:00:00-03:00</dFecProc>",
      "<dEstRes>Aprobado con observación</dEstRes>",
      "<dProtAut>0123456789</dProtAut>",
      "<gResProc><dCodRes>0300</dCodRes><dMsgRes>RUC del receptor inactivo</dMsgRes></gResProc>",
      "</rProtDe>",
    ].join("")
  )
);

const BATCH_RECEPTION_BODY = envelope(
  sifen(
    "rResEnviLoteDe",
    [
      "<dFecProc>2026-10-08T12:05:00-03:00</dFecProc>",
      "<dCodRes>0300</dCodRes>",
      "<dMsgRes>Lote recibido con éxito</dMsgRes>",
      `<dProtConsLote>${BATCH_NUMBER}</dProtConsLote>`,
      "<dTpoProces>1</dTpoProces>",
    ].join("")
  )
);

const BATCH_QUERY_BODY = envelope(
  sifen(
    "rResEnviConsLoteDe",
    [
      "<dFecProc>2026-10-08T12:15:00-03:00</dFecProc>",
      "<dCodResLot>0362</dCodResLot>",
      "<dMsgResLot>Lote procesado</dMsgResLot>",
      `<gResProcLote id="${CDC}">`,
      "<dEstRes>Aprobado</dEstRes>",
      "<dProtAut>0123456789</dProtAut>",
      "<gResProc><dCodRes>0300</dCodRes><dMsgRes>ok</dMsgRes></gResProc>",
      "</gResProcLote>",
    ].join("")
  )
);

const CDC_QUERY_BODY = envelope(
  sifen(
    "rEnviConsDeResponse",
    [
      "<dFecProc>2026-10-08T16:00:00-03:00</dFecProc>",
      "<dCodRes>0422</dCodRes>",
      "<dMsgRes>CDC encontrado</dMsgRes>",
      `<xContenDE>${DE_ELEMENT}</xContenDE>`,
    ].join("")
  )
);

const RUC_QUERY_BODY = envelope(
  sifen(
    "rResEnviConsRUC",
    [
      "<dCodRes>0502</dCodRes>",
      "<dMsgRes>RUC encontrado</dMsgRes>",
      "<xContRUC>",
      `<dRUCCons>${RUC}</dRUCCons>`,
      "<dRazCons>EMPRESA DE PRUEBA S.A.</dRazCons>",
      "<dCodEstCons>001</dCodEstCons>",
      "<dDesEstCons>ACTIVO</dDesEstCons>",
      "<dRUCFactElec>S</dRUCFactElec>",
      "</xContRUC>",
    ].join("")
  )
);

const EVENT_BODY = envelope(
  sifen(
    "rRetEnviEventoDe",
    [
      "<dFecProc>2026-10-08T17:00:00-03:00</dFecProc>",
      "<gResProcEVe>",
      `<id>${CDC}</id>`,
      "<dEstRes>Aprobado</dEstRes>",
      "<dProtAut>0123456789</dProtAut>",
      "<gResProc><dCodRes>0300</dCodRes><dMsgRes>ok</dMsgRes></gResProc>",
      "</gResProcEVe>",
    ].join("")
  )
);

function soapResponse(body: string): SifenTransportResponse {
  return { statusCode: 200, contentType: SIFEN_SOAP_CONTENT_TYPE, location: undefined, body };
}

/** The injected transport: a `vi.fn` the facade posts through instead of the network. */
function respondingTransport(body: string): Mock<typeof sendSifenRequest> {
  return vi.fn((_args: SendSifenRequestArgs): Promise<SifenTransportResponse> => {
    return Promise.resolve(soapResponse(body));
  });
}

/** A transport that answers by endpoint, for the tests that make two calls. */
function routedTransport(bodies: Readonly<Record<string, string>>): Mock<typeof sendSifenRequest> {
  return vi.fn((args: SendSifenRequestArgs): Promise<SifenTransportResponse> => {
    const body = bodies[args.endpoint];
    if (body === undefined) {
      return Promise.reject(new Error(`No fixture for ${args.endpoint}`));
    }
    return Promise.resolve(soapResponse(body));
  });
}

/** A transport that fails, with the error the facade must pass through. */
function failingTransport(error: Error): Mock<typeof sendSifenRequest> {
  return vi.fn((_args: SendSifenRequestArgs): Promise<SifenTransportResponse> => {
    return Promise.reject(error);
  });
}

/**
 * The credential port, in line: a `vi.fn` that answers the given credentials in
 * order, repeating the last one.
 */
function credentialRead(
  ...credentials: readonly (FiscalTransportCredential | null)[]
): Mock<FiscalCredentialPort["read"]> {
  const read = vi.fn<FiscalCredentialPort["read"]>();
  for (const credential of credentials) {
    read.mockResolvedValueOnce(credential);
  }
  const last = credentials[credentials.length - 1];
  read.mockResolvedValue(last ?? null);
  return read;
}

interface FacadeOptions {
  readonly baseUrl?: string;
  readonly read?: Mock<FiscalCredentialPort["read"]>;
  readonly transport?: Mock<typeof sendSifenRequest>;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly caPem?: readonly string[];
  readonly signal?: AbortSignal;
}

function buildFacade(options: FacadeOptions = {}): SifenServiceFacade {
  return createSifenServiceFacade({
    credentialPort: { read: options.read ?? credentialRead(CREDENTIAL) },
    environment: ENVIRONMENT,
    baseUrl: options.baseUrl ?? BASE_URL,
    transport: options.transport ?? respondingTransport(RECEPTION_BODY),
    now: options.now ?? ((): Date => CLOCK),
    timeoutMs: options.timeoutMs,
    caPem: options.caPem,
    signal: options.signal,
  });
}

function transportArgs(transport: Mock<typeof sendSifenRequest>, index = 0): SendSifenRequestArgs {
  const call = transport.mock.calls[index];
  if (call === undefined) {
    throw new Error(`The transport was not called ${String(index + 1)} time(s).`);
  }
  return call[0];
}

/** The rejection, without a `try`/`catch` at every call site. */
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("The call was expected to fail and did not.");
}

function asFacadeError(error: unknown): SifenFacadeError {
  if (!(error instanceof SifenFacadeError)) {
    throw new Error(`Expected a SifenFacadeError, received ${String(error)}`);
  }
  return error;
}

function asParseError(error: unknown): SifenParseError {
  if (!(error instanceof SifenParseError)) {
    throw new Error(`Expected a SifenParseError, received ${String(error)}`);
  }
  return error;
}

function asSerializationError(error: unknown): SifenSerializationError {
  if (!(error instanceof SifenSerializationError)) {
    throw new Error(`Expected a SifenSerializationError, received ${String(error)}`);
  }
  return error;
}

interface FacadeCase {
  readonly name: string;
  readonly path: string;
  readonly requestElement: string;
  readonly body: string;
  readonly expected: unknown;
  readonly invoke: (facade: SifenServiceFacade) => Promise<unknown>;
}

const FACADE_CASES: readonly FacadeCase[] = [
  {
    name: "receiveDe",
    path: SIFEN_SERVICE_PATHS.receiveDe,
    requestElement: "<rEnviDe",
    body: RECEPTION_BODY,
    expected: {
      protocol: {
        cdc: CDC,
        dFecProc: "2026-10-08T12:00:00-03:00",
        dEstRes: "Aprobado con observación",
        dProtAut: "0123456789",
        gResProc: [{ dCodRes: "0300", dMsgRes: "RUC del receptor inactivo" }],
      },
    },
    invoke: (facade) => facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: DE_XML }),
  },
  {
    name: "receiveBatch",
    path: SIFEN_SERVICE_PATHS.receiveBatch,
    requestElement: "<rEnvioLote",
    body: BATCH_RECEPTION_BODY,
    expected: {
      dFecProc: "2026-10-08T12:05:00-03:00",
      dCodRes: "0300",
      dMsgRes: "Lote recibido con éxito",
      dProtConsLote: BATCH_NUMBER,
      dTpoProces: "1",
    },
    invoke: (facade) =>
      facade.receiveBatch({ tenantId: TENANT_A, dId: D_ID, deXmls: [DE_XML, DE_XML] }),
  },
  {
    name: "queryBatch",
    path: SIFEN_SERVICE_PATHS.queryBatch,
    requestElement: "<rEnviConsLoteDe",
    body: BATCH_QUERY_BODY,
    expected: {
      dFecProc: "2026-10-08T12:15:00-03:00",
      dCodResLot: "0362",
      dMsgResLot: "Lote procesado",
      gResProcLote: [
        {
          cdc: CDC,
          dEstRes: "Aprobado",
          dProtAut: "0123456789",
          gResProc: [{ dCodRes: "0300", dMsgRes: "ok" }],
        },
      ],
    },
    invoke: (facade) =>
      facade.queryBatch({ tenantId: TENANT_A, dId: D_ID, dProtConsLote: BATCH_NUMBER }),
  },
  {
    name: "queryDe",
    path: SIFEN_SERVICE_PATHS.queryDe,
    requestElement: "<rEnviConsDeRequest",
    body: CDC_QUERY_BODY,
    expected: {
      dFecProc: "2026-10-08T16:00:00-03:00",
      dCodRes: "0422",
      dMsgRes: "CDC encontrado",
      xContenDE: { deXml: DE_ELEMENT, dProtAut: undefined, wrappedInContainer: false },
    },
    invoke: (facade) => facade.queryDe({ tenantId: TENANT_A, dId: D_ID, dCDC: CDC }),
  },
  {
    name: "queryRuc",
    path: SIFEN_SERVICE_PATHS.queryRuc,
    requestElement: "<rEnviConsRUC",
    body: RUC_QUERY_BODY,
    expected: {
      dCodRes: "0502",
      dMsgRes: "RUC encontrado",
      xContRUC: {
        dRUCCons: RUC,
        dRazCons: "EMPRESA DE PRUEBA S.A.",
        dCodEstCons: "001",
        dDesEstCons: "ACTIVO",
        dRUCFactElec: "S",
      },
    },
    invoke: (facade) => facade.queryRuc({ tenantId: TENANT_A, dId: D_ID, dRUCCons: RUC }),
  },
  {
    name: "receiveEvent",
    path: SIFEN_SERVICE_PATHS.receiveEvent,
    requestElement: "<rEnviEventoDe",
    body: EVENT_BODY,
    expected: {
      dFecProc: "2026-10-08T17:00:00-03:00",
      gResProcEVe: [
        {
          id: CDC,
          dEstRes: "Aprobado",
          dProtAut: "0123456789",
          gResProc: [{ dCodRes: "0300", dMsgRes: "ok" }],
        },
      ],
    },
    invoke: (facade) => facade.receiveEvent({ tenantId: TENANT_A, dId: D_ID, eventXml: EVENT_XML }),
  },
];

describe("SIFEN_SERVICE_PATHS", () => {
  it("is baseline §8's table and nothing else", () => {
    expect(SIFEN_SERVICE_PATHS).toEqual({
      receiveDe: "/de/ws/sync/recibe.wsdl",
      receiveBatch: "/de/ws/async/recibe-lote.wsdl",
      queryBatch: "/de/ws/consultas/consulta-lote.wsdl",
      queryDe: "/de/ws/consultas/consulta.wsdl",
      queryRuc: "/de/ws/consultas/consulta-ruc.wsdl",
      receiveEvent: "/de/ws/eventos/evento.wsdl",
    });
  });

  it("is frozen, so a service path cannot be rewritten at runtime", () => {
    expect(Object.isFrozen(SIFEN_SERVICE_PATHS)).toBe(true);
  });
});

describe("createSifenServiceFacade", () => {
  it.each(FACADE_CASES)(
    "$name posts to its §8 endpoint and returns the parsed answer",
    async (row) => {
      const transport = respondingTransport(row.body);
      const facade = buildFacade({ transport });

      const result = await row.invoke(facade);

      expect(transport).toHaveBeenCalledTimes(1);
      const args = transportArgs(transport);
      expect(args.endpoint).toBe(`${BASE_URL}${row.path}`);
      expect(args.envelope.startsWith(SOAP_ENVELOPE_OPEN)).toBe(true);
      expect(args.envelope.trimEnd().endsWith("</soap:Envelope>")).toBe(true);
      expect(args.envelope).toContain(row.requestElement);
      expect(args.credential).toBe(CREDENTIAL);
      expect(args.now).toEqual(CLOCK);
      expect(result).toEqual(row.expected);
    }
  );

  it("resolves the endpoint against the environment's host when no base URL is given", async () => {
    for (const environment of ["TEST", "PRODUCTION"] as const) {
      const transport = respondingTransport(RECEPTION_BODY);
      // Built without `baseUrl` on purpose: this is the deployment's path.
      const facade = createSifenServiceFacade({
        credentialPort: { read: credentialRead(CREDENTIAL) },
        environment,
        transport,
        now: () => CLOCK,
      });

      await facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: DE_XML });

      expect(transportArgs(transport).endpoint).toBe(
        `${SIFEN_ENVIRONMENT_HOSTS[environment]}${SIFEN_SERVICE_PATHS.receiveDe}`
      );
    }
  });

  it("reads the credential once per call, with the tenant and the environment", async () => {
    const read = credentialRead(CREDENTIAL, OTHER_CREDENTIAL);
    const transport = routedTransport({
      [`${BASE_URL}${SIFEN_SERVICE_PATHS.receiveDe}`]: RECEPTION_BODY,
      [`${BASE_URL}${SIFEN_SERVICE_PATHS.queryRuc}`]: RUC_QUERY_BODY,
    });
    const facade = buildFacade({ read, transport });

    expect(read, "construction reads no credential").not.toHaveBeenCalled();

    await facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: DE_XML });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenNthCalledWith(1, {
      tenantId: TENANT_A,
      environment: ENVIRONMENT,
    });

    await facade.queryRuc({ tenantId: TENANT_B, dId: D_ID, dRUCCons: RUC });
    // ADR-008 §2: a second call reads again and does not reuse the first read.
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(2, {
      tenantId: TENANT_B,
      environment: ENVIRONMENT,
    });

    // The credential is a parameter of the call, never a field: each call
    // authenticates with the material it just read.
    expect(transportArgs(transport, 0).credential).toBe(CREDENTIAL);
    expect(transportArgs(transport, 1).credential).toBe(OTHER_CREDENTIAL);
  });

  it("fails CREDENTIAL_UNAVAILABLE without building an envelope when the read is null", async () => {
    const read = credentialRead(null);
    const transport = respondingTransport(RECEPTION_BODY);
    // An input the serializer would refuse: the credential is checked first, so
    // the refusal that surfaces is the credential's and not the input's.
    const facade = buildFacade({ read, transport });

    const error = await failureOf(
      facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: "not a DE" })
    );

    expect(asFacadeError(error).failure).toBe("CREDENTIAL_UNAVAILABLE");
    expect(transport).not.toHaveBeenCalled();
  });

  it("passes the transport's typed failure through unchanged", async () => {
    const transportError = new SifenTransportError(
      "REDIRECT_NOT_ALLOWED",
      "SIFEN answered with a redirect, which is never followed.",
      { statusCode: 302, location: "/vdesk/hangup.php3" }
    );
    const transport = failingTransport(transportError);
    const facade = buildFacade({ transport });

    const error = await failureOf(
      facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: DE_XML })
    );

    expect(error).toBe(transportError);
    expect(error).toMatchObject({
      failure: "REDIRECT_NOT_ALLOWED",
      statusCode: 302,
      location: "/vdesk/hangup.php3",
    });
    expect(error).not.toBeInstanceOf(SifenFacadeError);
  });

  it.each([
    {
      name: "a body that is not a SOAP envelope",
      body: "<rRetEnviDe/>",
      failure: "MISSING_ELEMENT",
    },
    {
      name: "a body carrying a document type declaration",
      body: "<!DOCTYPE r><rRetEnviDe/>",
      failure: "DOCTYPE_FORBIDDEN",
    },
  ])("passes the parser's typed failure through unchanged for $name", async (row) => {
    const transport = respondingTransport(row.body);
    const facade = buildFacade({ transport });

    const error = await failureOf(
      facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: DE_XML })
    );

    expect(error).toBeInstanceOf(SifenParseError);
    expect(error).not.toBeInstanceOf(SifenFacadeError);
    expect(asParseError(error).failure).toBe(row.failure);
  });

  it("passes a serialization refusal through unchanged", async () => {
    const transport = respondingTransport(RECEPTION_BODY);
    const facade = buildFacade({ transport });

    const error = await failureOf(
      facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: "<rDE-other/>" })
    );

    expect(error).toBeInstanceOf(SifenSerializationError);
    expect(asSerializationError(error).failure).toBe("UNEXPECTED_DOCUMENT_ROOT");
    expect(transport).not.toHaveBeenCalled();
  });

  it("passes the timeout, the trust anchors and the signal to the transport", async () => {
    const caPem = ["-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"];
    const controller = new AbortController();
    const transport = respondingTransport(RECEPTION_BODY);
    const facade = buildFacade({
      transport,
      timeoutMs: 1234,
      caPem,
      signal: controller.signal,
    });

    await facade.receiveDe({ tenantId: TENANT_A, dId: D_ID, signedDteXml: DE_XML });

    const args = transportArgs(transport);
    expect(args.timeoutMs).toBe(1234);
    expect(args.caPem).toBe(caPem);
    expect(args.signal).toBe(controller.signal);
  });
});
