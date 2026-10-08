/**
 * FISC-010 WU-C — the SIFEN transport of [[ADR-008]] §1.
 *
 * SOAP 1.2 Document/Literal, posted by `node:https`, with a **per-call** mutual
 * TLS configuration built from the tenant's certificate. No HTTP client
 * dependency, no agent pool, no redirect following, no unbounded body.
 *
 * Four decisions live in this module, each of them the reason a guardrail exists:
 *
 * 1. **`agent: false` on every request.** Node's default agent pools and reuses
 *    sockets, and a pooled socket authenticated as tenant A could serve tenant
 *    B's next call. With `agent: false` every call performs its own handshake and
 *    no connection outlives it. The cost is a handshake per call — nothing next
 *    to a document submission — and the property it buys is the one this boundary
 *    cannot get wrong. Do not "optimise" this into a shared agent or a
 *    keep-alive option: the suite asserts that two calls with two credentials
 *    produce two connections, each with its own peer certificate.
 * 2. **A redirect is an error, never a body.** Both DNIT hosts answer
 *    `302 → /vdesk/hangup.php3` for everything unauthenticated (baseline §23.5,
 *    including a bogus path and the root), so a client that followed one would
 *    fetch an HTML portal page and hand it to an XML parser. A 3xx therefore
 *    fails the call carrying its status and its `Location`.
 * 3. **The response is bounded while it is read.** The cap is applied to the
 *    accumulating byte count, and the request is destroyed the moment it is
 *    crossed — not after a body has already been buffered.
 * 4. **Every failure is typed and local where it can be.** The credential is
 *    checked for freshness *before* the request is opened, so an expired
 *    certificate produces `CREDENTIAL_EXPIRED` rather than an opaque TLS alert,
 *    and the socket-error classification is a pure exported function so it is
 *    unit-testable without I/O.
 *
 * **The SOAPAction is deliberately absent.** SOAP 1.2 makes it a media-type
 * parameter rather than a mandatory header, the Guide's own invocations carry
 * none, and the WSDL that would pin it is unread (both hosts answer 302 for it,
 * baseline §23.5). ADR-008 records it as an open question rather than inventing
 * a value; if a service rejects an envelope without one, the action becomes a
 * constant with a cited source.
 *
 * **Nothing here logs.** No `console.*`, no ambient clock outside the injectable
 * `now`, and no error message carries the envelope, the credential or the
 * response body — the only variable part of a message is a validated symbolic
 * error code (see {@link classifySocketFailure}).
 */

import { request as httpsRequest, type RequestOptions } from "node:https";

import {
  isCredentialFresh,
  type FiscalSigningEnvironment,
  type FiscalTransportCredential,
} from "../fiscal-credential.port.js";
import { SIFEN_MAX_RESPONSE_BYTES } from "./sifen.parser.js";

/**
 * ADR-008 §1 / baseline §7: TLS 1.2 is the floor the Manual states
 * ("Internet + TLS 1.2 con AUTENTICACIÓN MUTUA"). It is a floor, not a ceiling:
 * Node negotiates 1.3 when the peer offers it.
 */
export const SIFEN_TLS_MIN_VERSION = "TLSv1.2" as const;

/**
 * ADR-008 §1 / baseline §7: SOAP 1.2's media type. The `charset` parameter is
 * part of the media type in SOAP 1.2 — unlike SOAP 1.1's `text/xml` — and both
 * this header and the body are UTF-8.
 */
export const SIFEN_SOAP_CONTENT_TYPE = "application/soap+xml; charset=utf-8" as const;

/**
 * ADR-008 §1 / baseline §11: "SIFEN's maximum response time per DTE is 1
 * minute". The window is a **socket inactivity** window, not a deadline for the
 * whole call: a service that keeps sending is not cut off mid-body.
 */
export const SIFEN_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * ADR-008 §3 / baseline §8: one DNIT host per environment. The paths are the
 * facade's ([[FISC-010]] WU-E); this module only knows the origins.
 *
 * The deployment-level `SIFEN_ENVIRONMENT` variable maps to these keys; the
 * lowercase spelling of that variable is the boot schema's business, not this
 * constant's, so the two cannot disagree about the host by accident.
 */
export const SIFEN_ENVIRONMENT_HOSTS = Object.freeze({
  TEST: "https://sifen-test.set.gov.py",
  PRODUCTION: "https://sifen.set.gov.py",
} as const);

/** The origin a service path is resolved against, for one environment. */
export function sifenBaseUrl(environment: FiscalSigningEnvironment): string {
  return SIFEN_ENVIRONMENT_HOSTS[environment];
}

