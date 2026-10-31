import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { WeightSearchService } from "./weight-search.service.js";
import { weightSearchBody } from "./weight-search.dto.js";

const url = process.env.WEIGHT_SEARCH_TEST_URL;
describe.skipIf(!url)("Weights — disposable real PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID(),
    patient = randomUUID(),
    secondPatient = randomUUID(),
    foreignPatient = randomUUID(),
    ownId = randomUUID(),
    foreignId = randomUUID();
  let keys = new Set(["vet.clinical.read"]),
    entitled = true;
  const service = new WeightSearchService(
    prisma,
    context,
    { has: () => Promise.resolve(entitled) } as unknown as EntitlementsService,
    { resolveForActiveRequest: () => Promise.resolve(keys) } as unknown as PermissionResolver
  );
  function run<T>(work: () => Promise<T>) {
    return context.run(randomUUID(), () => {
      context.setUserProfileId(randomUUID());
      context.setTenantMembership({
        tenantId: tenant,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "OWNER",
      });
      return work();
    });
  }
  const search = (body: object = {}, patientId = patient) =>
    run(() => service.search(patientId, weightSearchBody.parse(body)));
  const get = (id: string, patientId = patient) => run(() => service.get(patientId, id));
  beforeAll(async () => {
    if (!url || !/^\/newsaas_weight_search_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic weight tenant", slug: id })),
    });
    const species = await prisma.species.create({
      data: { code: randomUUID(), name: "Synthetic species" },
    });
    await prisma.patient.createMany({
      data: [patient, secondPatient, foreignPatient].map((id) => ({
        id,
        tenantId: id === foreignPatient ? other : tenant,
        speciesId: species.id,
        name: "Synthetic patient",
        sex: "UNKNOWN" as const,
        isActive: false,
      })),
    });
    await prisma.clinicalWeight.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: i === 0 ? ownId : randomUUID(),
        tenantId: tenant,
        patientId: patient,
        quantity: i === 0 ? "9999999.999" : i === 1 ? "0.001" : i === 2 ? "12.345" : String(i + 1),
        measuredAt: new Date(i < 20 ? "2026-10-20T12:00:00Z" : "2026-08-01T12:00:00Z"),
      })),
    });
    await prisma.clinicalWeight.createMany({
      data: [
        {
          id: foreignId,
          tenantId: other,
          patientId: foreignPatient,
          quantity: "0.002",
          measuredAt: new Date(),
        },
        { tenantId: tenant, patientId: secondPatient, quantity: "0.003", measuredAt: new Date() },
      ],
    });
  });
  beforeEach(() => {
    keys = new Set(["vet.clinical.read"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());
  it("bounds and counts this patient's history, including inactive patients, with stable UUID ties", async () => {
    const a = await search(),
      b = await search({ page: 2 });
    expect(a).toMatchObject({ total: 25, pageSize: 20, totalPages: 2, page: 1 });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(5);
    const expected = await prisma.clinicalWeight.findMany({
      where: { tenantId: tenant, patientId: patient },
      orderBy: [{ measuredAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    expect([...a.items, ...b.items].map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(Object.keys(a.items[0]).sort()).toEqual(["id", "quantity", "measuredAt", "unit"].sort());
  });
  it("compares inclusive exact decimal bounds and excludes other patient/tenant values", async () => {
    for (const quantity of ["0.001", "12.345", "9999999.999"])
      expect(await search({ minQuantity: quantity, maxQuantity: quantity })).toMatchObject({
        total: 1,
        items: [{ quantity }],
      });
    for (const quantity of ["0.002", "0.003"])
      expect(await search({ minQuantity: quantity, maxQuantity: quantity })).toMatchObject({
        total: 0,
        items: [],
      });
    expect(await search({ maxQuantity: "0.001" })).toMatchObject({ total: 1 });
    expect(await search({ minQuantity: "9999999.998" })).toMatchObject({ total: 1 });
  });
  it("combines range and rolling period using measurement rather than creation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    try {
      expect(await search({ period: "last30" })).toMatchObject({ total: 20 });
      expect(await search({ period: "last30", minQuantity: "21" })).toMatchObject({ total: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
  it("sorts oldest, clamps pages and represents empty results", async () => {
    const expected = await prisma.clinicalWeight.findMany({
      where: { tenantId: tenant, patientId: patient },
      take: 20,
      orderBy: [{ measuredAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect((await search({ sort: "oldest" })).items.map((r) => r.id)).toEqual(
      expected.map((r) => r.id)
    );
    expect(await search({ page: 10000 })).toMatchObject({ page: 2, total: 25 });
    expect(await search({ minQuantity: "0.002", maxQuantity: "0.002", page: 999 })).toMatchObject({
      page: 1,
      totalPages: 0,
      items: [],
    });
  });
  it("serializes the exact stored scale and does not invent a unit", async () => {
    expect(await get(ownId)).toEqual({
      version: 1,
      id: ownId,
      quantity: "9999999.999",
      unit: null,
      measuredAt: "2026-10-20T12:00:00.000Z",
    });
    expect((await search({ minQuantity: "4", maxQuantity: "4" })).items[0].quantity).toBe("4.000");
  });
  it("gives identical missing errors for foreign, nonexistent and wrong-patient references", async () => {
    for (const p of [randomUUID(), foreignPatient])
      await expect(search({}, p)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Clinical record was not found.",
      });
    for (const [p, id] of [
      [patient, randomUUID()],
      [patient, foreignId],
      [foreignPatient, foreignId],
      [secondPatient, ownId],
    ])
      await expect(get(id, p)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Clinical record was not found.",
      });
  });
  it.each(["permission", "entitlement"])("reasserts %s on both reads", async (gate) => {
    if (gate === "permission") keys.clear();
    else entitled = false;
    const code = gate === "permission" ? "FORBIDDEN" : "FEATURE_NOT_ENTITLED";
    await expect(search()).rejects.toMatchObject({ code });
    await expect(get(ownId)).rejects.toMatchObject({ code });
  });
  it("keeps count and rows on one snapshot despite a concurrent matching insert", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async (work, options) => {
      if (typeof work !== "function") throw new Error("Interactive transaction expected");
      return transaction(
        async (tx) =>
          work(
            new Proxy(tx, {
              get(target, property): unknown {
                if (property !== "clinicalWeight") return Reflect.get(target, property);
                return new Proxy(target.clinicalWeight, {
                  get(delegate, key): unknown {
                    if (key !== "count") return Reflect.get(delegate, key);
                    return async (args: { where: { tenantId: string } }) => {
                      const total = await delegate.count(args);
                      await prisma.clinicalWeight.create({
                        data: {
                          tenantId: tenant,
                          patientId: patient,
                          quantity: "9999999.998",
                          measuredAt: new Date(),
                        },
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
      expect(
        await search({ minQuantity: "9999999.998", maxQuantity: "9999999.998" })
      ).toMatchObject({ total: 0, items: [] });
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.clinicalWeight.count({ where: { tenantId: tenant, quantity: "9999999.998" } })
    ).toBe(1);
  });
  it("includes both window boundaries and excludes older/future measurements", async () => {
    const now = new Date("2026-10-30T12:00:00Z"),
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await prisma.clinicalWeight.createMany({
      data: [start, now, new Date(start.getTime() - 1), new Date(now.getTime() + 1)].map(
        (measuredAt) => ({ tenantId: tenant, patientId: patient, quantity: "7777.777", measuredAt })
      ),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      expect(
        await search({ minQuantity: "7777.777", maxQuantity: "7777.777", period: "last30" })
      ).toMatchObject({ total: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
