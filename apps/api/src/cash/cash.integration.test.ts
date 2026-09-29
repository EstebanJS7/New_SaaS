import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  type AuditLogRow,
  type CashRegisterRow,
  type CashSessionRow,
  type IsolationDatabase,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import type { CashRegisterResponse, CashSessionResponse } from "./cash.dto.js";
import { CASH_PERMISSIONS } from "./cash.permissions.js";
import {
  CASH_REGISTER_NOT_FOUND_MESSAGE,
  CASH_SESSION_NOT_FOUND_MESSAGE,
} from "./cash.repository.js";
import {
  CASH_FEATURE_NOT_ENTITLED_MESSAGE,
  CASH_REGISTER_NAME_CONFLICT_MESSAGE,
  CASH_SESSION_ALREADY_OPEN_MESSAGE,
} from "./cash.service.js";
import { CASH_DTO_SCHEMA_VERSION } from "./cash.zod.js";

interface ErrorDto {
  error: { code: string; message: string };
}

/** Exact allowlisted register key set — any extra key fails these assertions. */
const CASH_REGISTER_RESPONSE_KEYS: readonly string[] = [
  "id",
  "name",
  "isActive",
  "createdAt",
  "updatedAt",
];

/** Exact allowlisted session key set — any extra key fails these assertions. */
const CASH_SESSION_RESPONSE_KEYS: readonly string[] = [
  "id",
  "registerId",
  "status",
  "openedAt",
  "openedByMembershipId",
  "openingAmount",
  "createdAt",
  "updatedAt",
];

/** The full cash matrix an owning role holds; the read-only actor holds one key. */
const ALL_CASH_PERMISSIONS: readonly string[] = [
  CASH_PERMISSIONS.read,
  CASH_PERMISSIONS.createRegister,
  CASH_PERMISSIONS.openSession,
];

interface CashTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

interface CashHttpFixture {
  /** Probing tenant holding the FULL `cash.*` matrix and the `cash` entitlement. */
  a: CashTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: CashTenant;
  /** Tenant holding the full matrix but WITHOUT the `cash` entitlement. */
  c: CashTenant;
  /** Member of A whose role has NO cash permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `cash.read` only: every write is a 403. */
  readOnly: RbacActor;
  /** Fresh register in the given tenant; call per test for isolation. */
  createRegister(owner: CashTenant, name?: string): CashRegisterRow;
  /** Fresh session in the given tenant; call per test for isolation. */
  openSession(
    owner: CashTenant,
    registerId: string,
    options?: { status?: "OPEN" | "CLOSED"; openingAmount?: string }
  ): CashSessionRow;
}

/**
 * Seeds three isolated tenants (A probe / B foreign / C entitlement-negative)
 * plus a permission-negative and a read-only actor in tenant A and the cash
 * register/session factories. Every factory runs INSIDE its `it`, so no test
 * depends on a row minted by an earlier test.
 */
