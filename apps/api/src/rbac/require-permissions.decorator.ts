import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key carrying a route's required permission keys (EPIC-02 design
 * D1). Presence semantics are THREE-STATE and security-relevant:
 *
 * - absent          ⇒ private route violating the deny-by-default contract
 *                     (PermissionGuard rejects with FORBIDDEN pre-handler);
 * - present + empty  ⇒ authenticated-only declaration (no catalog key needed,
 *                     but tenant context still enforced by upstream guards);
 * - present + keys   ⇒ ALL listed keys must resolve from the active role's
 *                     RolePermission rows (logical AND — no OR variant).
 */
export const REQUIRE_PERMISSIONS_KEY = "ns:require-permissions";

/**
 * Declares the permission keys a route requires. Keys MUST exist in the
 * seed-owned permission catalog (`PERMISSION_SEEDS` in @newsaas/database);
 * declaring unknown keys would create permanently-unreachable routes.
 */
export const RequirePermissions = (...keys: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, keys);
