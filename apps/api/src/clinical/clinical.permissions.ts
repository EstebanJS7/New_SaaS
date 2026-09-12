/**
 * Canonical `vet.clinical.*` permission contract (EPIC-06 design). The keys
 * MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`): WU3 controllers declare them with
 * `@RequirePermissions`, and the service re-asserts them as defense in depth
 * for non-HTTP callers and forgotten route metadata.
 */
export const CLINICAL_PERMISSIONS = Object.freeze({
  read: "vet.clinical.read",
  create: "vet.clinical.create",
  update: "vet.clinical.update",
  close: "vet.clinical.close",
  amend: "vet.clinical.amend",
} as const);

export type ClinicalPermission = (typeof CLINICAL_PERMISSIONS)[keyof typeof CLINICAL_PERMISSIONS];
