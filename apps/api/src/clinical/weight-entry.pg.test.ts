import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { ClinicalRecordsService, type ClinicalRecordsPrisma } from "./clinical.records.service.js";
import { createWeightBody } from "./clinical.zod.js";
import { WeightSearchService } from "./weight-search.service.js";
import { weightSearchBody } from "./weight-search.dto.js";

const url = process.env.WEIGHT_ENTRY_TEST_URL;
describe.skipIf(!url)("Weight commands — disposable PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } }),
    context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID(),
    patient = randomUUID(),
    otherPatient = randomUUID(),
    secondPatient = randomUUID(),
    actor = randomUUID();
  let keys = new Set(["vet.clinical.create", "vet.clinical.update", "vet.clinical.read"]),
    entitled = true;
  // AuditWriter's narrow JSON-agnostic append contract wraps the real Prisma delegate.
  const audit = new AuditWriter(
    prisma as unknown as ConstructorParameters<typeof AuditWriter>[0],
    context
  );
  const service = new ClinicalRecordsService(
    prisma as unknown as ClinicalRecordsPrisma,
    context,
    { has: () => Promise.resolve(entitled) } as unknown as EntitlementsService,
    { resolveForActiveRequest: () => Promise.resolve(keys) } as unknown as PermissionResolver,
    audit
  );
  const reads = new WeightSearchService(
    prisma,
    context,
    { has: () => Promise.resolve(entitled) } as unknown as EntitlementsService,
    { resolveForActiveRequest: () => Promise.resolve(keys) } as unknown as PermissionResolver
  );
  const input = { quantity: "12.345", unit: "KG" as const, measuredAt: "2026-10-20T15:00:42.123Z" };
  function run<T>(work: () => Promise<T>) {
    return context.run(randomUUID(), () => {
      context.setUserProfileId(actor);
      context.setTenantMembership({
        tenantId: tenant,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "VETERINARIAN",
      });
      return work();
    });
  }
  const create = (patientId = patient) => run(() => service.createWeight(patientId, input));
  beforeAll(async () => {
    if (!url || !/^\/newsaas_weight_entry_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw new Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, other].map((id) => ({ id, name: "Synthetic entry tenant", slug: id })),
    });
    await prisma.userProfile.create({
      data: {
        id: actor,
        email: `${actor}@example.invalid`,
        displayName: "Synthetic actor",
        status: "ACTIVE",
      },
    });
    const species = await prisma.species.create({
      data: { code: randomUUID(), name: "Synthetic species" },
    });
    for (const id of [patient, secondPatient, otherPatient]) {
      const tenantId = id === otherPatient ? other : tenant;
      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: { tenantId, kind: "INDIVIDUAL", displayName: "Synthetic guardian" },
        });
        await tx.patient.create({
          data: {
            id,
            tenantId,
            name: "Synthetic patient",
            speciesId: species.id,
            sex: "UNKNOWN",
            isActive: false,
          },
        });
        await tx.patientGuardian.create({
          data: {
            tenantId,
            patientId: id,
            customerId: customer.id,
            isPrimary: true,
            isActive: true,
          },
        });
        await tx.patient.update({ where: { id }, data: { isActive: true } });
      });
    }
  });
  beforeEach(() => {
    keys = new Set(["vet.clinical.create", "vet.clinical.update", "vet.clinical.read"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());
  it("keeps a nullable unit with no database default and legacy output shape", async () => {
    const row = await run(() =>
      service.createWeight(patient, { quantity: "0.125", measuredAt: input.measuredAt })
    );
    expect(row).not.toHaveProperty("unit");
    expect((await run(() => reads.get(patient, row.id))).unit).toBeNull();
    const columns = await prisma.$queryRaw<
      { column_default: string | null; is_nullable: string }[]
    >`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'clinical_weight' AND column_name = 'unit'`;
    expect(columns).toEqual([{ column_default: null, is_nullable: "YES" }]);
  });
  it("confirms KG on an unknown value explicitly, preserving exact quantity and timestamp with one audit", async () => {
    const row = await run(() =>
      service.createWeight(patient, { quantity: "0.125", measuredAt: input.measuredAt })
    );
    await run(() => service.updateWeight(patient, row.id, { unit: "KG" }));
    expect(await run(() => reads.get(patient, row.id))).toEqual({
      id: row.id,
      quantity: "0.125",
      measuredAt: input.measuredAt,
      unit: "KG",
    });
    const logs = await prisma.auditLog.findMany({
      where: { targetId: row.id, action: "clinical_weight.updated" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toMatchObject({ changedFields: ["unit"] });
  });
  it("does not silently attach KG to an unqualified legacy quantity correction", async () => {
    const row = await create();
    await run(() => service.updateWeight(patient, row.id, { measuredAt: "2026-10-21T15:00:00Z" }));
    expect((await run(() => reads.get(patient, row.id))).unit).toBe("KG");
    await run(() => service.updateWeight(patient, row.id, { quantity: "0.001" }));
    expect(await run(() => reads.get(patient, row.id))).toMatchObject({
      quantity: "0.001",
      unit: null,
    });
  });
  it("validates unit and precision at HTTP schema and direct service boundaries without rounding", async () => {
    expect(createWeightBody.parse({ ...input, quantity: "9999999.999" }).unit).toBe("KG");
    for (const quantity of ["0", "-1", "0.0001", "10000000", "NaN", "1e2"]) {
      expect(() => createWeightBody.parse({ ...input, quantity })).toThrow();
      await expect(
        run(() => service.createWeight(patient, { ...input, quantity }))
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    for (const unit of ["LB", null])
      expect(() => createWeightBody.parse({ ...input, unit })).toThrow();
  });
  it("filters KG and unspecified values separately, preserving legacy unqualified ranges", async () => {
    const known = await run(() => service.createWeight(patient, { ...input, quantity: "777.123" }));
    const unknown = await run(() =>
      service.createWeight(patient, { quantity: "777.123", measuredAt: input.measuredAt })
    );
    const search = (body: object) => run(() => reads.search(patient, weightSearchBody.parse(body)));
    expect(
      (await search({ unit: "KG", minQuantity: "777.123", maxQuantity: "777.123" })).items.map(
        (r) => r.id
      )
    ).toEqual([known.id]);
    expect(
      (await search({ minQuantity: "777.123", maxQuantity: "777.123" })).items.map((r) => r.id)
    ).toEqual([unknown.id]);
    expect(
      (
        await search({ unit: "unspecified", minQuantity: "777.123", maxQuantity: "777.123" })
      ).items.map((r) => r.id)
    ).toEqual([unknown.id]);
    expect(() => weightSearchBody.parse({ unit: "all", minQuantity: "1" })).toThrow();
  });
  it("creates one weight with one atomic sanitized actor audit", async () => {
    const row = await create();
    expect(row).toMatchObject({
      tenantId: tenant,
      patientId: patient,
      quantity: input.quantity,
      measuredAt: input.measuredAt,
    });
    expect(row).not.toHaveProperty("unit");
    expect((await prisma.clinicalWeight.findUniqueOrThrow({ where: { id: row.id } })).unit).toBe(
      "KG"
    );
    const rows = await prisma.auditLog.findMany({ where: { targetId: row.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "clinical_weight.created",
      actorUserProfileId: actor,
      tenantId: tenant,
      targetType: "clinical_weight",
    });
    expect(rows[0].requestId).toBeTruthy();
    expect(JSON.stringify(rows[0].metadata)).not.toContain(input.quantity);
  });
  it("updates only supplied fields, preserving precise measurement date", async () => {
    const row = await create();
    const updated = await run(() =>
      service.updateWeight(patient, row.id, { quantity: "0.125", unit: "KG" })
    );
    expect(updated).toMatchObject({
      quantity: "0.125",
      measuredAt: input.measuredAt,
    });
    const audit = await prisma.auditLog.findMany({
      where: { targetId: row.id, action: "clinical_weight.updated" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ changedFields: ["quantity", "unit"] });
  });
  it("does not audit or mutate an empty update", async () => {
    const row = await create();
    expect(await run(() => service.updateWeight(patient, row.id, {}))).toEqual(row);
    expect(await prisma.auditLog.count({ where: { targetId: row.id } })).toBe(1);
  });
  it("isolates create anchors and update records/patients without audit side effects", async () => {
    const row = await create();
    const foreign = await prisma.clinicalWeight.create({
      data: {
        tenantId: other,
        patientId: otherPatient,
        ...input,
        measuredAt: new Date(input.measuredAt),
      },
    });
    const count = await prisma.auditLog.count();
    for (const p of [otherPatient, randomUUID()])
      await expect(create(p)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const [p, id] of [
      [patient, foreign.id],
      [secondPatient, row.id],
      [otherPatient, foreign.id],
      [patient, randomUUID()],
    ])
      await expect(
        run(() => service.updateWeight(p, id, { quantity: "0.125", unit: "KG" }))
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.auditLog.count()).toBe(count);
    expect(
      (await prisma.clinicalWeight.findUniqueOrThrow({ where: { id: row.id } })).quantity.toString()
    ).toBe(input.quantity);
  });
  it("distinguishes create and update permission and entitlement", async () => {
    const row = await create();
    keys = new Set(["vet.clinical.read"]);
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(() => service.updateWeight(patient, row.id, { unit: "KG" }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    keys = new Set(["vet.clinical.create"]);
    await expect(
      run(() => service.updateWeight(patient, row.id, { unit: "KG" }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    keys = new Set(["vet.clinical.update"]);
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    entitled = false;
    await expect(create()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
    await expect(
      run(() => service.updateWeight(patient, row.id, { unit: "KG" }))
    ).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
  });
  it("rolls back create when audit append fails", async () => {
    const count = await prisma.clinicalWeight.count();
    const spy = vi.spyOn(audit, "append").mockRejectedValue(new Error("Synthetic audit failure"));
    try {
      await expect(create()).rejects.toThrow("Synthetic audit failure");
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.clinicalWeight.count()).toBe(count);
  });
  it("rolls back correction when audit append fails", async () => {
    const row = await create(),
      count = await prisma.auditLog.count();
    const spy = vi.spyOn(audit, "append").mockRejectedValue(new Error("Synthetic audit failure"));
    try {
      await expect(
        run(() => service.updateWeight(patient, row.id, { quantity: "0.125", unit: "KG" }))
      ).rejects.toThrow("Synthetic audit failure");
    } finally {
      spy.mockRestore();
    }
    expect(
      (await prisma.clinicalWeight.findUniqueOrThrow({ where: { id: row.id } })).quantity.toString()
    ).toBe(input.quantity);
    expect(await prisma.auditLog.count()).toBe(count);
  });
});
