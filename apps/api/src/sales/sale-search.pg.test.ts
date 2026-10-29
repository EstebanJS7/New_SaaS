import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { SaleSearchService } from "./sale-search.service.js";
import { saleSearchBody } from "./sale-search.dto.js";

const url = process.env.SALE_SEARCH_TEST_URL;
describe.skipIf(!url)("Sale search — disposable real PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID();
  const ownId = randomUUID(),
    foreignId = randomUUID();
  let keys = new Set(["sales.read", "customers.read"]),
    entitled = true;
  const service = new SaleSearchService(
    prisma,
    context,
    { has: () => Promise.resolve(entitled) } as unknown as EntitlementsService,
    { resolveForActiveRequest: () => Promise.resolve(keys) } as unknown as PermissionResolver
  );
  function search(body: object = {}) {
    return context.run(randomUUID(), () => {
      context.setUserProfileId(randomUUID());
      context.setTenantMembership({
        tenantId: tenant,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });
      return service.search(saleSearchBody.parse(body));
    });
  }
  beforeAll(async () => {
    if (!url || !/^\/newsaas_sale_search_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic sales tenant", slug: id })),
    });
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant,
        kind: "INDIVIDUAL",
        displayName: "Synthetic customer needle",
        isActive: false,
      },
    });
    const foreign = await prisma.customer.create({
      data: { tenantId: other, kind: "INDIVIDUAL", displayName: "Foreign confidential" },
    });
    // Synthetic headers only in the disposable database: no completion, payment or ledger command.
    await prisma.sale.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: i === 0 ? ownId : randomUUID(),
        tenantId: tenant,
        currency: "PYG",
        customerId: i < 22 ? customer.id : null,
        status: i === 24 ? ("CANCELLED" as const) : ("DRAFT" as const),
        createdAt: new Date(i < 22 ? "2026-10-01T12:00:00Z" : "2026-10-02T12:00:00Z"),
      })),
    });
    await prisma.sale.create({
      data: { id: foreignId, tenantId: other, customerId: foreign.id, currency: "PYG" },
    });
  });
  beforeEach(() => {
    keys = new Set(["sales.read", "customers.read"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());
  it("bounds pages, counts only the tenant and breaks equal timestamps by UUID", async () => {
    const first = await search(),
      second = await search({ page: 2 });
    expect(first).toMatchObject({ total: 25, pageSize: 20, totalPages: 2, page: 1 });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    const expected = await prisma.sale.findMany({
      where: { tenantId: tenant },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
      expected.map((row) => row.id)
    );
    expect(first.items.some((row) => row.id === foreignId)).toBe(false);
    expect(Object.keys(first.items[0]).sort()).toEqual(
      ["id", "status", "createdAt", "customerName", "hasCustomer"].sort()
    );
  });
  it("searches inactive associated customers case-insensitively and counts the filter", async () => {
    expect(await search({ q: "CUSTOMER needle" })).toMatchObject({ total: 22, totalPages: 2 });
    expect(await search({ q: "Foreign confidential" })).toMatchObject({ total: 0, items: [] });
  });
  it("finds exact UUIDs and never exposes foreign UUIDs", async () => {
    expect(await search({ q: ownId.toUpperCase() })).toMatchObject({
      total: 1,
      items: [{ id: ownId }],
    });
    expect(await search({ q: foreignId })).toMatchObject({ total: 0, items: [] });
  });
  it("without customer permission searches only UUID and omits all names", async () => {
    keys = new Set(["sales.read"]);
    expect(await search({ q: "Synthetic customer needle" })).toMatchObject({ total: 0 });
    expect(await search({ q: ownId })).toMatchObject({
      total: 1,
      canReadCustomers: false,
      items: [{ customerName: null }],
    });
    expect((await search()).items.every((row) => row.customerName === null)).toBe(true);
  });
  it("filters actual lifecycle states and clamps an out-of-range page", async () => {
    expect(await search({ status: "CANCELLED", page: 999 })).toMatchObject({
      total: 1,
      page: 1,
      items: [{ status: "CANCELLED", hasCustomer: false }],
    });
    expect(await search({ status: "COMPLETED", page: 999 })).toMatchObject({
      total: 0,
      totalPages: 0,
      page: 1,
    });
    expect(await search({ status: "DRAFT" })).toMatchObject({ total: 24 });
  });
  it("supports oldest creation order with a stable UUID tiebreaker", async () => {
    const expected = await prisma.sale.findMany({
      where: { tenantId: tenant },
      take: 20,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect((await search({ sort: "oldest" })).items.map((row) => row.id)).toEqual(
      expected.map((row) => row.id)
    );
  });
  it("reasserts entitlement before permission", async () => {
    entitled = false;
    keys.clear();
    await expect(search()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
    entitled = true;
    await expect(search()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("uses one repeatable-read snapshot for count and rows", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let changed = false;
    // Update between count and findMany on another connection, inside this disposable DB only.
    const { vi } = await import("vitest");
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async (work, options) => {
      if (typeof work !== "function") throw new Error("Interactive transaction expected");
      return transaction(async (tx) => {
        return work(
          new Proxy(tx, {
            get(target, property): unknown {
              if (property !== "sale") return Reflect.get(target, property);
              return new Proxy(target.sale, {
                get(delegate, key): unknown {
                  if (key !== "count") return Reflect.get(delegate, key);
                  return async (args: { where: { tenantId: string } }) => {
                    const total = await delegate.count(args);
                    await prisma.sale.update({
                      where: { id: ownId },
                      data: { status: "CANCELLED" },
                    });
                    changed = true;
                    return total;
                  };
                },
              });
            },
          })
        );
      }, options);
    });
    try {
      const result = await search({ q: ownId, status: "DRAFT" });
      expect(changed).toBe(true);
      expect(result).toMatchObject({ total: 1, items: [{ id: ownId, status: "DRAFT" }] });
    } finally {
      spy.mockRestore();
    }
  });
});
