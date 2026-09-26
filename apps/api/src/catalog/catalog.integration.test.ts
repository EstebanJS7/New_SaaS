import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  SEEDED_TAX_RATE_IDS,
  type AuditLogRow,
  type CatalogItemRow,
  type IsolationDatabase,
  type TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { CATALOG_PERMISSIONS } from "./catalog.permissions.js";
import { CATALOG_DTO_SCHEMA_VERSION } from "./catalog.zod.js";

interface TaxRateProjectionDto {
  code: string;
  name: string;
  rate: string;
}

interface TaxRateDto extends TaxRateProjectionDto {
  id: string;
}

interface CatalogItemDto {
  id: string;
  tenantId: string;
  kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
  name: string;
  taxRateId: string;
  taxRate: TaxRateProjectionDto;
  referencePriceAmount: string | null;
  referencePriceCurrency: string | null;
  isActive: boolean;
  tracksStock: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ErrorDto {
  error: { code: string };
}

/** Exact allowlisted key sets — any extra key fails these assertions. */
const CATALOG_ITEM_RESPONSE_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "kind",
  "name",
  "taxRateId",
  "taxRate",
  "referencePriceAmount",
  "referencePriceCurrency",
  "isActive",
  "tracksStock",
  "createdAt",
  "updatedAt",
];

const TAX_RATE_RESPONSE_KEYS: readonly string[] = ["id", "code", "name", "rate"];

/** The item's nested projection deliberately repeats no rate identifier. */
const TAX_RATE_PROJECTION_KEYS: readonly string[] = ["code", "name", "rate"];

/** The full catalog matrix a tenant owner holds; the read-only actor holds none of it. */
const ALL_CATALOG_PERMISSIONS: readonly string[] = [
  CATALOG_PERMISSIONS.read,
  CATALOG_PERMISSIONS.create,
  CATALOG_PERMISSIONS.update,
  CATALOG_PERMISSIONS.deactivate,
];

interface CatalogTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

interface CatalogHttpFixture {
  /** Probing tenant holding the FULL `catalog.*` matrix. */
  a: CatalogTenant;
  /** Foreign tenant holding the full matrix; owns the rows A must not touch. */
  b: CatalogTenant;
  /** Member of A whose role has NO catalog permission (403 probe). */
  noPermission: RbacActor;
  /** Member of A with `catalog.read` only: every write is a 403. */
  readOnly: RbacActor;
  /** Fresh item in the given tenant; call per test for order independence. */
  createItem(
    owner: CatalogTenant,
    overrides?: Partial<Pick<CatalogItemRow, "kind" | "isActive" | "taxRateId">> & {
      name?: string;
      referencePriceAmount?: string | null;
      referencePriceCurrency?: string | null;
    }
  ): CatalogItemRow;
}

/**
 * Seeds two isolated tenants holding the full catalog matrix, a
 * permission-negative actor and a read-only actor in tenant A, plus item
 * factories. The three GLOBAL tax rates are already seeded by the shared
 * boundary, so no test mutates them.
 */
function seedCatalogHttp(db: IsolationDatabase): CatalogHttpFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string, keys: readonly string[]): CatalogTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `catalog-${letter}-${suffix}`, name: `Catalog ${label}` },
    });
    const role = seedRoleWithKeys(db, `CATALOG_${label}_${suffix}`, `Catalog ${label} (fixture)`, [
      ...keys,
    ]);
    const actor = seedRbacActor(db, {
      email: `catalog-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { tenant, actor };
  }

  const a = seedTenant("a", ALL_CATALOG_PERMISSIONS);
  const b = seedTenant("b", ALL_CATALOG_PERMISSIONS);

  const noPermissionRole = seedRoleWithKeys(
    db,
    `CATALOG_NONE_${suffix}`,
    "Catalog none (fixture)",
    []
  );
  const noPermission = seedRbacActor(db, {
    email: `catalog-none-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: noPermissionRole.role.id,
  });

  const readOnlyRole = seedRoleWithKeys(
    db,
    `CATALOG_READ_${suffix}`,
    "Catalog read only (fixture)",
    [CATALOG_PERMISSIONS.read]
  );
  const readOnly = seedRbacActor(db, {
    email: `catalog-read-${suffix}@isolation.test`,
    tenantId: a.tenant.id,
    roleId: readOnlyRole.role.id,
  });

  return {
    a,
    b,
    noPermission,
    readOnly,
    createItem: (owner, overrides = {}) =>
      db.prisma.catalogItem.create({
        data: {
          tenantId: owner.tenant.id,
          kind: overrides.kind ?? "PRODUCT",
          name: overrides.name ?? `Item ${randomUUID().slice(0, 8)}`,
          taxRateId: overrides.taxRateId ?? SEEDED_TAX_RATE_IDS.IVA_10,
          referencePriceAmount: overrides.referencePriceAmount ?? null,
          referencePriceCurrency: overrides.referencePriceCurrency ?? null,
          isActive: overrides.isActive ?? true,
        },
      }),
  };
}

