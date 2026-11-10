import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each catalog write needs ([[UX-037]]). UX only: the API stays the
 * authority. Source: apps/api/src/catalog/catalog.controller.ts
 * (`@RequirePermissions(CATALOG_PERMISSIONS.*)`); catalog has no entitlement.
 */
export const CATALOG_ACTIONS = {
  /** `POST /catalog` */
  create: { permission: "catalog.create" },
  /** `PUT /catalog/:id` */
  update: { permission: "catalog.update" },
  /** `POST /catalog/:id/deactivate` */
  deactivate: { permission: "catalog.deactivate" },
} as const satisfies Record<string, CapabilityRequirement>;
