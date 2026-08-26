import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "@newsaas/shared";
import type { FastifyRequest } from "fastify";
import { RequestContextService } from "../context/request-context.service.js";
import { IS_PUBLIC_ROUTE_KEY } from "../auth/public.decorator.js";
import { REQUIRE_PERMISSIONS_KEY } from "./require-permissions.decorator.js";
import { PermissionResolver } from "./permission-resolver.service.js";
import { isAuthSurfacePath } from "./route-contract.js";

/**
 * Deny-by-default permission gate — the THIRD link in the guard chain
 * (EPIC-02 design D1):
 *
 *   AuthGuard → TenantActiveGuard → PermissionGuard → handler
 *
 * Route contract (every route falls in exactly one bucket):
 * 1. public-exempt — `@Public` or the `/auth/*` surface: skipped with the SAME
 *    rules as the two upstream guards (auth stays reachable membership-less);
 * 2. declared — `@RequirePermissions` metadata present (empty array included:
 *    authenticated-only); ALL declared keys must resolve from the active
 *    role's RolePermission rows (logical AND, design D1);
 * 3. VIOLATION — private route WITHOUT the decorator: rejected FORBIDDEN here,
 *    before any handler executes. This is what makes undeclared routes
 *    unreachable and keeps the route-contract probe meaningful.
 *
 * Fail-closed guarantees: absent authentication context ⇒ UNAUTHENTICATED;
 * absent tenant/role context ⇒ FORBIDDEN — never an allow. Zero roleCode /
 * profile bypass branches exist by design: ADMIN authority is DATA (its seeded
 * RolePermission rows), never code.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
    private readonly resolver: PermissionResolver
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
    // Shared predicate (route-contract.ts) — identical rules to the probe.
    if (isAuthSurfacePath(request.routeOptions.url ?? "")) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required === null) {
      // Deny-by-default: an undeclared PRIVATE route is a contract violation,
      // not a missing requirement to be tolerated.
      throw new DomainError("FORBIDDEN", "Route is not registered in the permission contract.");
    }

    // Chain-contract defense (fail closed): this guard must only ever see a
    // context the two upstream guards enriched. Missing identity is a wiring
    // breach ⇒ UNAUTHENTICATED; missing membership/role ⇒ FORBIDDEN. Both
    // assertions run BEFORE any resolver interaction so a mis-wired chain can
    // never reach the database through this link.
    this.requestContext.requireUserProfileId();
    this.requestContext.requireTenantId();
    this.requestContext.requireRoleId();

    if (required.length === 0) {
      // Explicit authenticated-only declaration — no catalog key needed.
      return true;
    }

    const resolved = await this.resolver.resolveForActiveRequest();
    const missing = required.filter((key) => !resolved.has(key));
    if (missing.length > 0) {
      throw new DomainError("FORBIDDEN", "Insufficient permissions for this operation.");
    }
    return true;
  }
}
