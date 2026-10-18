import type { Prisma } from "@newsaas/database";
import type { NotificationEntitlementPort } from "@newsaas/notifications";

/**
 * The entitlement reader behind [[DEC-058]]'s per-channel gate.
 *
 * The API's `EntitlementsService` cannot serve this: the sending happens in the
 * worker, and a grant read from the tenant's own rows is the authoritative one
 * at send time. The query is the same shape as that service's `has`, so the two
 * can never disagree about what a grant means.
 */

/**
 * The narrow client this reader needs, in Prisma's own arg types — the
 * `fiscal-persistence` readers' pattern, so the real client fits by construction.
 */
export interface NotificationEntitlementClient {
  tenantEntitlement: {
    findFirst(args: Prisma.TenantEntitlementFindFirstArgs): Promise<{ id: string } | null>;
  };
}

export function createNotificationEntitlementReader(args: {
  readonly client: NotificationEntitlementClient;
}): NotificationEntitlementPort {
  return {
    async has({ tenantId, featureCode }) {
      const grant = await args.client.tenantEntitlement.findFirst({
        where: { tenantId, featureCode: { code: featureCode } },
        select: { id: true },
      });
      // A failed read propagates and the handler treats it as retryable: the
      // message was NOT sent, and the grant may well exist. Answering `false`
      // here would settle a delivery the tenant is entitled to receive.
      return grant !== null;
    },
  };
}
