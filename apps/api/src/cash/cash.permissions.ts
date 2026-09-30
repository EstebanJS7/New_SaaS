/**
 * Canonical `cash.*` permission contract (EPIC-12 POS-002, extended by EPIC-13
 * CASH-002). The four keys MUST exist in the seed-owned catalog
 * (`PERMISSION_SEEDS` in `@newsaas/database`), seeded with the DEC-026 matrix as
 * extended on 2026-09-29 and DEC-034: all six roles hold `read`, and
 * `OWNER`/`ADMIN`/`CASHIER` hold the three write keys. The cash controller
 * declares every key with `@RequirePermissions`, and the route probe pins
 * alignment so a future rename cannot silently orphan a route.
 *
 * Unlike the ungated Core precedent of DEC-016, the whole surface — reads
 * included — is ALSO gated on the `cash` capability through
 * `EntitlementsService.has(tenantId, "cash")` (DEC-026 subsequent-scope note of
 * 2026-09-29): `cash` is its own seeded feature code (PRD §10), exactly as
 * `sales` gates the sale surface. The entitlement is asserted FIRST
 * (`403 FEATURE_NOT_ENTITLED`) and this granular permission SECOND
 * (`403 FORBIDDEN`). The UI gate is UX only; both backend checks are mandatory.
 *
 * EPIC-13 CASH-002 consumes the seeded `cash.movement.create` key (DEC-034) for
 * the standalone non-sale movement command. The already-seeded
 * `cash.session.close` key stays reserved for CASH-003 and is consumed by no
 * route yet.
 */
export const CASH_PERMISSIONS = Object.freeze({
  read: "cash.read",
  createRegister: "cash.register.create",
  openSession: "cash.session.open",
  createMovement: "cash.movement.create",
} as const);

export type CashPermission = (typeof CASH_PERMISSIONS)[keyof typeof CASH_PERMISSIONS];
