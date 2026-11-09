import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { CATALOG_PERMISSIONS } from "./catalog.permissions.js";
import {
  CatalogRepository,
  type CatalogItemCreateData,
  type CatalogItemDelegate,
  type CatalogItemRow,
  type CatalogItemUpdateData,
} from "./catalog.repository.js";
import { CatalogService, type CatalogPrisma, type CatalogTaxRateRow } from "./catalog.service.js";
import { createCatalogItemBody, updateCatalogItemBody } from "./catalog.zod.js";

const TENANT_ID = randomUUID();
const RATE: CatalogTaxRateRow = { id: randomUUID(), code: "IVA_10", name: "IVA 10%", rate: "10" };

/**
 * FISC-020 T9 (DEC-097): the catalog item's optional SIFEN unit of measure,
 * proven through the REAL service and repository over a fake delegate that
 * stores every column it is handed — so "absent preserves" and "`null`
 * clears" are observed on the persisted row, not on a payload.
 */
function makeService() {
  const rows = new Map<string, CatalogItemRow>();
  const audits: AuditAppendInput[] = [];

  const delegate: CatalogItemDelegate = {
    findFirst: ({ where }) =>
      Promise.resolve(
        [...rows.values()].find((row) => row.id === where.id && row.tenantId === where.tenantId) ??
          null
      ),
    findMany: ({ where }) =>
      Promise.resolve([...rows.values()].filter((row) => row.tenantId === where.tenantId)),
    create: ({ data }: { data: CatalogItemCreateData & { tenantId: string } }) => {
      const now = new Date("2026-11-09T00:00:00Z");
      const created: CatalogItemRow = {
        id: randomUUID(),
        tenantId: data.tenantId,
        kind: data.kind,
        name: data.name,
        taxRateId: data.taxRateId,
        referencePriceAmount: null,
        referencePriceCurrency: null,
        isActive: true,
        tracksStock: data.tracksStock ?? true,
        lowStockThreshold: null,
        // The column has no database default: an omitted key lands NULL.
        unitOfMeasureCode: data.unitOfMeasureCode ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(created.id, created);
      return Promise.resolve(created);
    },
    updateMany: ({
      where,
      data,
    }: {
      where: { id?: string; tenantId?: string };
      data: CatalogItemUpdateData;
    }) => {
      const row = where.id === undefined ? undefined : rows.get(where.id);
      if (!row || row.tenantId !== where.tenantId) return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    },
  };

  const prisma: CatalogPrisma = {
    taxRate: {
      findMany: () => Promise.resolve([RATE]),
      findFirst: ({ where }) => Promise.resolve(where.id === RATE.id ? RATE : null),
    },
    $transaction: (work) =>
      work({
        catalogItem: delegate,
        // The audit writer below is faked, so this delegate is never reached.
        auditLog: { create: vi.fn() },
      }),
  };

  const context = new RequestContextService();
  const permissions = {
    resolveForActiveRequest: () =>
      Promise.resolve(new Set<string>(Object.values(CATALOG_PERMISSIONS))),
  } as unknown as PermissionResolver;
  const audit = {
    append: (input: AuditAppendInput) => {
      audits.push(input);
      return Promise.resolve({ id: randomUUID(), action: input.action });
    },
  } as unknown as AuditWriter;

  const service = new CatalogService(
    new CatalogRepository({ catalogItem: delegate }, context),
    prisma,
    context,
    permissions,
    audit
  );

  function run<T>(work: () => Promise<T>): Promise<T> {
    return context.run(`req-${randomUUID()}`, () => {
      context.setUserProfileId(randomUUID());
      context.setTenantMembership({
        tenantId: TENANT_ID,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });
      return work();
    });
  }

  return { service, rows, audits, run };
}

function createInput(extra: Record<string, unknown> = {}) {
  return createCatalogItemBody.parse({
    kind: "PRODUCT",
    name: "Alimento balanceado",
    taxRateId: RATE.id,
    ...extra,
  });
}

describe("CatalogService — unit of measure (FISC-020 T9)", () => {
  it("persists and returns a declared unit on create", async () => {
    const { service, rows, run } = makeService();

    const created = await run(() => service.create(createInput({ unitOfMeasureCode: "83" })));

    expect(created.unitOfMeasureCode).toBe("83");
    expect(rows.get(created.id)?.unitOfMeasureCode).toBe("83");
    expect((await run(() => service.getItem(created.id))).unitOfMeasureCode).toBe("83");
  });

  it("stores no unit when the create omits it or sends null", async () => {
    const { service, rows, run } = makeService();

    const omitted = await run(() => service.create(createInput()));
    const cleared = await run(() => service.create(createInput({ unitOfMeasureCode: null })));

    expect(omitted.unitOfMeasureCode).toBeNull();
    expect(rows.get(omitted.id)?.unitOfMeasureCode).toBeNull();
    expect(cleared.unitOfMeasureCode).toBeNull();
    expect(rows.get(cleared.id)?.unitOfMeasureCode).toBeNull();
  });

  it("preserves the unit on an update that omits it, changes it, then clears it with null", async () => {
    const { service, rows, audits, run } = makeService();
    const created = await run(() => service.create(createInput({ unitOfMeasureCode: "77" })));

    const renamed = await run(() =>
      service.update(created.id, updateCatalogItemBody.parse({ name: "Renombrado" }))
    );
    expect(renamed.unitOfMeasureCode).toBe("77");
    expect(rows.get(created.id)?.unitOfMeasureCode).toBe("77");

    const changed = await run(() =>
      service.update(created.id, updateCatalogItemBody.parse({ unitOfMeasureCode: "89" }))
    );
    expect(changed.unitOfMeasureCode).toBe("89");

    const cleared = await run(() =>
      service.update(created.id, updateCatalogItemBody.parse({ unitOfMeasureCode: null }))
    );
    expect(cleared.unitOfMeasureCode).toBeNull();
    expect(rows.get(created.id)?.unitOfMeasureCode).toBeNull();

    // The audit names the field and never carries the code itself.
    expect(audits.map((entry) => entry.metadata?.changedFields)).toEqual([
      ["kind", "name", "taxRateId", "unitOfMeasureCode"],
      ["name"],
      ["unitOfMeasureCode"],
      ["unitOfMeasureCode"],
    ]);
    expect(JSON.stringify(audits.map((entry) => entry.metadata))).not.toMatch(/"(77|89)"/);
  });

  it("projects a row read before the column was ever written as an explicit null", async () => {
    const { service, rows, run } = makeService();
    const created = await run(() => service.create(createInput()));
    const legacy = rows.get(created.id);
    if (legacy) delete legacy.unitOfMeasureCode;

    expect((await run(() => service.getItem(created.id))).unitOfMeasureCode).toBeNull();
  });
});

describe("catalog unit of measure contract (FISC-020 T9)", () => {
  it("accepts every code the SIFEN artifact publishes and refuses anything else", () => {
    expect(
      createCatalogItemBody.safeParse(createInput({ unitOfMeasureCode: "2366" })).success
    ).toBe(true);
    for (const code of ["9999", "077", "UNI", "", 77, true, {}]) {
      expect(
        createCatalogItemBody.safeParse({
          kind: "PRODUCT",
          name: "X",
          taxRateId: RATE.id,
          unitOfMeasureCode: code,
        }).success,
        JSON.stringify(code)
      ).toBe(false);
      expect(
        updateCatalogItemBody.safeParse({ unitOfMeasureCode: code }).success,
        JSON.stringify(code)
      ).toBe(false);
    }
  });
});
