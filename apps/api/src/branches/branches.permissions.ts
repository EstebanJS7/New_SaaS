/**
 * MB-001 (DEC-094 §4): the single `branches.manage` key, held by OWNER and
 * ADMIN. It covers the branch registry and the staff assignment, both
 * configuration rather than routine operation.
 */
export const BRANCH_PERMISSIONS = Object.freeze({ manage: "branches.manage" } as const);
