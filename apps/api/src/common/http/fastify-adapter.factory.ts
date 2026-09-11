import { FastifyAdapter } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import type { IncomingMessage } from "node:http";
import { REQUEST_ID_HEADER, resolveRequestId } from "../errors/request-id.js";
import { BRANDING_ASSET_LIMITS } from "../../branding/branding-asset-limits.js";

export interface CreateFastifyAdapterOptions {
  /** Root pino instance; omitted lets Fastify use its embedded default. */
  loggerInstance?: FastifyBaseLogger;
  /**
   * Explicit CORS origin allowlist (spec: api-contract / Baseline transport
   * security — "CORS origins ... configured server-side by default").
   * EMPTY/omitted means same-origin only: every cross-origin request carrying
   * an Origin header is rejected 403 before routing. Origins are matched
   * exactly (scheme+host+port, no wildcards).
   */
  corsAllowedOrigins?: readonly string[];
  /**
   * Emits Strict-Transport-Security on every response. Enable ONLY when the
   * deployment serves HTTPS (mirrors the secure-cookie posture); plain-HTTP
   * test harnesses and local development leave it off so the header never
   * advertises a transport guarantee the wire does not provide.
   */
  hstsEnabled?: boolean;
}

/** Raw-request slot where `genReqId` stashes the resolved id for ALS pickup. */
interface RawRequestWithId extends IncomingMessage {
  id?: unknown;
}

/** Baseline security headers set on EVERY response (success and error alike). */
const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
];

const HSTS_HEADER_VALUE = "max-age=31536000; includeSubDomains";

/** Methods we actually ship today; preflight answers never promise more. */
const ALLOWED_CORS_METHODS = "GET, POST, OPTIONS";
const ALLOWED_CORS_HEADERS = "Content-Type, X-Request-Id";

function isCorsPreflight(request: FastifyRequest): boolean {
  return request.method === "OPTIONS" && request.headers.origin !== undefined;
}

/**
 * Single construction point for the API's Fastify adapter.
 *
 * Wires the request-id contract (design D7): inbound `X-Request-Id` is
 * adopted only when it passes validation, otherwise a UUID is generated; the
 * resolved id is echoed on every response via an instance-level `onRequest`
 * hook, so success and error paths alike always carry the header. Both
 * production bootstrap (`main.ts`) and integration tests build adapters
 * through this factory, which is what makes the header/envelope behavior
 * testable end to end.
 *
 * The id is ALSO stashed on the raw request: Nest middleware receives the raw
 * `IncomingMessage` (not FastifyRequest) through the middie bridge, and the
 * ALS-entering middleware needs the authoritative id to seed the request
 * context (design D3).
 *
 * `@fastify/cookie` is registered here so every consumer — guards reading the
 * session cookie, controllers setting/clearing it — shares one RFC 6265-correct
 * parse/serialize implementation across production and tests.
 *
 * CORS + security headers (transport baseline) are implemented NATIVELY in
 * this hook rather than via @fastify/cors: the shipped surface needs exactly
 * an exact-match origin allowlist plus fixed headers, and staying native
 * avoids a new dependency while keeping deny-by-default explicit.
 */
export function createFastifyAdapter(options: CreateFastifyAdapterOptions = {}): FastifyAdapter {
  const allowedOrigins = new Set(options.corsAllowedOrigins ?? []);

  const adapter = new FastifyAdapter({
    ...(options.loggerInstance ? { loggerInstance: options.loggerInstance } : {}),
    // Contractual payload cap (1 MiB): pins today's Fastify default so a
    // future upstream change cannot silently move the limit; oversized bodies
    // are rejected before parsing (413 FST_ERR_CTP_BODY_TOO_LARGE).
    bodyLimit: 1_048_576,
    genReqId: (rawRequest: IncomingMessage) => {
      const requestId = resolveRequestId(rawRequest.headers[REQUEST_ID_HEADER]);
      (rawRequest as RawRequestWithId).id = requestId;
      return requestId;
    },
  });

  const instance = adapter.getInstance();
  void instance.register(cookie);
  void instance.register(multipart, {
    limits: {
      // Global multipart file-size ceiling: the largest approved asset is a
      // 2 MiB logo. Per-kind caps (logo vs favicon) are enforced in the pipe.
      fileSize: BRANDING_ASSET_LIMITS.logo,
    },
  });
  instance.addHook("onRequest", (request: FastifyRequest, reply: FastifyReply, done) => {
    // Request-id echo FIRST (design D7): every response carries correlation,
    // success and error paths alike.
    reply.header(REQUEST_ID_HEADER, request.id);
    // Security headers run before routing, so 404/401/403 responses carry
    // them too — there is no code path that skips the baseline.
    for (const [header, value] of SECURITY_HEADERS) {
      reply.header(header, value);
    }
    if (options.hstsEnabled) {
      reply.header("strict-transport-security", HSTS_HEADER_VALUE);
    }

    const origin = request.headers.origin;

    // No Origin header ⇒ same-origin or non-browser client: CORS never
    // applies, the request proceeds untouched.
    if (origin === undefined) {
      done();
      return;
    }

    // Vary prevents shared caches from serving one origin's CORS verdict to
    // another — required whenever responses differ per Origin.
    reply.header("vary", "Origin");

    if (!allowedOrigins.has(origin)) {
      // Deny-by-default: unknown origins get the standard error envelope
      // (403 FORBIDDEN) with NO Access-Control-Allow-* headers, which makes
      // browsers block the response regardless of status semantics.
      reply.code(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Cross-origin request rejected.",
          requestId: String(request.id),
        },
      });
      return;
    }

    reply.header("access-control-allow-origin", origin);

    if (isCorsPreflight(request)) {
      reply
        .code(204)
        .header("access-control-allow-methods", ALLOWED_CORS_METHODS)
        .header("access-control-allow-headers", ALLOWED_CORS_HEADERS)
        .send();
      return;
    }

    done();
  });

  return adapter;
}
