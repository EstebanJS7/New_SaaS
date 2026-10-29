import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { PatientSearchService } from "./patient-search.service.js";
import { patientSearchBody } from "./patient-search.dto.js";

const url = process.env.PATIENT_SEARCH_TEST_URL;
describe.skipIf(!url)("Patient search — real PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID();
  let keys = new Set(["patients.read", "customers.read"]),
    entitled = true;
  const service = new PatientSearchService(
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
      return service.search(patientSearchBody.parse(body));
    });
  }
  beforeAll(async () => {
    if (!url || !/^\/newsaas_patient_search_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic search tenant", slug: id })),
    });
    const species = await prisma.species.create({
      data: { code: randomUUID(), name: "Synthetic species" },
    });
    const customer = await prisma.customer.create({
      data: { tenantId: tenant, kind: "INDIVIDUAL", displayName: "Responsible needle" },
    });
    const foreign = await prisma.customer.create({
      data: { tenantId: other, kind: "INDIVIDUAL", displayName: "Foreign needle" },
    });
    for (let i = 0; i < 28; i++) {
      const own = i < 24;
      await prisma.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            tenantId: own ? tenant : other,
            name: own ? `Patient ${String(i).padStart(2, "0")}` : "Foreign needle",
            speciesId: species.id,
            sex: "UNKNOWN",
            isActive: false,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          },
        });
        await tx.patientGuardian.create({
          data: {
            tenantId: own ? tenant : other,
            patientId: patient.id,
            customerId: own ? customer.id : foreign.id,
            isActive: true,
            isPrimary: true,
          },
        });
        if (i < 22 || !own)
          await tx.patient.update({ where: { id: patient.id }, data: { isActive: true } });
      });
    }
    // A secondary name must not broaden primary-guardian search.
    const secondary = await prisma.customer.create({
      data: { tenantId: tenant, kind: "INDIVIDUAL", displayName: "Secondary secret" },
    });
    const first = await prisma.patient.findFirstOrThrow({
      where: { tenantId: tenant },
      orderBy: { name: "asc" },
    });
    await prisma.patientGuardian.create({
      data: { tenantId: tenant, patientId: first.id, customerId: secondary.id },
    });
  });
  beforeEach(() => {
    keys = new Set(["patients.read", "customers.read"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());
  it("pages and counts only the current tenant, without duplicate rows", async () => {
    const a = await search(),
      b = await search({ page: 2 });
    expect(a).toMatchObject({ total: 22, pageSize: 20, totalPages: 2, page: 1 });
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(2);
    expect(new Set([...a.items, ...b.items].map((row) => row.id)).size).toBe(22);
    expect(a.items.every((row) => row.name.startsWith("Patient"))).toBe(true);
    expect(Object.keys(a.items[0]).sort()).toEqual(
      ["id", "name", "isActive", "sex", "speciesName", "breedName", "primaryGuardianName"].sort()
    );
  });
  it("searches names case-insensitively and counts the exact filter", async () => {
    expect(await search({ q: "pAtIeNt 21" })).toMatchObject({
      total: 1,
      items: [{ name: "Patient 21" }],
    });
    expect(await search({ q: "Responsible" })).toMatchObject({ total: 22 });
    expect(await search({ q: "Foreign needle", status: "all" })).toMatchObject({
      total: 0,
      items: [],
    });
    expect(await search({ q: "Secondary secret" })).toMatchObject({ total: 0 });
  });
  it("filters lifecycle and returns stable recent/name order", async () => {
    expect(await search({ status: "inactive" })).toMatchObject({ total: 2 });
    expect(await search({ status: "all" })).toMatchObject({ total: 24 });
    const recent = await search({ sort: "recent" });
    expect(recent.items[0]?.name).toBe("Patient 21");
    const alpha = await search();
    expect(alpha.items[0]?.name).toBe("Patient 00");
    expect((await search()).items.map((row) => row.id)).toEqual(alpha.items.map((row) => row.id));
  });
  it("clamps an out-of-range page and handles an empty result", async () => {
    expect(await search({ page: 999 })).toMatchObject({ page: 2, total: 22 });
    expect(await search({ q: "not present", page: 999 })).toMatchObject({
      page: 1,
      total: 0,
      totalPages: 0,
      items: [],
    });
  });
  it("supports patient-only permission without disclosing guardian matches or names", async () => {
    keys.delete("customers.read");
    const result = await search();
    expect(result.total).toBe(22);
    expect(result.canReadGuardians).toBe(false);
    expect(result.items.every((row) => row.primaryGuardianName === null)).toBe(true);
    expect((await search({ q: "Responsible needle" })).total).toBe(0);
    expect((await search({ q: "Patient 21" })).total).toBe(1);
  });
  it("rejects missing patient permission and veterinary entitlement", async () => {
    keys.delete("patients.read");
    await expect(search()).rejects.toMatchObject({ code: "FORBIDDEN" });
    keys.add("patients.read");
    entitled = false;
    await expect(search()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
  });
  it("does not match inactive primary customers", async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { tenantId: tenant, displayName: "Responsible needle" },
    });
    await prisma.customer.update({ where: { id: customer.id }, data: { isActive: false } });
    try {
      expect((await search({ q: "Responsible needle" })).total).toBe(0);
      expect((await search()).items.every((row) => row.primaryGuardianName === null)).toBe(true);
    } finally {
      await prisma.customer.update({ where: { id: customer.id }, data: { isActive: true } });
    }
  });
});
