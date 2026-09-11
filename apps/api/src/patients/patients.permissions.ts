/**
 * Canonical `patients.*` permission contract (EPIC-05 design). The keys MUST
 * exist in the seed-owned catalog (`PERMISSION_SEEDS` in `@newsaas/database`):
 * WU3 controllers declare them with `@RequirePermissions`, and the boundary
 * test pins alignment so a future catalog rename cannot silently orphan a
 * route.
 */
export const PATIENT_PERMISSIONS = Object.freeze({
  read: "patients.read",
  create: "patients.create",
  update: "patients.update",
  deactivate: "patients.deactivate",
  guardianManage: "patients.guardian.manage",
} as const);

export type PatientPermission = (typeof PATIENT_PERMISSIONS)[keyof typeof PATIENT_PERMISSIONS];
