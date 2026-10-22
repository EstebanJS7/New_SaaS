/**
 * Canonical `reports.*` permission contract (EPIC-18 REP-002, [[DEC-062]]).
 *
 * Both keys MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`), seeded with the DEC-062 matrix: all six roles hold
 * `read`, and `OWNER`/`ADMIN` alone hold `export`.
 *
 * WHY EXPORT IS A SEPARATE KEY: reading an aggregate on the caller's own screen
 * and taking a file out of the system are different decisions. A CSV (or any
 * other download) crosses the tenant's boundary, survives the session that
 * produced it and is trivially forwarded, so the grant is narrower than the
 * render grant even though both read the same rows.
 *
 * There is NO feature-code gate on this surface: [[DEC-062]] rejected
 * `advanced_reports` and a thirteenth code, because a report aggregates data the
 * tenant already owns through its own domain surfaces. Nothing here asserts an
 * entitlement, and the module is deliberately not an `EntitlementsModule`
 * consumer.
 */
export const REPORTING_PERMISSIONS = Object.freeze({
  read: "reports.read",
  export: "reports.export",
} as const);

export type ReportingPermission =
  (typeof REPORTING_PERMISSIONS)[keyof typeof REPORTING_PERMISSIONS];