export interface SendSifenRequestArgs {
  /** Absolute `https:` URL of the service, e.g. `${sifenBaseUrl("TEST")}/de/ws/…`. */
  readonly endpoint: string;
  /** The already-serialized SOAP envelope (`sifen.serializer.ts`). Posted verbatim. */
  readonly envelope: string;
  readonly credential: FiscalTransportCredential;
  /** Defaults to {@link SIFEN_DEFAULT_TIMEOUT_MS}. Socket inactivity window. */
  readonly timeoutMs?: number;
  /** Defaults to {@link SIFEN_MAX_RESPONSE_BYTES}. Applied while reading. */
  readonly maxResponseBytes?: number;
  /** Injectable clock, used only for the freshness check. */
  readonly now?: Date;
  /** Cancels the call; an aborted signal produces `ABORTED`. */
  readonly signal?: AbortSignal;
  /**
   * Extra trust anchors for the server certificate, in PEM.
   *
   * ADR-008 §1 names `cert`, `key`, `minVersion` and `rejectUnauthorized` and
   * does not name a CA bundle, because SIFEN's certificate chains to a PSC root
   * a deployment already trusts. Two callers genuinely need this: the transport's
   * own suite, whose double is signed by a throwaway CA, and a deployment whose
   * PSC root is not in Node's bundled store. When it is omitted, the request
   * carries no `ca` option at all and Node's default trust store applies — this
   * field never weakens verification, it only adds anchors to it.
   */
  readonly caPem?: readonly string[];
}

export interface SifenTransportResponse {
  readonly statusCode: number;
  readonly contentType: string | undefined;
  readonly location: string | undefined;
  /** UTF-8, BOM stripped if present. Not interpreted: a SOAP fault is a body too. */
  readonly body: string;
}

export type SifenTransportFailure =
  | "INVALID_ENDPOINT"
  | "CREDENTIAL_EXPIRED"
  | "CREDENTIAL_NOT_YET_VALID"
  | "TLS_FAILURE"
  | "NETWORK_FAILURE"
  | "TIMEOUT"
  | "ABORTED"
  | "REDIRECT_NOT_ALLOWED"
  | "RESPONSE_TOO_LARGE";

/**
 * One fixed sentence per failure, so no call site invents a message and no
 * message can grow a payload. The only variable part any of them carries is a
 * symbolic socket error code, validated before it is interpolated.
 */
const SIFEN_TRANSPORT_MESSAGES: Record<SifenTransportFailure, string> = {
  INVALID_ENDPOINT: "The SIFEN endpoint must be an absolute https URL.",
  CREDENTIAL_EXPIRED: "The SIFEN signing certificate has expired.",
  CREDENTIAL_NOT_YET_VALID: "The SIFEN signing certificate is not valid yet.",
  TLS_FAILURE: "The TLS handshake with SIFEN failed.",
  NETWORK_FAILURE: "The request to SIFEN could not be completed.",
  TIMEOUT: "SIFEN did not answer within the request timeout.",
  ABORTED: "The request to SIFEN was aborted.",
  REDIRECT_NOT_ALLOWED: "SIFEN answered with a redirect, which is never followed.",
  RESPONSE_TOO_LARGE: "The SIFEN response exceeded the configured size limit.",
};

/**
 * A symbolic error code, or `undefined` when the error does not carry one.
 *
 * The code is validated against a conservative shape before it is used, because
 * it comes from an `unknown` error and it is the one piece of that error this
 * module is willing to repeat. Node's own codes (`ERR_TLS_CERT_ALTNAME_INVALID`,
 * `ECONNREFUSED`, …) all match; anything that does not is dropped rather than
 * echoed.
 */
const SOCKET_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * A transport failure, in the style of `DteCatalogueError`: a discriminant plus
 * the two response fields a redirect or a fault answer carries.
 *
 * `statusCode` and `location` are `undefined` for every failure that never saw a
 * response — an invalid endpoint, an unusable credential, a refused connection.
 */
export class SifenTransportError extends Error {
  readonly failure: SifenTransportFailure;
  readonly statusCode: number | undefined;
  readonly location: string | undefined;

  constructor(
    failure: SifenTransportFailure,
    message: string,
    details: { readonly statusCode?: number; readonly location?: string } = {}
  ) {
    super(message);
    this.name = "SifenTransportError";
    this.failure = failure;
    this.statusCode = details.statusCode;
    this.location = details.location;
  }
}

/** The failure classes ADR-008 §1 names, as codes rather than as prose. */
const TLS_FAILURE_PREFIXES = ["ERR_TLS_", "ERR_SSL_", "ERR_OSSL_"] as const;

