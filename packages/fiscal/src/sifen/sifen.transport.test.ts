/**
 * FISC-010 WU-C — ADR-008's transport guardrails, asserted against a real
 * localhost mutual-TLS handshake.
 *
 * Every assertion about TLS in this suite is made **on the handshake**, never on
 * a mocked agent or a stubbed option: the double refuses a client that presents
 * no certificate, records the subject of the one it accepted, and counts the TCP
 * connections it opened. That is what makes "no socket is pooled" and "the
 * tenant's certificate is presented" observable facts rather than claims about
 * the options this module happened to build.
 */

import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";

import {
  classifySocketFailure,
  sendSifenRequest,
  SIFEN_DEFAULT_TIMEOUT_MS,
  SIFEN_ENVIRONMENT_HOSTS,
  SIFEN_SOAP_CONTENT_TYPE,
  SIFEN_TLS_MIN_VERSION,
  SifenTransportError,
  sifenBaseUrl,
} from "./sifen.transport.js";
import {
  createSifenTlsFixture,
  SIFEN_TLS_FIXTURE_TENANT_A_COMMON_NAME,
  SIFEN_TLS_FIXTURE_TENANT_B_COMMON_NAME,
  startSifenTlsServer,
  type SifenTlsFixture,
  type SifenTlsServerHandle,
  type SifenTlsServerHandler,
} from "./sifen.tls.fixture.js";

/** A minimal SOAP 1.2 envelope: the transport never interprets it. */
const ENVELOPE =
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
  '<soap:Header/><soap:Body><rEnviDe xmlns="http://ekuatia.set.gov.py/sifen/xsd">' +
  "<dId>1</dId></rEnviDe></soap:Body></soap:Envelope>";

const SERVICE_PATH = "/de/ws/sync/recibe.wsdl";

/** One request's worth of what the double saw. */
interface ObservedRequest {
  readonly method: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

function observeRequest(request: IncomingMessage): Promise<ObservedRequest> {
  return new Promise<ObservedRequest>((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve({
        method: request.method,
        contentType: request.headers["content-type"],
        body,
      });
    });
  });
}

