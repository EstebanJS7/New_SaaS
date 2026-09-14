import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { CLINICAL_DTO_SCHEMA_VERSION, toClientSafeEncounter } from "./clinical.dto.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";
import { ClinicalService } from "./clinical.service.js";
import type {
  ClinicalEncounterDelegate,
  ClinicalEncounterRow,
  ClinicalEncounterWhere,
  ClinicalPrisma,
  ClinicalTransaction,
  CreateEncounterInput,
} from "./clinical.service.js";

const PATIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const FOREIGN_PATIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ACTOR = "11111111-1111-4111-8111-111111111100";
const IDEMPOTENCY_KEY = "66666666-6666-4666-8666-666666666661";
const TENANT_A = "tenant-1";
const TENANT_B = "tenant-2";

const ALL_CLINICAL_PERMISSIONS = new Set<string>(Object.values(CLINICAL_PERMISSIONS));

describe("ClinicalService (WU2A encounter core)", () => {
  let requestContext: RequestContextService;
  let appendMock: Mock<(input: AuditAppendInput, tx?: unknown) => Promise<{ id: string }>>;
  let audit: AuditWriter;
  let entitlementsMock: Mock<(tenantId: string, featureCode: string) => Promise<boolean>>;
  let entitlements: EntitlementsService;
  let resolveMock: Mock<() => Promise<Set<string>>>;
  let permissionResolver: PermissionResolver;

  let patients: Map<string, string>;
  let encounters: Map<string, ClinicalEncounterRow>;
  let encounterDelegate: ClinicalEncounterDelegate;
  let txQueryRaw: Mock<(query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>;
  let nextEncounterId: number;
  let service: ClinicalService;

  function withContext<T>(work: () => T, tenantId = TENANT_A): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId(ACTOR);
      requestContext.setTenantMembership({
        tenantId,
        membershipId: "mem-1",
        roleId: "role-1",
        roleCode: "VETERINARIAN",
      });
      return work();
    });
  }

  function matchesEncounter(row: ClinicalEncounterRow, where: ClinicalEncounterWhere): boolean {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (row.tenantId !== where.tenantId) return false;
    if (where.patientId !== undefined && row.patientId !== where.patientId) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.version !== undefined && row.version !== where.version) return false;
    if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) {
      return false;
    }
    return true;
  }

  function makeService(): ClinicalService {
    // Copy-on-write rows: a write installs a NEW object instead of mutating the
    // stored one in place, so the `$transaction` snapshot/restore below can
    // faithfully roll back both inserts and updates (an in-place `Object.assign`
    // would leak the mutated row through the restored Map).
    encounterDelegate = {
      findMany: ({ where, orderBy }) => {
        const rows = [...encounters.values()].filter(
          (row) => row.tenantId === where.tenantId && row.patientId === where.patientId
        );
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (orderBy?.createdAt === "asc") rows.reverse();
        return Promise.resolve(rows);
      },
      findFirst: ({ where }) =>
        Promise.resolve(
          [...encounters.values()].find((row) => matchesEncounter(row, where)) ?? null
        ),
      create: ({ data }) => {
        const now = new Date();
        const created: ClinicalEncounterRow = {
          id: `enc-${nextEncounterId++}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        encounters.set(created.id, { ...created });
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const row = [...encounters.values()].find((candidate) =>
          matchesEncounter(candidate, where)
        );
        if (!row) return Promise.resolve({ count: 0 });
        const next: ClinicalEncounterRow = { ...row };
        const { version, ...rest } = data;
        Object.assign(next, rest);
        if (version !== undefined) {
          if (typeof version === "number") next.version = version;
          else next.version += version.increment;
        }
        next.updatedAt = new Date();
        encounters.set(next.id, next);
        return Promise.resolve({ count: 1 });
      },
    };

    // In-memory `SELECT ... FOR UPDATE` seam: the lock is a no-op locally; the
    // assertion on its query text proves the lock is requested.
    txQueryRaw = vi.fn().mockResolvedValue([]);

    const tx: ClinicalTransaction = {
      clinicalEncounter: encounterDelegate,
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      $queryRaw: txQueryRaw,
    };

    const prisma: ClinicalPrisma = {
      $transaction: async <T>(work: (scope: ClinicalTransaction) => Promise<T>): Promise<T> => {
        const snapshot = new Map(encounters);
        try {
          return await work(tx);
        } catch (error) {
          restore(encounters, snapshot);
          throw error;
        }
      },
      patient: {
        findFirst: ({ where }) =>
          Promise.resolve(patients.get(where.id) === where.tenantId ? { id: where.id } : null),
      },
      clinicalEncounter: encounterDelegate,
    };

    return new ClinicalService(prisma, requestContext, entitlements, permissionResolver, audit);
  }

  function restore<TRow>(target: Map<string, TRow>, source: Map<string, TRow>): void {
    target.clear();
    for (const [key, row] of source) target.set(key, row);
  }

  async function createClosedEncounter(
    input: CreateEncounterInput = {}
  ): Promise<ClinicalEncounterRow> {
    const created = await withContext(() => service.createEncounter(PATIENT_A, input));
    await withContext(() =>
      service.closeEncounter(PATIENT_A, created.id, { version: created.version })
    );
    return encounters.get(created.id)!;
  }

  /** A committed amendment row, as a concurrent winner would leave it. */
  function makeAmendmentRow(
    original: ClinicalEncounterRow,
    idempotencyKey: string,
    reason: string
  ): ClinicalEncounterRow {
    const now = new Date();
    return {
      id: "enc-winner",
      tenantId: original.tenantId,
      patientId: original.patientId,
      status: "CLOSED",
      version: 1,
      reasonForVisit: null,
      anamnesis: null,
      diagnosis: "raced",
      treatmentPlan: null,
      internalNotes: null,
      clientSummary: null,
      amendsEncounterId: original.id,
      amendmentReason: reason,
      idempotencyKey,
      closedAt: now,
      closedByUserProfileId: ACTOR,
      createdAt: now,
      updatedAt: now,
    };
  }

  beforeEach(() => {
    requestContext = new RequestContextService();
    appendMock = vi
      .fn<(input: AuditAppendInput, tx?: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "audit-1" });
    audit = { append: appendMock } as unknown as AuditWriter;
    entitlementsMock = vi
      .fn<(tenantId: string, featureCode: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    entitlements = { has: entitlementsMock } as unknown as EntitlementsService;
    resolveMock = vi.fn().mockResolvedValue(new Set(ALL_CLINICAL_PERMISSIONS));
    permissionResolver = { resolveForActiveRequest: resolveMock } as unknown as PermissionResolver;

    patients = new Map([
      [PATIENT_A, TENANT_A],
      [FOREIGN_PATIENT, TENANT_B],
    ]);
    encounters = new Map();
    nextEncounterId = 1;
    service = makeService();
  });

  // -------------------------------------------------------------------------
  // Encounter lifecycle + audit
  // -------------------------------------------------------------------------

  it("creates a DRAFT encounter at version 1 and appends exactly one co-committed audit row", async () => {
    const result = await withContext(() =>
      service.createEncounter(PATIENT_A, { reasonForVisit: "Annual checkup" })
    );

    expect(result).toMatchObject({
      status: "DRAFT",
      version: 1,
      patientId: PATIENT_A,
      reasonForVisit: "Annual checkup",
    });
    expect(encounters.size).toBe(1);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      action: "clinical_encounter.created",
      targetType: "clinical_encounter",
      targetId: result.id,
      metadata: {
        schemaVersion: CLINICAL_DTO_SCHEMA_VERSION,
        changedFields: ["reasonForVisit"],
      },
    });
    // A mere tx-handle assertion is not proof: audit-or-nothing rollback is
    // proven by the dedicated rollback tests below.
  });

  it("autosaves a DRAFT and advances the version", async () => {
    const created = await withContext(() =>
      service.createEncounter(PATIENT_A, { anamnesis: "v1" })
    );
    appendMock.mockClear();

    const updated = await withContext(() =>
      service.updateDraft(PATIENT_A, created.id, { version: 1, anamnesis: "v2", diagnosis: "dx" })
    );

    expect(updated).toMatchObject({ version: 2, anamnesis: "v2", diagnosis: "dx" });
    expect(encounters.get(created.id)?.version).toBe(2);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0].metadata).toMatchObject({
      changedFields: ["anamnesis", "diagnosis"],
    });
  });

  it("rejects a stale autosave with CONFLICT and preserves the newer content", async () => {
    const created = await withContext(() =>
      service.createEncounter(PATIENT_A, { anamnesis: "v1" })
    );
    await withContext(() =>
      service.updateDraft(PATIENT_A, created.id, { version: 1, anamnesis: "v2" })
    );
    appendMock.mockClear();

    await expect(
      withContext(() =>
        service.updateDraft(PATIENT_A, created.id, { version: 1, anamnesis: "stale" })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(encounters.get(created.id)?.anamnesis).toBe("v2");
    expect(encounters.get(created.id)?.version).toBe(2);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("rejects updating a CLOSED encounter with CONFLICT and changes nothing", async () => {
    const closed = await createClosedEncounter({ anamnesis: "sealed" });
    appendMock.mockClear();

    await expect(
      withContext(() => service.updateDraft(PATIENT_A, closed.id, { version: 2, anamnesis: "x" }))
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(encounters.get(closed.id)?.status).toBe("CLOSED");
    expect(encounters.get(closed.id)?.anamnesis).toBe("sealed");
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("closes a DRAFT with exactly one co-committed audit row recording actor and transition", async () => {
    const created = await withContext(() => service.createEncounter(PATIENT_A, {}));
    appendMock.mockClear();

    const closed = await withContext(() =>
      service.closeEncounter(PATIENT_A, created.id, { version: 1 })
    );

    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedByUserProfileId).toBe(ACTOR);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      action: "clinical_encounter.closed",
      actorUserProfileId: ACTOR,
      targetId: created.id,
      metadata: { changedFields: ["status", "closedAt", "closedByUserProfileId"] },
    });
  });

  it("rejects closing an already CLOSED encounter with CONFLICT", async () => {
    const closed = await createClosedEncounter();

    await expect(
      withContext(() => service.closeEncounter(PATIENT_A, closed.id, { version: 2 }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // -------------------------------------------------------------------------
  // Amendments
  // -------------------------------------------------------------------------

  it("amends a CLOSED encounter with a linked CLOSED row and preserves the original", async () => {
    const original = await createClosedEncounter({ diagnosis: "old", internalNotes: "staff-only" });
    appendMock.mockClear();

    const amendment = await withContext(() =>
      service.amendEncounter(PATIENT_A, original.id, {
        reason: "Corrected diagnosis",
        content: { diagnosis: "new" },
      })
    );

    expect(amendment.id).not.toBe(original.id);
    expect(amendment).toMatchObject({
      status: "CLOSED",
      amendsEncounterId: original.id,
      amendmentReason: "Corrected diagnosis",
      diagnosis: "new",
      internalNotes: "staff-only",
    });
    expect(encounters.get(original.id)).toMatchObject({ diagnosis: "old", status: "CLOSED" });
    expect(encounters.size).toBe(2);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0]).toMatchObject({
      action: "clinical_encounter.amended",
      targetId: amendment.id,
      metadata: { amendedEncounterId: original.id },
    });
  });

  it("rejects an amendment without vet.clinical.amend and persists nothing", async () => {
    const original = await createClosedEncounter();
    resolveMock.mockResolvedValue(
      new Set([
        CLINICAL_PERMISSIONS.read,
        CLINICAL_PERMISSIONS.create,
        CLINICAL_PERMISSIONS.update,
        CLINICAL_PERMISSIONS.close,
      ])
    );
    appendMock.mockClear();

    await expect(
      withContext(() => service.amendEncounter(PATIENT_A, original.id, { reason: "x" }))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(encounters.size).toBe(1);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("rejects an amendment without a reason as VALIDATION_FAILED", async () => {
    const original = await createClosedEncounter();
    appendMock.mockClear();

    await expect(
      withContext(() => service.amendEncounter(PATIENT_A, original.id, { reason: "   " }))
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(encounters.size).toBe(1);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("rejects amending a DRAFT encounter with CONFLICT", async () => {
    const created = await withContext(() => service.createEncounter(PATIENT_A, {}));

    await expect(
      withContext(() => service.amendEncounter(PATIENT_A, created.id, { reason: "too early" }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(encounters.size).toBe(1);
  });

  it("returns the existing amendment for a repeated idempotency key without a second write", async () => {
    const original = await createClosedEncounter();
    const first = await withContext(() =>
      service.amendEncounter(PATIENT_A, original.id, {
        reason: "same request",
        idempotencyKey: IDEMPOTENCY_KEY,
      })
    );
    appendMock.mockClear();

    const second = await withContext(() =>
      service.amendEncounter(PATIENT_A, original.id, {
        reason: "same request",
        idempotencyKey: IDEMPOTENCY_KEY,
      })
    );

    expect(second.id).toBe(first.id);
    expect(encounters.size).toBe(2);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("locks the original encounter row FOR UPDATE inside the amendment transaction", async () => {
    const original = await createClosedEncounter();

    await withContext(() =>
      service.amendEncounter(PATIENT_A, original.id, { reason: "lock proof" })
    );

    expect(txQueryRaw).toHaveBeenCalledTimes(1);
    const [query, ...values] = txQueryRaw.mock.calls[0];
    const sql = query.join("");
    expect(sql).toContain('FROM "clinical_encounter"');
    expect(sql).toContain('"tenant_id" = ');
    expect(sql).toContain('"id" = ');
    expect(sql).toContain("FOR UPDATE");
    expect(values).toEqual([TENANT_A, original.id]);
  });

  it("recovers a duplicated amendment race into the winning row instead of a raw unique error", async () => {
    const original = await createClosedEncounter();
    appendMock.mockClear();
    const winner = makeAmendmentRow(original, IDEMPOTENCY_KEY, "winner");
    let raced = false;

    // The loser's replay check misses (the winner has not committed yet), its
    // insert hits the `(tenant_id, idempotency_key)` unique (P2002), and the
    // post-transaction recovery read resolves the winner's committed row.
    // Prisma reports the PG column-name shape for this index.
    encounterDelegate.create = () => {
      raced = true;
      return Promise.reject(
        Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          meta: { target: ["tenant_id", "idempotency_key"] },
        })
      );
    };
    const baseFindFirst = encounterDelegate.findFirst;
    encounterDelegate.findFirst = ({ where }) => {
      if (where.idempotencyKey !== undefined) {
        return Promise.resolve(raced ? winner : null);
      }
      return baseFindFirst({ where });
    };

    const result = await withContext(() =>
      service.amendEncounter(PATIENT_A, original.id, {
        reason: "raced",
        idempotencyKey: IDEMPOTENCY_KEY,
      })
    );

    expect(result.id).toBe(winner.id);
    expect(appendMock).not.toHaveBeenCalled();
    expect(encounters.size).toBe(1); // the loser's row rolled back
  });

  it("rethrows the idempotency conflict when no existing amendment matches the key", async () => {
    const original = await createClosedEncounter();
    appendMock.mockClear();
    const conflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["tenant_id", "idempotency_key"] },
    });
    encounterDelegate.create = () => Promise.reject(conflict);

    await expect(
      withContext(() =>
        service.amendEncounter(PATIENT_A, original.id, {
          reason: "raced",
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      )
    ).rejects.toBe(conflict);

    expect(encounters.size).toBe(1);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it("recovers the winning row when Prisma reports the index-name metadata shape", async () => {
    const original = await createClosedEncounter();
    appendMock.mockClear();
    const winner = makeAmendmentRow(original, IDEMPOTENCY_KEY, "winner");
    let raced = false;

    // Some engines/adapters report the violated index name instead of columns.
    encounterDelegate.create = () => {
      raced = true;
      return Promise.reject(
        Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          meta: { target: ["clinical_encounter_tenant_id_idempotency_key_key"] },
        })
      );
    };
    const baseFindFirst = encounterDelegate.findFirst;
    encounterDelegate.findFirst = ({ where }) => {
      if (where.idempotencyKey !== undefined) {
        return Promise.resolve(raced ? winner : null);
      }
      return baseFindFirst({ where });
    };

    const result = await withContext(() =>
      service.amendEncounter(PATIENT_A, original.id, {
        reason: "raced",
        idempotencyKey: IDEMPOTENCY_KEY,
      })
    );

    expect(result.id).toBe(winner.id);
    expect(appendMock).not.toHaveBeenCalled();
    expect(encounters.size).toBe(1); // the loser's row rolled back
  });

  it("rethrows an unrelated P2002 even when an idempotency-key row exists", async () => {
    const original = await createClosedEncounter();
    appendMock.mockClear();
    const existing = makeAmendmentRow(original, IDEMPOTENCY_KEY, "winner");
    let raced = false;
    // An unrelated conflict on the same table: the `(tenant_id, id)`
    // tenant-ownership key, not the `(tenant_id, idempotency_key)` one.
    const conflict = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["tenant_id", "id"] },
    });
    encounterDelegate.create = () => {
      raced = true;
      return Promise.reject(conflict);
    };
    const baseFindFirst = encounterDelegate.findFirst;
    encounterDelegate.findFirst = ({ where }) => {
      if (where.idempotencyKey !== undefined) {
        return Promise.resolve(raced ? existing : null);
      }
      return baseFindFirst({ where });
    };

    // A row with this idempotency key exists, but the conflict targeted a
    // different constraint: recovery must NOT fire and the original error must
    // propagate untouched.
    await expect(
      withContext(() =>
        service.amendEncounter(PATIENT_A, original.id, {
          reason: "raced",
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      )
    ).rejects.toBe(conflict);

    expect(encounters.size).toBe(1); // the loser's row rolled back
    expect(appendMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Transactional audit rollback (audit-or-nothing)
  // -------------------------------------------------------------------------

  it("rolls back a created encounter when the co-committed audit append fails", async () => {
    appendMock.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      withContext(() => service.createEncounter(PATIENT_A, { anamnesis: "x" }))
    ).rejects.toThrow("audit unavailable");

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(encounters.size).toBe(0);
  });

  it("rolls back a DRAFT autosave (content + version) when the audit append fails", async () => {
    const created = await withContext(() =>
      service.createEncounter(PATIENT_A, { anamnesis: "original" })
    );
    appendMock.mockClear();
    appendMock.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      withContext(() =>
        service.updateDraft(PATIENT_A, created.id, { version: 1, anamnesis: "leaked" })
      )
    ).rejects.toThrow("audit unavailable");

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(encounters.get(created.id)).toMatchObject({ version: 1, anamnesis: "original" });
  });

  it("rolls back a CLOSED transition when the audit append fails", async () => {
    const created = await withContext(() => service.createEncounter(PATIENT_A, {}));
    appendMock.mockClear();
    appendMock.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      withContext(() => service.closeEncounter(PATIENT_A, created.id, { version: 1 }))
    ).rejects.toThrow("audit unavailable");

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(encounters.get(created.id)).toMatchObject({ status: "DRAFT", version: 1 });
  });

  it("rolls back an amendment row when the audit append fails", async () => {
    const original = await createClosedEncounter();
    appendMock.mockClear();
    appendMock.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      withContext(() => service.amendEncounter(PATIENT_A, original.id, { reason: "x" }))
    ).rejects.toThrow("audit unavailable");

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(encounters.size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Entitlement + tenant isolation
  // -------------------------------------------------------------------------

  it("denies every clinical operation without the veterinary entitlement", async () => {
    entitlementsMock.mockResolvedValue(false);

    await expect(withContext(() => service.listEncounters(PATIENT_A))).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
    });
    await expect(withContext(() => service.createEncounter(PATIENT_A, {}))).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
    });
    expect(encounters.size).toBe(0);
  });

  it("returns 404 for a cross-tenant Patient on create and persists nothing", async () => {
    await expect(
      withContext(() => service.createEncounter(FOREIGN_PATIENT, {}))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(encounters.size).toBe(0);
  });

  it("returns 404 for a cross-tenant encounter read", async () => {
    const created = await withContext(() => service.createEncounter(PATIENT_A, {}));

    await expect(
      withContext(() => service.getEncounter(PATIENT_A, created.id), TENANT_B)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 404 listing encounters of a foreign Patient", async () => {
    await expect(withContext(() => service.listEncounters(FOREIGN_PATIENT))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // -------------------------------------------------------------------------
  // Allowlisted projections
  // -------------------------------------------------------------------------

  it("returns an exact allowlisted encounter DTO", async () => {
    const result = await withContext(() => service.createEncounter(PATIENT_A, {}));

    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "tenantId",
        "patientId",
        "status",
        "version",
        "reasonForVisit",
        "anamnesis",
        "diagnosis",
        "treatmentPlan",
        "internalNotes",
        "clientSummary",
        "amendsEncounterId",
        "amendmentReason",
        "closedAt",
        "closedByUserProfileId",
        "createdAt",
        "updatedAt",
      ].sort()
    );
  });

  it("excludes internalNotes from the client-safe projection", async () => {
    const created = await withContext(() =>
      service.createEncounter(PATIENT_A, { internalNotes: "secret", clientSummary: "ok" })
    );

    const clientSafe = toClientSafeEncounter(created);

    expect(clientSafe).not.toHaveProperty("internalNotes");
    expect(clientSafe.clientSummary).toBe("ok");
    expect(created.internalNotes).toBe("secret");
  });
});
