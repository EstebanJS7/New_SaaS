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
   * **The contract is that an unanswerable read must never answer `true`** — a
   * gate that fails OPEN on a database blip would send a WhatsApp message a
   * tenant did not pay for, which is a billing and policy failure rather than a
   * delivery delay.
   *
   * How it must fail closed is the implementation's choice, and the one wired
   * today PROPAGATES rather than answering `false`: the handler then retries the
   * delivery, because answering `false` would settle a delivery the tenant is
   * entitled to receive. That is the better failure of the two, and this comment
   * says so rather than describing the other one (TD-041 R3-002).
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
