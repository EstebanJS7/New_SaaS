import { NOTIFICATION_DELIVERY_REASON, type NotificationChannel } from "@newsaas/notifications";

/**
 * The content seam: what the message SAYS.
 *
 * It exists for the same reason the fiscal boundary's document-builder seam does
 * ([[DEC-056]]): the delivery path can be complete, wired and tested while the
 * content that depends on a domain's own rows is one unit away. The reminder's
 * real builder is [[NOTIF-003]]'s — it reads the appointment and renders the
 * message — and this unit must not invent it.
 *
 * The default fails closed and by name, so a delivery that arrives before that
 * unit lands settles with `NOTIFICATION_CONTENT_UNAVAILABLE` instead of sending
 * an empty message or retrying forever.
 */

export interface NotificationContentRequest {
  readonly tenantId: string;
  readonly deliveryId: string;
  readonly channel: NotificationChannel;
}

export type NotificationContentOutcome =
  | {
      readonly outcome: "READY";
      readonly subject: string;
      readonly body: string;
      /**
       * Ordered template values. A text channel ignores them; a template channel
       * cannot send without them, which is why the seam carries them (the
       * request contract's reason, [[NOTIF-002]]).
       */
      readonly parameters: readonly string[];
    }
  | {
      readonly outcome: "UNAVAILABLE";
      readonly reasonCode: string;
      readonly reason: string;
    };

export interface NotificationContentBuilder {
  build(request: NotificationContentRequest): Promise<NotificationContentOutcome>;
}

/** Injection token for the content builder the composition root supplies. */
export const NOTIFICATION_CONTENT_BUILDER = Symbol("NOTIFICATION_CONTENT_BUILDER");

/**
 * The fail-closed default: it builds nothing, and says so by name.
 *
 * Not retryable by construction — the handler settles a delivery it cannot build,
 * because a retry reaches the same absent seam.
 */
export function createUnavailableNotificationContentBuilder(): NotificationContentBuilder {
  return {
    build: () =>
      Promise.resolve({
        outcome: "UNAVAILABLE",
        reasonCode: NOTIFICATION_DELIVERY_REASON.CONTENT_UNAVAILABLE,
        reason: "No content builder is wired for notification deliveries.",
      }),
  };
}
