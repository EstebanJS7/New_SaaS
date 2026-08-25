import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "@newsaas/shared";
import type { FastifyRequest } from "fastify";
import { RequestContextService } from "../context/request-context.service.js";
import { IS_PUBLIC_ROUTE_KEY } from "./public.decorator.js";
import { STAFF_SESSION_COOKIE } from "./session-cookie.js";
import { SessionService } from "./session.service.js";

/**
 * Global authentication gate (design D3 wire order).
 *
 * Public routes (`@Public`: `/health*`, `/auth/login`) pass through untouched.
 * Every other route requires a live staff session cookie; on success the
 * RequestContext is enriched with the authenticated profile id — handlers
 * NEVER read identity from client-supplied fields. Failures throw the domain
 * UNAUTHENTICATED error before the handler runs, and the global filter renders
 * the 401 envelope.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly requestContext: RequestContextService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.[STAFF_SESSION_COOKIE];
    const session = await this.sessions.resolve(token);
    if (!session) {
      // Covers: missing cookie, unknown token, revoked (deleted), idle-expired
      // and absolute-expired sessions alike — one uniform rejection.
      throw new DomainError("UNAUTHENTICATED", "Authentication required.");
    }

    this.requestContext.setUserProfileId(session.userProfileId);
    return true;
  }
}
