import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { ClinicalRecordsService, type ClinicalRecordsPrisma } from "./clinical.records.service.js";
import { ClinicalDraftsService } from "./clinical-drafts.service.js";
import type { ClinicalDraftCopy } from "./clinical-drafts.schema.js";
const url = process.env.CLINICAL_DRAFTS_TEST_URL;
describe.skipIf(!url)("Author-private clinical drafts — disposable PostgreSQL", () => {
  if (!url) return;
  const prisma = new PrismaService({ datasources: { db: { url } } }),
    context = new RequestContextService();
  const tenant = randomUUID(),
    foreignTenant = randomUUID(),
    patient = randomUUID(),
    secondPatient = randomUUID(),
    foreignPatient = randomUUID(),
    author = randomUUID(),
    otherAuthor = randomUUID();
  let keys = new Set(["vet.clinical.read", "vet.clinical.create", "vet.clinical.update"]),
    entitled = true;
  const entitlement = { has: () => Promise.resolve(entitled) } as unknown as EntitlementsService;
  const permissions = {
    resolveForActiveRequest: () => Promise.resolve(keys),
  } as unknown as PermissionResolver;
  const audit = new AuditWriter(
    prisma as unknown as ConstructorParameters<typeof AuditWriter>[0],
    context
  );
  const records = new ClinicalRecordsService(
    prisma as unknown as ClinicalRecordsPrisma,
    context,
    entitlement,
    permissions,
    audit
  );
  const service = new ClinicalDraftsService(
    prisma,
    context,
    entitlement,
    permissions,
    audit,
    records
  );
  function run<T>(work: () => Promise<T>, actor = author, tenantId = tenant) {
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
    if (!/^\/newsaas_clinical_drafts_test_[a-f0-9]{32}$/.test(new URL(url).pathname))
      throw Error("Disposable database required.");
    await prisma.$connect();
    await prisma.tenant.createMany({
      data: [tenant, foreignTenant].map((id) => ({
        id,
        name: "Synthetic drafts tenant",
        slug: id,
      })),
    });
    await prisma.userProfile.createMany({
      data: [author, otherAuthor].map((id) => ({
        id,
        email: id + "@example.invalid",
        displayName: "Synthetic draft author",
        status: "ACTIVE",
      })),
    });
    const species = await prisma.species.create({
      data: { code: randomUUID(), name: "Synthetic species" },
    });
    for (const id of [patient, secondPatient, foreignPatient]) {
      const tenantId = id === foreignPatient ? foreignTenant : tenant;
      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: { tenantId, kind: "INDIVIDUAL", displayName: "Synthetic guardian" },
        });
        await tx.patient.create({
          data: {
            id,
            tenantId,
            name: "Synthetic draft patient",
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
    keys = new Set(["vet.clinical.read", "vet.clinical.create", "vet.clinical.update"]);
    entitled = true;
  });
  afterAll(() => prisma.$disconnect());
  const at = "2026-10-20T15:00:42.123Z";
  function copy(kind: ClinicalDraftCopy["kind"]): ClinicalDraftCopy {
    const creation = { key: randomUUID() },
      date = "2026-10-20T12:00:42.123";
    if (kind === "treatment")
      return { kind, fields: { description: "Incomplete synthetic", context: "", date, creation } };
    if (kind === "study")
      return { kind, fields: { studyType: "Synthetic study", result: "", date, creation } };
    return { kind, fields: { quantity: "0,125", confirmedKg: true, date, creation } };
  }
  function command(c: ClinicalDraftCopy) {
    const guard = { idempotencyKey: c.fields.creation!.key };
    return c.kind === "treatment"
      ? { ...guard, description: "Committed synthetic", context: null, administeredAt: at }
      : c.kind === "study"
        ? {
            ...guard,
            studyType: "Committed synthetic",
            result: "Synthetic result",
            performedAt: at,
          }
        : { ...guard, quantity: "0.125", unit: "KG", measuredAt: at };
  }
  async function count(id: string, action: string) {
    return prisma.auditLog.count({
      where: { targetId: id, action: "clinical_working_draft." + action },
    });
  }
  async function raw(id: string) {
    return (
      await prisma.$queryRaw<
        { state: string; version: number; payload: unknown; command: unknown }[]
      >(
        Prisma.sql`SELECT state,version,payload,command FROM clinical_working_draft WHERE id=${id}::uuid`
      )
    )[0];
  }
  describe.each(["treatment", "study", "weight"] as const)("%s", (kind) => {
    it("persists and replays a manual save once, supports CAS, and retains logical discards", async () => {
      const id = randomUUID(),
        c = copy(kind);
      const first = await run(() => service.save(patient, id, { version: 0, copy: c }));
      const replay = await run(() => service.save(patient, id, { version: 0, copy: c }));
      expect(first).toMatchObject({
        id,
        state: "ACTIVE",
        version: 1,
        copy: c,
        command: null,
        confirmedId: null,
      });
      expect(replay.version).toBe(1);
      expect(await count(id, "saved")).toBe(1);
      const updated = {
        ...c,
        fields: { ...c.fields, correctionReason: "Still an incomplete working copy" },
      };
      const next = await run(() => service.save(patient, id, { version: 1, copy: updated }));
      expect(next.version).toBe(2);
      await run(() => service.save(patient, id, { version: 1, copy: updated }));
      expect(await count(id, "saved")).toBe(2);
      await expect(
        run(() => service.save(patient, id, { version: 1, copy: c }))
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await run(() => service.discard(patient, id, { version: 2 }));
      await run(() => service.discard(patient, id, { version: 2 }));
      expect(await raw(id)).toMatchObject({ state: "DISCARDED", payload: updated, version: 3 });
      expect(await count(id, "discarded")).toBe(1);
      expect(
        (await run(() => service.search(patient, { kind }))).items.some((x) => x.id === id)
      ).toBe(false);
      await expect(
        prisma.$executeRaw(Prisma.sql`DELETE FROM clinical_working_draft WHERE id=${id}::uuid`)
      ).rejects.toThrow();
    });
    it("replays a lost creation response with the frozen command and one clinical audit", async () => {
      const id = randomUUID(),
        c = copy(kind),
        cmd = command(c);
      await run(() => service.save(patient, id, { version: 0, copy: c }));
      const committed = await run(() => service.submit(patient, id, { version: 1, command: cmd }));
      const pending = await run(() => service.get(patient, id));
      expect(pending).toMatchObject({
        state: "PENDING",
        version: 2,
        confirmedId: committed.id,
        command: cmd,
      });
      expect((await run(() => service.submit(patient, id, { version: 1, command: cmd }))).id).toBe(
        committed.id
      );
      await expect(
        run(() =>
          service.submit(patient, id, {
            version: 1,
            command: { ...cmd, correctionReason: "different" },
          })
        )
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(
        await prisma.auditLog.count({
          where: { targetId: committed.id, action: `clinical_${kind}.created` },
        })
      ).toBe(1);
      expect(await count(id, "submitted")).toBe(1);
      await run(() => service.complete(patient, id, { version: 2 }));
      await run(() => service.complete(patient, id, { version: 2 }));
      expect(await raw(id)).toMatchObject({
        state: "COMPLETED",
        payload: c,
        command: cmd,
        version: 3,
      });
      expect(await count(id, "completed")).toBe(1);
      expect((await run(() => service.submit(patient, id, { version: 1, command: cmd }))).id).toBe(
        committed.id
      );
    });
    it("serializes concurrent submissions and creates one record", async () => {
      const id = randomUUID(),
        c = copy(kind),
        cmd = command(c);
      await run(() => service.save(patient, id, { version: 0, copy: c }));
      const results = await Promise.all([
        run(() => service.submit(patient, id, { version: 1, command: cmd })),
        run(() => service.submit(patient, id, { version: 1, command: cmd })),
      ]);
      expect(results[0].id).toBe(results[1].id);
      expect(await count(id, "submitted")).toBe(1);
    });
    it("keeps a prepared creation recoverable if dispatch fails before commit", async () => {
      const id = randomUUID(),
        c = copy(kind),
        cmd = command(c);
      await run(() => service.save(patient, id, { version: 0, copy: c }));
      const method =
        kind === "treatment"
          ? "createTreatment"
          : kind === "study"
            ? "createStudy"
            : "createWeight";
      const spy = vi
        .spyOn(records, method)
        .mockRejectedValueOnce(Error("Synthetic dispatch failure"));
      try {
        await expect(
          run(() => service.submit(patient, id, { version: 1, command: cmd }))
        ).rejects.toThrow("Synthetic dispatch failure");
      } finally {
        spy.mockRestore();
      }
      expect(await raw(id)).toMatchObject({ state: "PENDING", version: 2, command: cmd });
      expect((await run(() => service.get(patient, id))).confirmedId).toBeNull();
      const saved = await run(() => service.submit(patient, id, { version: 1, command: cmd }));
      expect((await run(() => service.get(patient, id))).confirmedId).toBe(saved.id);
    });
    it("enforces owner, tenant, patient, read/write permissions and entitlement", async () => {
      const id = randomUUID(),
        c = copy(kind);
      await run(() => service.save(patient, id, { version: 0, copy: c }));
      for (const work of [
        () => service.get(secondPatient, id),
        () => service.get(foreignPatient, id),
        () => service.save(secondPatient, id, { version: 0, copy: c }),
        () => service.discard(secondPatient, id, { version: 1 }),
        () => service.submit(secondPatient, id, { version: 1, command: command(c) }),
      ])
        await expect(run<unknown>(work)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(run(() => service.get(patient, id), otherAuthor)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        run(() => service.get(patient, id), author, foreignTenant)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await run(() => service.search(patient, { kind }), otherAuthor)).items).toEqual([]);
      for (const key of ["vet.clinical.read", "vet.clinical.create"]) {
        keys.delete(key);
        await expect(run(() => service.get(patient, id))).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        keys.add(key);
      }
      entitled = false;
      await expect(run(() => service.get(patient, id))).rejects.toMatchObject({
        code: "FEATURE_NOT_ENTITLED",
      });
    });
  });
  it("allows one winner for conflicting manual writes from two tabs", async () => {
    const id = randomUUID(),
      c = copy("treatment");
    await run(() => service.save(patient, id, { version: 0, copy: c }));
    const results = await Promise.allSettled(
      ["First", "Second"].map((correctionReason) =>
        run(() =>
          service.save(patient, id, {
            version: 1,
            copy: { ...c, fields: { ...c.fields, correctionReason } },
          })
        )
      )
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await count(id, "saved")).toBe(2);
  });
  it("rolls save, submission and discard back on audit failure", async () => {
    const id = randomUUID(),
      c = copy("weight");
    let spy = vi.spyOn(audit, "append").mockRejectedValueOnce(Error("Synthetic audit failure"));
    try {
      await expect(run(() => service.save(patient, id, { version: 0, copy: c }))).rejects.toThrow(
        "Synthetic audit failure"
      );
    } finally {
      spy.mockRestore();
    }
    expect(await raw(id)).toBeUndefined();
    await run(() => service.save(patient, id, { version: 0, copy: c }));
    for (const action of [
      () => service.submit(patient, id, { version: 1, command: command(c) }),
      () => service.discard(patient, id, { version: 1 }),
    ]) {
      spy = vi.spyOn(audit, "append").mockRejectedValueOnce(Error("Synthetic audit failure"));
      try {
        await expect(run<unknown>(action)).rejects.toThrow("Synthetic audit failure");
      } finally {
        spy.mockRestore();
      }
      expect(await raw(id)).toMatchObject({ state: "ACTIVE", version: 1, command: null });
    }
  });
  it("keeps a correction uncertain after lost response and never sends it twice", async () => {
    const original = await run(() =>
      records.createTreatment(patient, { description: "Before", context: null, administeredAt: at })
    );
    const id = randomUUID(),
      c: ClinicalDraftCopy = {
        kind: "treatment",
        initial: {
          id: original.id,
          version: 1,
          description: "Before",
          context: null,
          administeredAt: at,
        },
        fields: {
          description: "After",
          context: "",
          date: "2026-10-20T12:00:42.123",
          correctionReason: "Synthetic correction",
        },
      };
    await run(() => service.save(patient, id, { version: 0, copy: c }));
    const cmd = {
      description: "After",
      expectedVersion: 1,
      correctionReason: "Synthetic correction",
    };
    await run(() => service.submit(patient, id, { version: 1, command: cmd }));
    await expect(
      run(() => service.submit(patient, id, { version: 1, command: cmd }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await raw(id)).toMatchObject({ state: "PENDING", command: cmd, payload: c });
    expect(
      await prisma.auditLog.count({
        where: { targetId: original.id, action: "clinical_treatment.updated" },
      })
    ).toBe(1);
    await expect(
      prisma.$executeRaw(
        Prisma.sql`UPDATE clinical_working_draft SET command='{}'::jsonb,version=version+1 WHERE id=${id}::uuid`
      )
    ).rejects.toThrow();
    await run(() => service.discard(patient, id, { version: 2 }));
    expect(await raw(id)).toMatchObject({ state: "DISCARDED", command: cmd, payload: c });
  });
  it("rejects malformed payloads, implicit ownership, changed keys and stale baselines", async () => {
    const id = randomUUID(),
      c = copy("study");
    await expect(
      run(() => service.save(patient, id, { version: 0, copy: c, authorId: otherAuthor }))
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await run(() => service.save(patient, id, { version: 0, copy: c }));
    await expect(
      run(() =>
        service.save(patient, id, {
          version: 1,
          copy: { ...c, fields: { ...c.fields, creation: { key: randomUUID() } } },
        })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      run(() =>
        service.submit(patient, id, {
          version: 1,
          command: { ...command(c), idempotencyKey: randomUUID() },
        })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await raw(id)).toMatchObject({ state: "ACTIVE", version: 1 });
  });
  it.each(["study", "weight"] as const)(
    "never resends an uncertain %s correction",
    async (kind) => {
      const created =
        kind === "study"
          ? await run(() =>
              records.createStudy(patient, {
                studyType: "Before",
                result: "Before",
                performedAt: at,
              })
            )
          : await run(() =>
              records.createWeight(patient, { quantity: "12.345", unit: "KG", measuredAt: at })
            );
      const c: ClinicalDraftCopy =
        kind === "study"
          ? {
              kind,
              initial: {
                id: created.id,
                version: 1,
                studyType: "Before",
                result: "Before",
                performedAt: at,
              },
              fields: { studyType: "Before", result: "After", date: "2026-10-20T12:00:42.123" },
            }
          : {
              kind,
              initial: {
                id: created.id,
                version: 1,
                quantity: "12.345",
                unit: "KG",
                measuredAt: at,
              },
              fields: { quantity: "0,125", confirmedKg: true, date: "2026-10-20T12:00:42.123" },
            };
      const cmd =
        kind === "study"
          ? { result: "After", expectedVersion: 1, correctionReason: "Synthetic reason" }
          : {
              quantity: "0.125",
              unit: "KG",
              expectedVersion: 1,
              correctionReason: "Synthetic reason",
            };
      const id = randomUUID();
      await run(() => service.save(patient, id, { version: 0, copy: c }));
      await run(() => service.submit(patient, id, { version: 1, command: cmd }));
      await expect(
        run(() => service.submit(patient, id, { version: 1, command: cmd }))
      ).rejects.toMatchObject({ code: "CONFLICT" });
      keys.delete("vet.clinical.update");
      await expect(run(() => service.get(patient, id))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      keys.add("vet.clinical.update");
      expect(
        await prisma.auditLog.count({
          where: { targetId: created.id, action: `clinical_${kind}.updated` },
        })
      ).toBe(1);
    }
  );
  it("rolls completion back without losing the frozen pending copy and never logs its payload", async () => {
    const id = randomUUID(),
      c = copy("weight"),
      cmd = command(c);
    await run(() => service.save(patient, id, { version: 0, copy: c }));
    await run(() => service.submit(patient, id, { version: 1, command: cmd }));
    const spy = vi
      .spyOn(audit, "append")
      .mockRejectedValueOnce(Error("Synthetic completion audit failure"));
    try {
      await expect(run(() => service.complete(patient, id, { version: 2 }))).rejects.toThrow(
        "Synthetic completion audit failure"
      );
    } finally {
      spy.mockRestore();
    }
    expect(await raw(id)).toMatchObject({ state: "PENDING", version: 2, payload: c, command: cmd });
    await run(() => service.complete(patient, id, { version: 2 }));
    const rows = await prisma.auditLog.findMany({ where: { targetId: id } });
    for (const row of rows) expect(row.metadata).toEqual({ patientId: patient });
  });
  it("paginates bounded author-private copies without duplicate IDs", async () => {
    for (let i = 0; i < 22; i++)
      await run(() =>
        service.save(secondPatient, randomUUID(), { version: 0, copy: copy("weight") })
      );
    const first = await run(() => service.search(secondPatient, { kind: "weight" }));
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    await run(() =>
      service.save(secondPatient, "ffffffff-ffff-4fff-8fff-ffffffffffff", {
        version: 0,
        copy: copy("weight"),
      })
    );
    const second = await run(() =>
      service.search(secondPatient, { kind: "weight", before: first.nextCursor })
    );
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(22);
    expect(second.nextCursor).toBeNull();
  });
});
