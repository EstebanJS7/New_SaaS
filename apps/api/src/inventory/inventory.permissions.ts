/**
 * Canonical `inventory.stock.*` permission contract (EPIC-10 W2). Both keys
 * MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`): the inventory controller declares them with
 * `@RequirePermissions`, and the route probe pins alignment so a future
 * inventory rename cannot silently orphan a route.
 *
 * `read` is the read-wide key (all six staff roles) and `adjust` the
 * owning-roles write key (OWNER/ADMIN/INVENTORY_MANAGER), the matrix W1
 * seeded. `inventory.stock.transfer` is deliberately NOT declared here: the
 * transfer command belongs to a later epic.
 */
export const INVENTORY_PERMISSIONS = Object.freeze({
  read: "inventory.stock.read",
  adjust: "inventory.stock.adjust",
} as const);

export type InventoryPermission =
  (typeof INVENTORY_PERMISSIONS)[keyof typeof INVENTORY_PERMISSIONS];
