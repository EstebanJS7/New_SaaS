import type { Prisma } from "@newsaas/database";
import {
  NOTIFICATION_DELIVERY_REASON,
  type NotificationChannel,
  type NotificationRecipientPort,
  type NotificationRecipientReference,
} from "@newsaas/notifications";

/**
 * The recipient reader: the delivery's stored REFERENCE resolved into a contact
 * datum at send time ([[NOTIF-002]], [[DEC-061]]).
 *
 * It lives in the worker because the worker is where sending happens and it is
 * the only consumer today. If the API ever needs to resolve a recipient, this
 * moves to its own package beside `fiscal-persistence` — the fiscal precedent,
 * and not a package to create for one caller.
 */

/** The contact kind each channel reads. */
export const NOTIFICATION_CONTACT_KIND = Object.freeze({
  EMAIL: "EMAIL",
  WHATSAPP: "PHONE",
} as const satisfies Readonly<Record<NotificationChannel, "EMAIL" | "PHONE">>);

/**
 * The narrow client this reader needs, in Prisma's OWN arg types.
 *
 * Declared with `Prisma.CustomerContactFindFirstArgs` rather than a hand-copied
 * structural shape, so the real client fits by construction and a test can pass
 * a stub — the `fiscal-persistence` readers' pattern. A hand-copied shape drifts
 * from Prisma's (a `readonly` array where Prisma wants a mutable one was the
 * first thing it broke).
 */
export interface NotificationRecipientClient {
  customerContact: {
    findFirst(args: Prisma.CustomerContactFindFirstArgs): Promise<{ value: string } | null>;
  };
  /**
   * The staff read (DAT-007). The profile's own email is the address, and it is
   * personal data of an employee: RESTRICTED, resolved here and never persisted,
   * logged or returned.
   */
  userProfile: {
    findFirst(args: Prisma.UserProfileFindFirstArgs): Promise<{ email: string } | null>;
  };
}

export function createNotificationRecipientReader(args: {
  readonly client: NotificationRecipientClient;
}): NotificationRecipientPort {
  return {
    async resolve(reference: NotificationRecipientReference) {
      if (reference.recipientType === "STAFF") {
        // NO tenant predicate, and the absence is deliberate: a staff profile is
        // global to the identity (the credential's key is shared with it), and the
        // delivery's tenant is the PLATFORM one, which owns the message rather than
        // the person. Filtering by it would resolve nobody, because the person
        // belongs to no tenant — they merely work in some.
        const profile = await args.client.userProfile.findFirst({
          where: { id: reference.recipientId },
          select: { email: true },
        });
        // Null is settled, exactly as it is for a customer with no contact: a profile
        // that no longer exists is not a failure a retry can change.
        return profile === null ? null : { address: profile.email };
      }

      if (reference.recipientType !== "CUSTOMER") {
        // Both enum members are handled above, so this is unreachable from the
        // database. It is a guard rather than dead code: the day a third recipient
        // type is added, an unhandled one must fail closed here instead of
        // resolving somebody else's contact.
        throw new UnsupportedRecipientTypeError(reference.recipientType);
      }

      const row = await args.client.customerContact.findFirst({
        where: {
          tenantId: reference.tenantId,
          customerId: reference.recipientId,
          kind: NOTIFICATION_CONTACT_KIND[reference.channel],
          isActive: true,
        },
        // The primary contact first, then the oldest: a deterministic choice, so
        // two runs resolve the same address and a test can pin it.
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { value: true },
      });

      // `null` is a settled outcome, not an error: a customer with no active
      // contact of this kind is a data state a retry cannot change. A failure of
      // the READ is different — it propagates, and the handler treats it as
      // retryable, because a database blip is not a missing phone number.
      return row === null ? null : { address: row.value };
    },
  };
}

/** A recipient type with no reader. A programming error, not a data state. */
export class UnsupportedRecipientTypeError extends Error {
  readonly code = NOTIFICATION_DELIVERY_REASON.RECIPIENT_TYPE_UNSUPPORTED;

  constructor(readonly recipientType: string) {
    super(`No recipient reader is wired for recipient type ${recipientType}.`);
    this.name = "UnsupportedRecipientTypeError";
  }
}
