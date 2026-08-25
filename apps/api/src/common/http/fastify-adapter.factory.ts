import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { FastifyBaseLogger } from "fastify";
import type { IncomingMessage } from "node:http";
import { REQUEST_ID_HEADER, resolveRequestId } from "../errors/request-id.js";

export interface CreateFastifyAdapterOptions {
  /** Root pino instance; omitted lets Fastify use its embedded default. */
  loggerInstance?: FastifyBaseLogger;
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
 */
export function createFastifyAdapter(options: CreateFastifyAdapterOptions = {}): FastifyAdapter {
  const adapter = new FastifyAdapter({
    ...(options.loggerInstance ? { loggerInstance: options.loggerInstance } : {}),
    genReqId: (rawRequest: IncomingMessage) =>
      resolveRequestId(rawRequest.headers[REQUEST_ID_HEADER]),
  });

  const instance = adapter.getInstance();
  instance.addHook("onRequest", (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });

  return adapter;
}
