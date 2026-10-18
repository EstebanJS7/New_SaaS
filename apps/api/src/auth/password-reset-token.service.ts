import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";

/**
 * The password-recovery token service (DAT-007, WU-B).
 *
 * Two functions, one table, and a single refusal — the interesting decisions are
 * the refusal's uniformity and the hashing choice.
 *
 * **Why SHA-256 and not argon2.** `argon2` exists to make a LOW-entropy,
 * human-chosen password expensive to guess. This token is 256 bits from
 * `randomBytes`: there is nothing to guess, and hashing it with argon2 would only
 * make the send path slow for no gain. `StaffSession` reached the same conclusion
 * for the same reason, and this service follows it deliberately rather than
 * copying it by habit.
 *
 * **Why one message for three failures.** An unknown token, a spent one and an
 * expired one are indistinguishable to the caller: same code, same message, no
 * field naming which. Distinguishing them would tell an attacker who holds a
 * stale link that it was once real — the same reasoning that makes login answer
 * one message for a wrong password and an unknown account.
 */

/**
 * How long a delivered token stays usable.
 *
 * Thirty minutes is chosen against the two failure modes it sits between: long
 * enough that a person can find the mail, open it on another device and choose a
 * password without racing a clock, and short enough that a link left in a shared
 * inbox is worthless by the time anyone else reads it. Note that the clock starts
 * when the message is SENT, not when it was requested (the issuance model in
 * DAT-007's Story), so an SMTP delay does not eat the user's window.
 */
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** One refusal for every cause. Exported so a suite can assert the uniformity. */
export const RESET_TOKEN_INVALID_MESSAGE =
  "This password reset link is not valid. Request a new one.";

/** 32 random bytes, base64url — the `generateSessionToken` convention. */
export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The digest the table stores. Lookup always happens by digest, never by token. */
export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Structural view of the row this service decides on (the `StaffSession` pattern). */
export interface PasswordResetTokenRow {
  readonly id: string;
  readonly userProfileId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * The narrow client, declared with Prisma's OWN arg types so the real client fits
 * by construction and a suite can pass a stub (`fiscal-persistence`'s pattern).
 */
export interface PasswordResetTokenPrisma {
  passwordResetToken: {
    create(args: Prisma.PasswordResetTokenCreateArgs): Promise<{ id: string }>;
    findFirst(args: Prisma.PasswordResetTokenFindFirstArgs): Promise<PasswordResetTokenRow | null>;
    updateMany(args: Prisma.PasswordResetTokenUpdateManyArgs): Promise<{ count: number }>;
  };
}

export interface IssuedPasswordResetToken {
  /** The PLAINTEXT token. It exists in this return value and nowhere else. */
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: Date;
}

export interface ConsumedPasswordResetToken {
  readonly tokenId: string;
  readonly userProfileId: string;
}

@Injectable()
export class PasswordResetTokenService {
  constructor(@Inject(PrismaService) private readonly prisma: PasswordResetTokenPrisma) {}

  /**
   * Mints a token for a profile and stores only its digest.
   *
   * The plaintext is returned once, to the caller that is about to put it in a
   * message. Nothing in this service logs it, stores it, or can read it back:
   * `issue` is the only place it exists.
   */
  async issue(userProfileId: string, now: Date = new Date()): Promise<IssuedPasswordResetToken> {
    const token = generatePasswordResetToken();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);

    const row = await this.prisma.passwordResetToken.create({
      data: { userProfileId, tokenHash: hashPasswordResetToken(token), expiresAt },
      select: { id: true },
    });

    return { token, tokenId: row.id, expiresAt };
  }

  /**
   * Spends a token, or refuses it — indistinguishably.
   *
   * The marking is a **compare-and-set** rather than a read-then-write: two
   * requests arriving with the same link must not both change a password, and the
   * only place that can be decided is one statement whose `WHERE` carries the
   * conditions the read already saw. A `count` of 0 therefore means "somebody else
   * spent it, or it expired, between the read and the write", which is the same
   * refusal.
   */
  async consume(
    token: unknown,
    now: Date = new Date(),
    /**
     * The caller's transaction, when the spending must be atomic with what follows.
     * The reset path passes its own: a token spent outside the transaction that then
     * fails would burn the link against a password that never changed.
     */
    client?: PasswordResetTokenPrisma
  ): Promise<ConsumedPasswordResetToken> {
    // A non-string never reaches a query. A caller passing `undefined` because a
    // body field was missing gets the same refusal as a wrong token rather than a
    // driver error, and no lookup happens at all.
    if (typeof token !== "string" || token.length === 0) return refuse();

    const prisma = client ?? this.prisma;
    const row = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashPasswordResetToken(token) },
      select: {
        id: true,
        userProfileId: true,
        tokenHash: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (row === null) return refuse();
    if (row.consumedAt !== null) return refuse();
    if (row.expiresAt.getTime() <= now.getTime()) return refuse();

    const spent = await prisma.passwordResetToken.updateMany({
      // The CAS: still unspent and still unexpired AS OF THIS STATEMENT.
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (spent.count !== 1) return refuse();

    return { tokenId: row.id, userProfileId: row.userProfileId };
  }

  /**
   * Spends every outstanding token for a profile.
   *
   * Called after a password actually changes, and it is what makes "once a
   * password is reset, no other reset link works" true rather than probable.
   * Without it, a user who requested a link twice — or an attacker who did — would
   * hold a second working link for the rest of the TTL, redeemable against the
   * password that was just set.
   *
   * The already-consumed rows are left alone by the `WHERE`, which matters twice
   * over: the guard refuses a rewrite of a consumption instant, and a token spent
   * earlier should keep the instant it was actually spent.
   */
  async spendAllForProfile(
    userProfileId: string,
    now: Date = new Date(),
    client?: PasswordResetTokenPrisma
  ): Promise<number> {
    const result = await (client ?? this.prisma).passwordResetToken.updateMany({
      where: { userProfileId, consumedAt: null },
      data: { consumedAt: now },
    });
    return result.count;
  }
}

/** The one refusal. A function so every path returns the same object shape. */
function refuse(): never {
  throw new DomainError("UNAUTHENTICATED", RESET_TOKEN_INVALID_MESSAGE);
}
