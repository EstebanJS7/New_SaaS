/**
 * Canonical `imports.*` permission contract (EPIC-19 IMP-001, [[DEC-072]]).
 *
 * Both keys MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`), seeded with the DEC-072 matrix: all six roles hold
 * `read`, and `OWNER`/`ADMIN` alone hold `run`.
 *
 * WHY RUN IS NARROWER THAN READ: reading an import is reading a job the tenant
 * already ran. RUNNING one creates hundreds of customer or patient records in a
 * single command, so it is the one action in this epic an operator should be
 * deliberate about — and the same read-wide / write-to-the-owning-roles split
 * every other domain in this repository uses.
 *
 * There is NO feature-code gate on this surface: [[DEC-072]] refused a thirteenth
 * code (after [[DEC-058]] and [[DEC-062]] refused the same move), because
 * importing is a staff action over data the tenant already owns. Nothing in the
 * imports module asserts an entitlement.
 */
export const IMPORTS_PERMISSIONS = Object.freeze({
  read: "imports.read",
  run: "imports.run",
} as const);

export type ImportsPermission = (typeof IMPORTS_PERMISSIONS)[keyof typeof IMPORTS_PERMISSIONS];
