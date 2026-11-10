import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each purchase write needs ([[UX-037]]). UX only: the API stays the
 * authority. Source: apps/api/src/purchases/purchases.controller.ts
 * (`@RequirePermissions(PURCHASES_PERMISSIONS.*)`); purchases have no entitlement.
 */
export const PURCHASE_ACTIONS = {
  /** `POST /purchases` */
  create: { permission: "purchases.create" },
  /** `PUT /purchases/:id` */
  update: { permission: "purchases.update" },
  /** `POST /purchases/:id/cancel` */
  cancel: { permission: "purchases.cancel" },
  /** `POST /purchases/:id/receive` */
  receive: { permission: "purchases.receive" },
} as const satisfies Record<string, CapabilityRequirement>;
