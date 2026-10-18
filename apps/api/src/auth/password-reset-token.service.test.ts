import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  PasswordResetTokenService,
  RESET_TOKEN_INVALID_MESSAGE,
  generatePasswordResetToken,
  hashPasswordResetToken,
  type PasswordResetTokenPrisma,
  type PasswordResetTokenRow,
} from "./password-reset-token.service.js";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const PROFILE = "11111111-1111-4111-8111-111111111111";

const TOKEN = "a-plaintext-reset-token-value";
const HASH = hashPasswordResetToken(TOKEN);

function row(overrides: Partial<PasswordResetTokenRow> = {}): PasswordResetTokenRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userProfileId: PROFILE,
    tokenHash: HASH,
    expiresAt: new Date(NOW.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    consumedAt: null,
    ...overrides,
  };
}

interface Harness {
  service: PasswordResetTokenService;
  creates: Prisma.PasswordResetTokenCreateArgs[];
  finds: Prisma.PasswordResetTokenFindFirstArgs[];
  updates: Prisma.PasswordResetTokenUpdateManyArgs[];
}

/**
 * The arguments are captured in typed arrays rather than read off `mock.calls`,
 * so an assertion about what the service ASKED FOR is checked by the compiler as
 * well as by the test — and because `mock.calls` is `any`, which this repository's
 * lint rejects.
 */
function harness(options: { rows?: PasswordResetTokenRow[]; spentCount?: number } = {}): Harness {
  const creates: Prisma.PasswordResetTokenCreateArgs[] = [];
  const finds: Prisma.PasswordResetTokenFindFirstArgs[] = [];
  const updates: Prisma.PasswordResetTokenUpdateManyArgs[] = [];
  const prisma: PasswordResetTokenPrisma = {
    passwordResetToken: {
      create: (args) => {
        creates.push(args);
        return Promise.resolve({ id: row().id });
      },
      findFirst: (args) => {
        finds.push(args);
        return Promise.resolve((options.rows ?? [])[0] ?? null);
      },
      updateMany: (args) => {
        updates.push(args);
        return Promise.resolve({ count: options.spentCount ?? 1 });
      },
    },
  };
  return { service: new PasswordResetTokenService(prisma), creates, finds, updates };
}

describe("the token's entropy and digest", () => {
  it("mints 32 random bytes as base64url, and two mints differ", () => {
    const first = generatePasswordResetToken();
    const second = generatePasswordResetToken();
    // 32 bytes base64url = 43 characters, no padding.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("digests deterministically and never as the token itself", () => {
    expect(hashPasswordResetToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPasswordResetToken(TOKEN)).toBe(HASH);
    expect(hashPasswordResetToken(`${TOKEN}x`)).not.toBe(HASH);
  });
});

describe("PasswordResetTokenService.issue", () => {
  it("stores the DIGEST and never the plaintext", async () => {
    const { service, creates } = harness();
    const issued = await service.issue(PROFILE, NOW);

    const data = creates[0]?.data as { userProfileId: string; tokenHash: string; expiresAt: Date };
    expect(data.tokenHash).toBe(hashPasswordResetToken(issued.token));
    // The assertion that matters: whatever else changes, the plaintext is not in
    // the write. Serializing the whole argument catches it in any field.
    expect(JSON.stringify(creates[0])).not.toContain(issued.token);
    expect(data.userProfileId).toBe(PROFILE);
  });

  it("sets the expiry from the TTL, not from the wall clock", async () => {
    const { service, creates } = harness();
    const issued = await service.issue(PROFILE, NOW);

    expect(issued.expiresAt.toISOString()).toBe(
      new Date(NOW.getTime() + PASSWORD_RESET_TOKEN_TTL_MS).toISOString()
    );
    const data = creates[0]?.data as { expiresAt: Date };
    expect(data.expiresAt.getTime()).toBe(issued.expiresAt.getTime());
  });

  it("returns the plaintext exactly once, and the row id it created", async () => {
    const { service } = harness();
    const issued = await service.issue(PROFILE, NOW);
    expect(typeof issued.token).toBe("string");
    expect(issued.tokenId).toBe(row().id);
    // Nothing on the returned value lets a caller recover the token later: there
    // is no second method that takes an id and hands back a plaintext.
    expect(Object.keys(issued).sort()).toEqual(["expiresAt", "token", "tokenId"]);
  });
});

