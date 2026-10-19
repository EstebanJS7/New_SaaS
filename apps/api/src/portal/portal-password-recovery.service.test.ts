import { describe, expect, it } from "vitest";
import type { AuditAppendInput, Prisma } from "@newsaas/database";
import type { EventDispatcher } from "@newsaas/shared";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { CredentialService } from "../auth/credential.service.js";
import {
  LOGIN_FAILURE_THRESHOLD,
  LoginRateLimiterService,
} from "../auth/login-rate-limiter.service.js";
import {
  PORTAL_PASSWORD_RESET_REQUESTED,
  PORTAL_TOO_MANY_RECOVERY_REQUESTS_MESSAGE,
  PortalPasswordRecoveryService,
  portalRecoveryRateLimitKey,
  type PortalRecoveryPrismaFull,
  type PortalResetTx,
} from "./portal-password-recovery.service.js";
import { PortalPasswordResetTokenService } from "./portal-password-reset-token.service.js";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const TENANT = "11111111-1111-4111-8111-111111111111";
const ACCESS = "22222222-2222-4222-8222-222222222222";
const HASHED = "a".repeat(64);

interface Harness {
  service: PortalPasswordRecoveryService;
  published: { type: string; tenantId: string | null; aggregateId: string }[];
  audits: AuditAppendInput[];
  accessQueries: Prisma.CustomerPortalAccessFindManyArgs[];
}

