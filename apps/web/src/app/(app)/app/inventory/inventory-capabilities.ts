import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each stock write offered here needs ([[UX-037]]). UX only: the API stays
 * the authority. Source: apps/api/src/inventory/inventory.controller.ts
 * (`@RequirePermissions(INVENTORY_PERMISSIONS.transfer)` on
 * `POST /inventory/stock/transfers`); inventory has no entitlement. Stock
 * adjustments (`inventory.stock.adjust`) have no web entry point yet.
 */
export const INVENTORY_ACTIONS = {
  transfer: { permission: "inventory.stock.transfer" },
} as const satisfies Record<string, CapabilityRequirement>;
