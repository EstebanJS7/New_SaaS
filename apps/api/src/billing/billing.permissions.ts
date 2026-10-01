/**
 * Canonical `billing.*` permission contract (EPIC-14 BILL-001/BIL-002). The four
 * keys MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`), seeded with the DEC-040 matrix: all six roles hold
 * `read`, and `OWNER`/`ADMIN`/`CASHIER` hold the three write keys. The invoice
 * controller declares each key it consumes with `@RequirePermissions`, and the
 * route probe pins alignment so a future rename cannot silently orphan a route.
 *
 * Like the entitlement-gated Core precedents of DEC-016/DEC-026, the whole
 * surface — reads included — is ALSO gated on the `billing` entitlement through
 * `EntitlementsService.has` (DEC-040): the entitlement is asserted FIRST
 * (`403 FEATURE_NOT_ENTITLED`) and the granular permission SECOND
 * (`403 FORBIDDEN`). The UI gate is UX only; both backend checks are mandatory.
 *
 * BILL-002 consumes `read` and `create` only. `confirm` and `cancel` are the
 * BILL-003 lifecycle keys: they are declared here because the family is closed
 * and seed-pinned, and this work unit must NOT reference them from any route.
 */
export const BILLING_PERMISSIONS = Object.freeze({
  read: "billing.read",
  create: "billing.create",
  confirm: "billing.confirm",
  cancel: "billing.cancel",
} as const);

export type BillingPermission = (typeof BILLING_PERMISSIONS)[keyof typeof BILLING_PERMISSIONS];
