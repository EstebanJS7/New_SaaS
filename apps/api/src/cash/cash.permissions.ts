/**
 * Canonical `cash.*` permission contract (EPIC-12 POS-002). The three keys MUST
 * exist in the seed-owned catalog (`PERMISSION_SEEDS` in `@newsaas/database`),
 * seeded with the DEC-026 matrix as extended on 2026-09-29: all six roles hold
 * `read`, and `OWNER`/`ADMIN`/`CASHIER` hold the two write keys. The cash
 * controller declares every key with `@RequirePermissions`, and the route probe
 * pins alignment so a future rename cannot silently orphan a route.
 *
 * Unlike the ungated Core precedent of DEC-016, the whole surface — reads
 * included — is ALSO gated on the `cash` capability through
 * `EntitlementsService.has(tenantId, "cash")` (DEC-026 subsequent-scope note of
 * 2026-09-29): `cash` is its own seeded feature code (PRD §10), exactly as
 * `sales` gates the sale surface. The entitlement is asserted FIRST
 * (`403 FEATURE_NOT_ENTITLED`) and this granular permission SECOND
 * (`403 FORBIDDEN`). The UI gate is UX only; both backend checks are mandatory.
 *
 * The already-seeded `cash.session.close` key stays reserved for EPIC-13 and is
 * consumed by no EPIC-12 route.
 */
export const CASH_PERMISSIONS = Object.freeze({
  read: "cash.read",
  createRegister: "cash.register.create",
  openSession: "cash.session.open",
} as const);

export type CashPermission = (typeof CASH_PERMISSIONS)[keyof typeof CASH_PERMISSIONS];