describe("sendSifenRequest over mutual TLS", () => {
  let fixture: SifenTlsFixture;

  beforeAll(() => {
    fixture = createSifenTlsFixture();
  });

  /** A fresh server per test, so every count in the test is exact. */
  async function withServer(
    run: (server: SifenTlsServerHandle) => Promise<void>,
    handler?: SifenTlsServerHandler
  ): Promise<void> {
    const server =
      handler === undefined
        ? await startSifenTlsServer({ fixture })
        : await startSifenTlsServer({ fixture, handler });
    try {
      await run(server);
    } finally {
      await server.close();
    }
  }

  function endpointOf(server: SifenTlsServerHandle): string {
    return `${server.origin}${SERVICE_PATH}`;
  }

  function send(
    server: SifenTlsServerHandle,
    overrides: {
      readonly credential?: SifenTlsFixture["tenantA"];
      readonly timeoutMs?: number;
      readonly maxResponseBytes?: number;
      readonly signal?: AbortSignal;
      readonly now?: Date;
    } = {}
  ): Promise<Awaited<ReturnType<typeof sendSifenRequest>>> {
    return sendSifenRequest({
      endpoint: endpointOf(server),
      envelope: ENVELOPE,
      credential: overrides.credential ?? fixture.tenantA,
      caPem: [fixture.caPem],
      ...overrides,
    });
  }

  it("refuses a client without a certificate and accepts the fixture's", async () => {
    await withServer(async (server) => {
      const withoutCertificate = await bareRequest(server);
      expect(withoutCertificate.errorCode, "a bare client must fail the handshake").toBeDefined();
      expect(server.handshakeFailures, "the server, not the client, refused it").toHaveLength(1);
      expect(server.acceptedPeerSubjects).toEqual([]);

      const response = await send(server);
      expect(response.statusCode).toBe(200);
      expect(server.acceptedPeerSubjects).toEqual([SIFEN_TLS_FIXTURE_TENANT_A_COMMON_NAME]);
    });
  });

  it("opens one connection per call, each with its own tenant certificate", async () => {
    await withServer(async (server) => {
      await send(server, { credential: fixture.tenantA });
      await send(server, { credential: fixture.tenantB });
      // A third call with the first tenant again: a pool keyed by tenant would
      // answer it on tenant A's earlier socket, leaving the count at two.
      await send(server, { credential: fixture.tenantA });

      expect(server.connectionCount).toBe(3);
      expect(server.acceptedPeerSubjects).toEqual([
        SIFEN_TLS_FIXTURE_TENANT_A_COMMON_NAME,
        SIFEN_TLS_FIXTURE_TENANT_B_COMMON_NAME,
        SIFEN_TLS_FIXTURE_TENANT_A_COMMON_NAME,
      ]);
    });
  });

  it("posts the envelope verbatim as SOAP 1.2 with an explicit length", async () => {
    let observed: Promise<ObservedRequest> | undefined;
    await withServer(
      async (server) => {
        const response = await send(server);
        expect(response.statusCode).toBe(200);
        expect(await observed).toEqual({
          method: "POST",
          contentType: SIFEN_SOAP_CONTENT_TYPE,
          body: ENVELOPE,
        });
      },
      (request, response) => {
        observed = observeRequest(request);
        response.writeHead(200, { "content-type": SIFEN_SOAP_CONTENT_TYPE });
        response.end("");
      }
    );
  });

  it("returns the status, the content type and the UTF-8 body intact", async () => {
    const body = "<dMsgRes>Aprobado con observación — ñandú ✅</dMsgRes>";
    await withServer(
      async (server) => {
        const response = await send(server);
        expect(response.statusCode).toBe(201);
        expect(response.contentType).toBe(SIFEN_SOAP_CONTENT_TYPE);
        expect(response.location).toBeUndefined();
        expect(response.body).toBe(body);
      },
      (_request, response) => {
        response.writeHead(201, { "content-type": SIFEN_SOAP_CONTENT_TYPE });
        response.end(body);
      }
    );
  });

  it("returns a 4xx or 5xx answer rather than throwing it, so a SOAP fault is readable", async () => {
    const fault =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
      "<soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code></soap:Fault>" +
      "</soap:Body></soap:Envelope>";
    await withServer(
      async (server) => {
        const response = await send(server);
        expect(response.statusCode).toBe(500);
        expect(response.body).toBe(fault);
      },
      (_request, response) => {
        response.writeHead(500, { "content-type": SIFEN_SOAP_CONTENT_TYPE });
        response.end(fault);
      }
    );
  });

  it("strips a leading byte order mark from the body", async () => {
    await withServer(
      async (server) => {
        const response = await send(server);
        expect(response.body).toBe("<ok/>");
      },
      (_request, response) => {
        response.writeHead(200, { "content-type": SIFEN_SOAP_CONTENT_TYPE });
        response.end("\uFEFF<ok/>");
      }
    );
  });

  it("refuses a redirect carrying its status and Location instead of parsing it", async () => {
    await withServer(
      async (server) => {
        const error = await transportFailure(() => send(server));

        expect(error.failure).toBe("REDIRECT_NOT_ALLOWED");
        expect(error.statusCode).toBe(302);
        expect(error.location).toBe("/vdesk/hangup.php3");
        // The portal page is never read, and never echoed into the error either.
        expect(error.message).not.toContain("html");
      },
      (_request, response) => {
        response.writeHead(302, {
          location: "/vdesk/hangup.php3",
          "content-type": "text/html",
        });
        response.end("<html><body>Portal SIFEN</body></html>");
      }
    );
  });

  it("fails RESPONSE_TOO_LARGE while reading a body past the cap", async () => {
    await withServer(
      async (server) => {
        const error = await transportFailure(() => send(server, { maxResponseBytes: 64 }));
        expect(error.failure).toBe("RESPONSE_TOO_LARGE");
      },
      (_request, response) => {
        response.writeHead(200, { "content-type": SIFEN_SOAP_CONTENT_TYPE });
        // Several chunks, so the cap is crossed mid-body rather than at the end.
        for (let index = 0; index < 8; index += 1) {
          response.write("x".repeat(32));
        }
        response.end();
      }
    );
  });

  it("fails TIMEOUT when the service never answers", async () => {
    await withServer(
      async (server) => {
        const error = await transportFailure(() => send(server, { timeoutMs: 250 }));
        expect(error.failure).toBe("TIMEOUT");
        expect(server.connectionCount).toBe(1);
      },
      () => {
        // Deliberately never answers, and never ends.
      }
    );
  });

  it("settles instead of hanging when the service truncates its answer", async () => {
    await withServer(
      async (server) => {
        // The property under test is settlement, not which event carries it: the
        // transport's own reading is that `error` or `close` must end this
        // promise, and a truncated answer is exactly the shape that used to
        // depend on the parser surfacing one. A promise that never settles fails
        // this test as a timeout, which is the failure the review named.
        const error = await transportFailure(() => send(server));
        expect(error.failure).toBe("NETWORK_FAILURE");
        expect(server.connectionCount).toBe(1);
      },
      (_request, response) => {
        // Headers first, one byte of a body, then the connection goes away with
        // no `end` and no `Content-Length` ever satisfied.
        response.writeHead(200, { "Content-Type": SIFEN_SOAP_CONTENT_TYPE });
        response.write("<soap:Envelope");
        response.socket?.destroy();
      }
    );
  });

  it("fails ABORTED without opening a connection when the signal is already aborted", async () => {
    await withServer(async (server) => {
      const controller = new AbortController();
      controller.abort();

      const error = await transportFailure(() => send(server, { signal: controller.signal }));

      expect(error.failure).toBe("ABORTED");
      expect(server.connectionCount).toBe(0);
    });
  });

  it("fails ABORTED when the signal aborts a call in flight", async () => {
    await withServer(
      async (server) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 100);

        const error = await transportFailure(() =>
          send(server, { signal: controller.signal, timeoutMs: 10_000 })
        );
        expect(error.failure).toBe("ABORTED");
      },
      () => {
        // Never answers; only the abort can settle the call.
      }
    );
  });

  it("uses exactly isCredentialFresh's boundaries, inclusively at notBefore", async () => {
    await withServer(async (server) => {
      // `now === notBefore` is fresh, so the call proceeds and completes.
      const response = await send(server, { now: new Date(fixture.notBefore.getTime()) });
      expect(response.statusCode).toBe(200);

      // `now === notAfter` is not, and the refusal is local: still one connection.
      const error = await transportFailure(() =>
        send(server, { now: new Date(fixture.notAfter.getTime()) })
      );
      expect(error.failure).toBe("CREDENTIAL_EXPIRED");
      expect(server.connectionCount).toBe(1);
    });
  });

  it("fails CREDENTIAL_EXPIRED before opening a connection", async () => {
    const expired = createSifenTlsFixture({
      notBefore: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      notAfter: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    await withServer(async (server) => {
      const error = await transportFailure(() =>
        send(server, {
          credential: expired.tenantA,
          now: new Date(expired.notAfter.getTime() + 1),
        })
      );
      expect(error.failure).toBe("CREDENTIAL_EXPIRED");
      expect(server.connectionCount).toBe(0);
    });
  });

  it("fails CREDENTIAL_NOT_YET_VALID before opening a connection", async () => {
    const future = createSifenTlsFixture({
      notBefore: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      notAfter: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });
    await withServer(async (server) => {
      const error = await transportFailure(() =>
        send(server, {
          credential: future.tenantA,
          now: new Date(future.notBefore.getTime() - 1),
        })
      );
      expect(error.failure).toBe("CREDENTIAL_NOT_YET_VALID");
      expect(server.connectionCount).toBe(0);
    });
  });

  it("fails NETWORK_FAILURE for a port nothing listens on", async () => {
    const server = await startSifenTlsServer({ fixture });
    const endpoint = endpointOf(server);
    await server.close();

    const error = await transportFailure(() =>
      sendSifenRequest({
        endpoint,
        envelope: ENVELOPE,
        credential: fixture.tenantA,
        caPem: [fixture.caPem],
        timeoutMs: 5_000,
      })
    );
    expect(error.failure).toBe("NETWORK_FAILURE");
  });

  it("fails TLS_FAILURE when the server certificate is not trusted, without repeating the credential", async () => {
    await withServer(async (server) => {
      const error = await transportFailure(() =>
        sendSifenRequest({
          endpoint: endpointOf(server),
          envelope: ENVELOPE,
          credential: fixture.tenantA,
        })
      );
      expect(error.failure).toBe("TLS_FAILURE");
      expect(server.acceptedPeerSubjects).toEqual([]);
      // Guardrail 8: the failure carries a status and a bounded reason, never the
      // key, the certificate or the envelope.
      expect(error.message).not.toContain("PRIVATE KEY");
      expect(error.message).not.toContain("BEGIN CERTIFICATE");
      expect(error.message).not.toContain("rEnviDe");
    });
  });

  it("refuses every endpoint that is not an absolute https URL", async () => {
    for (const endpoint of [
      "http://localhost:1/de/ws/sync/recibe.wsdl",
      "ftp://localhost/de/ws/sync/recibe.wsdl",
      "/de/ws/sync/recibe.wsdl",
      "not a url",
      "https://",
      "https://user:secret@localhost/de/ws/sync/recibe.wsdl",
    ]) {
      const error = await transportFailure(() =>
        sendSifenRequest({ endpoint, envelope: ENVELOPE, credential: fixture.tenantA })
      );
      expect(error.failure, endpoint).toBe("INVALID_ENDPOINT");
    }
  });

  /** A bare `https.request`, with no client certificate and no transport involved. */
  async function bareRequest(
    server: SifenTlsServerHandle
  ): Promise<{ readonly statusCode?: number; readonly errorCode?: string }> {
    return await new Promise((resolve) => {
      const request = httpsRequest(
        {
          host: "localhost",
          port: server.port,
          path: SERVICE_PATH,
          method: "POST",
          agent: false,
          minVersion: "TLSv1.2",
          rejectUnauthorized: true,
          ca: [fixture.caPem],
        },
        (response) => {
          response.resume();
          response.on("end", () => {
            resolve({ statusCode: response.statusCode });
          });
        }
      );
      request.on("error", (error: unknown) => {
        resolve({ errorCode: readCode(error) });
      });
      request.end("");
    });
  }
});

