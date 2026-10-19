/**
 * The portal password-recovery message's identity ([[PORTAL-002]]).
 *
 * The staff policy's sibling, and the differences are the identity's rather than the message's.
 */

/** Fixed, like the staff recovery's: a reset link is inherently an email-shaped thing. */
export const PORTAL_RECOVERY_CHANNEL = "EMAIL" as const;

/**
 * The window a request falls in, the instant truncated to the HOUR, UTC.
 *
 * The window exists for the same reason the staff one does: the delivery's dedupe key is unique per
 * tenant and released only by `CANCELLED`, so a window-less key would mean an access could receive
 * exactly ONE recovery email ever. The hour is also the anti-abuse budget — one message per holder
 * per hour however often the endpoint is called, so it cannot be turned into an email amplifier.
 */
export function portalRecoveryWindow(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/**
 * The delivery's logical identity: one recovery message per PORTAL ACCESS per hour.
 *
 * Keyed by the access rather than the customer, because the holder is what the token authorises: a
 * customer with two accesses would otherwise have one window for both, and a message for one would
 * suppress the other's.
 */
export function portalRecoveryDedupeKey(args: { portalAccessId: string; now: Date }): string {
  return `portal-recovery:${args.portalAccessId}:${portalRecoveryWindow(args.now)}`;
}

/**
 * The link a portal recovery message carries.
 *
 * The slug is in the PATH, because the portal surface is `/[slug]/…` — the page the link lands on
 * must know which clinic the holder is at before any session exists.
 */
export function portalRecoveryUrl(baseUrl: string, tenantSlug: string, token: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/${encodeURIComponent(tenantSlug)}/reset-password?token=${encodeURIComponent(token)}`;
}
