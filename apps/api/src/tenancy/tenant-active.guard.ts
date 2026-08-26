import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "@newsaas/shared";
import type { FastifyRequest } from "fastify";
import { RequestContextService } from "../context/request-context.service.js";
import { IS_PUBLIC_ROUTE_KEY } from "../auth/public.decorator.js";
import { TenantMembershipRepository } from "./tenant-membership.repository.js";

const AUTH_ROUTE_SEGMENT = "/auth";

/**
 * Global tenant-authority gate — the SECOND link in the D3 guard chain:
 *
 *   AuthGuard (session → userProfileId) → TenantActiveGuard (membership →
 *   tenantId/membershipId/roleCode) → handler
 *
 * Registration order is production behavior: AppModule must compose
 * TenancyModule AFTER AuthModule, so this guard only ever sees a context that
 * authentication already enriched. `tenancy.wiring.test.ts` pins that source
 * order and `cross-tenant-isolation.e2e-spec.ts` proves it at runtime: an
 * authenticated session without membership gets 403 here, while the same
 * session still passes on `/auth/*` routes.
 *
 * Skip rules (design D3): `@Public` routes and the whole `/auth/*` surface.
 * Auth endpoints stay reachable for membership-less sessions (`/auth/me`,
 * `/auth/logout`), and login itself is anonymous. Everything else REQUIRES an
 * ACTIVE membership resolved server-side — the effective tenant derives
 * exclusively from the session's membership rows; request body/query/headers
 * are never consulted (spec: Server-authoritative tenant resolution).
 */
@Injectable()
export class TenantActiveGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
    private readonly memberships: TenantMembershipRepository
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
    // Guards execute after routing, so the matched route pattern is available;
    // an absent pattern falls through to PRIVATE treatment (fail closed).
    const routePattern = request.routeOptions.url ?? "";
    if (routePattern === AUTH_ROUTE_SEGMENT || routePattern.startsWith(`${AUTH_ROUTE_SEGMENT}/`)) {
      return true;
    }

    // Chain-contract defense: fail CLOSED as UNAUTHENTICATED if this guard
    // ever runs without an authenticated identity behind it (mis-wiring),
    // instead of leaking a membership lookup for an unknown caller.
    const userProfileId = this.requestContext.requireUserProfileId();

    const membership = await this.memberships.resolveActiveForProfile(userProfileId);
    if (!membership) {
      // Covers zero memberships AND suspended-only memberships alike — the
      // resolver query matches ACTIVE rows exclusively (spec: no membership,
      // no tenant authority).
      throw new DomainError("FORBIDDEN", "An active tenant membership is required.");
    }

    this.requestContext.setTenantMembership({
      tenantId: membership.tenantId,
      membershipId: membership.id,
      roleId: membership.roleId,
      roleCode: membership.roleCode,
    });
    return true;
  }
}
