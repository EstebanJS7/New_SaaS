import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "./auth.config.js";
import { SessionService } from "./session.service.js";

/**
 * Module-boundary fake over the Prisma delegates this service touches
 * (PrismaClient is a Proxy — fakes attach by shape, never instanceof).
 * Backed by real Maps so rotation/revocation semantics are observable.
 */
function makeFakePrisma() {
  const sessions = new Map<
    string,
    {
      id: string;
      userProfileId: string;
      tokenHash: string;
      lastSeenAt: Date;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      revokedAt: Date | null;
    }
  >();
  let sequence = 0;

  const prisma = {
    staffSession: {
      // Sync bodies on purpose (eslint require-await): the service awaits
      // them, but awaiting a plain value keeps runtime behavior identical.
      create: ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = {
          id: `session-${sequence}`,
          userProfileId: data.userProfileId as string,
          tokenHash: data.tokenHash as string,
          lastSeenAt: data.lastSeenAt as Date,
          idleExpiresAt: data.idleExpiresAt as Date,
          absoluteExpiresAt: data.absoluteExpiresAt as Date,
          revokedAt: null,
        };
        sessions.set(row.tokenHash, row);
        return row;
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        sessions.get(where.tokenHash) ?? null,
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...sessions.values()].find((entry) => entry.id === where.id);
        if (!row) throw new Error("P2025 record not found");
        Object.assign(row, data);
        return row;
      },
      deleteMany: ({ where }: { where: { tokenHash: string } }) => {
        const existed = sessions.delete(where.tokenHash);
        return { count: existed ? 1 : 0 };
      },
    },
  };

  return { prisma, sessions };
}

const CONFIG: AuthConfig = {
  argonMemoryCost: 19456,
  argonTimeCost: 2,
  argonParallelism: 1,
  sessionIdleTtlSeconds: 7200,
  sessionAbsoluteTtlSeconds: 43_200,
  cookieSecure: false,
};

const T0 = new Date("2026-08-25T12:00:00.000Z");

function makeService(fake = makeFakePrisma()): {
  service: SessionService;
  sessions: ReturnType<typeof makeFakePrisma>["sessions"];
} {
  // PrismaClient is a Proxy — cast the structural fake instead of extending.
  const service = new SessionService(fake.prisma as never, CONFIG);
  return { service, sessions: fake.sessions };
}

