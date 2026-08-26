import { IS_PUBLIC_ROUTE_KEY } from "../auth/public.decorator.js";
import { REQUIRE_PERMISSIONS_KEY } from "./require-permissions.decorator.js";

/**
 * THE route-contract vocabulary shared by the PermissionGuard (runtime
 * enforcement) and the route-contract probe test (build-time fence) — review
 * suggestion: a single predicate so the two consumers can never drift on what
 * counts as public-exempt.
 *
 * Buckets (every private route falls in exactly one):
 * - PUBLIC-EXEMPT: `@Public` metadata or the `/auth/*` surface — skipped with
 *   the SAME rules as AuthGuard/TenantActiveGuard (auth stays reachable
 *   membership-less);
 * - DECLARED: `@RequirePermissions` metadata present (empty array included =
 *   authenticated-only);
 * - VIOLATION: neither — deny-by-default rejects the request pre-handler and
 *   the probe fails the build naming the route.
 */

/** Path prefix of the deliberately membership-less auth surface. */
export const AUTH_ROUTE_SEGMENT = "/auth";

/**
 * True when the route pattern is part of the `/auth/*` surface. Guard-side
 * this runs on the matched Fastify route pattern; probe-side on the
 * enumerated controller path.
 */
export function isAuthSurfacePath(path: string): boolean {
  return path === AUTH_ROUTE_SEGMENT || path.startsWith(`${AUTH_ROUTE_SEGMENT}/`);
}

/** Minimal contract view both consumers already hold at their call sites. */
export interface RouteContractShape {
  /** Normalized absolute route pattern, e.g. `/memberships/:id`. */
  readonly path: string;
  /** `@Public` present (handler-level override beats class-level). */
  readonly isPublic: boolean;
}

/** Public-exempt bucket: `@Public` OR the auth surface. */
export function isPublicExemptRoute(entry: RouteContractShape): boolean {
  return entry.isPublic || isAuthSurfacePath(entry.path);
}

/** Metadata keys, re-exported for consumers that must read them raw. */
export const ROUTE_CONTRACT_KEYS = {
  isPublic: IS_PUBLIC_ROUTE_KEY,
  requirePermissions: REQUIRE_PERMISSIONS_KEY,
} as const;
