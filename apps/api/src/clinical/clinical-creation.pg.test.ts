import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { ClinicalRecordsService, type ClinicalRecordsPrisma } from "./clinical.records.service.js";

const url = process.env.CLINICAL_CREATION_TEST_URL;
describe.skipIf(!url)("Clinical idempotent creation — disposable PostgreSQL", () => {
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
  const input = { quantity: "12.345", unit: "KG" as const, measuredAt: "2026-10-20T15:00:42.123Z" };
  function run<T>(work: () => Promise<T>, tenantId = tenant) {
    return context.run(randomUUID(), () => {
      context.setUserProfileId(actor);
      context.setTenantMembership({
        tenantId,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        roleCode: "VETERINARIAN",
      });
      return work();
    });
  }

  beforeAll(async () => {
    if (!url || !/^\/newsaas_clinical_creation_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
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

  const cases: {
    kind: string;
    create: (p: string, key?: string, different?: boolean) => Promise<{ id: string }>;
    action: string;
  }[] = [
    {
      kind: "treatment",
      create: (p: string, key?: string, different = false) =>
        service.createTreatment(
          p,
          {
            description: different ? "Different" : "Synthetic treatment",
            administeredAt: input.measuredAt,
            context: null,
          },
          key
        ),
      action: "clinical_treatment.created",
    },
    {
      kind: "study",
      create: (p: string, key?: string, different = false) =>
        service.createStudy(
          p,
          {
            studyType: different ? "Different" : "Synthetic study",
            performedAt: input.measuredAt,
            result: "",
          },
          key
        ),
      action: "clinical_study.created",
    },
    {
      kind: "weight",
      create: (p: string, key?: string, different = false) =>
        service.createWeight(p, { ...input, quantity: different ? "0.001" : "9999999.999" }, key),
      action: "clinical_weight.created",
    },
  ];
  describe.each(cases)("$kind", (c) => {
    it("replays the exact original result after a committed response is discarded, with one audit", async () => {
      const key = randomUUID();
      const committed = await run(() => c.create(patient, key));
      // The caller loses this response; its retry must recover the original ID and timestamps.
      const replay = await run(() => c.create(patient, key));
      expect(replay).toEqual(committed);
      expect(
        await prisma.auditLog.count({ where: { action: c.action, targetId: committed.id } })
      ).toBe(1);
    });
    it("serializes simultaneous identical requests into one record, receipt and audit", async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => run(() => c.create(patient, key)))
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
      expect(
        await prisma.auditLog.count({ where: { action: c.action, targetId: results[0].id } })
      ).toBe(1);
      const rows = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM clinical_creation_receipt WHERE key = ${key}::uuid`;
      expect(rows[0].count).toBe(1n);
    });
    it("rejects reused content and simultaneous incompatible requests with 409 semantics", async () => {
      const key = randomUUID();
      const results = await Promise.allSettled([
        run(() => c.create(patient, key)),
        run(() => c.create(patient, key, true)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
      const winner = results.find((r) => r.status === "fulfilled");
      if (winner?.status !== "fulfilled") throw Error("Missing winner");
      expect(
        await prisma.auditLog.count({ where: { action: c.action, targetId: winner.value.id } })
      ).toBe(1);
    });
    it("separates patient and tenant scopes, and hides foreign patients even on replay", async () => {
      const key = randomUUID();
      const first = await run(() => c.create(patient, key));
      const second = await run(() => c.create(secondPatient, key));
      const foreign = await run(() => c.create(otherPatient, key), other);
      expect(new Set([first.id, second.id, foreign.id]).size).toBe(3);
      await expect(run(() => c.create(otherPatient, key))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(run(() => c.create(patient, key), other)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    it("rechecks permission and veterinary entitlement before replay", async () => {
      const key = randomUUID();
      await run(() => c.create(patient, key));
      keys = new Set(["vet.clinical.read"]);
      await expect(run(() => c.create(patient, key))).rejects.toMatchObject({ code: "FORBIDDEN" });
      keys.add("vet.clinical.create");
      entitled = false;
      await expect(run(() => c.create(patient, key))).rejects.toMatchObject({
        code: "FEATURE_NOT_ENTITLED",
      });
    });
    it("rolls back record and receipt on failed audit, allowing same-key retry", async () => {
      const key = randomUUID();
      const auditCount = await prisma.auditLog.count();
      const counts = () =>
        Promise.all([
          prisma.clinicalTreatment.count(),
          prisma.clinicalStudy.count(),
          prisma.clinicalWeight.count(),
        ]);
      const before = await counts();
      const rowsBefore = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM clinical_creation_receipt`;
      const spy = vi.spyOn(audit, "append").mockRejectedValueOnce(Error("Synthetic audit failure"));
      await expect(run(() => c.create(patient, key))).rejects.toThrow("Synthetic audit failure");
      spy.mockRestore();
      expect(await prisma.auditLog.count()).toBe(auditCount);
      expect(await counts()).toEqual(before);
      expect(await prisma.$queryRaw`SELECT count(*) FROM clinical_creation_receipt`).toEqual(
        rowsBefore
      );
      const result = await run(() => c.create(patient, key));
      expect(
        await prisma.auditLog.count({ where: { targetId: result.id, action: c.action } })
      ).toBe(1);
    });
    it("keeps legacy no-key creation non-deduplicating and rejects invalid keys", async () => {
      const a = await run(() => c.create(patient));
      const b = await run(() => c.create(patient));
      expect(a.id).not.toBe(b.id);
      await expect(run(() => c.create(patient, "clinical text"))).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    });
  });
  it("rolls back the clinical row and audit if receipt persistence fails after both writes", async () => {
    const counts = () => Promise.all([prisma.clinicalWeight.count(), prisma.auditLog.count()]);
    const before = await counts(),
      key = randomUUID();
    // Synthetic failure only in this disposable database. UUID generated locally, never external SQL.
    await prisma.$executeRawUnsafe(
      "ALTER TABLE clinical_creation_receipt ADD CONSTRAINT ux019_injected_receipt_failure CHECK (key <> '" +
        key +
        "'::uuid)"
    );
    try {
      await expect(run(() => service.createWeight(patient, input, key))).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        "ALTER TABLE clinical_creation_receipt DROP CONSTRAINT ux019_injected_receipt_failure"
      );
    }
    expect(await counts()).toEqual(before);
    const result = await run(() => service.createWeight(patient, input, key));
    expect(await prisma.auditLog.count({ where: { targetId: result.id } })).toBe(1);
  });
  it("enforces tenant/patient FK and immutable receipts at the database boundary", async () => {
    const key = randomUUID();
    await run(() => service.createWeight(patient, input, key));
    await expect(
      prisma.$executeRaw`UPDATE clinical_creation_receipt SET request_hash = repeat('a',64) WHERE key = ${key}::uuid`
    ).rejects.toThrow("immutable");
    await expect(
      prisma.$executeRaw`DELETE FROM clinical_creation_receipt WHERE key = ${key}::uuid`
    ).rejects.toThrow("immutable");
    await expect(
      prisma.$executeRaw`INSERT INTO clinical_creation_receipt (tenant_id,patient_id,kind,key,request_hash,response) VALUES (${other}::uuid,${patient}::uuid,'weight',${randomUUID()}::uuid,repeat('a',64),'{}'::jsonb)`
    ).rejects.toThrow();
  });
  it("isolates types and replays the original snapshot after a correction", async () => {
    const key = randomUUID();
    const results = await Promise.all(cases.map((c) => run(() => c.create(patient, key))));
    expect(new Set(results.map((r) => r.id)).size).toBe(3);
    await run(() => service.updateTreatment(patient, results[0].id, { description: "Corrected" }));
    await run(() => service.updateStudy(patient, results[1].id, { result: "Corrected" }));
    await run(() => service.updateWeight(patient, results[2].id, { quantity: "0.125" }));
    expect(await Promise.all(cases.map((c) => run(() => c.create(patient, key))))).toEqual(results);
  });
  it("canonicalizes exact quantities, instants and absent nullable context without losing unit semantics", async () => {
    const key = randomUUID();
    const original = await run(() => service.createWeight(patient, input, key));
    expect(
      await run(() =>
        service.createWeight(
          patient,
          { ...input, quantity: "12.345", measuredAt: "2026-10-20T12:00:42.123-03:00" },
          key
        )
      )
    ).toEqual(original);
    await expect(
      run(() =>
        service.createWeight(
          patient,
          { quantity: input.quantity, measuredAt: input.measuredAt },
          key
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const key2 = randomUUID();
    const treatment = { description: "Untrimmed  ", administeredAt: input.measuredAt };
    const a = await run(() => service.createTreatment(patient, treatment, key2));
    expect(
      await run(() => service.createTreatment(patient, { ...treatment, context: null }, key2))
    ).toEqual(a);
    await expect(
      run(() => service.createTreatment(patient, { ...treatment, description: "Untrimmed" }, key2))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
