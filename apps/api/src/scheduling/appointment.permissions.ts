/**
 * Canonical `scheduling.appointment.*` permission contract (EPIC-07 design).
 * The keys MUST exist in the seed-owned catalog (`PERMISSION_SEEDS` in
 * `@newsaas/database`): WU3 controllers declare them with
 * `@RequirePermissions`, and the service re-asserts them as defense in depth
 * for non-HTTP callers and forgotten route metadata.
 *
 * `scheduling.settings.manage` (availability/blocks/policy writes) is owned by
 * the `tenant-settings` capability and defined in the settings registry, so it
 * is deliberately not duplicated here.
 */
export const SCHEDULING_PERMISSIONS = Object.freeze({
  read: "scheduling.appointment.read",
  /** Create and reschedule. */
  manage: "scheduling.appointment.manage",
  /** Named lifecycle commands. */
  transition: "scheduling.appointment.transition",
} as const);

export type SchedulingPermission =
  (typeof SCHEDULING_PERMISSIONS)[keyof typeof SCHEDULING_PERMISSIONS];
