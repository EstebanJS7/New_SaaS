import { ClinicalHistoryService, type HistoryKind } from "./clinical-history.service.js";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { ClinicalRecordsService, type ClinicalRecordsPrisma } from "./clinical.records.service.js";

import { TreatmentSearchService } from "./treatment-search.service.js";
import { StudySearchService } from "./study-search.service.js";
import { WeightSearchService } from "./weight-search.service.js";
import { updateTreatmentBody, updateStudyBody, updateWeightBody } from "./clinical.zod.js";
const url = process.env.CLINICAL_CORRECTION_TEST_URL;
describe.skipIf(!url)("Clinical correction concurrency — disposable PostgreSQL", () => {
  const prisma = new PrismaService({ datasources: { db: { url } } }),
    context = new RequestContextService();
  const tenant = randomUUID(),
    other = randomUUID(),
    patient = randomUUID(),
    otherPatient = randomUUID(),
    secondPatient = randomUUID(),
    actor = randomUUID();
  let keys = new Set([
      "vet.clinical.create",
      "vet.clinical.update",
      "vet.clinical.read",
      "vet.clinical.history_read",
    ]),
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
  const history = new ClinicalHistoryService(
    prisma,
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
    if (!url || !/^\/newsaas_clinical_correction_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
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
    keys = new Set([
      "vet.clinical.create",
      "vet.clinical.update",
      "vet.clinical.read",
      "vet.clinical.history_read",
    ]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());

  const reads: { get: (p: string, id: string) => Promise<{ id: string; version: number }> }[] = [
    TreatmentSearchService,
    StudySearchService,
    WeightSearchService,
  ].map(
    (Service) =>
      new Service(
        prisma,
        context,
        { has: () => Promise.resolve(entitled) } as unknown as EntitlementsService,
        { resolveForActiveRequest: () => Promise.resolve(keys) } as unknown as PermissionResolver
      )
  );
  const cases: {
    kind: string;
    table: string;
    create: (p: string) => Promise<{ id: string }>;
    update: (p: string, id: string, v?: number, text?: string) => Promise<{ id: string }>;
    read: (p: string, id: string) => Promise<{ id: string; version: number }>;
  }[] = [
    {
      kind: "treatment",
      table: "clinical_treatment",
      create: (p) =>
        service.createTreatment(p, {
          description: "Original",
          context: null,
          administeredAt: input.measuredAt,
        }),
      update: (p, id, v, text = "Corrected") =>
        service.updateTreatment(p, id, { description: text, expectedVersion: v }),
      read: (p, id) => reads[0].get(p, id),
    },
    {
      kind: "study",
      table: "clinical_study",
      create: (p) =>
        service.createStudy(p, {
          studyType: "Original",
          result: "",
          performedAt: input.measuredAt,
        }),
      update: (p, id, v, text = "Corrected") =>
        service.updateStudy(p, id, { result: text, expectedVersion: v }),
      read: (p, id) => reads[1].get(p, id),
    },
    {
      kind: "weight",
      table: "clinical_weight",
      create: (p) => service.createWeight(p, input),
      update: (p, id, v, text = "0.125") =>
        service.updateWeight(p, id, { quantity: text, unit: "KG", expectedVersion: v }),
      read: (p, id) => reads[2].get(p, id),
    },
  ];
  describe.each(cases)("$kind CAS", (c) => {
    const kind: HistoryKind =
      c.kind === "study" ? "studies" : c.kind === "treatment" ? "treatments" : "weights";
    const searchHistory = (id: string, cursor?: number) =>
      run(() => history.search(patient, id, kind, { beforeVersion: cursor }));
    it("captures exact before/after and historical actor, preserves legacy reasons, and links one audit", async () => {
      const row = await run(() => c.create(patient));
      expect((await searchHistory(row.id)).items).toEqual([]);
      await run<{ id: string }>(() =>
        c.kind === "treatment"
          ? service.updateTreatment(patient, row.id, {
              description: "Revised",
              expectedVersion: 1,
              correctionReason: "Motivo sintético",
            })
          : c.kind === "study"
            ? service.updateStudy(patient, row.id, {
                result: "Revised",
                expectedVersion: 1,
                correctionReason: "Motivo sintético",
              })
            : service.updateWeight(patient, row.id, {
                quantity: "0.125",
                unit: "KG",
                expectedVersion: 1,
                correctionReason: "Motivo sintético",
              })
      );
      const first = (await searchHistory(row.id)).items[0];
      expect(first).toMatchObject({
        beforeVersion: 1,
        afterVersion: 2,
        reason: "Motivo sintético",
      });
      expect(first.actorName).toBeTruthy();
      await prisma.userProfile.update({
        where: { id: actor },
        data: { displayName: "Renamed synthetic actor" },
      });
      expect((await searchHistory(row.id)).items[0].actorName).toBe(first.actorName);
      if (c.kind === "weight") {
        expect(first.before).toMatchObject({
          quantity: "12.345",
          unit: "KG",
          measuredAt: input.measuredAt,
        });
        expect(first.after).toMatchObject({ quantity: "0.125", unit: "KG" });
      }
      const auditRow = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: row.id, action: c.table + ".updated" },
      });
      expect(auditRow.metadata).toMatchObject({ revisionId: first.id });
      expect(auditRow.metadata).not.toHaveProperty("correctionReason");
      await run(() => c.update(patient, row.id));
      const items = (await searchHistory(row.id)).items;
      expect(items.map((x) => x.afterVersion)).toEqual([3, 2]);
      expect(items[0].reason).toBeNull();
      expect(items[0].before).toEqual(first.after);
      await expect(run(() => history.search(otherPatient, row.id, kind, {}))).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      );
      await expect(
        run(() => history.search(secondPatient, row.id, kind, {}))
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        run(() => history.search(patient, row.id, kind, {}), other)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("requires both history and ordinary read permissions plus veterinary", async () => {
      const row = await run(() => c.create(patient));
      for (const key of ["vet.clinical.read", "vet.clinical.history_read"]) {
        keys.delete(key);
        await expect(searchHistory(row.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
        keys.add(key);
      }
      entitled = false;
      await expect(searchHistory(row.id)).rejects.toMatchObject({ code: "FEATURE_NOT_ENTITLED" });
    });
    it("rolls history back on failed audit and makes committed revisions immutable", async () => {
      const row = await run(() => c.create(patient));
      const spy = vi.spyOn(audit, "append").mockRejectedValueOnce(Error("Synthetic audit failure"));
      try {
        await expect(run(() => c.update(patient, row.id, 1))).rejects.toThrow(
          "Synthetic audit failure"
        );
      } finally {
        spy.mockRestore();
      }
      expect((await searchHistory(row.id)).items).toHaveLength(0);
      await run(() => c.update(patient, row.id, 1));
      const revision = (await searchHistory(row.id)).items[0];
      await expect(
        prisma.$executeRaw(
          Prisma.sql`UPDATE ${Prisma.raw(c.table + "_revision")} SET correction_reason='tampered' WHERE id=${revision.id}::uuid`
        )
      ).rejects.toThrow();
      await expect(
        prisma.$executeRaw(
          Prisma.sql`DELETE FROM ${Prisma.raw(c.table + "_revision")} WHERE id=${revision.id}::uuid`
        )
      ).rejects.toThrow();
      await expect(run(() => c.update(patient, row.id, 1))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect((await searchHistory(row.id)).items).toHaveLength(1);
    });
    it("rolls the correction back if the capture trigger is disabled", async () => {
      const row = await run(() => c.create(patient));
      const trigger = "capture_" + c.table + "_revision";
      await prisma.$executeRawUnsafe("ALTER TABLE " + c.table + " DISABLE TRIGGER " + trigger);
      try {
        await expect(run(() => c.update(patient, row.id, 1))).rejects.toThrow(
          "Clinical history capture is required."
        );
        expect((await run(() => c.read(patient, row.id))).version).toBe(1);
        expect((await searchHistory(row.id)).items).toHaveLength(0);
        expect(
          await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
        ).toBe(0);
      } finally {
        await prisma.$executeRawUnsafe("ALTER TABLE " + c.table + " ENABLE TRIGGER " + trigger);
      }
      await run(() => c.update(patient, row.id, 1));
      expect((await searchHistory(row.id)).items).toHaveLength(1);
    });
    it("fails the whole correction if history insertion fails", async () => {
      const row = await run(() => c.create(patient));
      await prisma.$executeRawUnsafe(
        "CREATE FUNCTION fail_ux023_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure'; END $$"
      );
      try {
        await prisma.$executeRawUnsafe(
          "CREATE TRIGGER fail_ux023 BEFORE INSERT ON " +
            c.table +
            "_revision FOR EACH ROW EXECUTE FUNCTION fail_ux023_revision()"
        );
        await expect(run(() => c.update(patient, row.id, 1))).rejects.toThrow();
        expect((await run(() => c.read(patient, row.id))).version).toBe(1);
        expect(
          await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
        ).toBe(0);
      } finally {
        await prisma.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS fail_ux023 ON " + c.table + "_revision"
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION fail_ux023_revision()");
      }
    });
    it("records direct SQL as unattributed without leaking prior transaction actor/reason", async () => {
      const row = await run(() => c.create(patient));
      await run(() => c.update(patient, row.id));
      await prisma.$executeRaw(
        Prisma.sql`UPDATE ${Prisma.raw(c.table)} SET updated_at=now() WHERE id=${row.id}::uuid`
      );
      const item = (await searchHistory(row.id)).items[0];
      expect(item).toMatchObject({ actorName: null, reason: null, afterVersion: 3 });
    });
    it("paginates a bounded immutable version cursor without duplicates on new corrections", async () => {
      const row = await run(() => c.create(patient));
      for (let i = 0; i < 22; i++) await run(() => c.update(patient, row.id));
      const first = await searchHistory(row.id);
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).toBe(4);
      await run(() => c.update(patient, row.id));
      const second = await searchHistory(row.id, first.nextCursor!);
      expect(second.items.map((x) => x.afterVersion)).toEqual([3, 2]);
      expect(second.nextCursor).toBeNull();
    });

    it("initializes version, preserves legacy command shape, and returns version with current staff content", async () => {
      const row = await run(() => c.create(patient));
      expect(row).not.toHaveProperty("version");
      expect(await run(() => c.read(patient, row.id))).toMatchObject({ id: row.id, version: 1 });
      expect(await run(() => c.update(patient, row.id, 1))).not.toHaveProperty("version");
      expect((await run(() => c.read(patient, row.id))).version).toBe(2);
    });
    it("gives simultaneous baseline writers one winner and one conflict, with a single correction audit", async () => {
      const row = await run(() => c.create(patient));
      const results = await Promise.allSettled([
        run(() => c.update(patient, row.id, 1)),
        run(() => c.update(patient, row.id, 1)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT", message: "Clinical record version changed." },
      });
      expect((await run(() => c.read(patient, row.id))).version).toBe(2);
      expect(
        await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
      ).toBe(1);
    });
    it("does not repeat a correction after its committed response is lost", async () => {
      const row = await run(() => c.create(patient));
      await run(() => c.update(patient, row.id, 1));
      await expect(run(() => c.update(patient, row.id, 1))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect((await run(() => c.read(patient, row.id))).version).toBe(2);
      expect(
        await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
      ).toBe(1);
    });
    it("rejects stale version after a legacy write, even when values are identical", async () => {
      const row = await run(() => c.create(patient));
      await run(() => c.update(patient, row.id));
      await run(() => c.update(patient, row.id));
      const baseline = await run(() => c.read(patient, row.id));
      expect(baseline.version).toBe(3);
      await expect(run(() => c.update(patient, row.id, 1))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await run(() => c.read(patient, row.id))).toEqual(baseline);
      expect(
        await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
      ).toBe(2);
    });
    it("keeps version and data atomic with audit failure, then permits the same baseline retry", async () => {
      const row = await run(() => c.create(patient)),
        baseline = await run(() => c.read(patient, row.id));
      const spy = vi
        .spyOn(audit, "append")
        .mockRejectedValueOnce(Error("Synthetic correction audit failure"));
      await expect(run(() => c.update(patient, row.id, 1))).rejects.toThrow(
        "Synthetic correction audit failure"
      );
      spy.mockRestore();
      expect(await run(() => c.read(patient, row.id))).toEqual(baseline);
      expect(
        await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
      ).toBe(0);
      await run(() => c.update(patient, row.id, 1));
      expect((await run(() => c.read(patient, row.id))).version).toBe(2);
    });
    it("hides foreign and wrong-patient records before version checks without effects", async () => {
      const row = await run(() => c.create(patient)),
        baseline = await run(() => c.read(patient, row.id));
      for (const p of [secondPatient, otherPatient, randomUUID()])
        await expect(run(() => c.update(p, row.id, 99))).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      await expect(run(() => c.update(patient, row.id, 99), other)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(await run(() => c.read(patient, row.id))).toEqual(baseline);
      expect(
        await prisma.auditLog.count({ where: { targetId: row.id, action: c.table + ".updated" } })
      ).toBe(0);
    });
    it("requires update permission and veterinary entitlement before changing a version", async () => {
      const row = await run(() => c.create(patient));
      keys.delete("vet.clinical.update");
      await expect(run(() => c.update(patient, row.id, 1))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      keys.add("vet.clinical.update");
      entitled = false;
      await expect(run(() => c.update(patient, row.id, 1))).rejects.toMatchObject({
        code: "FEATURE_NOT_ENTITLED",
      });
      entitled = true;
      expect((await run(() => c.read(patient, row.id))).version).toBe(1);
    });
    it("serializes with a writer held at the database row lock and rejects its stale baseline", async () => {
      const row = await run(() => c.create(patient));
      let locked!: () => void, release!: () => void;
      const barrier = new Promise<void>((resolve) => {
          locked = resolve;
        }),
        hold = new Promise<void>((resolve) => {
          release = resolve;
        });
      const writer = prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM ${Prisma.raw(c.table)} WHERE id = ${row.id}::uuid FOR UPDATE`
        );
        locked();
        await hold;
        await tx.$executeRaw(
          Prisma.sql`UPDATE ${Prisma.raw(c.table)} SET updated_at = updated_at WHERE id = ${row.id}::uuid`
        );
      });
      await barrier;
      const waiting = run(() => c.update(patient, row.id, 1));
      release();
      await writer;
      await expect(waiting).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await run(() => c.read(patient, row.id))).version).toBe(2);
    });
  });
  it("validates expectedVersion strictly at HTTP schemas and direct service boundaries", async () => {
    const row = await run(() => service.createWeight(patient, input));
    for (const value of [0, -1, 1.2, "1", null, 2147483648]) {
      for (const schema of [updateTreatmentBody, updateStudyBody, updateWeightBody])
        expect(() => schema.parse({ expectedVersion: value })).toThrow();
      await expect(
        run(() => service.updateWeight(patient, row.id, { expectedVersion: value as number }))
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
  it("no-op bodies check the baseline without advancing version or auditing", async () => {
    const row = await run(() =>
      service.createTreatment(patient, {
        description: "Original",
        administeredAt: input.measuredAt,
      })
    );
    await run(() => service.updateTreatment(patient, row.id, { expectedVersion: 1 }));
    expect((await run(() => reads[0].get(patient, row.id))).version).toBe(1);
    await run(() =>
      service.updateTreatment(patient, row.id, { description: "Changed", expectedVersion: 1 })
    );
    await expect(
      run(() => service.updateTreatment(patient, row.id, { expectedVersion: 1 }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.auditLog.count({
        where: { targetId: row.id, action: "clinical_treatment.updated" },
      })
    ).toBe(1);
  });
});
