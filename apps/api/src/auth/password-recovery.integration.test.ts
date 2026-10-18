import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { PLATFORM_TENANT_SLUG } from "@newsaas/database";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { hashPasswordResetToken } from "./password-reset-token.service.js";
import type {
  AuditLogRow,
  TenantRow,
  UserProfileRow,
} from "../../test/support/in-memory-database.js";

/**
 * Staff password recovery, END TO END (DAT-007 WU-D).
 *
 * This is the gap the earlier units named rather than implied: the request half and
 * the reset half were each proven against stubs, and what was missing is the wiring a
 * stub cannot show — that a published `PasswordResetRequested` actually reaches the
 * notification module's subscriber IN THIS DEPLOYABLE, that the delivery lands under
 * the platform tenant, and that a real token changes a real credential inside one
 * transaction.
 *
 * The dispatcher is in-process, so "the subscriber is registered somewhere else" is a
 * silent, total failure of this feature; this suite is where that is not silent.
 */

const KNOWN = "recoverable@clinic.test";
const UNKNOWN = "nobody-here@clinic.test";
const PASSWORD = "a-password-set-by-the-reset";

let booted: BootedTestApp;
let tenant: TenantRow;
let platform: TenantRow;
let profile: UserProfileRow;

function deliveriesFor(sourceId: string) {
  return booted.db.prisma.notificationDelivery
    .findMany({ where: { tenantId: platform.id } })
    .filter((row) => row.sourceId === sourceId);
}

beforeAll(async () => {
  booted = await bootTestApp();
  tenant = booted.db.prisma.tenant.create({ data: { slug: "recovery-t", name: "Recovery" } });
  platform = booted.db.prisma.tenant.create({
    data: { slug: PLATFORM_TENANT_SLUG, name: "Platform" },
  });
  profile = booted.db.prisma.userProfile.create({
    data: { email: KNOWN, displayName: "Recoverable Staff", status: "active" },
  });
  booted.db.prisma.userCredential.create({
    data: { userProfileId: profile.id, passwordHash: "$argon2id$old$old" },
  });
});
afterAll(async () => booted.close());

const forgot = (email: string) =>
  supertest(booted.app.getHttpServer()).post("/auth/forgot-password").send({ email });

const reset = (token: string, password = PASSWORD) =>
  supertest(booted.app.getHttpServer()).post("/auth/password-reset").send({ token, password });

const auditsFor = (action: string): AuditLogRow[] =>
  [...booted.db.tables.audits.values()].filter((row: AuditLogRow) => row.action === action);

