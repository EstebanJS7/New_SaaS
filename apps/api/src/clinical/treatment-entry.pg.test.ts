import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { ClinicalRecordsService, type ClinicalRecordsPrisma } from "./clinical.records.service.js";

const url = process.env.TREATMENT_ENTRY_TEST_URL;
describe.skipIf(!url)("Treatment commands — disposable PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } }),
    context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID(),
    patient = randomUUID(),
    otherPatient = randomUUID(),
    secondPatient = randomUUID(),
    actor = randomUUID();
  let keys = new Set(["vet.clinical.create", "vet.clinical.update"]),
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
  const input = {
    description: "Synthetic private treatment",
    administeredAt: "2026-10-20T15:00:42.123Z",
    context: "Synthetic private context",
  };
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
  const create = (patientId = patient) => run(() => service.createTreatment(patientId, input));
  beforeAll(async () => {
    if (!url || !/^\/newsaas_treatment_entry_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
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
    keys = new Set(["vet.clinical.create", "vet.clinical.update"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());
  it("creates one treatment with one atomic sanitized actor audit", async () => {
    const row = await create();
    expect(row).toMatchObject({ tenantId: tenant, patientId: patient, ...input });
    const rows = await prisma.auditLog.findMany({ where: { targetId: row.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "clinical_treatment.created",
      actorUserProfileId: actor,
      tenantId: tenant,
      targetType: "clinical_treatment",
    });
    expect(rows[0].requestId).toBeTruthy();
    expect(JSON.stringify(rows[0].metadata)).not.toContain(input.description);
    expect(JSON.stringify(rows[0].metadata)).not.toContain(input.context);
  });
  it("updates only supplied fields, preserving precise date and unrelated context", async () => {
    const row = await create();
    const updated = await run(() =>
      service.updateTreatment(patient, row.id, { description: "Corrected synthetic treatment" })
    );
    expect(updated).toMatchObject({
      description: "Corrected synthetic treatment",
      administeredAt: input.administeredAt,
      context: input.context,
    });
    const audit = await prisma.auditLog.findMany({
      where: { targetId: row.id, action: "clinical_treatment.updated" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ changedFields: ["description"] });
  });
  it("clears context explicitly with null without changing other fields", async () => {
    const row = await create();
    const updated = await run(() => service.updateTreatment(patient, row.id, { context: null }));
    expect(updated).toMatchObject({
      context: null,
      description: input.description,
      administeredAt: input.administeredAt,
    });
    expect(
      await prisma.auditLog.count({
        where: { targetId: row.id, action: "clinical_treatment.updated" },
      })
    ).toBe(1);
  });
  it("does not audit or mutate an empty update", async () => {
    const row = await create();
    expect(await run(() => service.updateTreatment(patient, row.id, {}))).toEqual(row);
    expect(await prisma.auditLog.count({ where: { targetId: row.id } })).toBe(1);
  });
  it("isolates create anchors and update records/patients without audit side effects", async () => {
    const row = await create();
    const foreign = await prisma.clinicalTreatment.create({
      data: {
        tenantId: other,
        patientId: otherPatient,
        ...input,
        administeredAt: new Date(input.administeredAt),
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
        run(() => service.updateTreatment(p, id, { description: "Forbidden" }))
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.auditLog.count()).toBe(count);
    expect(
      (await prisma.clinicalTreatment.findUniqueOrThrow({ where: { id: row.id } })).description
    ).toBe(input.description);
  });
  it("distinguishes create and update permission and entitlement", async () => {
    const row = await create();
    keys = new Set(["vet.clinical.read"]);
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(() => service.updateTreatment(patient, row.id, { context: null }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    keys = new Set(["vet.clinical.create"]);
    await expect(
      run(() => service.updateTreatment(patient, row.id, { context: null }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    keys = new Set(["vet.clinical.update"]);
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    entitled = false;
    await expect(create()).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
    await expect(
      run(() => service.updateTreatment(patient, row.id, { context: null }))
    ).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
  });
  it("rolls back create when audit append fails", async () => {
    const count = await prisma.clinicalTreatment.count();
    const spy = vi.spyOn(audit, "append").mockRejectedValue(new Error("Synthetic audit failure"));
    try {
      await expect(create()).rejects.toThrow("Synthetic audit failure");
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.clinicalTreatment.count()).toBe(count);
  });
  it("rolls back correction when audit append fails", async () => {
    const row = await create(),
      count = await prisma.auditLog.count();
    const spy = vi.spyOn(audit, "append").mockRejectedValue(new Error("Synthetic audit failure"));
    try {
      await expect(
        run(() => service.updateTreatment(patient, row.id, { description: "Must roll back" }))
      ).rejects.toThrow("Synthetic audit failure");
    } finally {
      spy.mockRestore();
    }
    expect(
      (await prisma.clinicalTreatment.findUniqueOrThrow({ where: { id: row.id } })).description
    ).toBe(input.description);
    expect(await prisma.auditLog.count()).toBe(count);
  });
});
