import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  type AuditLogRow,
  type IsolationDatabase,
  type SupplierRow,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { SUPPLIERS_PERMISSIONS } from "./suppliers.permissions.js";
import { SUPPLIER_TAX_ID_CONFLICT_MESSAGE } from "./suppliers.service.js";
import { SUPPLIERS_DTO_SCHEMA_VERSION } from "./suppliers.zod.js";

interface SupplierDto {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string; message: string };
}

/** Exact allowlisted key set — any extra key fails these assertions. */
const SUPPLIER_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "name",
  "legalName",
  "taxId",
  "email",
  "phone",
  "address",
  "isActive",
  "createdAt",
  "updatedAt",
];

/** The full supplier matrix an owning role holds; the read-only actor holds one key. */
const ALL_SUPPLIERS_PERMISSIONS: readonly string[] = [
  SUPPLIERS_PERMISSIONS.read,
  SUPPLIERS_PERMISSIONS.create,
  SUPPLIERS_PERMISSIONS.update,
  SUPPLIERS_PERMISSIONS.deactivate,
];

/**
 * Distinctive CONFIDENTIAL payload values (DEC-011). They are asserted ABSENT
 * from every audit `metadata` object so a future change cannot start copying a
 * stored value into the trail.
 */
const CONFIDENTIAL_VALUES: readonly string[] = [
  "Distribuidora",
  "80012345-6",
  "contacto@alfa.example",
  "+595981111222",
  "Siempre Viva 742",
];

interface SuppliersTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

interface SuppliersHttpFixture {
  /** Probing tenant holding the FULL `suppliers.*` matrix. */
  a: SuppliersTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: SuppliersTenant;
  /** Member of A whose role has NO supplier permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `suppliers.read` only: every write is a 403. */
  readOnly: RbacActor;
  /** Fresh supplier in the given tenant; call per test for order independence. */
  createSupplier(
    owner: SuppliersTenant,
    overrides?: Partial<Pick<SupplierRow, "isActive" | "legalName" | "taxId">> & {
      name?: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    }
  ): SupplierRow;
}

/**
 * Seeds two isolated tenants holding the full supplier matrix, a
 * permission-negative actor and a read-only actor in tenant A, plus supplier
 * factories. Every factory runs INSIDE its `it`, so no test depends on an id
 * minted by an earlier test.
 */
