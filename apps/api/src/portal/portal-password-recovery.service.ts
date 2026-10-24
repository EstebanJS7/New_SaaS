import { Inject, Injectable } from "@nestjs/common";
import type { AuditAppendTx, Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import { DomainError, type EventDispatcher } from "@newsaas/shared";
import { assertPasswordAcceptable } from "../auth/password.policy.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { LoginRateLimiterService } from "../auth/login-rate-limiter.service.js";
import { CredentialService } from "../auth/credential.service.js";
import {
  PortalPasswordResetTokenService,
  type PortalResetTokenPrisma,
} from "./portal-password-reset-token.service.js";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";

/**
 * The portal's password recovery ([[PORTAL-002]]).
 *
 * The staff flow's sibling, and the differences are all the identity's:
 *
 * - **The tenant comes from the slug**, because the portal surface is `/[slug]/…` and the login
 *   resolves the tenant the same way. Every read is predicated on it, so a token from another tenant
 *   is refused.
 * - **The holder is resolved by `(tenant, contactEmail, ACTIVE)`**, exactly as the login does, so the
 *   address a reset is SENT to is the address the holder SIGNS IN with. It publishes an event rather
 *   than sending: the delivery goes through the same aggregate every other message uses.
 * - **A reset ends every portal session for that access**, which is [[DEC-008]]'s isolation applied to
 *   the consequence of a takeover: a surviving portal session is the attacker's.
 *
 * The request reports nothing about whether a holder exists, and an AMBIGUOUS login identity is
 * silenced like an absent one — the login fails closed on ambiguity, and a recovery that answered
 * differently would tell an attacker that a collision exists.
 */

/** The event this module publishes. Declared here because the publisher owns it. */
export const PORTAL_PASSWORD_RESET_REQUESTED = "PortalPasswordResetRequested";

/**
 * The rate-limit key, namespaced by hand.
 *
 * `portal:` matches the login's own namespace prefix, and the `recovery:` segment separates it from
 * the login budget — the person asking for a reset is exactly the person about to try to sign in.
 * The IP is in the key so one attacker cannot exhaust a victim's budget from somewhere else.
 */
export function portalRecoveryRateLimitKey(email: string, clientIp: string): string {
  return `portal:recovery:${email}:${clientIp}`;
}

export const PORTAL_TOO_MANY_RECOVERY_REQUESTS_MESSAGE =
  "Too many recovery requests. Try again later.";

/** The narrow client, in Prisma's OWN arg types so the real client fits and a suite can stub it. */
export interface PortalRecoveryPrisma {
  tenant: {
    findUnique(args: Prisma.TenantFindUniqueArgs): Promise<{ id: string } | null>;
  };
  customerPortalAccess: {
    findMany(
      args: Prisma.CustomerPortalAccessFindManyArgs
    ): Promise<{ id: string; tenantId: string; credential: { portalAccessId: string } | null }[]>;
  };
}

/** What the reset's transaction sees: the token service's client plus two tables. */
export interface PortalResetTx extends PortalResetTokenPrisma, AuditAppendTx {
  portalCredential: {
    update(args: Prisma.PortalCredentialUpdateArgs): Promise<unknown>;
  };
  portalSession: {
    deleteMany(args: Prisma.PortalSessionDeleteManyArgs): Promise<{ count: number }>;
  };
}

export interface PortalRecoveryPrismaFull extends PortalRecoveryPrisma {
  $transaction<T>(run: (tx: PortalResetTx) => Promise<T>): Promise<T>;
}

export interface PortalPasswordResetOutcome {
  readonly portalAccessId: string;
  readonly sessionsEnded: number;
}

@Injectable()
export class PortalPasswordRecoveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalRecoveryPrismaFull,
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher,
    private readonly tokens: PortalPasswordResetTokenService,
    private readonly credentials: CredentialService,
    private readonly limiter: LoginRateLimiterService,
    private readonly audit: AuditWriter
  ) {}

  /** Requests a recovery for a holder, and reports nothing about whether one exists. */
  async requestReset(
    tenantSlug: unknown,
    rawEmail: unknown,
    clientIp: string,
    now: Date = new Date()
  ): Promise<void> {
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const slug = typeof tenantSlug === "string" ? tenantSlug.trim() : "";
    const limiterKey = portalRecoveryRateLimitKey(`${slug}:${email}`, clientIp);
    if (await this.limiter.isBlocked(limiterKey, now)) {
      throw new DomainError("RATE_LIMITED", PORTAL_TOO_MANY_RECOVERY_REQUESTS_MESSAGE);
    }
    await this.limiter.recordFailure(limiterKey, now);

    if (email.length === 0 || slug.length === 0) return;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (tenant === null) return;

    const candidates = await this.prisma.customerPortalAccess.findMany({
      where: {
        tenantId: tenant.id,
        contactEmail: { equals: email, mode: "insensitive" },
        status: "ACTIVE",
      },
      orderBy: { id: "asc" },
      // Two, exactly like the login: one is the answer and two is ambiguity.
      take: 2,
      select: { id: true, tenantId: true, credential: { select: { portalAccessId: true } } },
    });
    // An ambiguous identity is silenced rather than refused: the login fails closed on it, and a
    // recovery that answered differently would tell an attacker that a collision exists.
    const access = candidates.length === 1 ? candidates[0] : null;
    // A holder with no credential cannot log in, so there is no password for a reset to change.
    // Falsy rather than `=== null`: a delegate that does not model the relation answers `undefined`,
    // and a strict null check would read "no credential" as "has one".
    if (!access?.credential) return;

    // Published AFTER the holder is known to exist, carrying the access and the tenant and nothing
    // else. The subscriber creates the delivery under THAT tenant — a portal message belongs to the
    // clinic's tenant, unlike the staff recovery's platform-level one.
    this.events.publish(PORTAL_PASSWORD_RESET_REQUESTED, {
      tenantId: access.tenantId,
      aggregateId: access.id,
      payload: {},
    });

    // Attributed to the ACCESS, exactly as the staff flow attributes its request to the profile: the
    // requester is anonymous (that is the situation), so the record reads "a reset was requested for
    // this holder" rather than claiming an actor nobody authenticated.
    await this.audit.append({
      action: "portal.password_reset_requested",
      actorPortalAccessId: access.id,
      targetType: "customer_portal_access",
      targetId: access.id,
    });
  }

  /**
   * Changes the password a token authorises, or refuses uniformly.
   *
   * One transaction, for the reasons the staff reset records: a changed password with a surviving
   * session is a stolen session that outlives the recovery; a spent token whose hash write failed
   * would burn the link and leave the old password; and an unaudited change is a security event
   * nobody can see. The hash is computed BEFORE it opens, so argon2's deliberate cost never holds a
   * transaction.
   */
  async resetPassword(
    rawToken: unknown,
    rawPassword: unknown,
    now: Date = new Date()
  ): Promise<PortalPasswordResetOutcome> {
    assertPasswordAcceptable(rawPassword);
    const passwordHash = await this.credentials.hash(rawPassword);

    return this.prisma.$transaction(async (tx) => {
      const consumed = await this.tokens.consume(rawToken, now, tx);

      await tx.portalCredential.update({
        where: { portalAccessId: consumed.portalAccessId },
        data: { passwordHash },
      });

      // EVERY portal session for this access: a reset is how somebody takes an account back, and a
      // surviving session is the attacker's. The staff cookie is not involved and cannot be.
      const sessions = await tx.portalSession.deleteMany({
        where: { portalAccessId: consumed.portalAccessId },
      });

      await this.tokens.spendAllForAccess(consumed.portalAccessId, now, tx);

      await this.audit.append(
        {
          action: "portal.password_reset_completed",
          // The same attribution as the request: the holder redeeming a link is proven by the TOKEN,
          // not by an authenticated session, so the record names the access rather than an actor.
          actorPortalAccessId: consumed.portalAccessId,
          targetType: "customer_portal_access",
          targetId: consumed.portalAccessId,
          metadata: { sessionsEnded: sessions.count },
        },
        tx
      );

      return { portalAccessId: consumed.portalAccessId, sessionsEnded: sessions.count };
    });
  }
}
