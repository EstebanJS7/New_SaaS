import { Injectable } from "@nestjs/common";
import { resolveRequestId } from "../common/errors/request-id.js";
import { RequestContextService } from "./request-context.service.js";

/**
 * ALS-entering middleware (design D3 wire order: genReqId → this → guards).
 *
 * The Fastify adapter runs Nest middleware through its bundled middie bridge,
 * which hands over the RAW `IncomingMessage` — not the FastifyRequest — so the
 * request id stashed by `genReqId` in the adapter factory is read from the raw
 * object here. `NestMiddleware` is deliberately NOT implemented: its declared
 * parameter types are Express-flavored and would lie about what actually
 * arrives; inputs are validated as unknown instead.
 */
@Injectable()
export class RequestContextMiddleware {
  constructor(private readonly contextService: RequestContextService) {}

  use(request: unknown, _response: unknown, next: () => void): void {
    // Defensive re-derivation mirrors the exception filter: when the adapter
    // was not built through the shared factory, a fresh UUID keeps contexts
    // unique instead of colliding on a placeholder.
    const requestId = resolveRequestId((request as { id?: unknown }).id);
    this.contextService.run(requestId, () => next());
  }
}
