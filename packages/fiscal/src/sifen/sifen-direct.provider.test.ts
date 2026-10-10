/**
 * FISC-012 WU-E — the provider, with the transport injected.
 *
 * The same double convention as `sifen.facade.test.ts`: a `vi.fn` transport and
 * a `vi.fn` credential port, so what is asserted is the **serialized envelope**
 * the facade posted and the provider's answer over it — never a network call.
 *
 * Two things this suite exists to pin:
 *
 * 1. **The failure partition, member by member.** The facade lets
 *    `SifenTransportError`, `SifenParseError` and `SifenFacadeError` travel out
 *    unmapped by design, so this adapter is the only place they become terminal
 *    or retryable. The table below asserts every transport member and the
 *    facade's single member, because a wrong partition is a retry loop or a
 *    stranded document.
 * 2. **The descriptor snapshots.** ADR-009 makes the request carry the document,
 *    so the snapshot must be a descriptor — the CDC, the service, the byte count
 *    — and the signed XML must not appear anywhere in the result.
 */

import { describe, expect, it, vi, type Mock } from "vitest";

import { FIXTURE_CDC } from "../dte/dte.fixture.js";
import type {
  FiscalCredentialPort,
  FiscalSigningEnvironment,
  FiscalTransportCredential,
} from "../fiscal-credential.port.js";
import { sanitizeProviderSnapshot } from "../fiscal-snapshot.sanitizer.js";
import type {
  FiscalIssueDocument,
  FiscalIssueOutcome,
  FiscalIssueRequest,
  FiscalProviderPort,
  FiscalQueryRequest,
} from "../fiscal-provider.port.js";
import { isRetryableOutcome } from "../fiscal-provider.port.js";
import {
  createSifenDirectFiscalProvider,
  SIFEN_DIRECT_CANCELLATION_UNPROFILED_REASON_CODE,
  SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE,
  SIFEN_DIRECT_QUERY_IDENTITY_MISSING_REASON_CODE,
  SIFEN_DIRECT_UNMAPPED_FAILURE_REASON_CODE,
} from "./sifen-direct.provider.js";
import { SIFEN_BATCH_POLL_INTERVAL_MS } from "./sifen.codes.js";
import { createSifenServiceFacade } from "./sifen.facade.js";
import { SIFEN_ID_PATTERN } from "./sifen.messages.js";
import {
  sendSifenRequest,
  SIFEN_SOAP_CONTENT_TYPE,
  SifenTransportError,
  type SendSifenRequestArgs,
  type SifenTransportFailure,
  type SifenTransportResponse,
} from "./sifen.transport.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const ENVIRONMENT: FiscalSigningEnvironment = "TEST";
const BASE_URL = "https://sifen-test.set.gov.py";
const D_ID = "20261008";
const CDC = FIXTURE_CDC;
const BATCH_NUMBER = "9999999999999999999999999999";
const AUTHORIZATION_PROTOCOL = "0123456789";
const CLOCK = new Date("2026-10-08T15:00:00.000Z");
const SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";

/**
 * The document, with a marker a snapshot must never contain. Its `<DE Id>` is
 * the CDC, which is what a `0422` answer's CDC is read from.
 */
const DOCUMENT_MARKER = "MARKER-INSIDE-THE-SIGNED-DOCUMENT";
const SIGNED_XML =
  `<rDE xmlns="${SIFEN_NS}"><DE Id="${CDC}"><dVerFor>150</dVerFor>` +
  `<marker>${DOCUMENT_MARKER}</marker></DE></rDE>`;
const XML_BYTES = Buffer.byteLength(SIGNED_XML, "utf8");
const SIGNED_DOCUMENT: FiscalIssueDocument = { cdc: CDC, signedXml: SIGNED_XML };

const CREDENTIAL: FiscalTransportCredential = {
  certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2027-01-01T00:00:00.000Z"),
};

