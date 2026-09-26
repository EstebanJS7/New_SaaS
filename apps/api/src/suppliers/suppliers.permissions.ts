/**
 * Canonical `suppliers.*` permission contract (EPIC-11 W2). The four keys MUST
 * exist in the seed-owned catalog (`PERMISSION_SEEDS` in `@newsaas/database`),
 * seeded by W1 with the DEC-016 matrix: all six roles hold `read`, and
 * `OWNER`/`ADMIN`/`INVENTORY_MANAGER` hold the three write keys. The supplier
 * controller declares them with `@RequirePermissions`, and the route probe pins
 * alignment so a future supplier rename cannot silently orphan a route.
 *
 * The supplier registry is a Core Business capability, so it declares no
 * entitlement key: there is no plan-level gate, exactly as the catalog and
 * inventory modules state.
 */
export const SUPPLIERS_PERMISSIONS = Object.freeze({
  read: "suppliers.read",
  create: "suppliers.create",
  update: "suppliers.update",
  deactivate: "suppliers.deactivate",
} as const);

export type SuppliersPermission =
  (typeof SUPPLIERS_PERMISSIONS)[keyof typeof SUPPLIERS_PERMISSIONS];