const TLS_FAILURE_CODES: ReadonlySet<string> = new Set([
  // OpenSSL X.509 verification results Node surfaces as `error.code`.
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_REJECTED",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  // The record-layer alert a server sends when it wants a client certificate.
  "EPROTO",
]);

/**
 * Classifies a socket error into one of the two transport failures it can be.
 *
 * **Pure and exported** so the classification is unit-testable without I/O: the
 * caller passes an `unknown` (exactly what a socket hands back) and gets a
 * failure code. The default is `NETWORK_FAILURE`, which is the honest answer for
 * an unrecognised code — an error this module cannot explain is not evidence of
 * a TLS problem.
 *
 * The lists above are the codes ADR-008 §1 names, extended with the rest of the
 * OpenSSL verification set and Node's `ERR_TLS_`/`ERR_SSL_`/`ERR_OSSL_`
 * namespaces, because a handshake failure reported as a connection failure would
 * send an operator looking at the network instead of at the certificate.
 */
export function classifySocketFailure(error: unknown): SifenTransportFailure {
  const code = readSocketErrorCode(error);
  if (code === undefined) {
    return "NETWORK_FAILURE";
  }
  if (TLS_FAILURE_CODES.has(code)) {
    return "TLS_FAILURE";
  }
  if (TLS_FAILURE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    return "TLS_FAILURE";
  }
  return "NETWORK_FAILURE";
}

/**
 * Posts one already-serialized envelope to one SIFEN service.
 *
 * Order of the checks matters and is asserted by the suite: the endpoint and the
 * credential are validated **before** a socket is opened, so a local failure is
 * never reported as a handshake failure and never costs a connection.
 */
export async function sendSifenRequest(
  args: SendSifenRequestArgs
): Promise<SifenTransportResponse> {
  const endpoint = parseEndpoint(args.endpoint);
  const now = args.now ?? new Date();
  assertCredentialUsable(args.credential, now);

  if (args.signal?.aborted === true) {
    throw new SifenTransportError("ABORTED", SIFEN_TRANSPORT_MESSAGES.ABORTED);
  }

  const envelope = Buffer.from(args.envelope, "utf8");

  return await postEnvelope({
    endpoint,
    envelope,
    credential: args.credential,
    timeoutMs: args.timeoutMs ?? SIFEN_DEFAULT_TIMEOUT_MS,
    maxResponseBytes: args.maxResponseBytes ?? SIFEN_MAX_RESPONSE_BYTES,
    signal: args.signal,
    caPem: args.caPem,
  });
}

/**
 * The freshness check, split into its two reasons on purpose: ADR-008 §2 says an
 * expired certificate is refused locally, and "expired" and "not yet valid" are
 * two different operator actions (renew it, or fix the clock/deployment).
 *
 * The two branches are exactly the complement of {@link isCredentialFresh}, and
 * the suite pins that equivalence rather than leaving it to inspection.
 */
function assertCredentialUsable(credential: FiscalTransportCredential, now: Date): void {
  if (isCredentialFresh(credential, now)) {
    return;
  }
  if (now.getTime() >= credential.notAfter.getTime()) {
    throw new SifenTransportError(
      "CREDENTIAL_EXPIRED",
      SIFEN_TRANSPORT_MESSAGES.CREDENTIAL_EXPIRED
    );
  }
  throw new SifenTransportError(
    "CREDENTIAL_NOT_YET_VALID",
    SIFEN_TRANSPORT_MESSAGES.CREDENTIAL_NOT_YET_VALID
  );
}

/**
 * Only `https:` is accepted. A relative URL, another scheme, a hostless URL or a
 * URL carrying credentials all fail here rather than reaching `tls.connect`.
 *
 * Credentials in the URL are refused rather than ignored: the request is built
 * from the parsed components, so a `user:password@` authority would be silently
 * dropped — a silent drop is worse than a refusal, and SIFEN has no use for one.
 *
 * The `hostname === ""` arm is a guard, not the main check: WHATWG URL
 * normalisation collapses `https:///path` into a request for host `path`, so a
 * string that merely *looks* hostless is a syntactically valid URL and fails
 * later, as a network failure. That is the honest classification — the URL is
 * well formed, the host simply does not exist.
 */
function parseEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new SifenTransportError("INVALID_ENDPOINT", SIFEN_TRANSPORT_MESSAGES.INVALID_ENDPOINT);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new SifenTransportError("INVALID_ENDPOINT", SIFEN_TRANSPORT_MESSAGES.INVALID_ENDPOINT);
  }
  return url;
}

interface PostEnvelopeInput {
  readonly endpoint: URL;
  readonly envelope: Buffer;
  readonly credential: FiscalTransportCredential;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly signal: AbortSignal | undefined;
  readonly caPem: readonly string[] | undefined;
}

