import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { TreatmentSearchService } from "./treatment-search.service.js";
import { treatmentSearchBody } from "./treatment-search.dto.js";

const url = process.env.TREATMENT_SEARCH_TEST_URL;
describe.skipIf(!url)("Treatments — disposable real PostgreSQL", () => {
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
  const service = new TreatmentSearchService(
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
    run(() => service.search(patientId, treatmentSearchBody.parse(body)));
  const get = (id: string, patientId = patient) => run(() => service.get(patientId, id));
  beforeAll(async () => {
    if (!url || !/^\/newsaas_treatment_search_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic treatment tenant", slug: id })),
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
    await prisma.clinicalTreatment.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: i === 0 ? ownId : randomUUID(),
        tenantId: tenant,
        patientId: patient,
        description: i < 20 ? "Repeated treatment" : `Old treatment ${i}`,
        context: "Context secret not searchable",
        administeredAt: new Date(i < 20 ? "2026-10-20T12:00:00Z" : "2026-08-01T12:00:00Z"),
      })),
    });
    await prisma.clinicalTreatment.createMany({
      data: [
        {
          id: foreignId,
          tenantId: other,
          patientId: foreignPatient,
          description: "Foreign secret",
          administeredAt: new Date(),
        },
        {
          tenantId: tenant,
          patientId: secondPatient,
          description: "Other patient secret",
          administeredAt: new Date(),
        },
      ],
    });
  });
  beforeEach(() => {
    keys = new Set(["vet.clinical.read"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());

  it("bounds and counts only this patient, including inactive patients, with stable UUID ties", async () => {
    const a = await search(),
      b = await search({ page: 2 });
    expect(a).toMatchObject({ total: 25, pageSize: 20, totalPages: 2, page: 1 });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(5);
    const expected = await prisma.clinicalTreatment.findMany({
      where: { tenantId: tenant, patientId: patient },
      orderBy: [{ administeredAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    expect([...a.items, ...b.items].map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(Object.keys(a.items[0]).sort()).toEqual(["id", "description", "administeredAt"].sort());
  });
  it("searches only descriptions case-insensitively and excludes other patient/tenant/context", async () => {
    expect(await search({ q: "rEpEaTeD" })).toMatchObject({ total: 20 });
    for (const q of ["Foreign secret", "Other patient", "Context secret"])
      expect(await search({ q })).toMatchObject({ items: [], total: 0 });
  });
  it("filters the last 30 rolling days by administration, not creation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    try {
      expect(await search({ period: "last30" })).toMatchObject({ total: 20 });
    } finally {
      vi.useRealTimers();
    }
  });
  it("sorts oldest and clamps out-of-range and empty pages", async () => {
    const expected = await prisma.clinicalTreatment.findMany({
      where: { tenantId: tenant, patientId: patient },
      take: 20,
      orderBy: [{ administeredAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect((await search({ sort: "oldest" })).items.map((r) => r.id)).toEqual(
      expected.map((r) => r.id)
    );
    expect(await search({ page: 10000 })).toMatchObject({ page: 2, total: 25 });
    expect(await search({ q: "Absent", page: 999 })).toMatchObject({
      page: 1,
      totalPages: 0,
      items: [],
    });
  });
  it("returns only allowlisted detail and nullable existing context", async () => {
    expect(await get(ownId)).toEqual({
      version: 1,
      id: ownId,
      description: "Repeated treatment",
      administeredAt: "2026-10-20T12:00:00.000Z",
      context: "Context secret not searchable",
    });
  });
  it("returns identical missing errors for nonexistent, foreign and wrong-patient anchors/records", async () => {
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
  it.each(["permission", "entitlement"])("reasserts %s for search and detail", async (gate) => {
    if (gate === "permission") keys.clear();
    else entitled = false;
    const code = gate === "permission" ? "FORBIDDEN" : "FEATURE_NOT_ENTITLED";
    await expect(search()).rejects.toMatchObject({ code });
    await expect(get(ownId)).rejects.toMatchObject({ code });
  });
  it("keeps count and rows on the same snapshot when a matching treatment is added concurrently", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async (work, options) => {
      if (typeof work !== "function") throw new Error("Interactive transaction expected");
      return transaction(
        async (tx) =>
          work(
            new Proxy(tx, {
              get(target, property): unknown {
                if (property !== "clinicalTreatment") return Reflect.get(target, property);
                return new Proxy(target.clinicalTreatment, {
                  get(delegate, key): unknown {
                    if (key !== "count") return Reflect.get(delegate, key);
                    return async (args: { where: { tenantId: string } }) => {
                      const total = await delegate.count(args);
                      await prisma.clinicalTreatment.create({
                        data: {
                          tenantId: tenant,
                          patientId: patient,
                          description: "Snapshot needle",
                          administeredAt: new Date(),
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
      expect(await search({ q: "Snapshot needle" })).toMatchObject({ total: 0, items: [] });
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.clinicalTreatment.count({
        where: { tenantId: tenant, description: "Snapshot needle" },
      })
    ).toBe(1);
  });
  it("includes both rolling-window boundaries and excludes older and future administration", async () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await prisma.clinicalTreatment.createMany({
      data: [start, now, new Date(start.getTime() - 1), new Date(now.getTime() + 1)].map(
        (administeredAt) => ({
          tenantId: tenant,
          patientId: patient,
          description: "Boundary window",
          administeredAt,
        })
      ),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      expect(await search({ q: "Boundary window", period: "last30" })).toMatchObject({ total: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