describe("SessionService — issuance", () => {
  it("stores ONLY the SHA-256 of the opaque token, never the token itself", async () => {
    const { service, sessions } = makeService();

    const { token } = await service.issue("profile-1", T0);

    expect(token).not.toContain("$");
    expect(sessions.size).toBe(1);
    const storedHash = [...sessions.values()][0].tokenHash;
    expect(storedHash).not.toBe(token);
    expect(storedHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("each login inserts a FRESH row (rotation) with independent tokens", async () => {
    const { service, sessions } = makeService();

    const first = await service.issue("profile-1", T0);
    const second = await service.issue("profile-1", T0);

    expect(first.token).not.toBe(second.token);
    expect(sessions.size).toBe(2);
    const rows = [...sessions.values()];
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it("computes idle and absolute expiry from config and creation time", async () => {
    const { service, sessions } = makeService();

    await service.issue("profile-1", T0);

    const row = [...sessions.values()][0];
    expect(row.lastSeenAt).toEqual(T0);
    expect(row.idleExpiresAt.getTime()).toBe(T0.getTime() + 7_200_000);
    expect(row.absoluteExpiresAt.getTime()).toBe(T0.getTime() + 43_200_000);
  });
});

describe("SessionService — resolution and TTL discrimination", () => {
  it("resolves a live session to its profile id without refreshing fresh rows", async () => {
    const { service, sessions } = makeService();
    const { token } = await service.issue("profile-1", T0);

    const resolved = await service.resolve(token, new Date(T0.getTime() + 30_000));

    expect(resolved).not.toBeNull();
    expect(resolved?.userProfileId).toBe("profile-1");
    // Fresh (<60s): no rolling write happened.
    const row = [...sessions.values()][0];
    expect(row.lastSeenAt).toEqual(T0);
  });

  it("rejects an IDLE-expired session even though absolute time remains", async () => {
    const { service } = makeService();
    const { token } = await service.issue("profile-1", T0);

    const justAfterIdleExpiry = new Date(T0.getTime() + 7_200_001);
    expect(await service.resolve(token, justAfterIdleExpiry)).toBeNull();
  });

  it("rejects an ABSOLUTE-expired session even when the idle window is fresh", async () => {
    const { service } = makeService();
    const { token } = await service.issue("profile-1", T0);

    // Keep the session continuously active until near the hard ceiling, so
    // the idle window is guaranteed fresh when absolute time runs out.
    let now = T0.getTime();
    while (now < T0.getTime() + 42_000_000) {
      now += 120_000;
      expect(await service.resolve(token, new Date(now))).not.toBeNull();
    }

    // Still inside the rolling idle window...
    const nearCeiling = new Date(T0.getTime() + 43_190_000);
    expect(await service.resolve(token, nearCeiling)).not.toBeNull();

    // ...but the absolute ceiling kills a FRESH session regardless.
    const afterAbsolute = new Date(T0.getTime() + 43_200_001);
    expect(await service.resolve(token, afterAbsolute)).toBeNull();
  });

  it("rolls the idle window only when last_seen is staler than 60s (throttle)", async () => {
    const { service, sessions } = makeService();
    const { token } = await service.issue("profile-1", T0);

    // Exactly at the throttle boundary: NOT stale enough (>60s required).
    await service.resolve(token, new Date(T0.getTime() + 60_000));
    expect([...sessions.values()][0].lastSeenAt).toEqual(T0);

    // One millisecond past the boundary: refresh fires.
    await service.resolve(token, new Date(T0.getTime() + 61_000));
    const row = [...sessions.values()][0];
    expect(row.lastSeenAt).toEqual(new Date(T0.getTime() + 61_000));
    expect(row.idleExpiresAt.getTime()).toBe(new Date(T0.getTime() + 61_000).getTime() + 7_200_000);
  });

  it("rejects a session whose idle window expired DESPITE recent activity", async () => {
    const { service } = makeService();
    const { token } = await service.issue("profile-1", T0);

    // Activity keeps arriving until just before idle expiry...
    let now = T0.getTime();
    while (now < T0.getTime() + 7_100_000) {
      now += 120_000; // 2-minute hops keep refreshing (>60s throttle each time)
      await service.resolve(token, new Date(now));
    }
    // ...but stopping activity lets idle expiry win.
    const abandoned = new Date(T0.getTime() + 14_400_000);
    expect(await service.resolve(token, abandoned)).toBeNull();
  });

  it("never resolves unknown or malformed tokens", async () => {
    const { service } = makeService();

    expect(await service.resolve(undefined)).toBeNull();
    expect(await service.resolve("")).toBeNull();
    expect(await service.resolve(12345)).toBeNull();
    expect(await service.resolve(randomBytes(32).toString("base64url"))).toBeNull();
  });
});

describe("SessionService — revocation", () => {
  it("hard-deletes the row so replayed tokens fail lookup afterwards", async () => {
    const { service, sessions } = makeService();
    const { token } = await service.issue("profile-1", T0);

    await service.revoke(token);

    expect(sessions.size).toBe(0);
    expect(await service.resolve(token, T0)).toBeNull();
  });

  it("is idempotent for repeated or malformed revocations", async () => {
    const { service } = makeService();
    const { token } = await service.issue("profile-1", T0);
    await service.revoke(token);

    await expect(service.revoke(token)).resolves.toBeUndefined();
    await expect(service.revoke(undefined)).resolves.toBeUndefined();
    await expect(service.revoke("")).resolves.toBeUndefined();
    await expect(service.revoke(null)).resolves.toBeUndefined();
  });

  it("treats a concurrent revoke during the rolling refresh as unauthenticated, not a 500", async () => {
    const fake = makeFakePrisma();
    const issuer = new SessionService(fake.prisma as never, CONFIG);
    const { token } = await issuer.issue("profile-1", T0);

    // Logout hard-deletes the row between resolve()'s findUnique and its
    // throttled refresh: Prisma surfaces P2025 on that UPDATE.
    fake.prisma.staffSession.update = () => {
      throw Object.assign(new Error("Record to update not found"), { code: "P2025" });
    };
    const service = new SessionService(fake.prisma as never, CONFIG);

    // PAST the >60s throttle so the refresh actually fires and hits the race.
    expect(await service.resolve(token, new Date(T0.getTime() + 61_000))).toBeNull();
  });

  it("still surfaces storage failures other than P2025 (no blanket swallow)", async () => {
    const fake = makeFakePrisma();
    const issuer = new SessionService(fake.prisma as never, CONFIG);
    const { token } = await issuer.issue("profile-1", T0);

    fake.prisma.staffSession.update = () => {
      throw new Error("connection refused");
    };
    const service = new SessionService(fake.prisma as never, CONFIG);

    await expect(service.resolve(token, new Date(T0.getTime() + 61_000))).rejects.toThrow(
      "connection refused"
    );
  });
});

describe("SessionService — clock independence", () => {
  it("drives every expiry decision from the injected now, not wall time", async () => {
    const { service } = makeService();
    // An epoch wildly distant from the real system clock (2026): if any
    // operation silently used wall time, these assertions would flip.
    const ancientEpoch = new Date("2001-01-01T00:00:00.000Z");

    const { token } = await service.issue("profile-1", ancientEpoch);
    // A sub-throttle peek (<60s) must NOT roll the idle window forward...
    expect(await service.resolve(token, new Date(ancientEpoch.getTime() + 30_000))).not.toBeNull();

    // ...so at +2h+1ms of SESSION time the idle window has expired — even
    // though wall-clock says 2026 and a wall-clock implementation would
    // consider the session brand new.
    const afterIdle = new Date(ancientEpoch.getTime() + 7_200_001);
    expect(await service.resolve(token, afterIdle)).toBeNull();

    await service.revoke(token);
    expect(await service.resolve(token, ancientEpoch)).toBeNull();
  });
});