function seedSuppliersHttp(db: IsolationDatabase): SuppliersHttpFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string, keys: readonly string[]): SuppliersTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `suppliers-${letter}-${suffix}`, name: `Suppliers ${label}` },
    });
    const role = seedRoleWithKeys(
      db,
      `SUPPLIERS_${label}_${suffix}`,
      `Suppliers ${label} (fixture)`,
      [...keys]
    );
    const actor = seedRbacActor(db, {
      email: `suppliers-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { tenant, actor };
  }

  const a = seedTenant("a", ALL_SUPPLIERS_PERMISSIONS);
  const b = seedTenant("b", ALL_SUPPLIERS_PERMISSIONS);

  const noPermissionRole = seedRoleWithKeys(
    db,
    `SUPPLIERS_NONE_${suffix}`,
    "Suppliers none (fixture)",
    []
  );
  const noPermission = seedRbacActor(db, {
    email: `suppliers-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(
    db,
    `SUPPLIERS_READ_${suffix}`,
    "Suppliers read only (fixture)",
    [SUPPLIERS_PERMISSIONS.read]
  );
  const readOnly = seedRbacActor(db, {
    email: `suppliers-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  return {
    a,
    b,
    noPermission,
    readOnly,
    createSupplier: (owner, overrides = {}) =>
      db.prisma.supplier.create({
        data: {
          tenantId: owner.tenant.id,
          name: overrides.name ?? `Supplier ${randomUUID().slice(0, 8)}`,
          legalName: overrides.legalName ?? null,
          taxId: overrides.taxId ?? null,
          email: overrides.email ?? null,
          phone: overrides.phone ?? null,
          address: overrides.address ?? null,
          isActive: overrides.isActive ?? true,
        },
      }),
  };
}

/** A valid create body; overrides let a test break exactly one rule. */
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Supplier ${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
}

/** Every audit row targeting one supplier — the per-mutation row count. */
function auditsForTarget(booted: BootedTestApp, targetId: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.targetId === targetId);
}

function changedFieldsOf(row: AuditLogRow): unknown[] | undefined {
  const value = row.metadata.changedFields;
  return Array.isArray(value) ? value : undefined;
}

/** Every supplier row of one tenant. */
function suppliersOf(booted: BootedTestApp, tenantId: string): SupplierRow[] {
  return [...booted.db.tables.suppliers.values()].filter((row) => row.tenantId === tenantId);
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
 * Replaces the in-memory `supplier.create` for the duration of `run` and
 * restores it afterwards. The in-memory boundary deliberately does NOT enforce
 * the DEC-011 partial unique index — a partial index cannot be expressed there
 * without inventing a constraint engine — so the service's `P2002` -> `409`
 * translation is exercised by making the delegate throw the exact error Prisma
 * would raise. This mirrors the stubbed-`P2002` precedent in
 * `clinical.service.test.ts`.
 */
async function withSupplierCreateFailing(
  db: IsolationDatabase,
  error: unknown,
  run: () => Promise<void>
): Promise<void> {
  const original = db.prisma.supplier.create;
  db.prisma.supplier.create = () => {
    throw error;
  };
  try {
    await run();
  } finally {
    db.prisma.supplier.create = original;
  }
}

/**
 * Replaces the in-memory `supplier.updateMany` for the duration of `run` and
 * restores it afterwards. Companion to {@link withSupplierCreateFailing}: the
 * update path reaches the same P2002 translation through a different delegate
 * method.
 */
async function withSupplierUpdateFailing(
  db: IsolationDatabase,
  error: unknown,
  run: () => Promise<void>
): Promise<void> {
  const original = db.prisma.supplier.updateMany;
  db.prisma.supplier.updateMany = () => {
    throw error;
  };
  try {
    await run();
  } finally {
    db.prisma.supplier.updateMany = original;
  }
}

/**
 * EPIC-11 W2 supplier registry surface over the REAL guard chain
 * (Auth → Tenancy → RBAC) and the shared in-memory boundary, which snapshots
 * and restores its tables on a thrown transaction — so "persists nothing" is
 * proven, not assumed.
 */
describe("Suppliers HTTP boundary (EPIC-11 W2)", () => {
  let booted: BootedTestApp;
  let fixture: SuppliersHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedSuppliersHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires suppliers.read on every read route and persists nothing when denied", async () => {
    const supplier = fixture.createSupplier(fixture.a, { name: "Readable" });
    const auditsBefore = booted.db.tables.audits.size;

    for (const path of ["/suppliers", `/suppliers/${supplier.id}`]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, path).toBe("FORBIDDEN");
    }

    // `suppliers.read` alone reads both routes.
    for (const path of ["/suppliers", `/suppliers/${supplier.id}`]) {
      await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.readOnly.cookie)
        .expect(200);
    }

    // A denied read reaches no data access and appends nothing.
    expect(auditsBefore).toBe(booted.db.tables.audits.size);
  });

  it("requires the matching supplier permission on every write route and persists nothing when denied", async () => {
    const cases = [
      {
        label: SUPPLIERS_PERMISSIONS.create,
        method: "post" as const,
        path: "/suppliers",
        body: createBody(),
      },
      {
        label: SUPPLIERS_PERMISSIONS.update,
        method: "put" as const,
        path: `/suppliers/${randomUUID()}`,
        body: { name: "Denied rename" },
      },
      {
        label: SUPPLIERS_PERMISSIONS.deactivate,
        method: "post" as const,
        path: `/suppliers/${randomUUID()}/deactivate`,
        body: undefined,
      },
    ];

    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    // Both a read-only member and a member with no supplier key at all are denied.
    for (const actor of [fixture.readOnly, fixture.noPermission]) {
      for (const scenario of cases) {
        const request = supertest(booted.app.getHttpServer())
          [scenario.method](scenario.path)
          .set("Cookie", actor.cookie);
        const response = await (
          scenario.body === undefined ? request : request.send(scenario.body)
        ).expect(403);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("FORBIDDEN");
      }
    }

    // A denied write reaches no data access AND no audit append.
    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("creates a supplier, co-commits exactly one audit row and returns the allowlisted DTO", async () => {
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/suppliers")
      .set("Cookie", fixture.a.actor.cookie)
      .send({
        name: "Distribuidora Alfa",
        legalName: "Distribuidora Alfa S.A.",
        taxId: "80012345-6",
        email: "contacto@alfa.example",
        phone: "+595981111222",
        address: "Av. Siempre Viva 742",
      })
      .expect(201);

    const body = response.body as SupplierDto;
    expect(Object.keys(body).sort()).toEqual([...SUPPLIER_RESPONSE_KEYS].sort());
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.name).toBe("Distribuidora Alfa");
    expect(body.legalName).toBe("Distribuidora Alfa S.A.");
    expect(body.taxId).toBe("80012345-6");
    expect(body.email).toBe("contacto@alfa.example");
    expect(body.phone).toBe("+595981111222");
    expect(body.address).toBe("Av. Siempre Viva 742");
    expect(body.isActive).toBe(true);

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("supplier.created");
    expect(rows[0].targetType).toBe("supplier");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(rows[0].metadata.schemaVersion).toBe(SUPPLIERS_DTO_SCHEMA_VERSION);
    expect(changedFieldsOf(rows[0])).toEqual([
      "name",
      "legalName",
      "taxId",
      "email",
      "phone",
      "address",
    ]);

    // Field NAMES only: no CONFIDENTIAL value reaches the trail.
    const serializedMeta = JSON.stringify(rows[0].metadata);
    for (const secret of CONFIDENTIAL_VALUES) {
      expect(serializedMeta, secret).not.toContain(secret);
    }
  });

  it("creates a supplier with only the required name and names exactly one changed field", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .post("/suppliers")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Solo Nombre" })
      .expect(201);

    const body = response.body as SupplierDto;
    expect(body.name).toBe("Solo Nombre");
    expect(body.legalName).toBeNull();
    expect(body.taxId).toBeNull();
    expect(body.email).toBeNull();
    expect(body.phone).toBeNull();
    expect(body.address).toBeNull();

    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(changedFieldsOf(rows[0])).toEqual(["name"]);
  });

  it("rejects every invalid create and persists nothing", async () => {
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    const rejected: [string, Record<string, unknown>][] = [
      ["missing name", {}],
      ["null name", { name: null }],
      ["blank name", { name: "" }],
      ["over-long name", { name: "x".repeat(201) }],
      ["numeric name", { name: 42 }],
      ["null legal name", createBody({ legalName: null })],
      ["blank legal name", createBody({ legalName: "" })],
      ["over-long legal name", createBody({ legalName: "x".repeat(201) })],
      ["over-long tax id", createBody({ taxId: "x".repeat(51) })],
      ["over-long email", createBody({ email: "x".repeat(321) })],
      ["over-long phone", createBody({ phone: "x".repeat(51) })],
      ["over-long address", createBody({ address: "x".repeat(501) })],
      ["client tenant", createBody({ tenantId: randomUUID() })],
      ["client isActive", createBody({ isActive: false })],
      ["unknown key", createBody({ nickname: "Alias" })],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/suppliers")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("treats an explicit null as a clear and an absent key as untouched", async () => {
    const supplier = fixture.createSupplier(fixture.a, {
      name: "Before rename",
      legalName: "Before Legal",
      taxId: "11111111-1",
      email: "before@example.test",
      phone: "+595980000000",
      address: "Before address",
    });

    // An omitted optional key leaves the stored value untouched.
    const untouched = await supertest(booted.app.getHttpServer())
      .put(`/suppliers/${supplier.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "After rename" })
      .expect(200);
    const untouchedBody = untouched.body as SupplierDto;
    expect(untouchedBody.name).toBe("After rename");
    expect(untouchedBody.legalName).toBe("Before Legal");
    expect(untouchedBody.taxId).toBe("11111111-1");
    expect(untouchedBody.email).toBe("before@example.test");
    expect(untouchedBody.phone).toBe("+595980000000");
    expect(untouchedBody.address).toBe("Before address");
    expect(changedFieldsOf(auditsForTarget(booted, supplier.id)[0])).toEqual(["name"]);

    // An explicit null CLEARS exactly the field it names.
    const cleared = await supertest(booted.app.getHttpServer())
      .put(`/suppliers/${supplier.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ email: null, phone: null })
      .expect(200);
    const clearedBody = cleared.body as SupplierDto;
    expect(clearedBody.email).toBeNull();
    expect(clearedBody.phone).toBeNull();
    expect(clearedBody.legalName).toBe("Before Legal");
    expect(clearedBody.taxId).toBe("11111111-1");
    expect(clearedBody.address).toBe("Before address");

    const clearRows = auditsForTarget(booted, supplier.id);
    expect(changedFieldsOf(clearRows[1])).toEqual(["email", "phone"]);

    // Clearing everything optional leaves the required name in place.
    const emptied = await supertest(booted.app.getHttpServer())
      .put(`/suppliers/${supplier.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ legalName: null, taxId: null, address: null })
      .expect(200);
    const emptiedBody = emptied.body as SupplierDto;
    expect(emptiedBody.name).toBe("After rename");
    expect(emptiedBody.legalName).toBeNull();
    expect(emptiedBody.taxId).toBeNull();
    expect(emptiedBody.address).toBeNull();

    // `name` may never be nulled: the required field has no clear state.
    const rejected = await supertest(booted.app.getHttpServer())
      .put(`/suppliers/${supplier.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: null })
      .expect(400);
    expect((rejected.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    const stored = booted.db.tables.suppliers.get(supplier.id);
    expect(stored?.name).toBe("After rename");
  });

  it("rejects every invalid update and persists nothing", async () => {
    const supplier = fixture.createSupplier(fixture.a, {
      name: "Estado estable",
      legalName: "Estable Legal",
      taxId: "22222222-2",
    });
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    const rejected: [string, Record<string, unknown>][] = [
      ["null name", { name: null }],
      ["blank name", { name: "" }],
      ["over-long name", { name: "x".repeat(201) }],
      ["numeric name", { name: 7 }],
      ["blank legal name", { legalName: "" }],
      ["over-long tax id", { taxId: "x".repeat(51) }],
      ["over-long email", { email: "x".repeat(321) }],
      ["over-long phone", { phone: "x".repeat(51) }],
      ["over-long address", { address: "x".repeat(501) }],
      ["client tenant", { tenantId: randomUUID() }],
      ["client isActive", { isActive: false }],
      ["unknown key", { nickname: "Alias" }],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .put(`/suppliers/${supplier.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    // A malformed id is a 400 too, and cannot reach the row.
    const malformed = await supertest(booted.app.getHttpServer())
      .put("/suppliers/not-a-uuid")
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Never stored" })
      .expect(400);
    expect((malformed.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);

    const stored = booted.db.tables.suppliers.get(supplier.id);
    expect(stored?.name).toBe("Estado estable");
    expect(stored?.legalName).toBe("Estable Legal");
    expect(stored?.taxId).toBe("22222222-2");
  });

  it("masks a foreign read, update and deactivation as the same 404 as an unknown id", async () => {
    const foreign = fixture.createSupplier(fixture.b, { name: "Foreign supplier" });
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "GET",
      nonexistentUrl: `/suppliers/${randomUUID()}`,
      foreignUrl: `/suppliers/${foreign.id}`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "PUT",
      nonexistentUrl: `/suppliers/${randomUUID()}`,
      foreignUrl: `/suppliers/${foreign.id}`,
      body: { name: "Masked rename" },
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: `/suppliers/${randomUUID()}/deactivate`,
      foreignUrl: `/suppliers/${foreign.id}/deactivate`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });

    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    const stored = booted.db.tables.suppliers.get(foreign.id);
    expect(stored?.name).toBe("Foreign supplier");
    expect(stored?.isActive).toBe(true);
  });

  it("deactivates idempotently and appends exactly one audit row per accepted command", async () => {
    const supplier = fixture.createSupplier(fixture.a, { name: "A desactivar", isActive: true });

    const first = await supertest(booted.app.getHttpServer())
      .post(`/suppliers/${supplier.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);
    const firstBody = first.body as SupplierDto;
    expect(firstBody.id).toBe(supplier.id);
    expect(firstBody.isActive).toBe(false);
    expect(Object.keys(firstBody).sort()).toEqual([...SUPPLIER_RESPONSE_KEYS].sort());

    const afterFirst = auditsForTarget(booted, supplier.id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].action).toBe("supplier.deactivated");
    expect(afterFirst[0].targetType).toBe("supplier");
    expect(changedFieldsOf(afterFirst[0])).toEqual(["isActive"]);

    // REPEAT: still accepted, still one MORE co-committed audit row, but the
    // diff is EMPTY because nothing changed on the second call.
    const repeat = await supertest(booted.app.getHttpServer())
      .post(`/suppliers/${supplier.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);
    expect((repeat.body as SupplierDto).isActive).toBe(false);

    const afterRepeat = auditsForTarget(booted, supplier.id);
    expect(afterRepeat).toHaveLength(2);
    expect(changedFieldsOf(afterRepeat[1])).toEqual([]);

    // A deactivated supplier stays readable (historical purchases keep it).
    await supertest(booted.app.getHttpServer())
      .get(`/suppliers/${supplier.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
  });

  it("exposes no delete or patch route anywhere on the supplier surface", async () => {
    const supplier = fixture.createSupplier(fixture.a, { name: "No se borra" });
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    for (const [method, path] of [
      ["delete", `/suppliers/${supplier.id}`],
      ["patch", `/suppliers/${supplier.id}`],
      ["delete", "/suppliers"],
      ["patch", "/suppliers"],
    ] as const) {
      await supertest(booted.app.getHttpServer())
        [method](path)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(404);
    }

    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    expect(booted.db.tables.suppliers.has(supplier.id)).toBe(true);
  });

  it("lists the caller tenant's suppliers by name, applies the isActive filter and has no implicit default", async () => {
    const zulu = fixture.createSupplier(fixture.a, { name: "Zulu Supplier" });
    const alfa = fixture.createSupplier(fixture.a, { name: "Alfa Supplier" });
    const bravo = fixture.createSupplier(fixture.a, { name: "Bravo Supplier", isActive: false });
    const foreign = fixture.createSupplier(fixture.b, { name: "Zzz foreign" });

    const all = await supertest(booted.app.getHttpServer())
      .get("/suppliers")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = all.body as SupplierDto[];
    const ids = body.map((row) => row.id);
    expect(ids).toContain(alfa.id);
    expect(ids).toContain(bravo.id);
    expect(ids).toContain(zulu.id);
    // No implicit visibility default: an omitted filter filters nothing, so an
    // INACTIVE supplier is still listed.
    expect(ids).toContain(bravo.id);
    expect(ids).not.toContain(foreign.id);
    expect(body.every((row) => row.tenantId === fixture.a.tenant.id)).toBe(true);
    // The list is COMPLETE for the caller's tenant: every stored row is returned.
    expect(body).toHaveLength(suppliersOf(booted, fixture.a.tenant.id).length);

    // Name-ascending ordering (the W1 `(tenant_id, name)` index serves it).
    const ownNames = body
      .filter((row) => [alfa.id, bravo.id, zulu.id].includes(row.id))
      .map((row) => row.name);
    expect(ownNames).toEqual(["Alfa Supplier", "Bravo Supplier", "Zulu Supplier"]);

    const listed = body.find((row) => row.id === alfa.id);
    expect(Object.keys(listed ?? {}).sort()).toEqual([...SUPPLIER_RESPONSE_KEYS].sort());

    // The `isActive` filter narrows the list in both directions.
    const active = await supertest(booted.app.getHttpServer())
      .get("/suppliers?isActive=true")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const activeIds = (active.body as SupplierDto[]).map((row) => row.id);
    expect(activeIds).toContain(alfa.id);
    expect(activeIds).not.toContain(bravo.id);

    const inactive = await supertest(booted.app.getHttpServer())
      .get("/suppliers?isActive=false")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const inactiveIds = (inactive.body as SupplierDto[]).map((row) => row.id);
    expect(inactiveIds).toContain(bravo.id);
    expect(inactiveIds).not.toContain(alfa.id);

    // Unknown query keys and malformed filter values are rejected, not ignored.
    for (const query of ["?limit=10", "?name=Alfa", "?isActive=yes", "?active=true"]) {
      const rejected = await supertest(booted.app.getHttpServer())
        .get(`/suppliers${query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((rejected.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }

    // No foreign tenant identifier ever leaks into the caller's list.
    expect(all.text).not.toContain(foreign.id);
    expect(all.text).not.toContain(fixture.b.tenant.id);
  });

  it("co-commits the create, update and deactivate audit rows with the expected diffs and no payload", async () => {
    const created = await supertest(booted.app.getHttpServer())
      .post("/suppliers")
      .set("Cookie", fixture.a.actor.cookie)
      .send({
        name: "Distribuidora Alfa",
        legalName: "Distribuidora Alfa S.A.",
        taxId: "80012345-6",
        email: "contacto@alfa.example",
        phone: "+595981111222",
        address: "Av. Siempre Viva 742",
      })
      .expect(201);
    const supplierId = (created.body as SupplierDto).id;

    await supertest(booted.app.getHttpServer())
      .put(`/suppliers/${supplierId}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ phone: "+595982222333", address: null })
      .expect(200);

    await supertest(booted.app.getHttpServer())
      .post(`/suppliers/${supplierId}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);

    const rows = auditsForTarget(booted, supplierId);
    expect(rows.map((row) => row.action)).toEqual([
      "supplier.created",
      "supplier.updated",
      "supplier.deactivated",
    ]);
    expect(rows.map((row) => row.targetType)).toEqual(["supplier", "supplier", "supplier"]);
    expect(rows.map(changedFieldsOf)).toEqual([
      ["name", "legalName", "taxId", "email", "phone", "address"],
      ["phone", "address"],
      ["isActive"],
    ]);

    for (const row of rows) {
      expect(row.metadata.schemaVersion).toBe(SUPPLIERS_DTO_SCHEMA_VERSION);
      const serialized = JSON.stringify(row.metadata);
      for (const secret of CONFIDENTIAL_VALUES) {
        expect(serialized, `${row.action} leaked ${secret}`).not.toContain(secret);
      }
      expect(serialized).not.toContain("+595982222333");
    }
  });

  it("maps a duplicate present tax identifier on create to the stable 409 and persists nothing", async () => {
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    await withSupplierCreateFailing(
      booted.db,
      // Column-name shape, as the PostgreSQL engine reports it.
      uniqueViolation(["tenant_id", "tax_id"]),
      async () => {
        const response = await supertest(booted.app.getHttpServer())
          .post("/suppliers")
          .set("Cookie", fixture.a.actor.cookie)
          .send({ name: "Duplicado", taxId: "80099999-9" })
          .expect(409);
        const body = response.body as ErrorDto;
        expect(body.error.code).toBe("CONFLICT");
        expect(body.error.message).toBe(SUPPLIER_TAX_ID_CONFLICT_MESSAGE);
        // The CONFIDENTIAL identifier is never echoed back to the caller.
        expect(response.text).not.toContain("80099999-9");
      }
    );

    // A rejected create commits no supplier row and no audit row.
    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("maps a duplicate present tax identifier on update to the stable 409 and persists nothing", async () => {
    const supplier = fixture.createSupplier(fixture.a, {
      name: "Sin cambios",
      taxId: "33333333-3",
    });
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;

    await withSupplierUpdateFailing(
      booted.db,
      // Index-name shape, the other shape Prisma can report.
      uniqueViolation("supplier_tenant_id_tax_id_key"),
      async () => {
        const response = await supertest(booted.app.getHttpServer())
          .put(`/suppliers/${supplier.id}`)
          .set("Cookie", fixture.a.actor.cookie)
          .send({ taxId: "44444444-4" })
          .expect(409);
        const body = response.body as ErrorDto;
        expect(body.error.code).toBe("CONFLICT");
        expect(body.error.message).toBe(SUPPLIER_TAX_ID_CONFLICT_MESSAGE);
        expect(response.text).not.toContain("44444444-4");
      }
    );

    // The rejected update changed nothing and appended no audit row.
    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    const stored = booted.db.tables.suppliers.get(supplier.id);
    expect(stored?.name).toBe("Sin cambios");
    expect(stored?.taxId).toBe("33333333-3");
  });

  it("rethrows an unrelated P2002 instead of mapping it to a 409", async () => {
    const supplier = fixture.createSupplier(fixture.a, { name: "Ownership key" });
    const suppliersBefore = booted.db.tables.suppliers.size;
    const auditsBefore = booted.db.tables.audits.size;
    // The `(tenant_id, id)` tenant-ownership key, NOT the tax-id partial index.
    const ownershipConflict = uniqueViolation(["tenant_id", "id"]);

    // Create path: the unrelated P2002 keeps its generic INTERNAL envelope.
    await withSupplierCreateFailing(booted.db, ownershipConflict, async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/suppliers")
        .set("Cookie", fixture.a.actor.cookie)
        .send({ name: "Otro" })
        .expect(500);
      expect((response.body as ErrorDto).error.code).toBe("INTERNAL");
    });

    // Update path: same rethrow, never a 409.
    await withSupplierUpdateFailing(booted.db, ownershipConflict, async () => {
      const response = await supertest(booted.app.getHttpServer())
        .put(`/suppliers/${supplier.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send({ name: "Renombrado" })
        .expect(500);
      expect((response.body as ErrorDto).error.code).toBe("INTERNAL");
    });

    // Nothing was persisted and no audit row was appended on either path.
    expect(booted.db.tables.suppliers.size).toBe(suppliersBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    expect(booted.db.tables.suppliers.get(supplier.id)?.name).toBe("Ownership key");
  });
});
