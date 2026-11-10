import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each invoice command needs ([[UX-037]]). UX only: the API stays the
 * authority. Source: apps/api/src/billing/billing.controller.ts
 * (`@RequirePermissions(BILLING_PERMISSIONS.*)`); BillingService asserts the
 * `billing` entitlement before the permission.
 */
export const BILLING_ACTIONS = {
  /** Any billing screen: the entitlement every billing call asserts first. */
  enabled: { feature: "billing" },
  /** `POST /invoices` */
  create: { permission: "billing.create", feature: "billing" },
  /** `POST /invoices/:id/confirm` */
  confirm: { permission: "billing.confirm", feature: "billing" },
  /** `POST /invoices/:id/cancel` */
  cancel: { permission: "billing.cancel", feature: "billing" },
} as const satisfies Record<string, CapabilityRequirement>;