/**
 * The request itself. Every exit path goes through `succeed`/`fail`, both of
 * which settle once — the destroy calls below can each raise a second event, and
 * a promise that settles twice is a bug that hides behind a passing test.
 */
function postEnvelope(input: PostEnvelopeInput): Promise<SifenTransportResponse> {
  return new Promise<SifenTransportResponse>((resolve, reject) => {
    let settled = false;

    const fail = (
      failure: SifenTransportFailure,
      details: {
        readonly statusCode?: number;
        readonly location?: string;
        readonly socketCode?: string;
      } = {}
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      const base = SIFEN_TRANSPORT_MESSAGES[failure];
      const message = details.socketCode === undefined ? base : `${base} (${details.socketCode})`;
      reject(new SifenTransportError(failure, message, details));
    };

    const succeed = (response: SifenTransportResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(response);
    };

    const options: RequestOptions = {
      protocol: "https:",
      hostname: input.endpoint.hostname,
      port: input.endpoint.port === "" ? 443 : input.endpoint.port,
      path: `${input.endpoint.pathname}${input.endpoint.search}`,
      method: "POST",
      // ADR-008 §1, guardrail 1. Never the global agent, never a keep-alive.
      agent: false,
      minVersion: SIFEN_TLS_MIN_VERSION,
      rejectUnauthorized: true,
      cert: input.credential.certificatePem,
      key: input.credential.privateKeyPem,
      headers: {
        "Content-Type": SIFEN_SOAP_CONTENT_TYPE,
        "Content-Length": String(input.envelope.byteLength),
      },
      ...(input.caPem === undefined || input.caPem.length === 0 ? {} : { ca: [...input.caPem] }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };

    const request = httpsRequest(options, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = readHeader(response.headers.location);
      const contentType = readHeader(response.headers["content-type"]);

      if (statusCode >= 300 && statusCode < 400) {
        // ADR-008 §1, guardrail 2: the body of a redirect is an HTML portal page,
        // never a SOAP answer. Nothing reads it.
        fail("REDIRECT_NOT_ALLOWED", { statusCode, location });
        response.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;

      response.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > input.maxResponseBytes) {
          // Guardrail 3: the bound is applied while reading, so a body that never
          // ends is never buffered to its end.
          fail("RESPONSE_TOO_LARGE", { statusCode, location });
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });

      response.on("error", (error: unknown) => {
        const socketCode = readSocketErrorCode(error);
        fail(
          input.signal?.aborted === true ? "ABORTED" : classifySocketFailure(error),
          socketCode === undefined ? { statusCode, location } : { statusCode, location, socketCode }
        );
      });

      // The settle guarantee must not depend on the parser's mood. A connection
      // that goes away without `error` and without `end` leaves this promise
      // pending: the socket is gone, so the inactivity timer can no longer
      // protect the call. `close` is the event that always fires, and `complete`
      // says whether the message actually finished — after a normal `end` the
      // guarded `fail` is already settled and this is a no-op.
      response.on("close", () => {
        if (!response.complete) {
          fail(input.signal?.aborted === true ? "ABORTED" : "NETWORK_FAILURE", {
            statusCode,
            location,
          });
        }
      });

      response.on("end", () => {
        succeed({
          statusCode,
          contentType,
          location,
          body: decodeUtf8Body(Buffer.concat(chunks)),
        });
      });
    });

    request.on("error", (error: unknown) => {
      const socketCode = readSocketErrorCode(error);
      fail(
        input.signal?.aborted === true ? "ABORTED" : classifySocketFailure(error),
        socketCode === undefined ? {} : { socketCode }
      );
    });

    // "No socket activity within the window", not "a deadline for the whole
    // call": Node's own socket timeout resets on every byte, so a slow but live
    // answer is not cut off mid-body.
    request.setTimeout(input.timeoutMs, () => {
      fail("TIMEOUT");
      request.destroy();
    });

    request.end(input.envelope);
  });
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

/**
 * The one piece of an `unknown` socket error this module repeats: its symbolic
 * code, and only when it matches {@link SOCKET_ERROR_CODE_PATTERN}. The message
 * is never used — an OpenSSL message can quote the peer's certificate subject,
 * and the guardrail is that an error carries a status and a bounded reason.
 */
function readSocketErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code: unknown = error.code;
  return typeof code === "string" && SOCKET_ERROR_CODE_PATTERN.test(code) ? code : undefined;
}

/** UTF-8, with a leading BOM removed if the service sent one. */
function decodeUtf8Body(bytes: Buffer): string {
  const body = bytes.toString("utf8");
  return body.startsWith("\uFEFF") ? body.slice(1) : body;
}
