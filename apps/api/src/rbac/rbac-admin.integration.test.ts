import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { PERMISSION_SEEDS, ROLE_PERMISSION_MATRIX, ROLE_SEEDS } from "@newsaas/database";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import type { IsolationDatabase } from "../../test/support/in-memory-database.js";
import { seedRbacActor } from "../../test/support/rbac-fixture.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface RolesBody {
  roles: { code: string; name: string; permissions: string[] }[];
}

interface PermissionsBody {
  permissions: { key: string; name: string }[];
}

interface ReplaceBody {
  code: string;
  permissions: string[];
}

interface AssignmentBody {
  assignment: { membershipId: string; roleCode: string };
}

/**
 * AUDITED RBAC ADMINISTRATION SUITE (EPIC-02 tasks 2.1–2.3 + 2.5, spec:
 * rbac-administration, architecture per DEC-003) — real HTTP through the
 * production guard chain over the seeded six-role reference catalog:
 *
 * - #10 roles listed WITH TENANT-EFFECTIVE keys (baseline ⊕ tenant overrides);
 * - #11/#12 tenant replace applied atomically / unknown key rejected
 *   UNCHANGED;
 * - #18 exactly ONE diff-audit row per override (`rbac.
 *   role_permissions_overridden`), ZERO rows per read;
 * - DEC-003 isolation: one tenant's overrides NEVER leak into another's view;
 * - last-manager rule: stripping `users.membership.manage` is allowed only
 *   while another effective holder remains, else 409 CONFLICT;
 * - #14/#15/#16 assignment applies, last admin protected (409), second admin
 *   enables demotion;
 * - non-admin effective manager retention is enforced in serial semantics;
 * - #19 assignment emits its own diff-audit row;
 * - the whole surface sits behind `users.membership.manage` (403 without).
 */

/** Mirrors reference-seed write order into the isolation database. */
function seedReferenceCatalog(db: IsolationDatabase): { ownerRoleId: string } {
  const roleIdByCode = new Map<string, string>();
  for (const role of ROLE_SEEDS) {
    const created = db.prisma.role.create({ data: { code: role.code, name: role.name } });
    roleIdByCode.set(role.code, created.id);
  }
  const permissionIdByKey = new Map<string, string>();
  for (const permission of PERMISSION_SEEDS) {
    const created = db.prisma.permission.create({
      data: { key: permission.key, name: permission.name },
    });
    permissionIdByKey.set(permission.key, created.id);
  }
  for (const [code, keys] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    const roleId = roleIdByCode.get(code);
    if (!roleId) continue;
    for (const key of keys) {
      const permissionId = permissionIdByKey.get(key);
      if (permissionId) {
        db.prisma.rolePermission.create({ data: { roleId, permissionId } });
      }
    }
  }
  const ownerRoleId = roleIdByCode.get("OWNER");
  if (!ownerRoleId) throw new Error("fixture failure: OWNER role missing");
  return { ownerRoleId };
}

