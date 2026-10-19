import { describe, expect, it, vi } from "vitest";
import { generatePasswordResetToken, hashPasswordResetToken } from "./staff-recovery.js";
import { RESET_LINK_REFUSAL_MESSAGE, spendResetToken, unspentTokenWhere } from "./reset-token.js";
import type { ResetTokenRow, ResetTokenSpend } from "./reset-token.js";

/**
 * The spend, which is the security-critical half of password recovery and was written twice before
 * this module existed. Its contract is narrow on purpose: **every** failure is the same `null`.
 */
const NOW = new Date("2026-10-19T12:00:00.000Z");

interface Row extends ResetTokenRow {
  readonly ownerId: string;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    ownerId: "owner-1",
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    ...overrides,
  };
}

/** A store that records what the spend asked of it. */
function store(
  found: Row | null,
  spent: number
): ResetTokenSpend<Row> & {
  findByHash: ReturnType<typeof vi.fn>;
  spendIfUnspent: ReturnType<typeof vi.fn>;
} {
  return {
    findByHash: vi.fn((_hash: string) => Promise.resolve(found)),
    spendIfUnspent: vi.fn((_id: string, _now: Date) => Promise.resolve(spent)),
  };
}

describe("spendResetToken", () => {
  it("spends an unspent, unexpired token and returns its row", async () => {
    const spend = store(row(), 1);
    const token = generatePasswordResetToken();

    const result = await spendResetToken(spend, token, NOW);

    expect(result).toEqual(row());
    // The lookup is by DIGEST: the plaintext never reaches a query.
    expect(spend.findByHash).toHaveBeenCalledWith(hashPasswordResetToken(token));
    expect(spend.spendIfUnspent).toHaveBeenCalledWith("row-1", NOW);
  });

  it("refuses a token that is not a non-empty string, without a query", async () => {
    for (const bad of [undefined, null, "", 42, { token: "x" }]) {
      const spend = store(row(), 1);
      expect(await spendResetToken(spend, bad, NOW)).toBeNull();
      // No lookup happens at all: a missing body field is not a driver error.
      expect(spend.findByHash).not.toHaveBeenCalled();
    }
  });

  it("refuses an unknown, already-spent or expired token with the same null", async () => {
    const unknown = store(null, 0);
    const spent = store(row({ consumedAt: new Date(NOW.getTime() - 1000) }), 0);
    const expired = store(row({ expiresAt: new Date(NOW.getTime() - 1) }), 0);

    expect(await spendResetToken(unknown, "a".repeat(43), NOW)).toBeNull();
    expect(await spendResetToken(spent, "a".repeat(43), NOW)).toBeNull();
    expect(await spendResetToken(expired, "a".repeat(43), NOW)).toBeNull();

    // A row already spent or expired is refused BEFORE the CAS: the write is not attempted.
    expect(spent.spendIfUnspent).not.toHaveBeenCalled();
    expect(expired.spendIfUnspent).not.toHaveBeenCalled();
  });

  it("refuses when the CAS loses, which is a race and not an error", async () => {
    // count 0 means somebody else spent it between the read and the write.
    const spend = store(row(), 0);

    expect(await spendResetToken(spend, "a".repeat(43), NOW)).toBeNull();
    expect(spend.spendIfUnspent).toHaveBeenCalledTimes(1);
  });

  it("treats a token expiring exactly now as expired", async () => {
    const spend = store(row({ expiresAt: new Date(NOW.getTime()) }), 1);

    expect(await spendResetToken(spend, "a".repeat(43), NOW)).toBeNull();
  });

  it("builds the predicate the CAS depends on", () => {
    // One predicate, both surfaces: widening it here is the only way to widen it anywhere.
    expect(unspentTokenWhere("row-1", NOW)).toEqual({
      id: "row-1",
      consumedAt: null,
      expiresAt: { gt: NOW },
    });
  });

  it("says one thing to everyone", () => {
    expect(RESET_LINK_REFUSAL_MESSAGE).toBe(
      "This password reset link is not valid. Request a new one."
    );
  });
});
