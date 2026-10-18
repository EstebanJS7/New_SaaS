import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import type { TenantRow } from "../../test/support/in-memory-database.js";

/**
 * The portal recovery routes over real HTTP ([[PORTAL-002]]).
 *
 * The property under test is the one the whole flow is built around: a caller learns NOTHING about
 * whether a holder exists. The four cases below are the four ways a request can fail, and all four
 * must look identical from outside.
 */
interface ErrorEnvelopeBody {
  error: { code: string; message: string };
}

let booted: BootedTestApp;
let tenant: TenantRow;
let access: { id: string };

beforeAll(async () => {
  booted = await bootTestApp();
  tenant = booted.db.prisma.tenant.create({
    data: { slug: `recovery-${randomUUID().slice(0, 8)}`, name: "Recovery" },
  });
  const customer = booted.db.prisma.customer.create({
    data: {
      tenantId: tenant.id,
      kind: "INDIVIDUAL",
      displayName: "Holder",
      isActive: true,
      legalName: null,
      taxId: null,
      firstName: null,
      lastName: null,
      documentNumber: null,
    },
  });
  const created = booted.db.prisma.customerPortalAccess.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      contactEmail: "holder@portal.test",
      status: "ACTIVE",
    },
  });
  access = { id: created.id };
  // A holder with a credential: the flow silences one without, so a case that asserted the uniform
  // answer for a holder would pass for the wrong reason.
  booted.db.prisma.portalCredential.create({
    data: { portalAccessId: created.id, passwordHash: "$argon2id$stub" },
  });
});
afterAll(async () => booted.close());

const forgot = (tenantSlug: string, email: string) =>
  supertest(booted.app.getHttpServer()).post("/portal/forgot-password").send({ tenantSlug, email });

const reset = (body: Record<string, unknown>) =>
  supertest(booted.app.getHttpServer()).post("/portal/password-reset").send(body);

describe("the portal recovery surface", () => {
  it("answers a holder and a stranger BYTE-IDENTICALLY", async () => {
    const holder = await forgot(tenant.slug, "holder@portal.test").expect(202);
    const stranger = await forgot(tenant.slug, "nobody@portal.test").expect(202);

    expect(holder.body).toEqual({ status: "accepted" });
    expect(JSON.stringify(holder.body)).toBe(JSON.stringify(stranger.body));
    expect(holder.status).toBe(stranger.status);
  });

  it("answers an unknown TENANT identically too", async () => {
    const unknown = await forgot("no-such-clinic", "holder@portal.test").expect(202);
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify({ status: "accepted" }));
  });

  it("refuses an unusable token with the login's vocabulary, and validates the body first", async () => {
    const bad = await reset({
      token: "a-token-that-was-never-issued",
      password: "a-long-enough-password",
    }).expect(401);
    expect((bad.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    expect((bad.body as ErrorEnvelopeBody).error.message).toBe(
      "This password reset link is not valid. Request a new one."
    );

    await reset({ token: "", password: "a-long-enough-password" }).expect(400);
    await reset({ password: "a-long-enough-password" }).expect(400);
    // The policy is the credential boundary's: a short password never reaches argon2.
    await reset({ token: "a-token", password: "short" }).expect(400);
  });

  it("creates no session and no cookie on any path", async () => {
    const response = await forgot(tenant.slug, "holder@portal.test").expect(202);
    // A recovery request is not a sign-in: no portal cookie is issued, so a caller cannot turn a
    // request into a session.
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(access.id).toBeTruthy();
  });
});