/** Unwraps a rejection, failing the test if the call resolved instead. */
async function transportFailure(run: () => Promise<unknown>): Promise<SifenTransportError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SifenTransportError) {
      return error;
    }
    throw error;
  }
  throw new Error("The transport was expected to fail, but it resolved.");
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code: unknown = error.code;
  return typeof code === "string" ? code : undefined;
}

describe("the transport's protocol constants", () => {
  it("pins TLS 1.2, SOAP 1.2's media type and the one-minute window", () => {
    expect(SIFEN_TLS_MIN_VERSION).toBe("TLSv1.2");
    expect(SIFEN_SOAP_CONTENT_TYPE).toBe("application/soap+xml; charset=utf-8");
    expect(SIFEN_DEFAULT_TIMEOUT_MS).toBe(60_000);
  });

  it("maps each environment to its DNIT host", () => {
    expect(sifenBaseUrl("TEST")).toBe("https://sifen-test.set.gov.py");
    expect(sifenBaseUrl("PRODUCTION")).toBe("https://sifen.set.gov.py");
    expect(Object.isFrozen(SIFEN_ENVIRONMENT_HOSTS)).toBe(true);
  });
});

describe("classifySocketFailure", () => {
  it("classifies certificate and handshake failures as TLS_FAILURE", () => {
    for (const code of [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED",
      "ERR_OSSL_UNSUPPORTED",
      "EPROTO",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_HAS_EXPIRED",
    ]) {
      expect(classifySocketFailure({ code }), code).toBe("TLS_FAILURE");
    }
  });

  it("classifies connection failures as NETWORK_FAILURE", () => {
    for (const code of [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNRESET",
      "EHOSTUNREACH",
      "EPIPE",
      "ERR_SOCKET_CONNECTION_TIMEOUT",
    ]) {
      expect(classifySocketFailure({ code }), code).toBe("NETWORK_FAILURE");
    }
  });

  it("defaults an unrecognised error to NETWORK_FAILURE", () => {
    expect(classifySocketFailure({ code: "SOMETHING_ELSE" })).toBe("NETWORK_FAILURE");
    expect(classifySocketFailure({})).toBe("NETWORK_FAILURE");
    expect(classifySocketFailure({ code: 42 })).toBe("NETWORK_FAILURE");
    expect(classifySocketFailure(new Error("no code"))).toBe("NETWORK_FAILURE");
    expect(classifySocketFailure("ECONNREFUSED")).toBe("NETWORK_FAILURE");
    expect(classifySocketFailure(null)).toBe("NETWORK_FAILURE");
    expect(classifySocketFailure(undefined)).toBe("NETWORK_FAILURE");
  });
});

describe("SifenTransportError", () => {
  it("carries only the failure discriminant and the two response fields", () => {
    const error = new SifenTransportError("NETWORK_FAILURE", "A bounded reason.", {});
    expect(error.failure).toBe("NETWORK_FAILURE");
    expect(error.statusCode).toBeUndefined();
    expect(error.location).toBeUndefined();
    expect(error.name).toBe("SifenTransportError");
    expect(error).toBeInstanceOf(Error);
  });

  it("carries the status and the Location of the response that failed it", () => {
    const error = new SifenTransportError("REDIRECT_NOT_ALLOWED", "A bounded reason.", {
      statusCode: 302,
      location: "/vdesk/hangup.php3",
    });
    expect(error.statusCode).toBe(302);
    expect(error.location).toBe("/vdesk/hangup.php3");
  });
});
