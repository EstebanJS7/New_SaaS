import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import {
  DomainError,
  generatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_TTL_MS,
  RESET_LINK_REFUSAL_MESSAGE,
  spendResetToken,
  unspentTokenWhere,
} from "@newsaas/shared";

/**
 * The primitives moved to the shared kernel in DAT-007 WU-D2, when the WORKER needed
 * to mint what this service verifies: two deployables agreeing on entropy, digest and
 * lifetime is a contract, and a second copy is how the two would drift. Re-exported
 * here so every existing import site keeps reading them from the auth boundary.
 */
export { generatePasswordResetToken, hashPasswordResetToken, PASSWORD_RESET_TOKEN_TTL_MS };

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
 * One refusal for every cause, and it is the KERNEL's: the portal says the same
 * thing, and a surface that needed its own wording would be a product decision
 * rather than an edit here.
 */
export const RESET_TOKEN_INVALID_MESSAGE = RESET_LINK_REFUSAL_MESSAGE;

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
   * The algorithm and the CAS predicate live in `@newsaas/shared`, because the portal's service had
   * the same eight lines with a different table name. What stays HERE is the part that is genuinely
   * this service's: which table, and what a row means.
   *
   * The caller's transaction is passed through: a token spent outside the transaction that then fails
   * would burn the link against a password that never changed.
   */
  async consume(
    token: unknown,
    now: Date = new Date(),
    client?: PasswordResetTokenPrisma
  ): Promise<ConsumedPasswordResetToken> {
    const prisma = client ?? this.prisma;
    const row = await spendResetToken(
      {
        findByHash: (tokenHash) =>
          prisma.passwordResetToken.findFirst({
            where: { tokenHash },
            select: {
              id: true,
              userProfileId: true,
              tokenHash: true,
              expiresAt: true,
              consumedAt: true,
            },
          }),
        // The CAS: still unspent and still unexpired AS OF THIS STATEMENT.
        spendIfUnspent: async (id, at) =>
          (
            await prisma.passwordResetToken.updateMany({
              where: unspentTokenWhere(id, at),
              data: { consumedAt: at },
            })
          ).count,
      },
      token,
      now
    );
    if (row === null) return refuse();

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
