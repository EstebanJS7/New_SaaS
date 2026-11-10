import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each sale write needs ([[UX-037]]). UX only: the API stays the
 * authority. Source: apps/api/src/sales/sales.controller.ts
 * (`@RequirePermissions(SALES_PERMISSIONS.*)`); SalesService and
 * SaleReversalService assert the `sales` entitlement before the permission.
 */
export const SALE_ACTIONS = {
  /**
   * The counter always creates the draft and completes it in one checkout:
   * `POST /sales` (`sales.create`) then `POST /sales/:id/complete` (`sales.complete`).
   */
  sell: { permission: ["sales.create", "sales.complete"], feature: "sales" },
  /** `POST /sales/:id/complete` on a saved draft. */
  complete: { permission: "sales.complete", feature: "sales" },
  /** `POST /sales/:id/reverse` (SAL-REV-001). */
  reverse: { permission: "sales.reverse", feature: "sales" },
} as const satisfies Record<string, CapabilityRequirement>;
