import { DomainError } from "@newsaas/shared";
import { notificationsSettingsSchema, type NotificationsSettings } from "../settings/registry.js";

/**
 * The typed `notifications` settings reader, the `loadSchedulingSettings`
 * precedent: the namespace is re-parsed through the registry's own schema, so a
 * stored-but-invalid namespace surfaces as an INTERNAL rather than as an
 * `undefined` that a policy function would arithmetic on.
 *
 * The shape is validated defensively even though the write path validated it:
 * a row can predate a schema version, and the read is where that becomes visible.
 */
export interface NotificationSettingsReader {
  get: (namespace: string) => Promise<Record<string, unknown>>;
}

export async function loadNotificationsSettings(
  settings: NotificationSettingsReader
): Promise<NotificationsSettings> {
  const raw = await settings.get("notifications");
  const parsed = notificationsSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("INTERNAL", "Stored notification settings are invalid.");
  }
  return parsed.data;
}
