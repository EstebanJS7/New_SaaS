import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import { PASSWORD_RESET_TOKEN_TTL_MS } from "@newsaas/shared";
import {
  PORTAL_RESET_TOKEN_INVALID_MESSAGE,
  PortalPasswordResetTokenService,
  type PortalResetTokenPrisma,
  type PortalResetTokenRow,
} from "./portal-password-reset-token.service.js";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const ACCESS = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<PortalResetTokenRow> = {}): PortalResetTokenRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    portalAccessId: ACCESS,
    tokenHash: "a".repeat(64),
    expiresAt: new Date(NOW.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
    consumedAt: null,
    ...overrides,
  };
}

interface Harness {
  service: PortalPasswordResetTokenService;
  creates: Prisma.PortalPasswordResetTokenCreateArgs[];
  finds: Prisma.PortalPasswordResetTokenFindFirstArgs[];
  updates: Prisma.PortalPasswordResetTokenUpdateManyArgs[];
}

function harness(options: { rows?: PortalResetTokenRow[]; spentCount?: number } = {}): Harness {
  const creates: Prisma.PortalPasswordResetTokenCreateArgs[] = [];
  const finds: Prisma.PortalPasswordResetTokenFindFirstArgs[] = [];
  const updates: Prisma.PortalPasswordResetTokenUpdateManyArgs[] = [];
  const prisma: PortalResetTokenPrisma = {
    portalPasswordResetToken: {
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
  return { service: new PortalPasswordResetTokenService(prisma), creates, finds, updates };
}

describe("PortalPasswordResetTokenService.issue", () => {
  it("stores the DIGEST and never the plaintext, keyed to an ACCESS", async () => {
    const { service, creates } = harness();
    const issued = await service.issue(ACCESS, NOW);

    const data = creates[0]?.data as { portalAccessId: string; tokenHash: string; expiresAt: Date };
    expect(data.portalAccessId).toBe(ACCESS);
    expect(JSON.stringify(creates[0])).not.toContain(issued.token);
    expect(issued.expiresAt.getTime()).toBe(NOW.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);
  });

  it("never writes a user_profile reference — the identity boundary in the schema", async () => {
    const { service, creates } = harness();
    await service.issue(ACCESS, NOW);
    // A portal token is not a staff token: the staff table's subject cannot appear here, and this
    // assertion is what keeps a refactor from reaching for the other table's field name.
    expect(JSON.stringify(creates[0])).not.toContain("userProfileId");
  });
});

describe("PortalPasswordResetTokenService.consume", () => {
  it("spends a live token with a compare-and-set", async () => {
    const { service, finds, updates } = harness({ rows: [row()] });
    await expect(service.consume("a-token", NOW)).resolves.toEqual({
      tokenId: row().id,
      portalAccessId: ACCESS,
    });
    expect(finds[0]?.where).toHaveProperty("tokenHash");
    expect(updates[0]?.where).toEqual({ id: row().id, consumedAt: null, expiresAt: { gt: NOW } });
  });

  it("refuses an unknown, a spent and an expired token IDENTICALLY", async () => {
    const cases = [
      harness({ rows: [] }),
      harness({ rows: [row({ consumedAt: new Date(NOW.getTime() - 1000) })] }),
      harness({ rows: [row({ expiresAt: new Date(NOW.getTime() - 1) })] }),
    ];
    for (const { service } of cases) {
      await expect(service.consume("a-token", NOW)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
        message: PORTAL_RESET_TOKEN_INVALID_MESSAGE,
      });
    }
  });

  it("refuses a lost race with the same refusal", async () => {
    const { service } = harness({ rows: [row()], spentCount: 0 });
    await expect(service.consume("a-token", NOW)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("refuses a non-string without querying at all", async () => {
    for (const bad of [undefined, null, 42, {}, "", []]) {
      const { service, finds, updates } = harness({ rows: [row()] });
      await expect(service.consume(bad, NOW)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(finds).toHaveLength(0);
      expect(updates).toHaveLength(0);
    }
  });

  it("is refused at exactly the expiry instant, and accepted a millisecond before", async () => {
    const at = new Date(NOW.getTime() + 1000);
    const { service: refused } = harness({ rows: [row({ expiresAt: at })] });
    await expect(refused.consume("a-token", at)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const { service: accepted } = harness({
      rows: [row({ expiresAt: new Date(at.getTime() + 1) })],
    });
    await expect(accepted.consume("a-token", at)).resolves.toMatchObject({
      portalAccessId: ACCESS,
    });
  });
});

describe("PortalPasswordResetTokenService.spendAllForAccess", () => {
  it("spends the outstanding tokens of ONE access and leaves the spent ones alone", async () => {
    const { service, updates } = harness({ spentCount: 2 });
    await expect(service.spendAllForAccess(ACCESS, NOW)).resolves.toBe(2);
    expect(updates[0]?.where).toEqual({ portalAccessId: ACCESS, consumedAt: null });
  });
});