describe("RBAC role/permission catalog administration", () => {
  let booted: BootedTestApp;
  let adminCookie: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const { ownerRoleId } = seedReferenceCatalog(booted.db);

    // A decoy NON-seeded role must never surface through the addressable API.
    booted.db.prisma.role.create({ data: { code: "GHOST", name: "Ghost" } });

    const tenant = booted.db.prisma.tenant.create({
      data: { slug: "catalog-admin-tenant", name: "Catalog Tenant" },
    });
    const actor = seedRbacActor(booted.db, {
      email: "catalog-admin@isolation.test",
      tenantId: tenant.id,
      roleId: ownerRoleId,
    });
    adminCookie = actor.cookie;
  });

  afterAll(async () => {
    await booted.close();
  });

  it("lists EXACTLY the six seeded roles with their current mapped keys (#10)", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);

    const body = response.body as RolesBody;
    expect(body.roles.map((role) => role.code)).toEqual(ROLE_SEEDS.map((role) => role.code));
    expect(body.roles.map((role) => role.code)).not.toContain("GHOST");

    for (const role of body.roles) {
      const baseline = [
        ...ROLE_PERMISSION_MATRIX[role.code as keyof typeof ROLE_PERMISSION_MATRIX],
      ];
      // Untouched catalog: every role shows exactly its seeded key set.
      expect(role.permissions).toEqual(baseline.sort());
      // DTO shape guard: never a raw Prisma model (no ids/timestamps leak).
      expect(Object.keys(role).sort()).toEqual(["code", "name", "permissions"]);
    }
  });

  it("lists the immutable permission catalog (#10)", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/rbac/permissions")
      .set("Cookie", adminCookie)
      .expect(200);

    const body = response.body as PermissionsBody;
    expect(body.permissions.map((entry) => entry.key)).toEqual(
      [...PERMISSION_SEEDS.map((entry) => entry.key)].sort()
    );
  });

  it("emits ZERO audit rows for both listing reads (#18)", async () => {
    const before = booted.db.prisma.auditLog.findMany().length;
    await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    await supertest(booted.app.getHttpServer())
      .get("/rbac/permissions")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(booted.db.prisma.auditLog.findMany().length).toBe(before);
  });

  it("applies a FULL tenant replace as overrides (#11)", async () => {
    const keep = "vet.clinical.create";
    const swapIn = "scheduling.appointment.manage";
    const payload = [keep, swapIn];

    const replaced = await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/VETERINARIAN/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: payload })
      .expect(200);

    expect(replaced.body as ReplaceBody).toEqual({
      code: "VETERINARIAN",
      permissions: [...payload].sort(),
    });

    const reread = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    const veterinarian = (reread.body as RolesBody).roles.find(
      (role) => role.code === "VETERINARIAN"
    );
    // Effective set reflects the tenant override layer.
    expect(veterinarian?.permissions).toEqual([...payload].sort());
    // Platform baseline rows stay untouched — only override verdicts exist.
    expect(
      [...booted.db.tables.rolePermissions.values()].filter((pair) => {
        const vetRole = booted.db.prisma.role.findUnique({ where: { code: "VETERINARIAN" } });
        return pair.roleId === vetRole?.id;
      }).length
    ).toBe(ROLE_PERMISSION_MATRIX.VETERINARIAN.length);
  });

  it("rejects UNKNOWN catalog keys with 400 and leaves the stored set unchanged (#12)", async () => {
    const before = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    const cashierBefore = (before.body as RolesBody).roles.find(
      (role) => role.code === "CASHIER"
    )?.permissions;

    const rejected = await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/CASHIER/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: ["cash.session.close", "totally.unknown.key"] })
      .expect(400);
    expect((rejected.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

    const after = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    const cashierAfter = (after.body as RolesBody).roles.find((role) => role.code === "CASHIER");
    expect(cashierAfter?.permissions).toEqual(cashierBefore);
  });

  it("answers 404 for any role code outside the six seeded ones", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/SUPERUSER/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: [] })
      .expect(404);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
  });

  it("rejects structurally broken payloads with VALIDATION_FAILED", async () => {
    await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/CASHIER/permissions")
      .set("Cookie", adminCookie)
      .send({})
      .expect(400);
    await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/CASHIER/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: "not-an-array" })
      .expect(400);
  });

  it("writes EXACTLY ONE diff audit row per successful tenant override (#18)", async () => {
    const before = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    const inventoryBefore = (before.body as RolesBody).roles.find(
      (role) => role.code === "INVENTORY_MANAGER"
    )?.permissions;

    const afterKeys = ["inventory.stock.transfer", "cash.session.close"];
    const rowsBefore = booted.db.prisma.auditLog.findMany({
      where: { action: "rbac.role_permissions_overridden" },
    }).length;
    await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/INVENTORY_MANAGER/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: afterKeys })
      .expect(200);

    const rows = booted.db.prisma.auditLog.findMany({
      where: { action: "rbac.role_permissions_overridden" },
    });
    // Exactly ONE new row for THIS override — the earlier VETERINARIAN
    // replace in this suite owns the earlier row; the DELTA is what the
    // spec pins (one mutation ⇔ one row). The legacy global-mapping action
    // name must never appear again (DEC-003 rename).
    expect(rows).toHaveLength(rowsBefore + 1);
    expect(
      booted.db.prisma.auditLog.findMany({
        where: { action: "rbac.role_permissions_replaced" },
      })
    ).toHaveLength(0);

    const row = rows[rows.length - 1];
    const metadata = row.metadata as {
      before: string[];
      after: string[];
    };
    expect(metadata.before).toEqual(inventoryBefore);
    expect(metadata.after).toEqual([...afterKeys].sort());
    expect(row.actorUserProfileId).toBeTruthy();
    expect(row.targetType).toBe("role");
    expect(row.targetId).toBeTruthy();
    expect(row.requestId).toBeTruthy();
  });

  it("keeps one tenant's overrides INVISIBLE to another tenant's reads (DEC-003)", async () => {
    const ownerRole = booted.db.prisma.role.findUnique({ where: { code: "OWNER" } });
    if (!ownerRole) throw new Error("fixture failure: OWNER role missing");
    const tenantB = booted.db.prisma.tenant.create({
      data: { slug: "override-isolation-tenant-b", name: "Override Tenant B" },
    });
    const actorB = seedRbacActor(booted.db, {
      email: "override-b@isolation.test",
      tenantId: tenantB.id,
      roleId: ownerRole.id,
    });

    // Tenant A (adminCookie) strips RECEPTIONIST down to nothing.
    await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/RECEPTIONIST/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: [] })
      .expect(200);

    // Tenant B still sees the untouched platform baseline.
    const seenByB = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", actorB.cookie)
      .expect(200);
    const receptionistForB = (seenByB.body as RolesBody).roles.find(
      (role) => role.code === "RECEPTIONIST"
    );
    expect(receptionistForB?.permissions).toEqual([...ROLE_PERMISSION_MATRIX.RECEPTIONIST]);

    // ...while tenant A sees the emptied effective set.
    const seenByA = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    const receptionistForA = (seenByA.body as RolesBody).roles.find(
      (role) => role.code === "RECEPTIONIST"
    );
    expect(receptionistForA?.permissions).toEqual([]);
  });

  it("allows removing users.membership.manage from ADMIN while OWNER retains it", async () => {
    const manage = "users.membership.manage";
    const adminBaseline = [...ROLE_PERMISSION_MATRIX.ADMIN].filter((key) => key !== manage);

    const replaced = await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/ADMIN/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: adminBaseline })
      .expect(200);
    expect((replaced.body as ReplaceBody).permissions).toEqual(adminBaseline.sort());

    // granted=false verdict materialized for exactly the removed baseline key.
    const adminRole = booted.db.prisma.role.findUnique({ where: { code: "ADMIN" } });
    const overrides = [...booted.db.tables.rolePermissionOverrides.values()].filter(
      (row) => row.roleId === adminRole?.id
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      permissionKey: manage,
      granted: false,
    });
  });

  it("rejects with 409 stripping the LAST administrator-class manage holder", async () => {
    // This tenant's only admin-class member is the OWNER actor; ADMIN no
    // longer carries the key (previous case), so removing it from OWNER too
    // would strand the tenant — CONFLICT inside the transaction.
    const manage = "users.membership.manage";
    const ownerWithoutManage = [...ROLE_PERMISSION_MATRIX.OWNER].filter((key) => key !== manage);

    const rejected = await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/OWNER/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: ownerWithoutManage })
      .expect(409);
    expect((rejected.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");

    // Nothing written: OWNER effective set unchanged AND audit untouched.
    const reread = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", adminCookie)
      .expect(200);
    const owner = (reread.body as RolesBody).roles.find((role) => role.code === "OWNER");
    expect(owner?.permissions).toEqual([...ROLE_PERMISSION_MATRIX.OWNER].sort());

    const ownerRole = booted.db.prisma.role.findUnique({ where: { code: "OWNER" } });
    expect(
      [...booted.db.tables.rolePermissionOverrides.values()].filter(
        (row) => row.roleId === ownerRole?.id
      )
    ).toHaveLength(0);
  });

  it("restores the baseline EXACTLY when the payload equals it (sandbox empties)", async () => {
    // ADMIN back to its full seeded set ⇒ no verdicts needed anymore.
    await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/ADMIN/permissions")
      .set("Cookie", adminCookie)
      .send({ keys: [...ROLE_PERMISSION_MATRIX.ADMIN] })
      .expect(200);

    const adminRole = booted.db.prisma.role.findUnique({ where: { code: "ADMIN" } });
    expect(
      [...booted.db.tables.rolePermissionOverrides.values()].filter(
        (row) => row.roleId === adminRole?.id
      )
    ).toHaveLength(0);
  });

  it("denies a member WITHOUT users.membership.manage and anonymous callers", async () => {
    const bareRole = booted.db.prisma.role.create({ data: { code: "BARE-CAT", name: "Bare" } });
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: "bare-cat-tenant", name: "Bare Catalog Tenant" },
    });
    const bare = seedRbacActor(booted.db, {
      email: "bare-catalog@isolation.test",
      tenantId: tenant.id,
      roleId: bareRole.id,
    });

    const denied = await supertest(booted.app.getHttpServer())
      .get("/rbac/roles")
      .set("Cookie", bare.cookie)
      .expect(403);
    expect((denied.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");

    const anonymous = await supertest(booted.app.getHttpServer()).get("/rbac/roles").expect(401);
    expect((anonymous.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
  });
});