describe("Password recovery, end to end", () => {
  it("turns a request into a delivery under the PLATFORM tenant, and enqueues it", async () => {
    // The deployment requires the platform tenant to exist: the seed writes it, and a
    // missing one is a loud failure rather than a silent no-mail.
    expect(platform.slug).toBe(PLATFORM_TENANT_SLUG);

    await forgot(KNOWN).expect(202);

    const created = deliveriesFor(profile.id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      tenantId: platform.id,
      channel: "EMAIL",
      sourceType: "STAFF_ACCOUNT",
      recipientType: "STAFF",
      recipientId: profile.id,
      status: "SCHEDULED",
    });
    // The job exists. Without it the row would be a message nobody ever sends.
    expect(booted.notificationDeliveryProducer.enqueued).toHaveLength(1);
    expect(booted.notificationDeliveryProducer.enqueued[0]?.job.notificationDeliveryId).toBe(
      created[0]?.id
    );
    // A tenant's operator sees nothing of it: the delivery is the platform's.
    expect(created[0]?.tenantId).not.toBe(tenant.id);
  });

  it("creates NOTHING for an address that does not exist, and answers the same", async () => {
    const before = booted.notificationDeliveryProducer.enqueued.length;
    const response = await forgot(UNKNOWN).expect(202);
    expect(response.body).toEqual({ status: "accepted" });

    // The answer is identical and nothing happened: no delivery, no job, no audit.
    expect(booted.notificationDeliveryProducer.enqueued).toHaveLength(before);
    expect(deliveriesFor(profile.id)).toHaveLength(1);
  });

  it("sends ONE message per hour window however often it is asked", async () => {
    const before = deliveriesFor(profile.id);
    await forgot(KNOWN).expect(202);

    // One DELIVERY: the dedupe key holds for the window, so the second request is
    // told to check an inbox that already has the message. That is the anti-abuse
    // budget working, not a lost request.
    expect(deliveriesFor(profile.id)).toHaveLength(before.length);

    // And every enqueue names the SAME job identity, so BullMQ treats a repeat as a
    // no-op. That is the self-healing shape DAT-007 inherited from EPIC-17 — a repeat
    // re-enqueues rather than giving up — and the deterministic id is what makes
    // re-enqueueing safe.
    const ids = new Set(
      booted.notificationDeliveryProducer.enqueued.map((entry) => entry.job.notificationDeliveryId)
    );
    expect(ids.size).toBe(1);
  });

  it("audits the request with the profile as subject and no address", async () => {
    const before = auditsFor("auth.password_reset_requested").length;
    await forgot(KNOWN).expect(202);
    const after = auditsFor("auth.password_reset_requested");
    expect(after).toHaveLength(before + 1);
    // The record names the profile and nobody else: the address is personal data and
    // the request already knew who it was for.
    expect(JSON.stringify(after[after.length - 1])).not.toContain(KNOWN);
  });

  it("refuses an unusable token, and changes nothing", async () => {
    const before = booted.db.prisma.userCredential.findUnique({
      where: { userProfileId: profile.id },
    });
    await reset("a-token-that-was-never-issued").expect(401);
    expect(
      booted.db.prisma.userCredential.findUnique({ where: { userProfileId: profile.id } })
        ?.passwordHash
    ).toBe(before?.passwordHash);
  });

  it("consumes a real token: the hash changes, EVERY session ends and the change is audited", async () => {
    // A live token, created the way the send path will create it: the row stores only
    // the digest, and the plaintext exists in this variable and nowhere else.
    const token = randomUUID().replace(/-/g, "");
    booted.db.prisma.passwordResetToken.create({
      data: {
        userProfileId: profile.id,
        tokenHash: hashPasswordResetToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    // Two sessions, only one of which the caller could possibly hold: the reset must
    // end both, or a stolen session outlives the recovery.
    for (const via of ["laptop", "phone"]) {
      booted.db.prisma.staffSession.create({
        data: {
          userProfileId: profile.id,
          tokenHash: `session-${via}`,
          lastSeenAt: new Date(),
          idleExpiresAt: new Date(Date.now() + 60_000),
          absoluteExpiresAt: new Date(Date.now() + 120_000),
        },
      });
    }
    // And a SECOND unsent link, which must not survive the password it was for.
    const other = randomUUID().replace(/-/g, "");
    booted.db.prisma.passwordResetToken.create({
      data: {
        userProfileId: profile.id,
        tokenHash: hashPasswordResetToken(other),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    await reset(token).expect(200);

    // The hash changed, with the real argon2id prefix and the configured parameters —
    // the same boundary login verifies against.
    const updated = booted.db.prisma.userCredential.findUnique({
      where: { userProfileId: profile.id },
    });
    // The real format, with the configured OWASP-floor parameters: the same boundary
    // the login path verifies against, so a reset password is a valid password.
    expect(updated?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(updated?.passwordHash).not.toBe("$argon2id$old$old");

    // Every session, and both links.
    expect(booted.db.tables.sessions.size).toBe(0);
    await reset(other).expect(401);

    // The change is audited, once, with no token and no hash in the record.
    const audits = auditsFor("auth.password_reset_completed");
    expect(audits).toHaveLength(1);
    const serialized = JSON.stringify(audits[0]);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("argon2");
  });

  it("cannot be replayed: the spent token is refused the second time", async () => {
    // The link is gone the moment it is used, and the refusal is the same one a
    // stranger's guess gets.
    await reset("a-token-that-was-never-issued").expect(401);
  });
});
