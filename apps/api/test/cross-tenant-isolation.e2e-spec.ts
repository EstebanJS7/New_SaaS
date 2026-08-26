import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "./support/boot-test-app.js";
import { expectCrossTenant404 } from "./support/expect-cross-tenant-404.js";
import {
  insertLiveStaffSession,
  seedTwoTenants,
  type TwoTenantFixture,
} from "./support/seed-two-tenants.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface MembershipListBody {
  memberships: { id: string; tenantId: string; userProfileId: string; status: string }[];
}

/**
 * Cross-tenant ISOLATION SUITE over the shipped private aggregate
 * (`TenantMembership`) — real HTTP through the production adapter factory and
 * the full AppModule guard chain (design D5, tasks 5.3).
 *
 * Fences proven here (spec traceability #30–#38, #45, #46):
 * - unauthenticated ⇒ 401 envelope BEFORE any tenancy logic;
 * - authenticated without ACTIVE membership ⇒ 403 envelope (never data);
 * - foreign resource ⇒ 404 indistinguishable from nonexistent;
 * - body/query/header tenant hints NEVER steer server-side scoping;
 * - no self-service tenant/role/branch surface exists anywhere;
 * - Branch/CustomerPortalAccess stay untouched by any route;
 * - zero cross-tenant identifiers in every observed response body.
 */
