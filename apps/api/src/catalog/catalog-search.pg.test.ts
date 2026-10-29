import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { CatalogSearchService } from "./catalog-search.service.js";
import { catalogSearchBody } from "./catalog-search.dto.js";

const url = process.env.CATALOG_SEARCH_TEST_URL;
describe.skipIf(!url)("Catalog search — disposable real PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID(),
    ownId = randomUUID();
  let keys = new Set(["catalog.read"]);
  const service = new CatalogSearchService(prisma, context, {
    resolveForActiveRequest: () => Promise.resolve(keys),
  } as unknown as PermissionResolver);
  function search(body: object = {}) {
    return context.run(randomUUID(), () => {
      context.setUserProfileId(randomUUID());
      context.setTenantMembership({
        tenantId: tenant,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });
      return service.search(catalogSearchBody.parse(body));
    });
  }
  beforeAll(async () => {
    if (!url || !/^\/newsaas_catalog_search_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic catalog tenant", slug: id })),
    });
    const tax = await prisma.taxRate.create({
      data: { code: "SEARCH_TEST_RATE", name: "Synthetic rate name", rate: "5.00" },
    });
    const kinds = ["PRODUCT", "SERVICE", "MEDICATION", "SUPPLY"] as const;
    await prisma.catalogItem.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: i === 0 ? ownId : randomUUID(),
        tenantId: tenant,
        name: i < 20 ? "Repeated Item" : `Catalog ${i}`,
        kind: kinds[i % kinds.length],
        taxRateId: tax.id,
        isActive: i < 23,
        referencePriceAmount: i === 0 ? "999999999999.99" : i === 1 ? "0.00" : null,
        referencePriceCurrency: i === 0 ? "USD" : i === 1 ? "PYG" : null,
        createdAt: new Date(i < 23 ? "2026-10-01T12:00:00Z" : "2026-10-02T12:00:00Z"),
      })),
    });
    await prisma.catalogItem.create({
      data: { tenantId: other, name: "Foreign secret needle", kind: "PRODUCT", taxRateId: tax.id },
    });
  });
  beforeEach(() => {
    keys = new Set(["catalog.read"]);
  });
  afterAll(() => prisma.$disconnect());
  it("bounds pages, counts only tenant and breaks equal names with UUID", async () => {
    const a = await search(),
      b = await search({ page: 2 });
    expect(a).toMatchObject({ total: 23, pageSize: 20, totalPages: 2, page: 1 });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(3);
    const expected = await prisma.catalogItem.findMany({
      where: { tenantId: tenant, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect([...a.items, ...b.items].map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(new Set([...a.items, ...b.items].map((row) => row.id)).size).toBe(23);
    expect(Object.keys(a.items[0]).sort()).toEqual(
      [
        "id",
        "name",
        "kind",
        "isActive",
        "taxRateName",
        "referencePriceAmount",
        "referencePriceCurrency",
      ].sort()
    );
  });
  it("searches names case-insensitively without matching foreign rows or tax names", async () => {
    expect(await search({ q: "rEpEaTeD" })).toMatchObject({ total: 20 });
    expect(await search({ q: "Foreign secret", status: "all" })).toMatchObject({
      total: 0,
      items: [],
    });
    expect(await search({ q: "Synthetic rate" })).toMatchObject({ total: 0, items: [] });
  });
  it.each(["PRODUCT", "SERVICE", "MEDICATION", "SUPPLY"])(
    "filters the real kind %s and counts it",
    async (kind) => {
      const expected = await prisma.catalogItem.count({
        where: {
          tenantId: tenant,
          isActive: true,
          kind: kind as "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY",
        },
      });
      const result = await search({ kind });
      expect(result.total).toBe(expected);
      expect(result.items.every((row) => row.kind === kind && row.isActive)).toBe(true);
    }
  );
  it("combines status/kind, clamps pages and handles empty results", async () => {
    expect(await search({ page: 10000 })).toMatchObject({ page: 2, total: 23 });
    expect(await search({ status: "inactive", kind: "SUPPLY", page: 999 })).toMatchObject({
      total: 1,
      page: 1,
      items: [{ kind: "SUPPLY", isActive: false }],
    });
    expect(await search({ status: "inactive", kind: "SERVICE" })).toMatchObject({
      page: 1,
      totalPages: 0,
      total: 0,
      items: [],
    });
    expect(await search({ status: "all" })).toMatchObject({ total: 25 });
  });
  it("sorts recent creation with UUID ties", async () => {
    const expected = await prisma.catalogItem.findMany({
      where: { tenantId: tenant },
      take: 20,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    expect((await search({ status: "all", sort: "recent" })).items.map((row) => row.id)).toEqual(
      expected.map((row) => row.id)
    );
  });
  it("projects rate name and exact fixed-scale price strings without inventing missing prices", async () => {
    const result = await search({ q: "Repeated" });
    expect(result.items.find((row) => row.id === ownId)).toMatchObject({
      referencePriceAmount: "999999999999.99",
      referencePriceCurrency: "USD",
      taxRateName: "Synthetic rate name",
    });
    expect(
      result.items.some(
        (row) => row.referencePriceAmount === "0.00" && row.referencePriceCurrency === "PYG"
      )
    ).toBe(true);
    expect(
      result.items.some(
        (row) => row.referencePriceAmount === null && row.referencePriceCurrency === null
      )
    ).toBe(true);
  });
  it("reasserts catalog.read in the service", async () => {
    keys.clear();
    await expect(search()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps count and page on one repeatable-read snapshot", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async (work, options) => {
      if (typeof work !== "function") throw new Error("Interactive transaction expected");
      return transaction(
        async (tx) =>
          work(
            new Proxy(tx, {
              get(target, property): unknown {
                if (property !== "catalogItem") return Reflect.get(target, property);
                return new Proxy(target.catalogItem, {
                  get(delegate, key): unknown {
                    if (key !== "count") return Reflect.get(delegate, key);
                    return async (args: { where: { tenantId: string } }) => {
                      const total = await delegate.count(args);
                      await prisma.catalogItem.update({
                        where: { id: ownId },
                        data: { isActive: false },
                      });
                      return total;
                    };
                  },
                });
              },
            })
          ),
        options
      );
    });
    try {
      const result = await search({ q: "Repeated" });
      expect(result.total).toBe(20);
      expect(result.items).toHaveLength(20);
      expect(result.items.find((row) => row.id === ownId)?.isActive).toBe(true);
      expect((await prisma.catalogItem.findUniqueOrThrow({ where: { id: ownId } })).isActive).toBe(
        false
      );
    } finally {
      spy.mockRestore();
    }
  });
});