describe("PasswordResetTokenService.consume", () => {
  it("spends a live token with a compare-and-set, not a read-then-write", async () => {
    const { service, finds, updates } = harness({ rows: [row()] });
    const consumed = await service.consume(TOKEN, NOW);

    expect(consumed).toEqual({ tokenId: row().id, userProfileId: PROFILE });
    expect(finds[0]?.where).toEqual({ tokenHash: HASH });
    // The WHERE carries the conditions the read saw, which is what makes two
    // concurrent requests with one link impossible to both win.
    expect(updates[0]?.where).toEqual({
      id: row().id,
      consumedAt: null,
      expiresAt: { gt: NOW },
    });
    expect((updates[0]?.data as { consumedAt: Date }).consumedAt.getTime()).toBe(NOW.getTime());
  });

  it("refuses a token it lost the race for, with the same refusal", async () => {
    const { service } = harness({ rows: [row()], spentCount: 0 });
    await expect(service.consume(TOKEN, NOW)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: RESET_TOKEN_INVALID_MESSAGE,
    });
  });

  it("refuses an unknown, a spent and an expired token IDENTICALLY", async () => {
    const unknown = await capture(() => harness({ rows: [] }).service.consume(TOKEN, NOW));
    const spent = await capture(() =>
      harness({ rows: [row({ consumedAt: new Date(NOW.getTime() - 1000) })] }).service.consume(
        TOKEN,
        NOW
      )
    );
    const expired = await capture(() =>
      harness({ rows: [row({ expiresAt: new Date(NOW.getTime() - 1) })] }).service.consume(
        TOKEN,
        NOW
      )
    );

    // Uniform means uniform: same code, same message. A distinct message per cause
    // would tell the holder of a stale link that it was once real.
    for (const failure of [unknown, spent, expired]) {
      expect(failure).toEqual({ code: "UNAUTHENTICATED", message: RESET_TOKEN_INVALID_MESSAGE });
    }
  });

  it("is refused at exactly the expiry instant, and accepted one millisecond before", async () => {
    const at = new Date(NOW.getTime() + 1000);
    const { service: refused } = harness({ rows: [row({ expiresAt: at })] });
    await expect(refused.consume(TOKEN, at)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const { service: accepted } = harness({
      rows: [row({ expiresAt: new Date(at.getTime() + 1) })],
    });
    await expect(accepted.consume(TOKEN, at)).resolves.toMatchObject({ userProfileId: PROFILE });
  });

  it("refuses a non-string token WITHOUT querying for it", async () => {
    for (const bad of [undefined, null, 42, {}, "", []]) {
      const { service, finds, updates } = harness({ rows: [row()] });
      await expect(service.consume(bad, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      // A missing body field must not become a driver error, and must not reach
      // the database at all.
      expect(finds).toHaveLength(0);
      expect(updates).toHaveLength(0);
    }
  });
});

describe("PasswordResetTokenService.spendAllForProfile", () => {
  it("spends the outstanding tokens and leaves the already-spent ones alone", async () => {
    const { service, updates } = harness({ spentCount: 2 });
    await expect(service.spendAllForProfile(PROFILE, NOW)).resolves.toBe(2);

    // The `consumedAt: null` in the WHERE is load-bearing twice: the guard refuses
    // a rewrite of a consumption instant, and a token spent earlier must keep the
    // instant it was ACTUALLY spent at.
    expect(updates[0]?.where).toEqual({ userProfileId: PROFILE, consumedAt: null });
  });
});

/** Runs a call and reports the DomainError it threw, or fails the test. */
async function capture(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    return { code: String(candidate.code), message: String(candidate.message) };
  }
  throw new Error("Expected the call to refuse, but it resolved.");
}
