/**
 * The entitlement boundary, for the CHANNEL-level gate.
 *
 * [[DEC-058]] decided that email is ungated and WhatsApp sits behind the
 * existing `whatsapp` feature code, and that the gate is evaluated **per channel
 * value**. This port is that check at the send path — the authoritative one,
 * because a stored setting or an earlier scheduling decision is not a grant.
 *
 * It is a port for the same reason the recipient reader is: the entitlement
 * lives in the tenant's own rows, and this package depends on no persistence.
 * The API's `EntitlementsService` cannot serve the worker, which is where the
 * sending happens.
 */

export interface NotificationEntitlementPort {
  /**
   * Whether the tenant holds the grant.
   *
   * A read that cannot answer must answer `false`. A gate that fails OPEN on a
   * database blip would send a WhatsApp message a tenant did not pay for, which
   * is a billing and policy failure rather than a delivery delay.
   */
  has(args: { readonly tenantId: string; readonly featureCode: string }): Promise<boolean>;
}

/** Injection token for the entitlement reader the composition root supplies. */
export const NOTIFICATION_ENTITLEMENT = Symbol("NOTIFICATION_ENTITLEMENT");

/**
 * The fail-closed default: it grants nothing.
 *
 * A deployment that wires no reader cannot send WhatsApp at all, which is the
 * correct failure for an entitlement gate — and it is deliberately not the same
 * thing as "email is ungated", which the gate's caller encodes by never asking
 * this port about `EMAIL` ([[DEC-058]]).
 */
export function createDenyAllNotificationEntitlementPort(): NotificationEntitlementPort {
  return {
    has: () => Promise.resolve(false),
  };
}