function seedCashHttp(db: IsolationDatabase): CashHttpFixture {
  const suffix = randomUUID().slice(0, 8);
  const cashFeature = db.prisma.featureCode.create({ data: { code: "cash" } });

  function seedTenant(
    letter: string,
    options: { entitled: boolean; keys: readonly string[] }
  ): CashTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `cash-${letter}-${suffix}`, name: `Cash ${label}` },
    });
    const role = seedRoleWithKeys(db, `CASH_${label}_${suffix}`, `Cash ${label} (fixture)`, [
      ...options.keys,
    ]);
    const actor = seedRbacActor(db, {
      email: `cash-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    if (options.entitled) {
      db.prisma.tenantEntitlement.create({
        data: { tenantId: tenant.id, featureCodeId: cashFeature.id },
      });
    }
    return { tenant, actor };
  }

  const a = seedTenant("a", { entitled: true, keys: ALL_CASH_PERMISSIONS });
  const b = seedTenant("b", { entitled: true, keys: ALL_CASH_PERMISSIONS });
  const c = seedTenant("c", { entitled: false, keys: ALL_CASH_PERMISSIONS });

  const noPermissionRole = seedRoleWithKeys(db, `CASH_NONE_${suffix}`, "Cash none (fixture)", []);
  const noPermission = seedRbacActor(db, {
    email: `cash-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(db, `CASH_READ_${suffix}`, "Cash read only (fixture)", [
    CASH_PERMISSIONS.read,
  ]);
  const readOnly = seedRbacActor(db, {
    email: `cash-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  const createRegister: CashHttpFixture["createRegister"] = (owner, name) =>
    db.prisma.cashRegister.create({
      data: { tenantId: owner.tenant.id, name: name ?? `Register ${randomUUID().slice(0, 8)}` },
    });

  const openSession: CashHttpFixture["openSession"] = (owner, registerId, options = {}) =>
    db.prisma.cashSession.create({
      data: {
        tenantId: owner.tenant.id,
        registerId,
        openedByMembershipId: owner.actor.membership?.id ?? randomUUID(),
        openingAmount: options.openingAmount ?? "0.00",
        status: options.status ?? "OPEN",
      },
    });

  return { a, b, c, noPermission, readOnly, createRegister, openSession };
}

/** A valid register body; `extra` breaks exactly one rule. */
function registerBody(
  name: unknown = "Main drawer",
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { name, ...extra };
}

/** A valid session-open body; `extra` breaks exactly one rule. */
function sessionBody(
  registerId: unknown,
  openingAmount: unknown = "0.00",
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { registerId, openingAmount, ...extra };
}

/** Every audit row targeting one resource — the per-mutation row count. */
function auditsForTarget(booted: BootedTestApp, targetId: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.targetId === targetId);
}

function changedFieldsOf(row: AuditLogRow): unknown[] | undefined {
  const value = row.metadata.changedFields;
  return Array.isArray(value) ? value : undefined;
}

/** Row count of every in-memory table — the "is the cash surface inert?" probe. */
function tableSizes(db: IsolationDatabase): Record<string, number> {
  return Object.fromEntries(Object.entries(db.tables).map(([name, table]) => [name, table.size]));
}

/**
 * The exact Prisma error shape a unique-index violation raises: `P2002` with the
 * violated target in `meta.target`. Prisma reports either the index name or the
 * column names depending on the engine, so tests exercise both shapes.
 */
function uniqueViolation(target: string | string[]): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target },
  });
}

/**
 * Replaces the in-memory `cashRegister.create` for the duration of `run` and
 * restores it afterwards. The in-memory boundary deliberately does NOT enforce
 * the `cash_register_tenant_id_name_key` unique index — an in-memory Map cannot
 * — so the service's `P2002` -> `409` translation is exercised by making the
 * delegate throw the exact error Prisma would raise. The real index is proven by
 * the live-PostgreSQL gate (C3); mirrors the supplier slice's stubbed P2002.
 */
async function withCashRegisterCreateFailing(
  db: IsolationDatabase,
  error: unknown,
  run: () => Promise<void>
): Promise<void> {
  const original = db.prisma.cashRegister.create;
  db.prisma.cashRegister.create = () => {
    throw error;
  };
  try {
    await run();
  } finally {
    db.prisma.cashRegister.create = original;
  }
}

/**
 * Companion to {@link withCashRegisterCreateFailing} for the session delegate:
 * the partial one-OPEN-session index cannot be expressed in the in-memory fake,
 * so the `P2002` -> `409` translation is exercised by injecting the exact error
 * Prisma would raise. The real partial index against real PostgreSQL is proven
 * by the C3 live block, NOT here.
 */
async function withCashSessionCreateFailing(
  db: IsolationDatabase,
  error: unknown,
  run: () => Promise<void>
): Promise<void> {
  const original = db.prisma.cashSession.create;
  db.prisma.cashSession.create = () => {
    throw error;
  };
  try {
    await run();
  } finally {
    db.prisma.cashSession.create = original;
  }
}

/**
 * EPIC-12 POS-002 cash register/session surface over the REAL guard chain
 * (Auth → Tenancy → RBAC) and the shared in-memory boundary, which snapshots and
 * restores its tables on a thrown transaction — so "persists nothing" is proven,
 * not assumed.
 */
describe("Cash HTTP boundary (EPIC-12 POS-002)", () => {
  let booted: BootedTestApp;
  let fixture: CashHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedCashHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires cash.read on both read routes and appends nothing when denied", async () => {
    const register = fixture.createRegister(fixture.a);
    fixture.openSession(fixture.a, register.id);
    const auditsBefore = booted.db.tables.audits.size;

    for (const path of ["/cash/registers", "/cash/sessions"]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, path).toBe("FORBIDDEN");
    }

    // `cash.read` alone reads both routes.
    for (const path of ["/cash/registers", "/cash/sessions"]) {
      await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.readOnly.cookie)
        .expect(200);
    }

    // Reads are never audited.
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("requires the matching cash permission on every write route and persists nothing when denied", async () => {
    const register = fixture.createRegister(fixture.a);

    const cases = [
      {
        label: CASH_PERMISSIONS.createRegister,
        path: "/cash/registers",
        body: registerBody(),
      },
      {
        label: CASH_PERMISSIONS.openSession,
        path: "/cash/sessions",
        body: sessionBody(register.id, "100.00"),
      },
    ];

    const sizesBefore = tableSizes(booted.db);

    for (const actor of [fixture.readOnly, fixture.noPermission]) {
      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .post(scenario.path)
          .set("Cookie", actor.cookie)
          .send(scenario.body)
          .expect(403);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("FORBIDDEN");
      }
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("rejects a route of each kind when the tenant holds the permission but not the cash capability", async () => {
    const register = fixture.createRegister(fixture.a);

    const cases = [
      { method: "get" as const, path: "/cash/registers" },
      { method: "get" as const, path: "/cash/sessions" },
      { method: "post" as const, path: "/cash/registers", body: registerBody() },
      { method: "post" as const, path: "/cash/sessions", body: sessionBody(register.id) },
    ];

    const sizesBefore = tableSizes(booted.db);
    for (const scenario of cases) {
      const request = supertest(booted.app.getHttpServer())
        [scenario.method](scenario.path)
        .set("Cookie", fixture.c.actor.cookie);
      const response = await (
        scenario.body === undefined ? request : request.send(scenario.body)
      ).expect(403);
      expect((response.body as ErrorDto).error.code, scenario.path).toBe("FEATURE_NOT_ENTITLED");
      expect((response.body as ErrorDto).error.message, scenario.path).toBe(
        CASH_FEATURE_NOT_ENTITLED_MESSAGE
      );
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("creates a register, co-commits one audit row and returns the allowlisted DTO", async () => {
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/cash/registers")
      .set("Cookie", fixture.a.actor.cookie)
      .send(registerBody("  Front drawer  "))
      .expect(201);

    const body = response.body as CashRegisterResponse;
    expect(Object.keys(body).sort()).toEqual([...CASH_REGISTER_RESPONSE_KEYS].sort());
    expect(body.name).toBe("Front drawer");
    expect(body.isActive).toBe(true);
    // No Prisma model and no foreign server-owned key crosses the boundary.
    expect(Object.keys(body)).not.toContain("tenantId");

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("cash.register.created");
    expect(rows[0].targetType).toBe("cash_register");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].metadata.schemaVersion).toBe(CASH_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["name"]);

    // Field NAMES only: no identifier or stored value reaches the trail.
    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain(body.id);
    expect(serializedMeta).not.toContain("Front drawer");
  });

  it("enforces the register name bounds and trims the accepted value", async () => {
    const sizesBefore = tableSizes(booted.db);
    const rejected: [string, unknown][] = [
      ["empty", ""],
      ["whitespace only", "   "],
      ["over 200 characters", "a".repeat(201)],
      ["non-string", 42],
    ];

    for (const [label, name] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/cash/registers")
        .set("Cookie", fixture.a.actor.cookie)
        .send(registerBody(name))
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }
    expect(tableSizes(booted.db)).toEqual(sizesBefore);

    // The exact 200-character maximum is accepted.
    const atLimit = await supertest(booted.app.getHttpServer())
      .post("/cash/registers")
      .set("Cookie", fixture.a.actor.cookie)
      .send(registerBody("b".repeat(200)))
      .expect(201);
    expect((atLimit.body as CashRegisterResponse).name).toHaveLength(200);
  });

  it("maps a duplicate register name to the stable 409 (injected: the fake cannot enforce the unique index)", async () => {
    const register = fixture.createRegister(fixture.a, "Duplicate probe");
    const sizesBefore = tableSizes(booted.db);
    const auditsBefore = booted.db.tables.audits.size;

    // INJECTED: the real `cash_register_tenant_id_name_key` unique index is
    // proven against live PostgreSQL by C3; here the delegate throws the exact
    // P2002 Prisma would raise for that index.
    await withCashRegisterCreateFailing(
      booted.db,
      uniqueViolation("cash_register_tenant_id_name_key"),
      async () => {
        const response = await supertest(booted.app.getHttpServer())
          .post("/cash/registers")
          .set("Cookie", fixture.a.actor.cookie)
          .send(registerBody(register.name))
          .expect(409);
        const errorBody = response.body as ErrorDto;
        expect(errorBody.error.code).toBe("CONFLICT");
        expect(errorBody.error.message).toBe(CASH_REGISTER_NAME_CONFLICT_MESSAGE);
        // Value-free: the register name never echoes back.
        expect(response.text).not.toContain(register.name);
      }
    );

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("rethrows an unrelated P2002 on both write paths instead of mapping it to a 409", async () => {
    const register = fixture.createRegister(fixture.a, "Ownership key");
    const sizesBefore = tableSizes(booted.db);
    // The `(tenant_id, id)` tenant-ownership keys, NOT the cash indexes above.
    const ownershipConflict = uniqueViolation(["tenant_id", "id"]);

    await withCashRegisterCreateFailing(booted.db, ownershipConflict, async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/cash/registers")
        .set("Cookie", fixture.a.actor.cookie)
        .send(registerBody("Unrelated"))
        .expect(500);
      expect((response.body as ErrorDto).error.code).toBe("INTERNAL");
    });

    await withCashSessionCreateFailing(booted.db, ownershipConflict, async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/cash/sessions")
        .set("Cookie", fixture.a.actor.cookie)
        .send(sessionBody(register.id))
        .expect(500);
      expect((response.body as ErrorDto).error.code).toBe("INTERNAL");
    });

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("lists the caller tenant's registers newest-first without exposing another tenant's", async () => {
    const first = fixture.createRegister(fixture.a, "Listed A");
    const second = fixture.createRegister(fixture.a, "Listed B");
    const foreign = fixture.createRegister(fixture.b, "Foreign B");

    const response = await supertest(booted.app.getHttpServer())
      .get("/cash/registers")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const rows = response.body as CashRegisterResponse[];
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(ids).not.toContain(foreign.id);

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...CASH_REGISTER_RESPONSE_KEYS].sort());
    }
    // Ordering contract: newest first by `createdAt`, `id` ascending on ties.
    // Two registers created in the same millisecond tie on `createdAt`, so the
    // assertion pins the declared comparator rather than wall-clock creation
    // order (which the fake cannot make distinct).
    const mine = rows.filter((row) => row.id === first.id || row.id === second.id);
    const expectedOrder = [...mine].sort((left, right) => {
      const byCreated = left.createdAt.localeCompare(right.createdAt);
      return byCreated !== 0 ? -byCreated : left.id.localeCompare(right.id);
    });
    expect(mine.map((row) => row.id)).toEqual(expectedOrder.map((row) => row.id));
  });

  it("opens a session with a non-zero float, resolves the opener server-side and co-commits one audit row", async () => {
    const register = fixture.createRegister(fixture.a);
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .send(sessionBody(register.id, "1500.00"))
      .expect(201);

    const body = response.body as CashSessionResponse;
    expect(Object.keys(body).sort()).toEqual([...CASH_SESSION_RESPONSE_KEYS].sort());
    expect(body.registerId).toBe(register.id);
    expect(body.status).toBe("OPEN");
    expect(body.openingAmount).toBe("1500.00");
    // The opener is the caller's own ACTIVE membership, never the body.
    expect(body.openedByMembershipId).toBe(fixture.a.actor.membership?.id);

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("cash.session.opened");
    expect(rows[0].targetType).toBe("cash_session");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].metadata.schemaVersion).toBe(CASH_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual(["registerId", "openingAmount"]);

    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain(body.id);
    expect(serializedMeta).not.toContain(register.id);
    expect(serializedMeta).not.toContain("1500.00");
    expect(serializedMeta).not.toContain(body.openedByMembershipId);
  });

  it("allows an empty drawer: a 0.00 opening float opens the session", async () => {
    const register = fixture.createRegister(fixture.a);

    const response = await supertest(booted.app.getHttpServer())
      .post("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .send(sessionBody(register.id, "0.00"))
      .expect(201);

    expect((response.body as CashSessionResponse).openingAmount).toBe("0.00");
  });

  it("requires the opening amount and rejects a negative one before any write", async () => {
    const register = fixture.createRegister(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    const required = await supertest(booted.app.getHttpServer())
      .post("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ registerId: register.id })
      .expect(400);
    expect((required.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    const negative = await supertest(booted.app.getHttpServer())
      .post("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .send(sessionBody(register.id, "-1.00"))
      .expect(400);
    expect((negative.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("masks an unknown and a foreign register as a byte-equivalent 404 and persists nothing", async () => {
    const foreignRegister = fixture.createRegister(fixture.b, "Foreign drawer");
    const sizesBefore = tableSizes(booted.db);

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: "/cash/sessions",
      foreignUrl: "/cash/sessions",
      body: sessionBody(randomUUID(), "10.00"),
      foreignBody: sessionBody(foreignRegister.id, "10.00"),
      forbiddenIdentifiers: [foreignRegister.id, fixture.b.tenant.id],
    });

    expect(tableSizes(booted.db)).toEqual(sizesBefore);

    // The unknown-register rejection uses the shared register message, distinct
    // from the session resource message.
    const unknown = await supertest(booted.app.getHttpServer())
      .post("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .send(sessionBody(randomUUID(), "10.00"))
      .expect(404);
    expect((unknown.body as ErrorDto).error.message).toBe(CASH_REGISTER_NOT_FOUND_MESSAGE);
    expect(CASH_REGISTER_NOT_FOUND_MESSAGE).not.toBe(CASH_SESSION_NOT_FOUND_MESSAGE);
  });

  it("maps a second open for the same register to the stable 409 (injected: the fake cannot enforce the partial index)", async () => {
    const register = fixture.createRegister(fixture.a);
    const alreadyOpen = fixture.openSession(fixture.a, register.id);
    const sizesBefore = tableSizes(booted.db);
    const auditsBefore = booted.db.tables.audits.size;

    // INJECTED: the real partial unique index
    // `cash_session_one_open_per_register_key` is enforced by PostgreSQL and
    // proven against it by C3; the in-memory fake enforces no unique index, so
    // the delegate throws the exact P2002 Prisma would raise. The service has NO
    // service-level pre-check, so this exercises the translation only.
    for (const target of [
      "cash_session_one_open_per_register_key",
      ["tenant_id", "register_id"],
    ] as (string | string[])[]) {
      await withCashSessionCreateFailing(booted.db, uniqueViolation(target), async () => {
        const response = await supertest(booted.app.getHttpServer())
          .post("/cash/sessions")
          .set("Cookie", fixture.a.actor.cookie)
          .send(sessionBody(register.id, "100.00"))
          .expect(409);
        const errorBody = response.body as ErrorDto;
        expect(errorBody.error.code).toBe("CONFLICT");
        expect(errorBody.error.message).toBe(CASH_SESSION_ALREADY_OPEN_MESSAGE);
      });
    }

    // The rejected attempts persisted nothing and appended no audit row.
    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    expect(booted.db.tables.cashSessions.get(alreadyOpen.id)?.status).toBe("OPEN");
  });

  it("lists the caller tenant's sessions with and without a status filter", async () => {
    const openRegister = fixture.createRegister(fixture.a);
    const closedRegister = fixture.createRegister(fixture.a);
    const open = fixture.openSession(fixture.a, openRegister.id);
    const closed = fixture.openSession(fixture.a, closedRegister.id, { status: "CLOSED" });
    const foreign = fixture.openSession(fixture.b, fixture.createRegister(fixture.b).id);

    const all = await supertest(booted.app.getHttpServer())
      .get("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const allIds = (all.body as CashSessionResponse[]).map((row) => row.id);
    expect(allIds).toContain(open.id);
    expect(allIds).toContain(closed.id);
    expect(allIds).not.toContain(foreign.id);

    const openOnly = await supertest(booted.app.getHttpServer())
      .get("/cash/sessions?status=OPEN")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const openIds = (openOnly.body as CashSessionResponse[]).map((row) => row.id);
    expect(openIds).toContain(open.id);
    expect(openIds).not.toContain(closed.id);
    for (const row of openOnly.body as CashSessionResponse[]) {
      expect(Object.keys(row).sort()).toEqual([...CASH_SESSION_RESPONSE_KEYS].sort());
    }

    const closedOnly = await supertest(booted.app.getHttpServer())
      .get("/cash/sessions?status=CLOSED")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const closedIds = (closedOnly.body as CashSessionResponse[]).map((row) => row.id);
    expect(closedIds).toContain(closed.id);
    expect(closedIds).not.toContain(open.id);
  });

  it("rejects every invalid body and query with 400 and persists nothing", async () => {
    const register = fixture.createRegister(fixture.a);
    const otherRegister = fixture.createRegister(fixture.a);
    const sizesBefore = tableSizes(booted.db);

    const rejectedRegisterBodies: [string, Record<string, unknown>][] = [
      ["missing name", {}],
      ["unknown key", registerBody("Ok", { isActive: false })],
      ["tenantId", registerBody("Ok", { tenantId: randomUUID() })],
      ["branchId", registerBody("Ok", { branchId: randomUUID() })],
    ];
    for (const [label, body] of rejectedRegisterBodies) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/cash/registers")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    const rejectedSessionBodies: [string, Record<string, unknown>][] = [
      ["missing register", { openingAmount: "0.00" }],
      ["missing amount", { registerId: register.id }],
      ["non-uuid register", sessionBody("not-a-uuid")],
      ["float amount", sessionBody(register.id, 1.5)],
      ["exponential amount", sessionBody(register.id, "1e2")],
      ["three decimals", sessionBody(register.id, "1.234")],
      ["status", sessionBody(register.id, "0.00", { status: "OPEN" })],
      ["tenantId", sessionBody(register.id, "0.00", { tenantId: randomUUID() })],
      [
        "openedByMembershipId",
        sessionBody(register.id, "0.00", { openedByMembershipId: randomUUID() }),
      ],
      ["branchId", sessionBody(register.id, "0.00", { branchId: randomUUID() })],
      ["currency", sessionBody(register.id, "0.00", { currency: "PYG" })],
      ["unknown key", sessionBody(register.id, "0.00", { drawer: otherRegister.id })],
    ];
    for (const [label, body] of rejectedSessionBodies) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/cash/sessions")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    // The list query is strict too: a bogus status or an unknown key is a 400.
    for (const query of ["?status=OPENX", `?tenantId=${randomUUID()}`, "?foo=bar"]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/cash/sessions${query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((response.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
  });

  it("exposes no PATCH, no DELETE and no close route anywhere on the cash surface", async () => {
    const register = fixture.createRegister(fixture.a);
    const session = fixture.openSession(fixture.a, register.id);
    const sizesBefore = tableSizes(booted.db);

    for (const [method, path] of [
      ["delete", `/cash/registers/${register.id}`],
      ["patch", `/cash/registers/${register.id}`],
      ["patch", "/cash/registers"],
      ["delete", `/cash/sessions/${session.id}`],
      ["patch", `/cash/sessions/${session.id}`],
      ["post", `/cash/sessions/${session.id}/close`],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        [method](path)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(404);
    }

    expect(tableSizes(booted.db)).toEqual(sizesBefore);
    expect(booted.db.tables.cashSessions.get(session.id)?.status).toBe("OPEN");
  });

  it("keeps the surface INERT: no movement, sale, stock, payment or close state is written", async () => {
    const sizesBefore = tableSizes(booted.db);
    const closedBefore = [...booted.db.tables.cashSessions.values()].filter(
      (row: CashSessionRow) => row.tenantId === fixture.a.tenant.id && row.status === "CLOSED"
    ).length;

    const created = await supertest(booted.app.getHttpServer())
      .post("/cash/registers")
      .set("Cookie", fixture.a.actor.cookie)
      .send(registerBody())
      .expect(201);
    const registerId = (created.body as CashRegisterResponse).id;

    const opened = await supertest(booted.app.getHttpServer())
      .post("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .send(sessionBody(registerId, "250.00"))
      .expect(201);
    const sessionId = (opened.body as CashSessionResponse).id;

    await supertest(booted.app.getHttpServer())
      .get("/cash/registers")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    await supertest(booted.app.getHttpServer())
      .get("/cash/sessions")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const sizesAfter = tableSizes(booted.db);
    const changedTables = Object.keys(sizesAfter)
      .filter((name) => sizesAfter[name] !== sizesBefore[name])
      .sort();

    // The ONLY tables a cash register/session operation may touch: the two
    // aggregates plus the co-committed audit trail. NO `cash_movement` row is
    // written (POS-003 owns that), no sale, no stock movement, no balance, no
    // payment and no cash close state.
    expect(changedTables).toEqual(["audits", "cashRegisters", "cashSessions"]);
    expect(sizesAfter.cashMovements).toBe(sizesBefore.cashMovements);
    expect(sizesAfter.sales).toBe(sizesBefore.sales);
    expect(sizesAfter.saleLines).toBe(sizesBefore.saleLines);
    expect(sizesAfter.stockMovements).toBe(sizesBefore.stockMovements);
    expect(sizesAfter.stockBalances).toBe(sizesBefore.stockBalances);

    // No close state: the new session is OPEN and the OPEN command created no
    // additional CLOSED session for this tenant.
    expect(booted.db.tables.cashSessions.get(sessionId)?.status).toBe("OPEN");
    const closedAfter = [...booted.db.tables.cashSessions.values()].filter(
      (row: CashSessionRow) => row.tenantId === fixture.a.tenant.id && row.status === "CLOSED"
    ).length;
    expect(closedAfter).toBe(closedBefore);
  });
});
