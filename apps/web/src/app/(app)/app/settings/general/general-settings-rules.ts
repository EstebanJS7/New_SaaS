/**
 * Pure rules of «Configuración › General» ([[CFG-001]]). UX only: the API's
 * settings registry (`apps/api/src/settings/registry.ts`) is the authority for
 * permissions, entitlements and validation, and re-checks every write.
 */

export type SettingsNamespace = "sales" | "portal" | "notifications" | "scheduling";

/** Page order of the sections. */
export const SETTINGS_SECTIONS: readonly SettingsNamespace[] = [
  "sales",
  "portal",
  "notifications",
  "scheduling",
];

/** Mirrors each registry definition's `requiredPermissionKey` and `requiresFeature`. */
export const SECTION_GATES: Readonly<
  Record<SettingsNamespace, { readonly permission: string; readonly feature?: string }>
> = {
  sales: { permission: "sales.settings.manage", feature: "sales" },
  portal: { permission: "portal.settings.manage", feature: "portal" },
  notifications: { permission: "notifications.settings.manage" },
  scheduling: { permission: "scheduling.settings.manage" },
};

/**
 * Mirrors `NOTIFICATION_REMINDER_LEAD_HOURS_MIN/MAX` and
 * `NOTIFICATION_REMINDER_CHANNELS` of `@newsaas/notifications`, which the web
 * cannot import (it carries BullMQ and the mailer). `general-settings-rules.test.ts`
 * reads that package's source and fails when they drift.
 */
export const REMINDER_LEAD_HOURS_MIN = 1;
export const REMINDER_LEAD_HOURS_MAX = 168;
export const REMINDER_CHANNELS = ["EMAIL", "WHATSAPP"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/**
 * The sections the caller is offered. Unknown permissions or entitlements
 * (`undefined`) never hide a section, the same default as the navigation.
 */
export function visibleSections(
  permissions: readonly string[] | undefined,
  entitlements: readonly string[] | undefined
): SettingsNamespace[] {
  return SETTINGS_SECTIONS.filter((namespace) => {
    const gate = SECTION_GATES[namespace];
    if (permissions !== undefined && !permissions.includes(gate.permission)) return false;
    if (entitlements !== undefined && gate.feature !== undefined) {
      return entitlements.includes(gate.feature);
    }
    return true;
  });
}

/** Unique, known channels in the API's order. */
export function normalizeChannels(channels: readonly string[]): ReminderChannel[] {
  return REMINDER_CHANNELS.filter((channel) => channels.includes(channel));
}

export function isValidLeadHours(value: number): boolean {
  return (
    Number.isInteger(value) && value >= REMINDER_LEAD_HOURS_MIN && value <= REMINDER_LEAD_HOURS_MAX
  );
}

/**
 * The patch body: only the draft keys whose value differs from the loaded
 * settings. The API merges a partial patch, so unchanged keys — and keys this
 * form does not edit, such as the agenda's `availability` and `blocks` — are
 * never sent and never overwritten.
 */
export function changedFields(
  current: Readonly<Record<string, unknown>>,
  draft: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) patch[key] = value;
  }
  return patch;
}
