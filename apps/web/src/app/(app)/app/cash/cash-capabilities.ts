import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each cash command needs ([[UX-037]]). UX only: the API stays the
 * authority. Source: apps/api/src/cash/cash.controller.ts
 * (`@RequirePermissions(CASH_PERMISSIONS.*)`); CashService asserts the `cash`
 * entitlement before the permission.
 */
export const CASH_ACTIONS = {
  /** Any cash screen: the entitlement every cash call asserts first. */
  enabled: { feature: "cash" },
  /** `POST /cash/registers` */
  createRegister: { permission: "cash.register.create", feature: "cash" },
  /** `POST /cash/sessions` */
  openSession: { permission: "cash.session.open", feature: "cash" },
  /** `POST /cash/movements` */
  createMovement: { permission: "cash.movement.create", feature: "cash" },
  /** `POST /cash/sessions/:id/close` */
  closeSession: { permission: "cash.session.close", feature: "cash" },
} as const satisfies Record<string, CapabilityRequirement>;
