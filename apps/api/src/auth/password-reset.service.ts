import { Inject, Injectable } from "@nestjs/common";
import type { AuditAppendTx, Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { CredentialService } from "./credential.service.js";
import {
  PasswordResetTokenService,
  type PasswordResetTokenPrisma,
} from "./password-reset-token.service.js";

/**
 * Staff password recovery, the reset half (DAT-007, WU-C2).
 *
 * **Everything that must be true together happens in ONE transaction**: the token
 * is spent, the credential's hash is replaced, EVERY outstanding session for the
 * profile is deleted, the profile's other reset tokens are spent, and the audit row
 * is appended. Each of those is worthless — or worse — without the others:
 *
 * - a changed password with a surviving session is a stolen session that outlives
 *   the recovery, which is the whole thing a reset is supposed to end;
 * - a spent token whose hash write failed would burn the link and leave the old
 *   password, so the user is locked out with no way back;
 * - an unaudited password change is a security event nobody can see.
 *
 * **The hash is computed BEFORE the transaction opens.** argon2 at the configured
 * OWASP-floor parameters takes tens of milliseconds of CPU on purpose, and holding
 * a transaction open across it would hold locks for that whole time — paying the
 * cost outside means the transaction contains only the statements that must be
 * atomic. It also means the expensive part happens before any row is touched, so a
 * request that will be refused for a bad token still pays a cost an attacker cannot
 * use to hold locks.
 *
 * A shared unit reading three tables is the price of that atomicity, and it is the
 * smaller price: the alternative is threading a transaction client through
 * `SessionService` and `PasswordResetTokenService`, which puts the boundary in
 * three signatures instead of in one comment.
 */

/** What the transaction needs to see: the token service's client plus two tables. */
export interface PasswordResetTx extends PasswordResetTokenPrisma, AuditAppendTx {
  userCredential: {
    update(args: Prisma.UserCredentialUpdateArgs): Promise<unknown>;
  };
  staffSession: {
    deleteMany(args: Prisma.StaffSessionDeleteManyArgs): Promise<{ count: number }>;
  };
}

export interface PasswordResetPrisma {
  $transaction<T>(callback: (tx: PasswordResetTx) => Promise<T>): Promise<T>;
}

export interface PasswordResetOutcome {
  readonly userProfileId: string;
  /** How many sessions the reset ended. Reported for the audit, never returned. */
  readonly sessionsEnded: number;
}

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PasswordResetPrisma,
    private readonly tokens: PasswordResetTokenService,
    private readonly credentials: CredentialService,
    private readonly audit: AuditWriter
  ) {}

  /**
   * Changes the password a token authorises, or refuses uniformly.
   *
   * The refusal is the token service's: one code and one message for an unknown, a
   * spent and an expired token. Nothing here adds a distinct failure, because a
   * distinct failure is a hint about a link's history.
   */
  async resetPassword(
    rawToken: unknown,
    rawPassword: unknown,
    now: Date = new Date()
  ): Promise<PasswordResetOutcome> {
    // The shape check is the controller's job; this is the boundary's own, so a
    // service called directly cannot hash `undefined`.
    if (typeof rawPassword !== "string" || rawPassword.length === 0) {
      throw new DomainError("VALIDATION_FAILED", "A new password is required.");
    }
    if (rawPassword.length > MAX_PASSWORD_LENGTH) {
      throw new DomainError("VALIDATION_FAILED", "The new password is too long.");
    }

    // Paid outside the transaction, deliberately: see the class comment.
    const passwordHash = await this.credentials.hash(rawPassword);

    return this.prisma.$transaction(async (tx) => {
      // Inside the transaction, so a later failure rolls the spending back: the
      // link survives a transient database error instead of being burnt against a
      // password that never changed.
      const consumed = await this.tokens.consume(rawToken, now, tx);

      await tx.userCredential.update({
        where: { userProfileId: consumed.userProfileId },
        data: { passwordHash },
      });

      // EVERY session, not the current one: a reset is how somebody who suspects
      // their account is compromised takes it back, and a surviving session is the
      // attacker's.
      const sessions = await tx.staffSession.deleteMany({
        where: { userProfileId: consumed.userProfileId },
      });

      // And every OTHER outstanding reset link, so a second message — requested by
      // the user or by somebody else — cannot be redeemed against the password that
      // was just set.
      await this.tokens.spendAllForProfile(consumed.userProfileId, now, tx);

      // Appended with the transaction, never after it: an append failure aborts the
      // whole change rather than committing it unaudited.
      await this.audit.append(
        {
          action: "auth.password_reset_completed",
          actorUserProfileId: consumed.userProfileId,
          targetType: "user_profile",
          targetId: consumed.userProfileId,
          // The count only. There is no token, no hash and no address in the record.
          metadata: { sessionsEnded: sessions.count },
        },
        tx
      );

      return { userProfileId: consumed.userProfileId, sessionsEnded: sessions.count };
    });
  }
}

/**
 * The bound mirrors the login body's, and it is the ONLY rule this Story applies.
 *
 * **There is no password policy anywhere in this repository yet** — accounts are
 * ops-provisioned — so inventing a complexity rule here would be a product decision
 * taken by an implementation. What that means in practice is recorded as a
 * limitation: a user-chosen password is bounded by length alone, and this path is
 * the first place a policy would matter, because it is the first place a human
 * chooses the password.
 */
export const MAX_PASSWORD_LENGTH = 1024;
