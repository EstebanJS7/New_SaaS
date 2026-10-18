import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import type { EventDispatcher } from "@newsaas/shared";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { LOGIN_FAILURE_THRESHOLD, LoginRateLimiterService } from "./login-rate-limiter.service.js";
import {
  PASSWORD_RESET_REQUESTED,
  PasswordRecoveryService,
  TOO_MANY_RECOVERY_REQUESTS_MESSAGE,
  recoveryRateLimitKey,
  type PasswordRecoveryPrisma,
} from "./password-recovery.service.js";

const NOW = new Date("2026-10-17T12:00:00.000Z");
const PROFILE = "11111111-1111-4111-8111-111111111111";
const IP = "203.0.113.7";

interface Harness {
  service: PasswordRecoveryService;
  finds: Prisma.UserProfileFindUniqueArgs[];
  published: { type: string; tenantId: string | null; aggregateId: string }[];
  audits: { action: string; targetId?: string }[];
}

function harness(options: { profile?: unknown } = {}): Harness {
  const finds: Prisma.UserProfileFindUniqueArgs[] = [];
  const published: Harness["published"] = [];
  const audits: Harness["audits"] = [];
  const prisma: PasswordRecoveryPrisma = {
    userProfile: {
      findUnique: (args) => {
        finds.push(args);
        return Promise.resolve(
          (options.profile === undefined
            ? { id: PROFILE, credential: { userProfileId: PROFILE } }
            : options.profile) as never
        );
      },
    },
  };
  const events = {
    publish: (type: string, partial: { tenantId: string | null; aggregateId: string }) => {
      published.push({ type, tenantId: partial.tenantId, aggregateId: partial.aggregateId });
      return { id: "event", type, occurredAt: NOW.toISOString(), ...partial };
    },
  } as unknown as EventDispatcher;
  const audit = {
    append: (input: { action: string; targetId?: string }) => {
      audits.push(input);
      return Promise.resolve({ id: "audit" });
    },
  } as unknown as AuditWriter;
  return {
    service: new PasswordRecoveryService(prisma, events, new LoginRateLimiterService(), audit),
    finds,
    published,
    audits,
  };
}

describe("PasswordRecoveryService — what a caller may learn", () => {
  it("normalizes the address EXACTLY as login does, so an account that can log in can be found", async () => {
    const { service, finds, published } = harness();
    await service.requestReset("  Owner@Clinic.Test  ", IP, NOW);
    expect(finds[0]?.where).toEqual({ email: "owner@clinic.test" });
    expect(published).toHaveLength(1);
  });

  it("publishes a PLATFORM-LEVEL event carrying the profile id and nothing else", async () => {
    const { service, published } = harness();
    await service.requestReset("owner@clinic.test", IP, NOW);

    // `tenantId: null` is the envelope's documented meaning for a platform-level
    // event, and it is the honest value: the credential is global to the profile and
    // the request is anonymous, so there is no tenant to name.
    expect(published[0]).toEqual({
      type: PASSWORD_RESET_REQUESTED,
      tenantId: null,
      aggregateId: PROFILE,
    });
  });

  it("is SILENT for an unknown address: no event, no audit, no error", async () => {
    const { service, published, audits } = harness({ profile: null });
    await expect(service.requestReset("nobody@clinic.test", IP, NOW)).resolves.toBeUndefined();
    // Both assertions matter. An event would create a delivery for nobody, and an
    // audit row per probe would let a stranger grow the audit table.
    expect(published).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("is silent for a profile that has no credentials, which cannot log in at all", async () => {
    const { service, published, audits } = harness({
      profile: { id: PROFILE, credential: null },
    });
    await expect(service.requestReset("owner@clinic.test", IP, NOW)).resolves.toBeUndefined();
    expect(published).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("does not query for an empty address, and stays silent", async () => {
    const { service, finds, published } = harness();
    await service.requestReset("   ", IP, NOW);
    expect(finds).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it("does not query for a non-string address either", async () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      const { service, finds } = harness();
      await expect(service.requestReset(bad, IP, NOW)).resolves.toBeUndefined();
      expect(finds).toHaveLength(0);
    }
  });

  it("audits a real request with the profile as the subject and no address", async () => {
    const { service, audits } = harness();
    await service.requestReset("owner@clinic.test", IP, NOW);
    expect(audits[0]).toMatchObject({
      action: "auth.password_reset_requested",
      actorUserProfileId: PROFILE,
      targetType: "user_profile",
      targetId: PROFILE,
    });
    // The record names nobody: the email is personal data and the request already
    // knows who it was for.
    expect(JSON.stringify(audits[0])).not.toContain("owner@clinic.test");
  });

  it("refuses with RATE_LIMITED before any lookup, and publishes nothing", async () => {
    const { service, finds, published } = harness();
    for (let attempt = 0; attempt < LOGIN_FAILURE_THRESHOLD; attempt += 1) {
      await service.requestReset("owner@clinic.test", IP, NOW);
    }
    const before = published.length;
    const beforeFinds = finds.length;

    await expect(service.requestReset("owner@clinic.test", IP, NOW)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: TOO_MANY_RECOVERY_REQUESTS_MESSAGE,
    });
    // No lookup and no event: the refusal costs nothing and reveals nothing.
    expect(finds).toHaveLength(beforeFinds);
    expect(published).toHaveLength(before);
  });

  it("keys the limit by ADDRESS AND IP, so one attacker cannot lock a victim out", () => {
    // Keyed by the address alone, an attacker could exhaust a known address's budget
    // and deny that person their own recovery.
    expect(recoveryRateLimitKey("a@b.test", "1.1.1.1")).not.toBe(
      recoveryRateLimitKey("a@b.test", "2.2.2.2")
    );
    // And namespaced, so asking for resets cannot consume the login budget — the
    // person asking for a reset is about to try to log in.
    expect(recoveryRateLimitKey("a@b.test", "1.1.1.1")).not.toBe("a@b.test:1.1.1.1");
  });
});
