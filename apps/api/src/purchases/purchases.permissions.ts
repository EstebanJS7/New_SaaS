/**
 * Canonical `purchases.*` permission contract (EPIC-11 PUR-001/PUR-002). The
 * five keys MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`), seeded with the DEC-016 matrix: all six roles hold
 * `read`, and `OWNER`/`ADMIN`/`INVENTORY_MANAGER` hold the four write keys,
 * `receive` included. `purchases.receive` is the sealed fifth key of DEC-016 and
 * gates the PUR-002 receiving command; the purchase controller declares every
 * key with `@RequirePermissions`, and the route probe pins alignment so a
 * future rename cannot silently orphan a route.
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
  receive: "purchases.receive",
} as const);

export type PurchasesPermission =
  (typeof PURCHASES_PERMISSIONS)[keyof typeof PURCHASES_PERMISSIONS];
