import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import { DomainError, type EventDispatcher } from "@newsaas/shared";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";

/**
 * Staff password recovery, the request half (DAT-007, WU-C1).
 *
 * The whole design is about what a caller can learn, and the answer is: nothing. A
 * request for an address that exists, one for an address that does not, and one for
 * a profile that never had credentials all leave through the same door with the
 * same body. The two failures the service CAN report are the two that say nothing
 * about any account:
 *
 * - `RATE_LIMITED`, keyed by address AND client IP, so hammering the endpoint
 *   cannot lock a known address out of its own recovery from somewhere else; and
 * - `INTERNAL` when the database itself is unreachable.
 *
 * **It sends nothing and creates nothing.** It publishes `PasswordResetRequested`
 * and returns; the notification module's subscriber creates the delivery intent and
 * enqueues it. That is this codebase's own mechanism for a decoupled reaction
 * (EPIC-17 publishes, notifications subscribes), and it is what keeps identity free
 * of the delivery aggregate: this module knows no queue, no producer and no
 * delivery table. The dispatcher is fire-and-forget, so a subscriber failure cannot
 * turn this route's answer into an existence oracle either.
 *
 * **The event is platform-level** — `tenantId: null`, which the envelope documents
 * as the meaning of that value. A reset belongs to an IDENTITY rather than to a
 * tenant: the credential it authorises is global to the profile, and the request is
 * anonymous, so there is no tenant to name.
 */

/** The event this module publishes. Declared here because the publisher owns it. */
export const PASSWORD_RESET_REQUESTED = "PasswordResetRequested";

/**
 * The address is normalized exactly as login normalizes it (`trim().toLowerCase`),
 * because a lookup that normalized differently would answer "no such account" for
 * an account that can log in.
 */
function normalizeEmail(rawEmail: unknown): string {
  return typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
}

/**
 * The rate-limit key, namespaced by hand rather than through
 * `LoginRateLimiterService.key`.
 *
 * Sharing the login budget would make a user who asked for a few resets unable to
 * log in — and the person asking for a reset is exactly the person about to try to
 * log in. The counter is the same instrument; only the namespace differs.
 *
 * The IP is in the key deliberately: keyed by address alone, one attacker could
 * exhaust a victim's recovery budget and lock them out of their own account.
 */
export function recoveryRateLimitKey(email: string, clientIp: string): string {
  return `recovery:${email}:${clientIp}`;
}

export const TOO_MANY_RECOVERY_REQUESTS_MESSAGE = "Too many recovery requests. Try again later.";

/**
 * The narrow client, in Prisma's OWN arg types so the real client fits by
 * construction and a suite can pass a stub.
 *
 * Deliberately just the identity read: this service touches no other table.
 */
export interface PasswordRecoveryPrisma {
  userProfile: {
    findUnique(
      args: Prisma.UserProfileFindUniqueArgs
    ): Promise<{ id: string; credential: { userProfileId: string } | null } | null>;
  };
}

@Injectable()
export class PasswordRecoveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PasswordRecoveryPrisma,
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher,
    private readonly limiter: LoginRateLimiterService,
    private readonly audit: AuditWriter
  ) {}

  /**
   * Requests a reset for an address, and reports nothing about whether it exists.
   *
   * Returns `void` on every path that could reveal an account: an empty address, an
   * unknown one and a profile without credentials all return normally.
   */
  async requestReset(rawEmail: unknown, clientIp: string, now: Date = new Date()): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const limiterKey = recoveryRateLimitKey(email, clientIp);
    if (await this.limiter.isBlocked(limiterKey, now)) {
      throw new DomainError("RATE_LIMITED", TOO_MANY_RECOVERY_REQUESTS_MESSAGE);
    }
    // Recorded BEFORE the account lookup, so a flood of probes against addresses
    // that do not exist is limited by the same budget as one that does.
    await this.limiter.recordFailure(limiterKey, now);

    if (email.length === 0) return;

    const profile = await this.prisma.userProfile.findUnique({
      where: { email },
      select: { id: true, credential: { select: { userProfileId: true } } },
    });
    // A profile without a credential cannot log in at all, so there is no password
    // for a reset to change. Silenced rather than refused, because "this account has
    // no password" is exactly the fact an enumeration attack wants.
    //
    // The check is FALSY rather than `=== null`, and that is deliberate: the type
    // says `| null`, but a delegate that does not model the relation at all returns
    // `undefined` — and a strict null check would then read "no credentials" as "has
    // credentials" and mail a reset link for a password that does not exist.
    //
    // `status` is deliberately NOT consulted, for consistency with the login path:
    // login checks the credential and the password and ignores `status` entirely. A
    // recovery that refused a suspended profile while login admitted it would be a
    // second, contradictory rule about who may enter.
    if (!profile?.credential) return;

    // Published AFTER the account is known to exist, so no event is emitted for a
    // probe, and the payload carries the profile id and nothing else — no email, no
    // token, no host.
    this.events.publish(PASSWORD_RESET_REQUESTED, {
      tenantId: null,
      aggregateId: profile.id,
      payload: {},
    });

    // Audited only for an account that exists: an audit row per probe of an unknown
    // address would let a stranger grow the table, which is the storage-DoS the
    // login path documents.
    await this.audit.append({
      action: "auth.password_reset_requested",
      actorUserProfileId: profile.id,
      targetType: "user_profile",
      targetId: profile.id,
    });
  }
}