/** A valid create body; overrides let a test break exactly one rule. */
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "PRODUCT",
    name: `Item ${randomUUID().slice(0, 8)}`,
    taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
    ...overrides,
  };
}

/** Every audit row targeting one item — the per-mutation row count. */
function auditsForTarget(booted: BootedTestApp, targetId: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.targetId === targetId);
}

function auditMeta(row: AuditLogRow): { schemaVersion?: unknown; changedFields?: unknown[] } {
  return {
    schemaVersion: row.metadata.schemaVersion,
    changedFields: changedFieldsOf(row),
  };
}

/** The `changedFields` audit metadata, read defensively from the JSON payload. */
function changedFieldsOf(row: AuditLogRow): unknown[] | undefined {
  const value = row.metadata.changedFields;
  return Array.isArray(value) ? value : undefined;
}

/**
 * EPIC-09 WU2 catalog READ boundary: `GET /catalog`, `GET /catalog/:id` and
 * `GET /catalog/tax-rates` over the REAL guard chain (Auth → Tenancy → RBAC)
 * and the shared in-memory boundary. Every factory runs INSIDE its `it`, so no
 * test depends on an id minted by an earlier test.
 */
describe("Catalog reads HTTP boundary (EPIC-09 WU2)", () => {
  let booted: BootedTestApp;
  let fixture: CatalogHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedCatalogHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires catalog.read on every read route and persists nothing when denied", async () => {
    const itemsBefore = booted.db.tables.catalogItems.size;
    const auditsBefore = booted.db.tables.audits.size;

    for (const path of ["/catalog", "/catalog/tax-rates", `/catalog/${randomUUID()}`]) {
      const response = await supertest(booted.app.getHttpServer())
        .get(path)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);
      expect((response.body as ErrorDto).error.code, path).toBe("FORBIDDEN");
    }

    // A denied read reaches no data access: no row is created and nothing is
    // audited.
    expect(booted.db.tables.catalogItems.size).toBe(itemsBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("lists only the caller tenant's items with the exact allowlisted DTO key set", async () => {
    const own = fixture.createItem(fixture.a, {
      kind: "PRODUCT",
      name: "Propofol 1%",
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
      referencePriceAmount: "1500.00",
      referencePriceCurrency: "PYG",
      isActive: true,
    });
    const ownInactive = fixture.createItem(fixture.a, {
      kind: "SERVICE",
      name: "Consulta de control",
      taxRateId: SEEDED_TAX_RATE_IDS.IVA_5,
      isActive: false,
    });
    const foreign = fixture.createItem(fixture.b, { name: "Foreign item" });

    const response = await supertest(booted.app.getHttpServer())
      .get("/catalog")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as CatalogItemDto[];
    const ids = body.map((item) => item.id);
    expect(ids).toContain(own.id);
    // No implicit visibility default: an omitted filter filters nothing.
    expect(ids).toContain(ownInactive.id);
    expect(ids).not.toContain(foreign.id);

    const listed = body.find((item) => item.id === own.id);
    expect(listed).toBeDefined();
    expect(Object.keys(listed ?? {}).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());
    expect(Object.keys(listed?.taxRate ?? {}).sort()).toEqual([...TAX_RATE_PROJECTION_KEYS].sort());

    // Decimal reference price is projected as a STRING, never a float.
    expect(listed?.referencePriceAmount).toBe("1500.00");
    expect(listed?.referencePriceCurrency).toBe("PYG");
    // The nested projection carries the stable code/name/rate, not the id.
    expect(listed?.taxRateId).toBe(SEEDED_TAX_RATE_IDS.EXEMPT);
    expect(listed?.taxRate).toEqual({ code: "EXEMPT", name: "Exempt", rate: "0.00" });

    // No foreign tenant identifier ever leaks into the caller's list.
    expect(response.text).not.toContain(fixture.b.tenant.id);
    expect(response.text).not.toContain(foreign.id);
  });

  it("reads one item with the allowlisted DTO; foreign ids are byte-equivalent to unknown ones", async () => {
    const own = fixture.createItem(fixture.a, {
      name: "Amoxicilina",
      referencePriceAmount: "25000.00",
      referencePriceCurrency: "PYG",
    });
    const foreign = fixture.createItem(fixture.b, { name: "Foreign detail" });

    const response = await supertest(booted.app.getHttpServer())
      .get(`/catalog/${own.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);

    const body = response.body as CatalogItemDto;
    expect(body.id).toBe(own.id);
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(Object.keys(body).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());
    expect(body.referencePriceAmount).toBe("25000.00");

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/catalog/${randomUUID()}`,
      foreignUrl: `/catalog/${foreign.id}`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });
  });

  it("rejects a malformed item id with VALIDATION_FAILED", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/catalog/not-a-uuid")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(400);

    expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
  });

  it("applies the kind and isActive list filters, and rejects unknown query input", async () => {
    const activeProduct = fixture.createItem(fixture.a, { kind: "PRODUCT", isActive: true });
    const activeService = fixture.createItem(fixture.a, { kind: "SERVICE", isActive: true });
    const inactiveService = fixture.createItem(fixture.a, { kind: "SERVICE", isActive: false });

    const byKind = await supertest(booted.app.getHttpServer())
      .get("/catalog?kind=SERVICE")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const kindBody = byKind.body as CatalogItemDto[];
    expect(kindBody.every((item) => item.kind === "SERVICE")).toBe(true);
    expect(kindBody.map((item) => item.id)).toContain(activeService.id);
    expect(kindBody.map((item) => item.id)).not.toContain(activeProduct.id);

    const inactive = await supertest(booted.app.getHttpServer())
      .get("/catalog?isActive=false")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const inactiveBody = inactive.body as CatalogItemDto[];
    expect(inactiveBody.every((item) => item.isActive === false)).toBe(true);
    expect(inactiveBody.map((item) => item.id)).toContain(inactiveService.id);
    expect(inactiveBody.map((item) => item.id)).not.toContain(activeService.id);

    const combined = await supertest(booted.app.getHttpServer())
      .get("/catalog?kind=SERVICE&isActive=true")
      .set("Cookie", fixture.a.actor.cookie)
      .expect(200);
    const combinedBody = combined.body as CatalogItemDto[];
    expect(combinedBody.every((item) => item.kind === "SERVICE" && item.isActive)).toBe(true);
    expect(combinedBody.map((item) => item.id)).toContain(activeService.id);
    expect(combinedBody.map((item) => item.id)).not.toContain(inactiveService.id);

    for (const query of ["?limit=10", "?isActive=maybe", "?kind=UNKNOWN"]) {
      const rejected = await supertest(booted.app.getHttpServer())
        .get(`/catalog${query}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((rejected.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
    }
  });

  it("serves the same global tax-rate list to every tenant", async () => {
    const [asA, asB] = await Promise.all([
      supertest(booted.app.getHttpServer())
        .get("/catalog/tax-rates")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200),
      supertest(booted.app.getHttpServer())
        .get("/catalog/tax-rates")
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200),
    ]);

    const ratesA = asA.body as TaxRateDto[];
    const ratesB = asB.body as TaxRateDto[];

    // GLOBAL reference data: identical rows and stable `code` order.
    expect(ratesA).toEqual(ratesB);
    expect(ratesA.map((rate) => rate.code)).toEqual(["EXEMPT", "IVA_10", "IVA_5"]);
    expect(ratesA.find((rate) => rate.code === "IVA_10")).toEqual({
      id: SEEDED_TAX_RATE_IDS.IVA_10,
      code: "IVA_10",
      name: "IVA 10%",
      rate: "10.00",
    });
    for (const rate of ratesA) {
      expect(Object.keys(rate).sort()).toEqual([...TAX_RATE_RESPONSE_KEYS].sort());
    }

    // The global list never carries tenant-private identifiers.
    expect(asA.text).not.toContain(fixture.a.tenant.id);
    expect(asA.text).not.toContain(fixture.b.tenant.id);
  });
});

/**
 * EPIC-09 WU2 catalog WRITE boundary: `POST /catalog`, `PUT /catalog/:id` and
 * `POST /catalog/:id/deactivate`. Every assertion runs over the REAL guard chain
 * and the shared in-memory boundary, which snapshots and restores its tables on
 * a thrown transaction — so "persists nothing" is proven, not assumed.
 */
describe("Catalog writes HTTP boundary (EPIC-09 WU2)", () => {
  let booted: BootedTestApp;
  let fixture: CatalogHttpFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedCatalogHttp(booted.db);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("requires the matching catalog permission on every write route and persists nothing when denied", async () => {
    const cases = [
      {
        label: CATALOG_PERMISSIONS.create,
        method: "post" as const,
        path: "/catalog",
        body: createBody(),
      },
      {
        label: CATALOG_PERMISSIONS.update,
        method: "put" as const,
        path: `/catalog/${randomUUID()}`,
        body: { name: "Denied rename" },
      },
      {
        label: CATALOG_PERMISSIONS.deactivate,
        method: "post" as const,
        path: `/catalog/${randomUUID()}/deactivate`,
        body: undefined,
      },
    ];

    const itemsBefore = booted.db.tables.catalogItems.size;
    const auditsBefore = booted.db.tables.audits.size;

    // Both a read-only member and a member with no catalog key at all are denied.
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
    expect(booted.db.tables.catalogItems.size).toBe(itemsBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("creates an item, co-commits exactly one audit row and returns the allowlisted DTO", async () => {
    const auditsBefore = booted.db.tables.audits.size;
    const itemsBefore = booted.db.tables.catalogItems.size;

    const response = await supertest(booted.app.getHttpServer())
      .post("/catalog")
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        createBody({
          kind: "MEDICATION",
          name: "Propofol 1%",
          taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
          referencePriceAmount: "1500.00",
          referencePriceCurrency: "PYG",
        })
      )
      .expect(201);

    const body = response.body as CatalogItemDto;
    expect(Object.keys(body).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());
    expect(body.tenantId).toBe(fixture.a.tenant.id);
    expect(body.kind).toBe("MEDICATION");
    expect(body.name).toBe("Propofol 1%");
    expect(body.isActive).toBe(true);
    expect(body.referencePriceAmount).toBe("1500.00");
    expect(body.referencePriceCurrency).toBe("PYG");
    expect(body.taxRate).toEqual({ code: "IVA_10", name: "IVA 10%", rate: "10.00" });

    expect(booted.db.tables.catalogItems.size).toBe(itemsBefore + 1);
    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);

    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("catalog_item.created");
    expect(rows[0].targetType).toBe("catalog_item");
    expect(rows[0].tenantId).toBe(fixture.a.tenant.id);
    expect(auditMeta(rows[0])).toMatchObject({
      schemaVersion: CATALOG_DTO_SCHEMA_VERSION,
      changedFields: [
        "kind",
        "name",
        "taxRateId",
        "referencePriceAmount",
        "referencePriceCurrency",
      ],
    });
    // Field NAMES only: no name, amount or currency VALUE ever reaches the trail.
    const serializedMeta = JSON.stringify(rows[0].metadata);
    expect(serializedMeta).not.toContain("Propofol");
    expect(serializedMeta).not.toContain("1500");
    expect(serializedMeta).not.toContain("PYG");
  });

  it("creates a rate-carrying item with no reference price at all", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .post("/catalog")
      .set("Cookie", fixture.a.actor.cookie)
      .send(
        createBody({ kind: "SUPPLY", name: "Gasa estéril", taxRateId: SEEDED_TAX_RATE_IDS.IVA_5 })
      )
      .expect(201);

    const body = response.body as CatalogItemDto;
    expect(body.referencePriceAmount).toBeNull();
    expect(body.referencePriceCurrency).toBeNull();
    expect(body.taxRate.code).toBe("IVA_5");

    const rows = auditsForTarget(booted, body.id);
    expect(rows).toHaveLength(1);
    expect(auditMeta(rows[0]).changedFields).toEqual(["kind", "name", "taxRateId"]);
  });

  it("defaults tracksStock by kind on create and honors an explicit override", async () => {
    async function create(overrides: Record<string, unknown>): Promise<CatalogItemDto> {
      const response = await supertest(booted.app.getHttpServer())
        .post("/catalog")
        .set("Cookie", fixture.a.actor.cookie)
        .send(createBody(overrides))
        .expect(201);
      return response.body as CatalogItemDto;
    }

    // Omitted flag: the KIND decides, not the column's own `true` default.
    const service = await create({ kind: "SERVICE", name: "Consulta de rutina" });
    const product = await create({ kind: "PRODUCT", name: "Alimento balanceado" });
    const medication = await create({ kind: "MEDICATION", name: "Antibiotico" });
    const supply = await create({ kind: "SUPPLY", name: "Gasa esteril" });
    expect(service.tracksStock).toBe(false);
    expect(product.tracksStock).toBe(true);
    expect(medication.tracksStock).toBe(true);
    expect(supply.tracksStock).toBe(true);

    // The flag is part of the allowlisted DTO and the PERSISTED row agrees, so
    // the projection is a read of stored state rather than a re-derived rule.
    expect(Object.keys(service).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());
    expect(booted.db.tables.catalogItems.get(service.id)?.tracksStock).toBe(false);
    expect(booted.db.tables.catalogItems.get(product.id)?.tracksStock).toBe(true);

    // A supplied value wins over the kind default in BOTH directions, because
    // the flag is a manual, staff-editable decision.
    const trackingService = await create({
      kind: "SERVICE",
      name: "Cirugia con insumos",
      tracksStock: true,
    });
    const untrackedProduct = await create({
      kind: "PRODUCT",
      name: "Producto sin stock",
      tracksStock: false,
    });
    expect(trackingService.tracksStock).toBe(true);
    expect(untrackedProduct.tracksStock).toBe(false);

    // The audit names tracksStock only when the caller actually sent it: the
    // by-kind default is already determined by the `kind` it records.
    const defaultRows = auditsForTarget(booted, service.id);
    expect(defaultRows).toHaveLength(1);
    expect(auditMeta(defaultRows[0]).changedFields).toEqual(["kind", "name", "taxRateId"]);
    const overrideRows = auditsForTarget(booted, untrackedProduct.id);
    expect(overrideRows).toHaveLength(1);
    expect(auditMeta(overrideRows[0]).changedFields).toEqual([
      "kind",
      "name",
      "taxRateId",
      "tracksStock",
    ]);
  });

  it("rejects every invalid create and persists nothing", async () => {
    const itemsBefore = booted.db.tables.catalogItems.size;
    const auditsBefore = booted.db.tables.audits.size;

    const rejected: [string, Record<string, unknown>][] = [
      ["unknown kind", createBody({ kind: "UNKNOWN" })],
      ["missing kind", { name: "No kind", taxRateId: SEEDED_TAX_RATE_IDS.IVA_10 }],
      ["missing name", { kind: "PRODUCT", taxRateId: SEEDED_TAX_RATE_IDS.IVA_10 }],
      ["blank name", createBody({ name: "" })],
      ["missing tax rate", { kind: "PRODUCT", name: "No rate" }],
      ["null tax rate", createBody({ taxRateId: null })],
      ["malformed tax rate", createBody({ taxRateId: "not-a-uuid" })],
      ["unknown tax rate", createBody({ taxRateId: randomUUID() })],
      ["amount without currency", createBody({ referencePriceAmount: "1500.00" })],
      ["currency without amount", createBody({ referencePriceCurrency: "PYG" })],
      [
        "malformed currency",
        createBody({ referencePriceAmount: "1500.00", referencePriceCurrency: "pyg" }),
      ],
      [
        "unsupported currency",
        createBody({ referencePriceAmount: "1500.00", referencePriceCurrency: "ZZZ" }),
      ],
      [
        "negative amount",
        createBody({ referencePriceAmount: "-1.00", referencePriceCurrency: "PYG" }),
      ],
      [
        "over-scaled amount",
        createBody({ referencePriceAmount: "1.234", referencePriceCurrency: "PYG" }),
      ],
      ["numeric amount", createBody({ referencePriceAmount: 1500, referencePriceCurrency: "PYG" })],
      ["text tracksStock", createBody({ tracksStock: "true" })],
      ["null tracksStock", createBody({ tracksStock: null })],
      ["numeric tracksStock", createBody({ tracksStock: 1 })],
      ["client isActive", createBody({ isActive: false })],
      ["client tenantId", createBody({ tenantId: randomUUID() })],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .post("/catalog")
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    expect(booted.db.tables.catalogItems.size).toBe(itemsBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("updates an item, leaves the rate unchanged when omitted and co-commits one audit row", async () => {
    const item = fixture.createItem(fixture.a, {
      kind: "PRODUCT",
      name: "Amoxicilina 500mg",
      taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
    });
    const auditsBefore = booted.db.tables.audits.size;

    const response = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Amoxicilina 500 mg", kind: "MEDICATION" })
      .expect(200);

    const body = response.body as CatalogItemDto;
    expect(body.id).toBe(item.id);
    expect(body.name).toBe("Amoxicilina 500 mg");
    expect(body.kind).toBe("MEDICATION");
    // Omitted taxRateId: the selected GLOBAL rate is untouched.
    expect(body.taxRateId).toBe(SEEDED_TAX_RATE_IDS.EXEMPT);
    expect(body.taxRate.code).toBe("EXEMPT");
    expect(Object.keys(body).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());

    expect(booted.db.tables.audits.size).toBe(auditsBefore + 1);
    const rows = auditsForTarget(booted, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("catalog_item.updated");
    expect(auditMeta(rows[0]).changedFields).toEqual(["kind", "name"]);
    expect(JSON.stringify(rows[0].metadata)).not.toContain("Amoxicilina");
  });

  it("changes the selected rate when the update supplies one", async () => {
    const item = fixture.createItem(fixture.a, { taxRateId: SEEDED_TAX_RATE_IDS.IVA_10 });

    const response = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ taxRateId: SEEDED_TAX_RATE_IDS.IVA_5 })
      .expect(200);

    const body = response.body as CatalogItemDto;
    expect(body.taxRateId).toBe(SEEDED_TAX_RATE_IDS.IVA_5);
    expect(body.taxRate).toEqual({ code: "IVA_5", name: "IVA 5%", rate: "5.00" });

    const rows = auditsForTarget(booted, item.id);
    expect(rows).toHaveLength(1);
    expect(auditMeta(rows[0]).changedFields).toEqual(["taxRateId"]);
  });

  it("changes tracksStock on update only when the update supplies it", async () => {
    // Created through HTTP so the by-kind default (SERVICE → false) applies.
    const created = await supertest(booted.app.getHttpServer())
      .post("/catalog")
      .set("Cookie", fixture.a.actor.cookie)
      .send(createBody({ kind: "SERVICE", name: "Bano medicado" }))
      .expect(201);
    const item = created.body as CatalogItemDto;
    expect(item.tracksStock).toBe(false);

    // An omitted flag changes nothing: the stored value must survive an update
    // that never mentions the field.
    const omitted = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Bano medicado (revisado)" })
      .expect(200);
    const omittedBody = omitted.body as CatalogItemDto;
    expect(omittedBody.tracksStock).toBe(false);
    expect(Object.keys(omittedBody).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());
    const omittedAudit = auditsForTarget(booted, item.id);
    expect(omittedAudit).toHaveLength(2); // the create row plus this update
    expect(auditMeta(omittedAudit[1]).changedFields).toEqual(["name"]);

    // A present flag flips it — staff-editable, BOTH directions.
    const tracked = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ tracksStock: true })
      .expect(200);
    expect((tracked.body as CatalogItemDto).tracksStock).toBe(true);

    const untrackedAgain = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ tracksStock: false })
      .expect(200);
    expect((untrackedAgain.body as CatalogItemDto).tracksStock).toBe(false);
    expect(booted.db.tables.catalogItems.get(item.id)?.tracksStock).toBe(false);

    // Each flip names its own field in the trail; no value ever reaches it.
    const flips = auditsForTarget(booted, item.id);
    expect(flips.map((row) => row.action)).toEqual([
      "catalog_item.created",
      "catalog_item.updated",
      "catalog_item.updated",
      "catalog_item.updated",
    ]);
    expect(auditMeta(flips[2]).changedFields).toEqual(["tracksStock"]);
    expect(auditMeta(flips[3]).changedFields).toEqual(["tracksStock"]);
    expect(JSON.stringify(flips[2].metadata)).not.toContain("true");
  });

  it("treats an explicit null pair as a clear and an absent field as untouched", async () => {
    const item = fixture.createItem(fixture.a, {
      referencePriceAmount: "100.00",
      referencePriceCurrency: "PYG",
    });

    // Absent reference-price keys leave the stored pair untouched.
    const untouched = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ name: "Sigue con precio" })
      .expect(200);
    const untouchedBody = untouched.body as CatalogItemDto;
    expect(untouchedBody.referencePriceAmount).toBe("100.00");
    expect(untouchedBody.referencePriceCurrency).toBe("PYG");

    // An explicit null on BOTH keys clears the pair.
    const cleared = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ referencePriceAmount: null, referencePriceCurrency: null })
      .expect(200);
    const clearedBody = cleared.body as CatalogItemDto;
    expect(clearedBody.referencePriceAmount).toBeNull();
    expect(clearedBody.referencePriceCurrency).toBeNull();

    const clearAudit = auditsForTarget(booted, item.id).find(
      (row) => auditMeta(row).changedFields?.length === 2
    );
    expect(clearAudit).toBeDefined();
    if (!clearAudit) throw new Error("the clear update did not append its audit row");
    expect(auditMeta(clearAudit).changedFields).toEqual([
      "referencePriceAmount",
      "referencePriceCurrency",
    ]);

    // Setting the pair again stores both values (PYG is never coerced). The
    // submitted amount is deliberately UNPADDED: the DTO must still report the
    // fixed two-decimal scale, never the caller's spelling.
    const reset = await supertest(booted.app.getHttpServer())
      .put(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .send({ referencePriceAmount: "250.5", referencePriceCurrency: "USD" })
      .expect(200);
    const resetBody = reset.body as CatalogItemDto;
    expect(resetBody.referencePriceAmount).toBe("250.50");
    expect(resetBody.referencePriceCurrency).toBe("USD");
  });

  it("rejects every invalid update and persists nothing", async () => {
    const item = fixture.createItem(fixture.a, {
      kind: "PRODUCT",
      name: "Estado estable",
      taxRateId: SEEDED_TAX_RATE_IDS.IVA_10,
      referencePriceAmount: "100.00",
      referencePriceCurrency: "PYG",
    });
    const itemsBefore = booted.db.tables.catalogItems.size;
    const auditsBefore = booted.db.tables.audits.size;

    const rejected: [string, Record<string, unknown>][] = [
      ["clear the rate", { taxRateId: null }],
      ["malformed rate", { taxRateId: "not-a-uuid" }],
      ["unknown rate", { taxRateId: randomUUID() }],
      ["amount without currency", { referencePriceAmount: "20.00" }],
      ["currency without amount", { referencePriceCurrency: "PYG" }],
      ["clear the amount only", { referencePriceAmount: null }],
      ["clear the currency only", { referencePriceCurrency: null }],
      [
        "clear the amount, set the currency",
        { referencePriceAmount: null, referencePriceCurrency: "PYG" },
      ],
      [
        "set the amount, clear the currency",
        { referencePriceAmount: "20.00", referencePriceCurrency: null },
      ],
      ["malformed currency", { referencePriceAmount: "20.00", referencePriceCurrency: "pyg" }],
      ["unsupported currency", { referencePriceAmount: "20.00", referencePriceCurrency: "ZZZ" }],
      ["negative amount", { referencePriceAmount: "-20.00", referencePriceCurrency: "PYG" }],
      ["unknown kind", { kind: "UNKNOWN" }],
      ["text tracksStock", { tracksStock: "false" }],
      ["null tracksStock", { tracksStock: null }],
      ["client isActive", { isActive: false }],
    ];

    for (const [label, body] of rejected) {
      const response = await supertest(booted.app.getHttpServer())
        .put(`/catalog/${item.id}`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorDto).error.code, label).toBe("VALIDATION_FAILED");
    }

    expect(booted.db.tables.catalogItems.size).toBe(itemsBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);

    // The stored row is exactly what it was before the rejected sweep.
    const stored = booted.db.tables.catalogItems.get(item.id);
    expect(stored).toBeDefined();
    expect(stored?.name).toBe("Estado estable");
    expect(stored?.kind).toBe("PRODUCT");
    expect(stored?.taxRateId).toBe(SEEDED_TAX_RATE_IDS.IVA_10);
    expect(stored?.referencePriceAmount).toBe("100.00");
    expect(stored?.referencePriceCurrency).toBe("PYG");
  });

  it("masks a foreign update as the same 404 as an unknown id and persists nothing", async () => {
    const foreign = fixture.createItem(fixture.b, { name: "Foreign writable" });
    const itemsBefore = booted.db.tables.catalogItems.size;
    const auditsBefore = booted.db.tables.audits.size;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "PUT",
      nonexistentUrl: `/catalog/${randomUUID()}`,
      foreignUrl: `/catalog/${foreign.id}`,
      body: { name: "Masked rename" },
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });

    expect(booted.db.tables.catalogItems.size).toBe(itemsBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    const stored = booted.db.tables.catalogItems.get(foreign.id);
    expect(stored?.name).toBe("Foreign writable");
  });

  it("deactivates idempotently and appends one audit row per accepted command", async () => {
    const item = fixture.createItem(fixture.a, { name: "A desactivar", isActive: true });

    const first = await supertest(booted.app.getHttpServer())
      .post(`/catalog/${item.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);
    const firstBody = first.body as CatalogItemDto;
    expect(firstBody.id).toBe(item.id);
    expect(firstBody.isActive).toBe(false);
    expect(Object.keys(firstBody).sort()).toEqual([...CATALOG_ITEM_RESPONSE_KEYS].sort());

    const afterFirst = auditsForTarget(booted, item.id);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].action).toBe("catalog_item.deactivated");
    expect(afterFirst[0].targetType).toBe("catalog_item");
    expect(auditMeta(afterFirst[0]).changedFields).toEqual(["isActive"]);

    // REPEAT: still accepted, still one MORE co-committed audit row, but the
    // diff is empty because nothing changed on the second call.
    const repeat = await supertest(booted.app.getHttpServer())
      .post(`/catalog/${item.id}/deactivate`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(201);
    expect((repeat.body as CatalogItemDto).isActive).toBe(false);

    const afterRepeat = auditsForTarget(booted, item.id);
    expect(afterRepeat).toHaveLength(2);
    expect(auditMeta(afterRepeat[1]).changedFields).toEqual([]);
  });

  it("masks a foreign deactivation as the same 404 as an unknown id and persists nothing", async () => {
    const foreign = fixture.createItem(fixture.b, { name: "Foreign active", isActive: true });
    const auditsBefore = booted.db.tables.audits.size;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      method: "POST",
      nonexistentUrl: `/catalog/${randomUUID()}/deactivate`,
      foreignUrl: `/catalog/${foreign.id}/deactivate`,
      forbiddenIdentifiers: [foreign.id, fixture.b.tenant.id],
    });

    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    const stored = booted.db.tables.catalogItems.get(foreign.id);
    expect(stored?.isActive).toBe(true);
  });

  it("exposes no delete route anywhere on the catalog surface", async () => {
    const item = fixture.createItem(fixture.a, { name: "No se borra" });

    await supertest(booted.app.getHttpServer())
      .delete(`/catalog/${item.id}`)
      .set("Cookie", fixture.a.actor.cookie)
      .expect(404);

    expect(booted.db.tables.catalogItems.has(item.id)).toBe(true);
  });
});
