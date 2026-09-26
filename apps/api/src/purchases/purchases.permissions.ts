/**
 * Canonical `purchases.*` permission contract (EPIC-11 PUR-001). The four keys
 * MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`), seeded by P1 with the DEC-016 matrix: all six roles hold
 * `read`, and `OWNER`/`ADMIN`/`INVENTORY_MANAGER` hold the three write keys. The
 * purchase controller declares them with `@RequirePermissions`, and the route
 * probe pins alignment so a future rename cannot silently orphan a route.
 *
 * `purchases.receive` is deliberately ABSENT: the receive command belongs to
 * PUR-002 and its key arrives with that slice (DEC-016). Declaring it here would
 * route-probe a route this slice does not ship.
 *
 * Purchases are a Core Business capability, so this boundary declares no
 * entitlement key: there is no plan-level gate, exactly as the catalog,
 * inventory and supplier modules state.
 */
export const PURCHASES_PERMISSIONS = Object.freeze({
  read: "purchases.read",
  create: "purchases.create",
  update: "purchases.update",
  cancel: "purchases.cancel",
} as const);

export type PurchasesPermission =
  (typeof PURCHASES_PERMISSIONS)[keyof typeof PURCHASES_PERMISSIONS];
