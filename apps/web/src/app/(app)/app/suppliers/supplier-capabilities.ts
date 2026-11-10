import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each supplier write needs ([[UX-037]]). UX only: the API stays the
 * authority. Source: apps/api/src/suppliers/suppliers.controller.ts
 * (`@RequirePermissions(SUPPLIERS_PERMISSIONS.*)`); suppliers have no entitlement.
 */
export const SUPPLIER_ACTIONS = {
  /** `POST /suppliers` */
  create: { permission: "suppliers.create" },
  /** `PUT /suppliers/:id` */
  update: { permission: "suppliers.update" },
  /** `POST /suppliers/:id/deactivate` */
  deactivate: { permission: "suppliers.deactivate" },
} as const satisfies Record<string, CapabilityRequirement>;