function harness(
  options: {
    tenant?: { id: string } | null;
    accesses?: unknown[];
    tokenRow?: unknown;
    updateFails?: boolean;
    sessions?: number;
  } = {}
): Harness {
  const published: Harness["published"] = [];
  const audits: AuditAppendInput[] = [];
  const accessQueries: Prisma.CustomerPortalAccessFindManyArgs[] = [];

  const tx: PortalResetTx = {
    portalPasswordResetToken: {
      create: () => Promise.resolve({ id: "unused" }),
      findFirst: () =>
        Promise.resolve(
          (options.tokenRow === undefined
            ? {
                id: "token-1",
                portalAccessId: ACCESS,
                tokenHash: HASHED,
                expiresAt: new Date(NOW.getTime() + 60_000),
                consumedAt: null,
              }
            : options.tokenRow) as never
        ),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    portalCredential: {
      update: () => {
        if (options.updateFails) return Promise.reject(new Error("write failed"));
        return Promise.resolve({});
      },
    },
    portalSession: { deleteMany: () => Promise.resolve({ count: options.sessions ?? 2 }) },
    auditLog: { create: () => Promise.resolve({ id: "audit" }) },
  };

  const prisma = {
    tenant: {
      findUnique: () =>
        Promise.resolve(options.tenant === undefined ? { id: TENANT } : options.tenant),
    },
    customerPortalAccess: {
      findMany: (args: Prisma.CustomerPortalAccessFindManyArgs) => {
        accessQueries.push(args);
        return Promise.resolve(
          (options.accesses ?? [
            { id: ACCESS, tenantId: TENANT, credential: { portalAccessId: ACCESS } },
          ]) as never
        );
      },
    },
    $transaction: <T>(run: (tx: PortalResetTx) => Promise<T>): Promise<T> => run(tx),
  } as unknown as PortalRecoveryPrismaFull;

  const events = {
    publish: (type: string, partial: { tenantId: string | null; aggregateId: string }) => {
      published.push({ type, tenantId: partial.tenantId, aggregateId: partial.aggregateId });
      return { id: "e", type, occurredAt: NOW.toISOString(), ...partial };
    },
  } as unknown as EventDispatcher;
  const credentials = {
    hash: () => Promise.resolve("$argon2id$stub"),
  } as unknown as CredentialService;
  const audit = {
    append: (input: AuditAppendInput) => {
      audits.push(input);
      return Promise.resolve({ id: "audit" });
    },
  } as unknown as AuditWriter;
  const tokens = new PortalPasswordResetTokenService({
    portalPasswordResetToken: {
      create: () => Promise.resolve({ id: "issued" }),
      findFirst: () => Promise.resolve(null),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
  });

  return {
    service: new PortalPasswordRecoveryService(
      prisma,
      events,
      tokens,
      credentials,
      new LoginRateLimiterService(),
      audit
    ),
    published,
    audits,
    accessQueries,
  };
}

describe("PortalPasswordRecoveryService — what a caller may learn", () => {
  it("resolves the tenant from the slug and the holder within it, and publishes under THAT tenant", async () => {
    const { service, published, accessQueries } = harness();
    await service.requestReset("demo", "Ana@Clinic.Test", "203.0.113.7", NOW);

    expect(accessQueries[0]?.where).toMatchObject({
      tenantId: TENANT,
      status: "ACTIVE",
      contactEmail: { equals: "ana@clinic.test", mode: "insensitive" },
    });
    // A portal message belongs to the CLINIC's tenant — unlike the staff recovery's platform-level
    // one — because the holder is a customer of that tenant.
    expect(published[0]).toEqual({
      type: PORTAL_PASSWORD_RESET_REQUESTED,
      tenantId: TENANT,
      aggregateId: ACCESS,
    });
  });

  it("is SILENT for a holder that does not exist, an unknown tenant, and no email", async () => {
    for (const options of [{ accesses: [] }, { tenant: null }, { accesses: [], tenant: null }]) {
      const { service, published, audits } = harness(options);
      await expect(
        service.requestReset("demo", "nobody@clinic.test", "1.1.1.1", NOW)
      ).resolves.toBeUndefined();
      expect(published).toHaveLength(0);
      expect(audits).toHaveLength(0);
    }
    const { service, accessQueries } = harness();
    await service.requestReset("demo", "   ", "1.1.1.1", NOW);
    expect(accessQueries).toHaveLength(0);
  });

  it("silences an AMBIGUOUS login identity rather than resolving one arbitrarily", async () => {
    // The login fails closed on two ACTIVE rows for one address; a recovery that answered
    // differently would tell an attacker the collision exists.
    const { service, published, accessQueries } = harness({
      accesses: [
        { id: ACCESS, tenantId: TENANT, credential: { portalAccessId: ACCESS } },
        { id: "other", tenantId: TENANT, credential: { portalAccessId: "other" } },
      ],
    });
    await service.requestReset("demo", "ana@clinic.test", "1.1.1.1", NOW);

    expect(published).toHaveLength(0);
    // Two rows are read, precisely so ambiguity is detectable.
    expect(accessQueries[0]?.take).toBe(2);
  });

  it("is silent for a holder with no credential, and refuses a non-string safely", async () => {
    const { service, published } = harness({
      accesses: [{ id: ACCESS, tenantId: TENANT, credential: null }],
    });
    await expect(
      service.requestReset("demo", "ana@clinic.test", "1.1.1.1", NOW)
    ).resolves.toBeUndefined();
    expect(published).toHaveLength(0);

    for (const bad of [undefined, null, 42, {}, []]) {
      const h = harness();
      await expect(h.service.requestReset(bad, bad, "1.1.1.1", NOW)).resolves.toBeUndefined();
      expect(h.published).toHaveLength(0);
    }
  });

  it("audits a real request with the access as subject and no address", async () => {
    const { service, audits } = harness();
    await service.requestReset("demo", "ana@clinic.test", "1.1.1.1", NOW);
    expect(audits[0]).toMatchObject({
      action: "portal.password_reset_requested",
      // Attributed to the ACCESS, not to an actor: the requester is anonymous by definition.
      actorPortalAccessId: ACCESS,
      targetType: "customer_portal_access",
      targetId: ACCESS,
    });
    expect(JSON.stringify(audits[0])).not.toContain("ana@clinic.test");
  });

  it("rate-limits per address and IP, namespaced away from the login budget", async () => {
    const { service, published } = harness();
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await service.requestReset("demo", "ana@clinic.test", "1.1.1.1", NOW);
    }
    const before = published.length;
    await expect(
      service.requestReset("demo", "ana@clinic.test", "1.1.1.1", NOW)
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: PORTAL_TOO_MANY_RECOVERY_REQUESTS_MESSAGE,
    });
    expect(published).toHaveLength(before);

    // Namespaced: the login's own key for the same address is a different key, and the IP is part of
    // it so one attacker cannot exhaust a victim's budget.
    expect(portalRecoveryRateLimitKey("demo:ana@clinic.test", "1.1.1.1")).toContain(
      "portal:recovery:"
    );
    expect(portalRecoveryRateLimitKey("demo:ana@clinic.test", "1.1.1.1")).not.toBe(
      portalRecoveryRateLimitKey("demo:ana@clinic.test", "2.2.2.2")
    );
  });
});

describe("PortalPasswordRecoveryService — the reset", () => {
  it("changes the password, ends EVERY portal session and audits, in one transaction", async () => {
    const { service, audits } = harness({ sessions: 3 });
    const outcome = await service.resetPassword("a-live-token", "a-long-enough-password", NOW);

    expect(outcome).toEqual({ portalAccessId: ACCESS, sessionsEnded: 3 });
    expect(audits[0]).toMatchObject({
      action: "portal.password_reset_completed",
      actorPortalAccessId: ACCESS,
      targetType: "customer_portal_access",
      targetId: ACCESS,
      metadata: { sessionsEnded: 3 },
    });
    expect(JSON.stringify(audits[0])).not.toContain("a-live-token");
  });

  it("refuses an unusable token with the login's own vocabulary", async () => {
    const { service } = harness({ tokenRow: null });
    await expect(
      service.resetPassword("nope", "a-long-enough-password", NOW)
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "This password reset link is not valid. Request a new one.",
    });
  });

  it("refuses a password the policy rejects, before hashing or touching a row", async () => {
    const { service } = harness();
    await expect(service.resetPassword("a-live-token", "short", NOW)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
