import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "@newsaas/shared";
import type { FastifyRequest } from "fastify";
import { IS_PUBLIC_ROUTE_KEY } from "../auth/public.decorator.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { isPortalSurfacePath } from "../rbac/route-contract.js";
import { PORTAL_FEATURE_CODE } from "./portal.constants.js";
import { PORTAL_SESSION_COOKIE } from "./portal-session-cookie.js";
import { PortalSessionService } from "./portal-session.service.js";

/**
 * Global PORTAL authentication gate (EPIC-08 D2) — the isolated twin of the
 * staff AuthGuard.
 *
 * Enforcement is scoped to the `/portal/*` surface ONLY (`isPortalSurfacePath`):
 * every other route passes through untouched, and the staff guards symmetrically
 * skip the portal surface. Consequences, by construction:
 *
 * - a staff session cookie is never read here, so it cannot authorize a portal
 *   route (staff routes ↔ portal routes never accept each other's credentials);
 * - the portal cookie is never read by the staff chain, so it cannot authorize
 *   a staff route;
 * - `@Public` (portal login) is the ONLY opt-out and applies within the portal
 *   surface only — the surface predicate, not `@Public`, is what keeps portal
 *   routes out of the staff chain.
 *
 * Resolution order is authentication THEN entitlement: an anonymous request is
 * always 401 even when the tenant is unentitled, and only an authenticated
 * holder ever receives 403 FEATURE_NOT_ENTITLED. On success the RequestContext
 * is enriched with the holder's tenant, Customer and access id — all derived
 * from the session's own access row, never from client input.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
    private readonly sessions: PortalSessionService,
    private readonly entitlements: EntitlementsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // Guards execute after routing; an absent pattern falls through to a skip
    // because this guard only ever enforces the portal surface, and an
    // unmatched request never reaches a handler.
    if (!isPortalSurfacePath(request.routeOptions.url ?? "")) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // Portal login is the only anonymous portal-surface route.
      return true;
    }

    const token = request.cookies?.[PORTAL_SESSION_COOKIE];
    const session = await this.sessions.resolve(token);
    if (!session) {
      // Missing cookie, unknown token, revoked/expired session, or a session
      // whose holder is no longer ACTIVE — one uniform rejection.
      throw new DomainError("UNAUTHENTICATED", "Portal authentication required.");
    }

    if (!(await this.entitlements.has(session.tenantId, PORTAL_FEATURE_CODE))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Portal features are not enabled for this tenant."
      );
    }

    this.requestContext.setPortalIdentity({
      tenantId: session.tenantId,
      customerId: session.customerId,
      portalAccessId: session.portalAccessId,
    });
    return true;
  }
}
