import { FastifyAdapter } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import type { FastifyBaseLogger } from "fastify";
import type { IncomingMessage } from "node:http";
import { REQUEST_ID_HEADER, resolveRequestId } from "../errors/request-id.js";

export interface CreateFastifyAdapterOptions {
  /** Root pino instance; omitted lets Fastify use its embedded default. */
  loggerInstance?: FastifyBaseLogger;
}

/** Raw-request slot where `genReqId` stashes the resolved id for ALS pickup. */
interface RawRequestWithId extends IncomingMessage {
  id?: unknown;
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
 */
export function createFastifyAdapter(options: CreateFastifyAdapterOptions = {}): FastifyAdapter {
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
  instance.addHook("onRequest", (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  return adapter;
}
