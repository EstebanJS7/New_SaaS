/**
 * Canonical `sales.*` permission contract (EPIC-12 POS-001). The four keys MUST
 * exist in the seed-owned catalog (`PERMISSION_SEEDS` in `@newsaas/database`),
 * seeded with the DEC-026 matrix: all six roles hold `read`, and
 * `OWNER`/`ADMIN`/`CASHIER` hold the three write keys. The sale controller
 * declares every key with `@RequirePermissions`, and the route probe pins
 * alignment so a future rename cannot silently orphan a route.
 *
 * Unlike the ungated Core precedent of DEC-016, the whole surface — reads
 * included — is ALSO gated on the `sales` entitlement through
 * `EntitlementsService.has` (DEC-026): the entitlement is asserted FIRST
 * (`403 FEATURE_NOT_ENTITLED`) and this granular permission SECOND
 * (`403 FORBIDDEN`). The UI gate is UX only; both backend checks are mandatory.
 */
export const SALES_PERMISSIONS = Object.freeze({
  read: "sales.read",
  create: "sales.create",
  update: "sales.update",
  cancel: "sales.cancel",
} as const);

export type SalesPermission = (typeof SALES_PERMISSIONS)[keyof typeof SALES_PERMISSIONS];
