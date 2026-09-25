/**
 * Canonical `catalog.*` permission contract (EPIC-09 WU2). The keys MUST exist
 * in the seed-owned catalog (`PERMISSION_SEEDS` in `@newsaas/database`): the
 * catalog controllers declare them with `@RequirePermissions`, and the route
 * probe pins alignment so a future catalog rename cannot silently orphan a
 * route.
 *
 * This read slice declares only `read`; the create/update/deactivate keys are
 * already seeded by WU2 A1 and are consumed by the write surface.
 */
export const CATALOG_PERMISSIONS = Object.freeze({
  read: "catalog.read",
  create: "catalog.create",
  update: "catalog.update",
  deactivate: "catalog.deactivate",
} as const);

export type CatalogPermission = (typeof CATALOG_PERMISSIONS)[keyof typeof CATALOG_PERMISSIONS];
