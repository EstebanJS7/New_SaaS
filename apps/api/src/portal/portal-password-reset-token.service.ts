import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import {
  DomainError,
  generatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_TTL_MS,
} from "@newsaas/shared";

/**
 * The portal's recovery-token service ([[PORTAL-002]]).
 *
 * The staff service's sibling ([[DAT-007]]), deliberately a SECOND explicit service rather than a
 * shared generic one: the two are bound to different tables with different subjects, and the
 * repository prefers explicit code to a generic base. The primitives they DO share — the entropy,
 * the digest and the lifetime — live in `@newsaas/shared`, so those cannot drift; what is duplicated
 * is the compare-and-set and the uniform refusal, and that duplication is named in the Story's
 * technical debt rather than hidden.
 *
 * **A portal token is not a staff token.** It is keyed to a `customer_portal_access` row, and the
 * staff table's foreign key could not even hold one. That is [[DEC-008]]'s identity boundary, one
 * level down from the sessions: neither token may be redeemed for the other's password.
 */

/** One refusal for every cause. Exported so a suite can assert the uniformity. */
export const PORTAL_RESET_TOKEN_INVALID_MESSAGE =
  "This password reset link is not valid. Request a new one.";

/** Structural view of the row this service decides on (the `StaffSession` pattern). */
export interface PortalResetTokenRow {
  readonly id: string;
  readonly portalAccessId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * The narrow client, declared with Prisma's OWN arg types so the real client fits by construction
 * and a suite can pass a stub.
 */
export interface PortalResetTokenPrisma {
  portalPasswordResetToken: {
    create(args: Prisma.PortalPasswordResetTokenCreateArgs): Promise<{ id: string }>;
    findFirst(
      args: Prisma.PortalPasswordResetTokenFindFirstArgs
    ): Promise<PortalResetTokenRow | null>;
    updateMany(args: Prisma.PortalPasswordResetTokenUpdateManyArgs): Promise<{ count: number }>;
  };
}

export interface IssuedPortalResetToken {
  /** The PLAINTEXT token. It exists in this return value and nowhere else. */
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: Date;
}

export interface ConsumedPortalResetToken {
  readonly tokenId: string;
  readonly portalAccessId: string;
}

@Injectable()
export class PortalPasswordResetTokenService {
  constructor(@Inject(PrismaService) private readonly prisma: PortalResetTokenPrisma) {}

  /** Mints a token for an access and stores only its digest. */
  async issue(portalAccessId: string, now: Date = new Date()): Promise<IssuedPortalResetToken> {
    const token = generatePasswordResetToken();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);

    const row = await this.prisma.portalPasswordResetToken.create({
      data: { portalAccessId, tokenHash: hashPasswordResetToken(token), expiresAt },
      select: { id: true },
    });

    return { token, tokenId: row.id, expiresAt };
  }

  /**
   * Spends a token, or refuses it — indistinguishably.
   *
   * The marking is a compare-and-set rather than a read-then-write: two requests arriving with the
   * same link must not both change a password, and the only place that can be decided is one
   * statement whose `WHERE` carries the conditions the read already saw.
   */
  async consume(
    token: unknown,
    now: Date = new Date(),
    client?: PortalResetTokenPrisma
  ): Promise<ConsumedPortalResetToken> {
    // A non-string never reaches a query, so a missing body field is the same refusal as a wrong
    // token rather than a driver error.
    if (typeof token !== "string" || token.length === 0) return refuse();

    const prisma = client ?? this.prisma;
    const row = await prisma.portalPasswordResetToken.findFirst({
      where: { tokenHash: hashPasswordResetToken(token) },
      select: {
        id: true,
        portalAccessId: true,
        tokenHash: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (row === null) return refuse();
    if (row.consumedAt !== null) return refuse();
    if (row.expiresAt.getTime() <= now.getTime()) return refuse();

    const spent = await prisma.portalPasswordResetToken.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (spent.count !== 1) return refuse();

    return { tokenId: row.id, portalAccessId: row.portalAccessId };
  }

  /**
   * Spends every outstanding token for an access, after a password actually changes.
   *
   * Without it, a holder who requested a link twice — or somebody else who did — would keep a second
   * working link for the rest of the TTL, redeemable against the password just set. The
   * already-consumed rows are left alone by the `WHERE`, so a token spent earlier keeps the instant
   * it was actually spent.
   */
  async spendAllForAccess(
    portalAccessId: string,
    now: Date = new Date(),
    client?: PortalResetTokenPrisma
  ): Promise<number> {
    const result = await (client ?? this.prisma).portalPasswordResetToken.updateMany({
      where: { portalAccessId, consumedAt: null },
      data: { consumedAt: now },
    });
    return result.count;
  }
}

/** The one refusal. A function so every path returns the same object shape. */
function refuse(): never {
  throw new DomainError("UNAUTHENTICATED", PORTAL_RESET_TOKEN_INVALID_MESSAGE);
}