function envelope(body: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap:Header/><soap:Body>${body}</soap:Body></soap:Envelope>`
  );
}

function sifen(element: string, inner: string): string {
  return `<${element} xmlns="${SIFEN_NS}">${inner}</${element}>`;
}

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

const BATCH_QUERY_CONCLUDED_BODY = envelope(
  sifen(
    "rResEnviConsLoteDe",
    [
      "<dFecProc>2026-10-08T12:15:00-03:00</dFecProc>",
      "<dCodResLot>0362</dCodResLot>",
      "<dMsgResLot>Lote procesado</dMsgResLot>",
      `<gResProcLote id="${CDC}">`,
      "<dEstRes>Aprobado</dEstRes>",
      `<dProtAut>${AUTHORIZATION_PROTOCOL}</dProtAut>`,
      "<gResProc><dCodRes>0300</dCodRes><dMsgRes>ok</dMsgRes></gResProc>",
      "</gResProcLote>",
    ].join("")
  )
);

const BATCH_QUERY_PROCESSING_BODY = envelope(
  sifen(
    "rResEnviConsLoteDe",
    [
      "<dFecProc>2026-10-08T12:15:00-03:00</dFecProc>",
      "<dCodResLot>0361</dCodResLot>",
      "<dMsgResLot>En proceso</dMsgResLot>",
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
      `<xContenDE>${SIGNED_XML}</xContenDE>`,
    ].join("")
  )
);

/** A body the parser refuses before it ever looks for a response root. */
const UNPARSEABLE_BODY = "<rRetEnviDe/>";

function soapResponse(body: string): SifenTransportResponse {
  return { statusCode: 200, contentType: SIFEN_SOAP_CONTENT_TYPE, location: undefined, body };
}

/** The injected transport: a `vi.fn` the facade posts through instead of the network. */
function respondingTransport(body: string): Mock<typeof sendSifenRequest> {
  return vi.fn((_args: SendSifenRequestArgs): Promise<SifenTransportResponse> => {
    return Promise.resolve(soapResponse(body));
  });
}

/** A transport that fails with the typed error the adapter must partition. */
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

interface ProviderHarness {
  readonly provider: FiscalProviderPort;
  readonly transport: Mock<typeof sendSifenRequest>;
  readonly read: Mock<FiscalCredentialPort["read"]>;
}

interface ProviderOptions {
  readonly body?: string;
  readonly read?: Mock<FiscalCredentialPort["read"]>;
  readonly transport?: Mock<typeof sendSifenRequest>;
  readonly controlNumber?: () => string;
  readonly now?: () => Date;
}

function buildProvider(options: ProviderOptions = {}): ProviderHarness {
  const read = options.read ?? credentialRead(CREDENTIAL);
  const transport = options.transport ?? respondingTransport(options.body ?? BATCH_RECEPTION_BODY);
  const facade = createSifenServiceFacade({
    credentialPort: { read },
    environment: ENVIRONMENT,
    baseUrl: BASE_URL,
    transport,
    now: () => CLOCK,
  });
  const provider = createSifenDirectFiscalProvider({
    facade,
    controlNumber: options.controlNumber ?? (() => D_ID),
    now: options.now ?? (() => CLOCK),
  });
  return { provider, transport, read };
}

function transportArgs(transport: Mock<typeof sendSifenRequest>, index = 0): SendSifenRequestArgs {
  const call = transport.mock.calls[index];
  if (call === undefined) {
    throw new Error(`The transport was not called ${String(index + 1)} time(s).`);
  }
  return call[0];
}

function issueRequest(document: FiscalIssueDocument | null): FiscalIssueRequest {
  return {
    fiscalDocumentId: "document-1",
    tenantId: TENANT_A,
    provider: "SIFEN_DIRECT",
    document,
    invoice: { series: "A", number: 1, currency: "PYG", issuedAt: "2026-10-08T15:00:00.000Z" },
    lines: [],
    totals: { taxableBase: "0", taxAmount: "0", total: "0" },
  };
}

function queryRequest(overrides: Partial<FiscalQueryRequest> = {}): FiscalQueryRequest {
  return {
    fiscalDocumentId: "document-1",
    tenantId: TENANT_A,
    provider: "SIFEN_DIRECT",
    cdc: CDC,
    externalId: null,
    providerReference: null,
    ...overrides,
  };
}

describe("createSifenDirectFiscalProvider", () => {
  it("declares SIFEN_DIRECT and that it requires a signed document (ADR-009)", () => {
    const { provider } = buildProvider();
    expect(provider.provider).toBe("SIFEN_DIRECT");
    expect(provider.requiresSignedDocument).toBe(true);
  });

  it("issues a lot of one through the asynchronous reception and answers SUBMITTED", async () => {
    const { provider, transport, read } = buildProvider({ body: BATCH_RECEPTION_BODY });

    expect(read, "construction reads no credential").not.toHaveBeenCalled();

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(transport).toHaveBeenCalledTimes(1);
    const args = transportArgs(transport);
    expect(args.endpoint).toBe(`${BASE_URL}/de/ws/async/recibe-lote.wsdl`);
    expect(args.envelope).toContain("<rEnvioLote");
    expect(args.envelope).toContain(`<dId>${D_ID}</dId>`);
    // ADR-008 §2: the credential is read per call inside the facade, never held.
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ tenantId: TENANT_A, environment: ENVIRONMENT });

    expect(result).toEqual({
      outcome: "SUBMITTED",
      externalId: null,
      providerReference: BATCH_NUMBER,
      cdc: CDC,
      reasonCode: "0300",
      reason: "Lote recibido con éxito",
      retryAfterMs: null,
      providerRequest: {
        provider: "SIFEN_DIRECT",
        service: "receiveBatch",
        cdc: CDC,
        xmlBytes: XML_BYTES,
      },
      providerResponse: {
        provider: "SIFEN_DIRECT",
        service: "receiveBatch",
        statusCode: "0300",
        message: "Lote recibido con éxito",
      },
      resolvedAt: CLOCK.toISOString(),
    });
  });

  it("keeps SUBMITTED and the document's CDC when the lot number was not received", async () => {
    // ADR-007 §2's recovery case: the hand-over answer arrived without the
    // handle, so the CDC is the only identity the reconciliation will have.
    const body = envelope(
      sifen(
        "rResEnviLoteDe",
        [
          "<dFecProc>2026-10-08T12:05:00-03:00</dFecProc>",
          "<dCodRes>0300</dCodRes>",
          "<dMsgRes>Lote recibido con éxito</dMsgRes>",
        ].join("")
      )
    );
    const { provider } = buildProvider({ body });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(result.outcome).toBe("SUBMITTED");
    expect(result.providerReference).toBeNull();
    expect(result.cdc).toBe(CDC);
  });

  it("answers CONFIGURATION_ERROR without a facade call when the request carries no document", async () => {
    const { provider, transport, read } = buildProvider();

    const result = await provider.issue(issueRequest(null));

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe(SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE);
    expect(result.reason).toContain("document");
    expect(result.cdc).toBeNull();
    expect(result.providerRequest).toBeNull();
    expect(result.providerResponse).toBeNull();
    expect(isRetryableOutcome(result.outcome)).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("takes resolvedAt from the injected clock", async () => {
    const resolved = new Date("2026-10-08T18:30:00.000Z");
    const { provider } = buildProvider({ now: () => resolved });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(result.resolvedAt).toBe(resolved.toISOString());
  });

  it("draws one control number per envelope, from the injected source", async () => {
    const controlNumber = vi.fn(() => D_ID);
    const { provider, transport } = buildProvider({ controlNumber });

    await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(controlNumber).toHaveBeenCalledTimes(1);
    expect(transportArgs(transport).envelope).toContain(`<dId>${D_ID}</dId>`);
  });

  it("generates a 15-digit control number that SIFEN_ID_PATTERN accepts", async () => {
    const transport = respondingTransport(BATCH_RECEPTION_BODY);
    // Built without the injection on purpose: this is the default path.
    const provider = createSifenDirectFiscalProvider({
      facade: createSifenServiceFacade({
        credentialPort: { read: credentialRead(CREDENTIAL) },
        environment: ENVIRONMENT,
        baseUrl: BASE_URL,
        transport,
        now: () => CLOCK,
      }),
    });

    await provider.issue(issueRequest(SIGNED_DOCUMENT));

    const match = /<dId>([0-9]+)<\/dId>/.exec(transportArgs(transport).envelope);
    expect(match).not.toBeNull();
    const dId = match?.[1] ?? "";
    expect(dId).toHaveLength(15);
    expect(SIFEN_ID_PATTERN.test(dId)).toBe(true);
  });
});

describe("query", () => {
  it("asks the batch service with the operation handle and returns its resolution", async () => {
    const { provider, transport } = buildProvider({ body: BATCH_QUERY_CONCLUDED_BODY });

    const result = await provider.query(queryRequest({ providerReference: BATCH_NUMBER }));

    expect(transport).toHaveBeenCalledTimes(1);
    const args = transportArgs(transport);
    expect(args.endpoint).toBe(`${BASE_URL}/de/ws/consultas/consulta-lote.wsdl`);
    expect(args.envelope).toContain("<rEnviConsLoteDe");
    expect(args.envelope).toContain(`<dProtConsLote>${BATCH_NUMBER}</dProtConsLote>`);

    expect(result).toEqual({
      outcome: "APPROVED",
      cdc: CDC,
      externalId: AUTHORIZATION_PROTOCOL,
      reasonCode: "0300",
      reason: "ok",
      retryAfterMs: null,
      providerRequest: {
        provider: "SIFEN_DIRECT",
        service: "queryBatch",
        cdc: CDC,
        xmlBytes: null,
      },
      providerResponse: {
        provider: "SIFEN_DIRECT",
        service: "queryBatch",
        statusCode: "0362",
        message: "Lote procesado",
      },
      resolvedAt: CLOCK.toISOString(),
    });
  });

  it("asks the per-CDC consultation when only the document's identity is known", async () => {
    const { provider, transport } = buildProvider({ body: CDC_QUERY_BODY });

    const result = await provider.query(queryRequest());

    expect(transport).toHaveBeenCalledTimes(1);
    const args = transportArgs(transport);
    expect(args.endpoint).toBe(`${BASE_URL}/de/ws/consultas/consulta.wsdl`);
    expect(args.envelope).toContain("<rEnviConsDeRequest");
    expect(args.envelope).toContain(`<dCDC>${CDC}</dCDC>`);

    expect(result.outcome).toBe("APPROVED");
    expect(result.cdc).toBe(CDC);
    expect(result.externalId).toBeNull();
    // ADR-009's descriptor rule: the answer's body carried the whole DE, and
    // neither the result nor its snapshot carries a byte of it.
    expect(JSON.stringify(result)).not.toContain(DOCUMENT_MARKER);
  });

  it("answers CONFIGURATION_ERROR without a facade call when the query has no identity", async () => {
    const { provider, transport, read } = buildProvider();

    const result = await provider.query(queryRequest({ cdc: null }));

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe(SIFEN_DIRECT_QUERY_IDENTITY_MISSING_REASON_CODE);
    expect(result.cdc).toBeNull();
    expect(result.providerRequest).toBeNull();
    expect(transport).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("passes PROCESSING through with its retry hint and resolves nothing (ADR-007 §5)", async () => {
    const { provider } = buildProvider({ body: BATCH_QUERY_PROCESSING_BODY });

    const result = await provider.query(queryRequest({ providerReference: BATCH_NUMBER }));

    expect(result.outcome).toBe("PROCESSING");
    expect(result.retryAfterMs).toBe(SIFEN_BATCH_POLL_INTERVAL_MS);
    expect(result.cdc).toBeNull();
    expect(result.externalId).toBeNull();
  });

  it("maps a query's transport failure with the same partition as issue", async () => {
    const { provider } = buildProvider({
      transport: failingTransport(
        new SifenTransportError("TIMEOUT", "SIFEN did not answer within the request timeout.")
      ),
    });

    const result = await provider.query(queryRequest({ providerReference: BATCH_NUMBER }));

    expect(result.outcome).toBe("TRANSIENT_FAILURE");
    expect(result.reasonCode).toBe("TIMEOUT");
    expect(result.cdc).toBeNull();
  });
});

describe("cancel", () => {
  it("fails closed because the cancellation event's payload is unprofiled (§23.3)", async () => {
    const { provider, transport, read } = buildProvider();

    const result = await provider.cancel({
      fiscalDocumentId: "document-1",
      tenantId: TENANT_A,
      provider: "SIFEN_DIRECT",
      reason: "Operator request",
      externalId: null,
      cdc: CDC,
    });

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe(SIFEN_DIRECT_CANCELLATION_UNPROFILED_REASON_CODE);
    // The reason names the missing profile and does not claim a SIFEN state.
    expect(result.reason).toContain("§23.3");
    expect(result.reason).toContain("Nothing was sent to SIFEN");
    expect(isRetryableOutcome(result.outcome)).toBe(false);
    expect(result.providerRequest).toBeNull();
    expect(result.providerResponse).toBeNull();
    expect(transport).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("the failure partition", () => {
  interface TransportCase {
    readonly failure: SifenTransportFailure;
    readonly outcome: FiscalIssueOutcome;
  }

  /**
   * Every member of `SifenTransportFailure`, and the outcome it becomes. The
   * implementation's own `Record<SifenTransportFailure, …>` makes the table
   * exhaustive at compile time; this one pins the values.
   */
  const TRANSPORT_CASES: readonly TransportCase[] = [
    { failure: "INVALID_ENDPOINT", outcome: "CONFIGURATION_ERROR" },
    { failure: "CREDENTIAL_EXPIRED", outcome: "CONFIGURATION_ERROR" },
    { failure: "CREDENTIAL_NOT_YET_VALID", outcome: "CONFIGURATION_ERROR" },
    { failure: "TLS_FAILURE", outcome: "CONFIGURATION_ERROR" },
    { failure: "NETWORK_FAILURE", outcome: "TRANSIENT_FAILURE" },
    { failure: "TIMEOUT", outcome: "TRANSIENT_FAILURE" },
    { failure: "ABORTED", outcome: "TRANSIENT_FAILURE" },
    { failure: "REDIRECT_NOT_ALLOWED", outcome: "CONFIGURATION_ERROR" },
    { failure: "RESPONSE_TOO_LARGE", outcome: "CONFIGURATION_ERROR" },
  ];

  it("covers all nine transport members", () => {
    expect(TRANSPORT_CASES).toHaveLength(9);
  });

  it.each(TRANSPORT_CASES)("maps $failure to $outcome", async (row) => {
    const message = `Transport failure: ${row.failure}`;
    const { provider, transport } = buildProvider({
      transport: failingTransport(new SifenTransportError(row.failure, message)),
    });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(result.outcome).toBe(row.outcome);
    expect(result.reasonCode).toBe(row.failure);
    expect(result.reason).toBe(message);
    expect(isRetryableOutcome(result.outcome)).toBe(row.outcome === "TRANSIENT_FAILURE");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("maps a null credential read to a terminal CONFIGURATION_ERROR", async () => {
    const read = credentialRead(null);
    const transport = respondingTransport(BATCH_RECEPTION_BODY);
    const { provider } = buildProvider({ read, transport });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("CREDENTIAL_UNAVAILABLE");
    expect(isRetryableOutcome(result.outcome)).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("maps an unreadable answer to CONFIGURATION_ERROR with the parser's own code", async () => {
    const { provider } = buildProvider({ body: UNPARSEABLE_BODY });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("MISSING_ELEMENT");
    // The row's message is fixed: the parser's own message can quote the body.
    expect(result.reason).not.toContain("<rRetEnviDe");
  });

  it("maps a document the serializer refuses without leaking its bytes", async () => {
    const transport = respondingTransport(BATCH_RECEPTION_BODY);
    const { provider } = buildProvider({ transport });

    const result = await provider.issue(
      issueRequest({ cdc: CDC, signedXml: `<notADe>${DOCUMENT_MARKER}</notADe>` })
    );

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("UNEXPECTED_DOCUMENT_ROOT");
    expect(result.reason).not.toContain(DOCUMENT_MARKER);
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed for an error it does not recognise", async () => {
    const { provider } = buildProvider({
      transport: failingTransport(new Error("opaque failure")),
    });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe(SIFEN_DIRECT_UNMAPPED_FAILURE_REASON_CODE);
    expect(result.reason).not.toContain("opaque failure");
  });
});

describe("the snapshot descriptors (ADR-009)", () => {
  it("keeps the descriptor unredacted and never the signed document", async () => {
    const { provider } = buildProvider({ body: BATCH_RECEPTION_BODY });

    const result = await provider.issue(issueRequest(SIGNED_DOCUMENT));

    const request = sanitizeProviderSnapshot(result.providerRequest);
    expect(request.snapshot).toEqual({
      provider: "SIFEN_DIRECT",
      service: "receiveBatch",
      cdc: CDC,
      xmlBytes: XML_BYTES,
    });
    expect(request.redactedPaths).toEqual([]);

    const response = sanitizeProviderSnapshot(result.providerResponse);
    expect(response.snapshot).toEqual({
      provider: "SIFEN_DIRECT",
      service: "receiveBatch",
      statusCode: "0300",
      message: "Lote recibido con éxito",
    });
    expect(response.redactedPaths).toEqual([]);

    // The document never entered the result: no sanitized fragment and no raw
    // fragment either.
    expect(JSON.stringify(request.snapshot)).not.toContain("<rDE");
    expect(JSON.stringify(result)).not.toContain(DOCUMENT_MARKER);
  });
});
