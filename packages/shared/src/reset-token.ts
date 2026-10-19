import { hashPasswordResetToken } from "./staff-recovery.js";

/**
 * Spending a password-reset token: the one place the compare-and-set lives.
 *
 * Staff recovery ([[DAT-007]]) and portal recovery ([[PORTAL-002]]) have separate tables, separate
 * owners and separate routes, and their spend logic was written twice — **line for line**, with only
 * the table, the owner column and the returned field differing. That is the kind of duplication that
 * survives one fix and not the next, and the half being duplicated is the security-critical one: the
 * spend.
 *
 * So the ALGORITHM lives here and each surface keeps only its table binding, which is the part that is
 * genuinely different. Nothing here knows about Prisma, and nothing here throws: a refusal is `null`,
 * and the caller decides what its identity context should say about it.
 */

export interface ResetTokenRow {
  readonly id: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * The two operations a spend needs, bound to one table.
 *
 * `spendIfUnspent` is a **compare-and-set**, not a write: it must apply `unspentTokenWhere` and report
 * the affected count. An implementation that widens the predicate turns the spend into a
 * read-then-write and lets two requests with the same link both change a password.
 */
export interface ResetTokenSpend<TRow extends ResetTokenRow> {
  readonly findByHash: (tokenHash: string) => Promise<TRow | null>;
  readonly spendIfUnspent: (id: string, now: Date) => Promise<number>;
}

/**
 * The predicate that makes the spend atomic, written once so a fix lands in both surfaces.
 *
 * The conditions are the ones the read already saw, re-checked AS OF THIS STATEMENT: still unspent and
 * still unexpired. A `count` of 0 therefore means "somebody else spent it, or it expired, between the
 * read and the write", which is the same refusal as a token that never existed.
 */
export function unspentTokenWhere(
  id: string,
  now: Date
): { id: string; consumedAt: null; expiresAt: { gt: Date } } {
  return { id, consumedAt: null, expiresAt: { gt: now } };
}

/**
 * Spends a token, or returns `null` — indistinguishably.
 *
 * Every failure is the same `null`, and that is the point: a caller cannot tell a wrong token from a
 * spent one from an expired one from a race it lost, so neither can an attacker reading the response.
 * A non-string never reaches a query either, which is what makes a missing body field the same refusal
 * as a wrong token rather than a driver error.
 */
export async function spendResetToken<TRow extends ResetTokenRow>(
  spend: ResetTokenSpend<TRow>,
  token: unknown,
  now: Date
): Promise<TRow | null> {
  if (typeof token !== "string" || token.length === 0) return null;

  const row = await spend.findByHash(hashPasswordResetToken(token));
  if (row === null) return null;
  if (row.consumedAt !== null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;

  return (await spend.spendIfUnspent(row.id, now)) === 1 ? row : null;
}

/**
 * The one refusal both surfaces show.
 *
 * Deliberately a single message: a staff member and a portal holder are told the same thing, and
 * neither is told which of the causes it was. If a surface ever needs its own wording, that is a
 * product decision and it means splitting this constant — not editing it.
 */
export const RESET_LINK_REFUSAL_MESSAGE =
  "This password reset link is not valid. Request a new one.";