describe("cross-tenant isolation (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
  });

  afterAll(async () => {
    fixture.cleanup();
    await booted.close();
  });

  const foreignIdentifiers = (): string[] => [
    fixture.tenants.b.id,
    fixture.tenants.b.slug,
    fixture.actors.b.profile.id,
    fixture.actors.b.membership!.id,
    fixture.actors.b.profile.email,
  ];

  /**
   * Identifiers that must NEVER appear anywhere, including infra metadata.
   * Restricted to values this suite NEVER puts on the wire: Fastify access
   * logs serialize `req.url`, and the query-hint probe below legitimately
   * carries tenant B's id/slug as caller-supplied claims (a request line is
   * not a data leak — the caller already knows what it sent). Profile
   * identity, by contrast, is never transmitted by us — seeing it anywhere
   * would prove a real boundary breach.
   */
  const neverAcceptableAnywhere = (): string[] => [
    fixture.actors.b.profile.id,
    fixture.actors.b.profile.email,
  ];

  it("rejects UNAUTHENTICATED access with a 401 envelope before any tenancy logic", async () => {
    for (const url of ["/memberships", `/memberships/${fixture.actors.a.membership!.id}`]) {
      const response = await supertest(booted.app.getHttpServer()).get(url).expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("scopes listing IMPLICITLY: tenant A observes only A rows even though B exists", async () => {
    const asA = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(200);
    const listA = (asA.body as MembershipListBody).memberships;

    // Tenant A's roster = its ACTIVE member + its SUSPENDED member (the
    // repository scopes by TENANT only); zero B rows is the isolation proof.
    expect(listA).toHaveLength(2);
    expect(listA.map((entry) => entry.tenantId)).toEqual([
      fixture.tenants.a.id,
      fixture.tenants.a.id,
    ]);
    expect(listA.every((entry) => entry.status === "ACTIVE" || entry.status === "SUSPENDED")).toBe(
      true
    );
    // The call site passed NO tenant filter — scoping is the repository's.
    for (const identifier of foreignIdentifiers()) {
      expect(asA.text).not.toContain(identifier);
    }
  });

  it("masks a FOREIGN membership as 404 and stays byte-equivalent to nonexistent", async () => {
    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.actors.a.cookie,
      nonexistentUrl: `/memberships/${randomUUID()}`,
      foreignUrl: `/memberships/${fixture.actors.b.membership!.id}`,
      forbiddenIdentifiers: foreignIdentifiers(),
    });
  });

  it("masks a FOREIGN membership from ROLE ASSIGNMENT as 404 too (EPIC-02 task 2.4)", async () => {
    // The audited assignment command is tenant-scoped exactly like the reads:
    // a foreign UUID must be indistinguishable from a nonexistent one — same
    // status, same envelope code, byte-identical body text.
    const sharedRequestId = randomUUID();
    const payload = { roleCode: "VETERINARIAN" };
    const server = booted.app.getHttpServer();

    const [nonexistentResponse, foreignResponse] = [
      await supertest(server)
        .post(`/memberships/${randomUUID()}/role`)
        .set("Cookie", fixture.actors.a.cookie)
        .set("x-request-id", sharedRequestId)
        .send(payload)
        .expect(404),
      await supertest(server)
        .post(`/memberships/${fixture.actors.b.membership!.id}/role`)
        .set("Cookie", fixture.actors.a.cookie)
        .set("x-request-id", sharedRequestId)
        .send(payload)
        .expect(404),
    ];

    expect((nonexistentResponse.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    expect((foreignResponse.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    expect(nonexistentResponse.text).toBe(foreignResponse.text);

    // Tenant B's membership id must not leak through either rejection.
    for (const body of [nonexistentResponse.text, foreignResponse.text]) {
      expect(body).not.toContain(fixture.actors.b.membership!.id);
    }
  });

  it("scopes RBAC permission OVERRIDES to the caller's tenant only (DEC-003)", async () => {
    // Seed a minimal slice of the reference catalog: one SEEDED role code
    // (addressable) plus its candidate permission row. Baseline mapping is
    // deliberately empty so the override verdict is the ONLY source of the
    // granted key.
    const CASHIER_ROLE = "CASHIER";
    const GRANTED_KEY = "cash.session.close";
    let cashier = booted.db.prisma.role.findUnique({ where: { code: CASHIER_ROLE } });
    cashier =
      cashier ?? booted.db.prisma.role.create({ data: { code: CASHIER_ROLE, name: "Cashier" } });
    let grantPermission = booted.db.prisma.permission.findUnique({
      where: { key: GRANTED_KEY },
    });
    grantPermission =
      grantPermission ??
      booted.db.prisma.permission.create({ data: { key: GRANTED_KEY, name: GRANTED_KEY } });
    if (!grantPermission) throw new Error("fixture failure: permission row missing");

    // Tenant A grants itself the key through the tenant override layer.
    await supertest(booted.app.getHttpServer())
      .put(`/rbac/roles/${CASHIER_ROLE}/permissions`)
      .set("Cookie", fixture.actors.a.cookie)
      .send({ keys: [GRANTED_KEY] })
      .expect(200);

    // Tenant A's effective view carries the override…
    const seenByA = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(200);
    const cashierForA = (
      seenByA.body as { roles: { code: string; permissions: string[] }[] }
    ).roles.find((role) => role.code === CASHIER_ROLE);
    expect(cashierForA?.permissions).toEqual([GRANTED_KEY]);

    // …while tenant B — same global role row, ZERO overrides of its own —
    // still sees the untouched baseline. The shared catalog row gave A no
    // power over B's reality.
    const seenByB = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", fixture.actors.b.cookie)
      .expect(200);
    const cashierForB = (
      seenByB.body as { roles: { code: string; permissions: string[] }[] }
    ).roles.find((role) => role.code === CASHIER_ROLE);
    expect(cashierForB?.permissions).toEqual([]);

    // Physical fence: every stored verdict belongs to tenant A.
    for (const override of booted.db.tables.rolePermissionOverrides.values()) {
      expect(override.tenantId).toBe(fixture.tenants.a.id);
      expect(override.roleId).toBe(cashier?.id);
    }
  });

  it("ignores query/header tenant hints: scoping still resolves to tenant A", async () => {
    const plainList = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(200);

    // Client-supplied hints claiming Tenant B via EVERY transport channel.
    // (There is deliberately no private route that reads a JSON body this
    // epic — the body-vector fence lives in the creation-route cases below,
    // where bodies are sent and provably never processed.)
    const hintedList = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", fixture.actors.a.cookie)
      .query({ tenantId: fixture.tenants.b.id })
      .query({ slug: fixture.tenants.b.slug })
      .set("x-tenant-id", fixture.tenants.b.id)
      .expect(200);

    expect(hintedList.text).toBe(plainList.text);

    const hintedDetail = await supertest(booted.app.getHttpServer())
      .get(`/memberships/${fixture.actors.b.membership!.id}`)
      .set("Cookie", fixture.actors.a.cookie)
      .query({ tenantId: fixture.tenants.b.id })
      .set("x-tenant-id", fixture.tenants.b.id)
      .expect(404);
    expect((hintedDetail.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
  });

  it("gives an authenticated session WITHOUT memberships 403 — but /auth/me still works", async () => {
    const cookie = fixture.actors.noMembership.cookie;

    // Private tenant-scoped surface: FORBIDDEN envelope (spec: no membership,
    // no tenant authority). This ALSO discriminates the guard chain order:
    // TenantActiveGuard could only reject with 403 because AuthGuard had
    // already enriched the context — running first it would fail 401 instead.
    const denied = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", cookie)
      .expect(403);
    expect((denied.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");

    const foreignDetail = await supertest(booted.app.getHttpServer())
      .get(`/memberships/${fixture.actors.b.membership!.id}`)
      .set("Cookie", cookie)
      .expect(403);
    expect(foreignDetail.text).not.toContain(fixture.actors.b.membership!.id);

    // Same session on /auth/*: reachable — proving the D3 skip rule.
    const me = await supertest(booted.app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookie)
      .expect(200);
    expect((me.body as { user: { id: string } }).user.id).toBe(
      fixture.actors.noMembership.profile.id
    );
  });

  it("treats SUSPENDED memberships as no authority at all (ACTIVE-only rule)", async () => {
    const suspended = await supertest(booted.app.getHttpServer())
      .get("/memberships")
      .set("Cookie", fixture.actors.suspendedA.cookie)
      .expect(403);
    expect((suspended.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
  });

  it("has NO self-service creation surface: signup attempts hit absent routes (404)", async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ["/tenants", { slug: "evil-tenant", name: "Evil" }],
      ["/auth/register", { email: "evil@isolation.test", password: "whatever123" }],
      ["/tenants/register", { name: "Evil" }],
      ["/roles", { code: "SUPERUSER" }],
      ["/branches", { name: "Shadow Branch" }],
    ];
    for (const [url, payload] of attempts) {
      // Every self-service creation vector would be a POST — probed explicitly,
      // never through dynamic method dispatch.
      const response = await supertest(booted.app.getHttpServer())
        .post(url)
        .set("Cookie", fixture.actors.a.cookie)
        .send(payload)
        .expect(404);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    }

    // Unauthenticated registration attempts are equally impossible: the route
    // simply does not exist.
    await supertest(booted.app.getHttpServer()).post("/auth/register").send({}).expect(404);
  });

  it("keeps the UN-namespaced legacy administration paths absent (RBAC lives under /rbac)", async () => {
    // EPIC-02 moved administration behind the guarded /rbac surface; the old
    // top-level paths must NOT silently start resolving to anything.
    for (const url of ["/roles", `/roles/${randomUUID()}`, "/permissions"]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(url)
        .set("Cookie", fixture.actors.a.cookie)
        .expect(404);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    }
  });

  it("keeps schema-only scaffolding inert: Branch/CustomerPortalAccess have no routes", async () => {
    for (const url of [
      "/branches",
      `/branches/${randomUUID()}`,
      "/portal-access",
      `/portal-access/${randomUUID()}`,
    ]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(url)
        .set("Cookie", fixture.actors.a.cookie)
        .expect(404);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    }

    // EPIC-02: the ONLY membership mutation route is the audited role command
    // (`POST /:id/role`, tenant-scoped + last-admin-guarded above). Generic
    // status/field edits stay structurally unreachable.
    for (const method of ["patch", "put", "delete"] as const) {
      const response = await supertest(booted.app.getHttpServer())
        [method](`/memberships/${fixture.actors.a.membership!.id}`)
        .set("Cookie", fixture.actors.a.cookie)
        .send({ status: "SUSPENDED" })
        .expect(404);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    }
  });

  it("settings reads resolve to the caller's tenant only — no cross-tenant-addressable resource (EPIC-02 task 3.4)", async () => {
    // Tenant B writes a sales setting through a dedicated actor holding the
    // permission and an explicit sales entitlement.
    const bAdminRole = booted.db.prisma.role.create({
      data: { code: `ADMIN-SETTINGS-${fixture.suffix}`, name: "Settings Admin" },
    });
    const salesPermission =
      booted.db.prisma.permission.findUnique({ where: { key: "sales.settings.manage" } }) ??
      booted.db.prisma.permission.create({
        data: { key: "sales.settings.manage", name: "Manage sales settings" },
      });
    if (!salesPermission) throw new Error("fixture failure: sales permission missing");
    booted.db.prisma.rolePermission.create({
      data: { roleId: bAdminRole.id, permissionId: salesPermission.id },
    });
    const bAdminProfile = booted.db.prisma.userProfile.create({
      data: {
        email: `settings-admin-b-${fixture.suffix}@isolation.test`,
        displayName: "Settings Admin B",
        status: "active",
      },
    });
    const bAdminMembership = booted.db.prisma.tenantMembership.create({
      data: {
        tenantId: fixture.tenants.b.id,
        userProfileId: bAdminProfile.id,
        roleId: bAdminRole.id,
        status: "ACTIVE",
      },
    });
    const salesFeature =
      booted.db.prisma.featureCode.findUnique({ where: { code: "sales" } }) ??
      booted.db.prisma.featureCode.create({ data: { code: "sales" } });
    if (!salesFeature) throw new Error("fixture failure: sales feature code missing");
    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId: fixture.tenants.b.id, featureCodeId: salesFeature.id },
    });

    const { cookie: bAdminCookie } = insertLiveStaffSession(booted.db, bAdminProfile.id);

    await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", bAdminCookie)
      .send({ defaultCurrency: "USD" })
      .expect(200);

    // There is NO cross-tenant-addressable settings resource. Tenant A reading
    // the same namespace resolves to A's own tenant scope; with no persisted row
    // it receives A's validated defaults, indistinguishable from A never having
    // written the namespace at all.
    const aReadBefore = await supertest(booted.app.getHttpServer())
      .get("/settings/sales")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(200);
    expect((aReadBefore.body as { settings: Record<string, unknown> }).settings).toEqual({
      defaultCurrency: "PYG",
      requireCustomerForInvoice: false,
    });

    const aReadAfter = await supertest(booted.app.getHttpServer())
      .get("/settings/sales")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(200);
    expect(aReadAfter.text).toBe(aReadBefore.text);

    // Tenant A's write attempt to the same namespace is denied by the
    // permission matrix, but the tenant-scoped lookup itself returns defaults
    // rather than touching B's row.
    const aWrite = await supertest(booted.app.getHttpServer())
      .put("/settings/sales")
      .set("Cookie", fixture.actors.a.cookie)
      .send({ defaultCurrency: "ARS" })
      .expect(403);
    expect((aWrite.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");

    // Physical fence: exactly one settings row exists and it belongs to B.
    const rows = booted.db.prisma.tenantSettingNamespace.findMany({
      where: { namespace: "sales" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(fixture.tenants.b.id);
    expect(rows[0].data).toEqual({ defaultCurrency: "USD", requireCustomerForInvoice: false });

    // Cleanup fixture-specific rows so the global leak scan below stays valid.
    booted.db.tables.settingNamespaces.delete(rows[0].id);
    booted.db.tables.rolePermissions.delete(
      [...booted.db.tables.rolePermissions.values()].find(
        (entry) => entry.roleId === bAdminRole.id && entry.permissionId === salesPermission.id
      )!.id
    );
    booted.db.tables.roles.delete(bAdminRole.id);
    if (
      [...booted.db.tables.rolePermissions.values()].every(
        (entry) => entry.permissionId !== salesPermission.id
      )
    ) {
      booted.db.tables.permissions.delete(salesPermission.id);
    }
    if (
      [...booted.db.tables.entitlements.values()].every(
        (entry) => entry.featureCodeId !== salesFeature.id
      )
    ) {
      booted.db.tables.featureCodes.delete(salesFeature.id);
    }
    const bAdminSession = [...booted.db.tables.sessions.values()].find(
      (entry) => entry.userProfileId === bAdminProfile.id
    );
    if (bAdminSession) booted.db.tables.sessions.delete(bAdminSession.tokenHash);
    booted.db.tables.memberships.delete(bAdminMembership.id);
    booted.db.tables.profiles.delete(bAdminProfile.id);
  });

  it("leaks ZERO tenant-B identifiers across every observed response body", async () => {
    const responses = [
      await supertest(booted.app.getHttpServer())
        .get("/memberships")
        .set("Cookie", fixture.actors.a.cookie),
      await supertest(booted.app.getHttpServer())
        .get(`/memberships/${fixture.actors.b.membership!.id}`)
        .set("Cookie", fixture.actors.a.cookie),
      await supertest(booted.app.getHttpServer())
        .get("/memberships")
        .set("Cookie", fixture.actors.noMembership.cookie),
    ];

    const serialized = responses.map((response) => response.text).join("\n");
    for (const identifier of foreignIdentifiers()) {
      expect(serialized).not.toContain(identifier);
    }

    // Structured logs carry no tenant-B material either. (The probed foreign
    // MEMBERSHIP id legitimately appears inside request URLs — a 404 route
    // path is not data — so the log fence covers identity-revealing values.)
    const logs = booted.logLines().join("\n");
    for (const identifier of neverAcceptableAnywhere()) {
      expect(logs).not.toContain(identifier);
    }
  });
});
