import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { CustomerSearchService } from "./customer-search.service.js";
import { customerSearchBody } from "./customer-search.dto.js";

const url = process.env.CUSTOMER_SEARCH_TEST_URL;
describe.skipIf(!url)("Customer search — disposable real PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID(),
    ownId = randomUUID();
  let keys = new Set(["customers.read"]);
  const service = new CustomerSearchService(prisma, context, {
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
      return service.search(customerSearchBody.parse(body));
    });
  }
  beforeAll(async () => {
    if (!url || !/^\/newsaas_customer_search_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic customer tenant", slug: id })),
    });
    await prisma.customer.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: i === 0 ? ownId : randomUUID(),
        tenantId: tenant,
        kind: i < 20 ? ("INDIVIDUAL" as const) : ("COMPANY" as const),
        displayName: i < 20 ? "Repeated Customer" : `Company ${i}`,
        firstName: i < 20 ? "Synthetic" : null,
        lastName: i < 20 ? `Person ${i}` : null,
        documentNumber: i < 20 ? `CI-${String(i).padStart(4, "0")}` : null,
        legalName: i >= 20 ? `Empresa ${i}` : null,
        taxId: i >= 20 ? `80000${i}-0` : null,
        isActive: i < 23,
        createdAt: new Date(i < 23 ? "2026-10-01T12:00:00Z" : "2026-10-02T12:00:00Z"),
      })),
    });
    await prisma.customer.create({
      data: {
        tenantId: other,
        kind: "INDIVIDUAL",
        displayName: "Foreign needle",
        documentNumber: "FOREIGN-DOC",
      },
    });
    await prisma.customerContact.create({
      data: {
        tenantId: tenant,
        customerId: ownId,
        kind: "EMAIL",
        value: "contact-only@example.test",
      },
    });
  });
  beforeEach(() => {
    keys = new Set(["customers.read"]);
  });
  afterAll(() => prisma.$disconnect());
  it("bounds pages and counts only the current tenant with stable name ties", async () => {
    const a = await search(),
      b = await search({ page: 2 });
    expect(a).toMatchObject({ total: 23, pageSize: 20, totalPages: 2, page: 1 });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(3);
    const expected = await prisma.customer.findMany({
      where: { tenantId: tenant, isActive: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect([...a.items, ...b.items].map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(new Set([...a.items, ...b.items].map((row) => row.id)).size).toBe(23);
    expect(Object.keys(a.items[0]).sort()).toEqual(
      ["id", "displayName", "kind", "isActive", "firstName", "lastName", "legalName"].sort()
    );
  });
  it.each([
    ["rEpEaTeD", 20],
    ["eMpReSa 22", 1],
    ["ci-0019", 1],
    ["8000022-0", 1],
  ])("searches the existing identity field %s without exposing identifiers", async (q, total) => {
    const result = await search({ q });
    expect(result.total).toBe(total);
    expect(JSON.stringify(result.items)).not.toContain("CI-0019");
    expect(JSON.stringify(result.items)).not.toContain("8000022-0");
  });
  it("isolates all OR branches and does not search child contact values", async () => {
    expect(await search({ q: "Foreign needle", status: "all" })).toMatchObject({
      total: 0,
      items: [],
    });
    expect(await search({ q: "FOREIGN-DOC", status: "all" })).toMatchObject({
      total: 0,
      items: [],
    });
    expect(await search({ q: "contact-only" })).toMatchObject({ total: 0, items: [] });
  });
  it("combines status and kind filters with an exact count", async () => {
    expect(await search({ kind: "COMPANY" })).toMatchObject({ total: 3 });
    expect(await search({ status: "inactive", kind: "COMPANY" })).toMatchObject({
      total: 2,
      items: [
        { kind: "COMPANY", isActive: false },
        { kind: "COMPANY", isActive: false },
      ],
    });
    expect(await search({ status: "all", kind: "INDIVIDUAL" })).toMatchObject({ total: 20 });
    expect(await search({ status: "all" })).toMatchObject({ total: 25 });
  });
  it("clamps pages after filtering and handles no results", async () => {
    expect(await search({ page: 10000 })).toMatchObject({ page: 2, total: 23 });
    expect(await search({ page: 10000, status: "inactive", kind: "INDIVIDUAL" })).toMatchObject({
      page: 1,
      totalPages: 0,
      total: 0,
      items: [],
    });
  });
  it("sorts recent creation with a UUID tiebreaker", async () => {
    const expected = await prisma.customer.findMany({
      where: { tenantId: tenant },
      take: 20,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    expect((await search({ status: "all", sort: "recent" })).items.map((row) => row.id)).toEqual(
      expected.map((row) => row.id)
    );
  });
  it("reasserts customers.read in the service", async () => {
    keys.clear();
    await expect(search()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps count and rows on one repeatable-read snapshot", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async (work, options) => {
      if (typeof work !== "function") throw new Error("Interactive transaction expected");
      return transaction(
        async (tx) =>
          work(
            new Proxy(tx, {
              get(target, property): unknown {
                if (property !== "customer") return Reflect.get(target, property);
                return new Proxy(target.customer, {
                  get(delegate, key): unknown {
                    if (key !== "count") return Reflect.get(delegate, key);
                    return async (args: { where: { tenantId: string } }) => {
                      const total = await delegate.count(args);
                      await prisma.customer.update({
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
      const result = await search({ q: "CI-0000" });
      expect(result).toMatchObject({ total: 1, items: [{ id: ownId, isActive: true }] });
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: ownId } })).isActive).toBe(
        false
      );
    } finally {
      spy.mockRestore();
    }
  });
});