describe("membership role assignment", () => {
  let booted: BootedTestApp;
  let adminCookie: string;
  let adminMembershipId: string;
  let tenantId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const { ownerRoleId } = seedReferenceCatalog(booted.db);
    const created = booted.db.prisma.tenant.create({
      data: { slug: "assign-admin-tenant", name: "Assign Tenant" },
    });
    tenantId = created.id;
    const actor = seedRbacActor(booted.db, {
      email: "assign-admin@isolation.test",
      tenantId,
      roleId: ownerRoleId,
    });
    adminCookie = actor.cookie;
    const membershipId = actor.membership?.id ?? "";
    if (!membershipId) throw new Error("fixture failure: admin membership missing");
    adminMembershipId = membershipId;
  });

  afterAll(async () => {
    await booted.close();
  });

  function roleIdByCode(code: string): string {
    const found = booted.db.prisma.role.findUnique({ where: { code } });
    if (!found) throw new Error(`fixture failure: role ${code} missing`);
    return found.id;
  }

  function createColleagueMembership(roleCode: string): { id: string } {
    return booted.db.prisma.tenantMembership.create({
      data: {
        tenantId,
        userProfileId: seedRbacActor(booted.db, {
          email: `colleague-${roleCode.toLowerCase()}-${Math.random()
            .toString(36)
            .slice(2, 8)}@isolation.test`,
          // Session only — membership is attached explicitly below.
          withMembership: false,
        }).profile.id,
        roleId: roleIdByCode(roleCode),
        status: "ACTIVE",
      },
    });
  }

  function storedRoleCodeOf(membershipId: string): string | undefined {
    const row = booted.db.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!row) return undefined;
    return booted.db.tables.roles.get(row.roleId)?.code;
  }

  it("replaces a RECEPTIONIST colleague's single role with VETERINARIAN (#14)", async () => {
    const colleague = createColleagueMembership("RECEPTIONIST");

    const response = await supertest(booted.app.getHttpServer())
      .post(`/memberships/${colleague.id}/role`)
      .set("Cookie", adminCookie)
      .send({ roleCode: "VETERINARIAN" })
      .expect(201);

    expect(response.body as AssignmentBody).toEqual({
      assignment: { membershipId: colleague.id, roleCode: "VETERINARIAN" },
    });
    expect(storedRoleCodeOf(colleague.id)).toBe("VETERINARIAN");
  });

  it("protects the LAST administrator with 409 and leaves the role unchanged (#15)", async () => {
    // Single-admin tenant so far (the seeded OWNER actor).
    const response = await supertest(booted.app.getHttpServer())
      .post(`/memberships/${adminMembershipId}/role`)
      .set("Cookie", adminCookie)
      .send({ roleCode: "RECEPTIONIST" })
      .expect(409);
    expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
    expect(storedRoleCodeOf(adminMembershipId)).toBe("OWNER");
  });

  // NOTE: cases after #14/#15 run while the caller still holds
  // `users.membership.manage`. The self-demotion case (#16) runs LAST by
  // design — it strips the CALLER'S OWN key, so any later administration
  // call from this suite would 403.

  it("emits EXACTLY ONE assignment audit row with the before/after diff (#19)", async () => {
    const rowsBefore = booted.db.prisma.auditLog.findMany({
      where: { action: "rbac.membership_role_assigned" },
    }).length;

    const colleague = createColleagueMembership("CASHIER");
    await supertest(booted.app.getHttpServer())
      .post(`/memberships/${colleague.id}/role`)
      .set("Cookie", adminCookie)
      .send({ roleCode: "INVENTORY_MANAGER" })
      .expect(201);

    const rows = booted.db.prisma.auditLog.findMany({
      where: { action: "rbac.membership_role_assigned" },
    });
    expect(rows.length).toBe(rowsBefore + 1);

    const row = rows[rows.length - 1];
    expect(row.metadata).toEqual({ before: "CASHIER", after: "INVENTORY_MANAGER" });
    expect(row.targetType).toBe("membership");
    expect(row.targetId).toBe(colleague.id);
    expect(row.actorUserProfileId).toBeTruthy();
    expect(row.requestId).toBeTruthy();
  });

  it("rejects unknown role codes and malformed bodies with VALIDATION_FAILED", async () => {
    const colleague = createColleagueMembership("CASHIER");

    const unknownRole = await supertest(booted.app.getHttpServer())
      .post(`/memberships/${colleague.id}/role`)
      .set("Cookie", adminCookie)
      .send({ roleCode: "SUPERUSER" })
      .expect(400);
    expect((unknownRole.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

    await supertest(booted.app.getHttpServer())
      .post(`/memberships/${colleague.id}/role`)
      .set("Cookie", adminCookie)
      .send({})
      .expect(400);

    const malformedId = await supertest(booted.app.getHttpServer())
      .post("/memberships/not-a-uuid/role")
      .set("Cookie", adminCookie)
      .send({ roleCode: "CASHIER" })
      .expect(400);
    expect((malformedId.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

    // None of the rejected attempts mutated anything.
    expect(storedRoleCodeOf(colleague.id)).toBe("CASHIER");
  });

  it("enables demotion when a SECOND administrator exists (#16)", async () => {
    const secondAdmin = createColleagueMembership("ADMIN");

    await supertest(booted.app.getHttpServer())
      .post(`/memberships/${adminMembershipId}/role`)
      .set("Cookie", adminCookie)
      .send({ roleCode: "RECEPTIONIST" })
      .expect(201);

    expect(storedRoleCodeOf(adminMembershipId)).toBe("RECEPTIONIST");
    expect(storedRoleCodeOf(secondAdmin.id)).toBe("ADMIN");
  });
});

/**
 * COMPOSED STRANDING PROTECTION (re-judge 2026-08-26): proves the reviewer's
 * deterministic repro against the REAL guard chain — an override replace that
 * strips `users.membership.manage` from ADMIN composed with a subsequent
 * OWNER self-demotion must be rejected by the assignment flow.
 */
describe("composed stranding protection (override strip × self-demote)", () => {
  let booted: BootedTestApp;
  let ownerCookie: string;
  let ownerMembershipId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const { ownerRoleId } = seedReferenceCatalog(booted.db);
    const tenant = booted.db.prisma.tenant.create({
      data: { slug: "stranding-compose-tenant", name: "Stranding Compose Tenant" },
    });

    const ownerActor = seedRbacActor(booted.db, {
      email: "compose-owner@isolation.test",
      tenantId: tenant.id,
      roleId: ownerRoleId,
    });
    ownerCookie = ownerActor.cookie;
    const membershipId = ownerActor.membership?.id ?? "";
    if (!membershipId) throw new Error("fixture failure: owner membership missing");
    ownerMembershipId = membershipId;

    // The second ADMINISTRATOR-CLASS SEAT whose mere presence fooled the
    // retired seat-count predicate: an ADMIN membership whose effective set
    // loses the manage key in step 1 below while its seat row stays put.
    const adminRole = booted.db.prisma.role.findUnique({ where: { code: "ADMIN" } });
    if (!adminRole) throw new Error("fixture failure: ADMIN role missing");
    booted.db.prisma.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userProfileId: seedRbacActor(booted.db, {
          email: "compose-admin@isolation.test",
          tenantId: tenant.id,
          // Session only — membership attached explicitly above this comment.
          withMembership: false,
        }).profile.id,
        roleId: adminRole.id,
        status: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await booted.close();
  });

  it("rejects OWNER self-demotion AFTER an override stripped ADMIN's manage key", async () => {
    // DISCRIMINATION PROOF (why this fails against the OLD seat-count
    // predicate): step 1 strips the key from ADMIN's EFFECTIVE set via a
    // granted=false override while leaving the ADMIN membership row intact.
    // Step 2 under the old rule saw remainingAdmins=[ADMIN seat] ≠ 0 and
    // returned 201 — composing both operations into zero effective holders of
    // users.membership.manage and a permanently locked-out tenant. Only the
    // unified effective-holdership predicate evaluates step 2 against the
    // post-write sets and rejects it.
    const manage = "users.membership.manage";

    // Step 1 — OWNER strips the key from ADMIN's tenant-effective set.
    // Allowed: the OWNER's own effective set still holds it (retention kept).
    const adminWithoutManage = [...ROLE_PERMISSION_MATRIX.ADMIN].filter((key) => key !== manage);
    await supertest(booted.app.getHttpServer())
      .put("/rbac/roles/ADMIN/permissions")
      .set("Cookie", ownerCookie)
      .send({ keys: adminWithoutManage })
      .expect(200);

    // Step 2 — the SECOND operation: OWNER assigns themselves VETERINARIAN.
    const rejected = await supertest(booted.app.getHttpServer())
      .post(`/memberships/${ownerMembershipId}/role`)
      .set("Cookie", ownerCookie)
      .send({ roleCode: "VETERINARIAN" })
      .expect(409);
    expect((rejected.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");

    // State unchanged: the rejected assignment wrote nothing.
    const stored = booted.db.prisma.tenantMembership.findFirst({
      where: { id: ownerMembershipId },
    });
    const ownerRoleId = booted.db.tables.roles.get(stored?.roleId ?? "")?.code;
    expect(ownerRoleId).toBe("OWNER");

    // Fail-closed audit atomicity (implementation guarantee asserted
    // explicitly): the audit append rides INSIDE the rolled-back transaction,
    // so a REJECTED attempt leaves ZERO `rbac.membership_role_assigned` rows.
    expect(
      booted.db.prisma.auditLog.findMany({
        where: { action: "rbac.membership_role_assigned" },
      })
    ).toHaveLength(0);
  });
});

describe("non-admin effective manager retention", () => {
  it("protects a non-admin role granted manage by tenant override", async () => {
    const booted = await bootTestApp();
    try {
      const { ownerRoleId } = seedReferenceCatalog(booted.db);
      const receptionistRole = booted.db.prisma.role.findUnique({
        where: { code: "RECEPTIONIST" },
      });
      const veterinarianRole = booted.db.prisma.role.findUnique({
        where: { code: "VETERINARIAN" },
      });
      if (!receptionistRole || !veterinarianRole) {
        throw new Error("fixture failure: non-admin role missing");
      }
      const tenant = booted.db.prisma.tenant.create({
        data: { slug: "non-admin-manager-tenant", name: "Non-admin Manager Tenant" },
      });
      const owner = seedRbacActor(booted.db, {
        email: "non-admin-manager-owner@isolation.test",
        tenantId: tenant.id,
        roleId: ownerRoleId,
      });
      const receptionist = seedRbacActor(booted.db, {
        email: "non-admin-manager-receptionist@isolation.test",
        tenantId: tenant.id,
        roleId: receptionistRole.id,
      });

      const receptionistWithManage = [
        ...ROLE_PERMISSION_MATRIX.RECEPTIONIST,
        "users.membership.manage",
      ];
      // Serial semantics: first leave the NON-ADMIN receptionist as the sole
      // effective manager, then use that holder to attempt self-demotion.
      await supertest(booted.app.getHttpServer())
        .put("/rbac/roles/RECEPTIONIST/permissions")
        .set("Cookie", owner.cookie)
        .send({ keys: receptionistWithManage })
        .expect(200);

      const ownerWithoutManage = [...ROLE_PERMISSION_MATRIX.OWNER].filter(
        (key) => key !== "users.membership.manage"
      );
      await supertest(booted.app.getHttpServer())
        .put("/rbac/roles/OWNER/permissions")
        .set("Cookie", owner.cookie)
        .send({ keys: ownerWithoutManage })
        .expect(200);

      // The in-memory transaction fake is intentionally serial and cannot
      // prove PostgreSQL interleaving/row-lock behavior; TD-006 retains that
      // live-PG evidence limitation. This case discriminates the effective
      // holder set from the retired admin-class seat-count predicate.
      const rejected = await supertest(booted.app.getHttpServer())
        .post(`/memberships/${receptionist.membership?.id}/role`)
        .set("Cookie", receptionist.cookie)
        .send({ roleCode: "VETERINARIAN" })
        .expect(409);
      expect((rejected.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(
        booted.db.tables.roles.get(
          booted.db.prisma.tenantMembership.findFirst({
            where: { id: receptionist.membership?.id },
          })?.roleId ?? ""
        )?.code
      ).toBe("RECEPTIONIST");
    } finally {
      await booted.close();
    }
  });
});
