import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import type {
  SchedulingAvailabilityWindow,
  SchedulingBlock,
  SchedulingSettings,
} from "../settings/registry.js";
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";
import {
  AppointmentService,
  intersectsBlock,
  isWithinAvailability,
  toZonedParts,
} from "./appointment.service.js";
import type {
  AppointmentBranchDelegate,
  AppointmentCatalogItemDelegate,
  AppointmentDelegate,
  AppointmentFilters,
  AppointmentMembershipDelegate,
  AppointmentPatientDelegate,
  AppointmentPrisma,
  AppointmentRow,
  AppointmentTransaction,
  AppointmentTransitionCommand,
  AppointmentWhere,
} from "./appointment.service.js";
import type { CreateAppointmentInput } from "./appointment.dto.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRANCH_A = "11111111-1111-4111-8111-111111111101";
const PATIENT_A = "22222222-2222-4222-8222-222222222201";
const VET_A = "33333333-3333-4333-8333-333333333301";
const BRANCH_B = "11111111-1111-4111-8111-111111111102";
const PATIENT_B = "22222222-2222-4222-8222-222222222202";
const VET_B = "33333333-3333-4333-8333-333333333302";
const ACTOR = "44444444-4444-4444-8444-444444444401";

/** In-tenant ACTIVE SERVICE anchor (EPIC-09 WU4). */
const SERVICE_A = "55555555-5555-4555-8555-555555555501";
/** SERVICE owned by the FOREIGN tenant. */
const SERVICE_FOREIGN = "55555555-5555-4555-8555-555555555502";
/** In-tenant SERVICE that was deactivated. */
const SERVICE_INACTIVE = "55555555-5555-4555-8555-555555555503";
/** In-tenant ACTIVE item of the WRONG kind. */
const SERVICE_PRODUCT = "55555555-5555-4555-8555-555555555504";
/** Unknown catalog item id (never seeded). */
const SERVICE_UNKNOWN = "55555555-5555-4555-8555-5555555555ff";

const START = "2026-09-14T12:00:00.000Z";
const END = "2026-09-14T12:30:00.000Z";
const OVERLAP_START = "2026-09-14T12:15:00.000Z";
const OVERLAP_END = "2026-09-14T12:45:00.000Z";

const ALL_PERMISSIONS = new Set<string>(Object.values(SCHEDULING_PERMISSIONS));

/** Calendar-day identity in UTC as the `toZonedParts` contract defines it. */
const localDaySerial = (year: number, month: number, day: number): number =>
  Date.UTC(year, month - 1, day) / 86_400_000;

type AppendMock = Mock<(input: AuditAppendInput, tx?: unknown) => Promise<{ id: string }>>;

function matchesAppointment(row: AppointmentRow, where: AppointmentWhere): boolean {
  if (where.id !== undefined) {
    if (typeof where.id === "string") {
      if (row.id !== where.id) return false;
    } else if (row.id === where.id.not) {
      return false;
    }
  }
  if (row.tenantId !== where.tenantId) return false;
  if (where.branchId !== undefined && row.branchId !== where.branchId) return false;
  if (where.patientId !== undefined && row.patientId !== where.patientId) return false;
  if (
    where.professionalMembershipId !== undefined &&
    row.professionalMembershipId !== where.professionalMembershipId
  ) {
    return false;
  }
  if (where.version !== undefined && row.version !== where.version) return false;
  if (where.serviceId !== undefined && row.serviceId !== where.serviceId) return false;
  if (where.status !== undefined) {
    if (typeof where.status === "string") {
      if (row.status !== where.status) return false;
    } else if (!where.status.in.includes(row.status)) {
      return false;
    }
  }
  if (where.startAt?.lt !== undefined && !(row.startAt.getTime() < where.startAt.lt.getTime())) {
    return false;
  }
  if (where.endAt?.gt !== undefined && !(row.endAt.getTime() > where.endAt.gt.getTime())) {
    return false;
  }
  return true;
}

interface Harness {
  service: AppointmentService;
  rows: Map<string, AppointmentRow>;
  memberships: Map<string, { tenantId: string; roleCode: string }>;
  catalogItems: Map<string, CatalogItemFixture>;
  appendMock: AppendMock;
  resolveMock: Mock<() => Promise<Set<string>>>;
  settingsMock: Mock<(namespace: string) => Promise<unknown>>;
  queryRawMock: Mock<(query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>;
  lastTx: () => AppointmentTransaction;
  seed(overrides?: Partial<AppointmentRow>): AppointmentRow;
}

/** Minimal in-memory catalog item the service anchor and projection read. */
interface CatalogItemFixture {
  tenantId: string;
  kind: string;
  isActive: boolean;
  name: string;
}

function buildHarness(requestContext: RequestContextService): Harness {
  const branches = new Map<string, string>([[BRANCH_A, TENANT_A]]);
  const patients = new Map<string, string>([[PATIENT_A, TENANT_A]]);
  const memberships = new Map<string, { tenantId: string; roleCode: string }>([
    [VET_A, { tenantId: TENANT_A, roleCode: "VETERINARIAN" }],
  ]);
  const catalogItems = new Map<string, CatalogItemFixture>([
    [SERVICE_A, { tenantId: TENANT_A, kind: "SERVICE", isActive: true, name: "Consulta" }],
    [
      SERVICE_FOREIGN,
      { tenantId: TENANT_B, kind: "SERVICE", isActive: true, name: "Foreign consultation" },
    ],
    [
      SERVICE_INACTIVE,
      { tenantId: TENANT_A, kind: "SERVICE", isActive: false, name: "Retired consultation" },
    ],
    [SERVICE_PRODUCT, { tenantId: TENANT_A, kind: "PRODUCT", isActive: true, name: "Dog food" }],
  ]);
  const rows = new Map<string, AppointmentRow>();
  let nextId = 1;

  const branchDelegate: AppointmentBranchDelegate = {
    findFirst: ({ where }) =>
      Promise.resolve(branches.get(where.id) === where.tenantId ? { id: where.id } : null),
    findMany: ({ where }) =>
      Promise.resolve(
        [...branches.entries()]
          .filter(([, tenantId]) => tenantId === where.tenantId)
          .map(([id]) => ({ id, name: `Branch ${id}` }))
      ),
  };

  const patientDelegate: AppointmentPatientDelegate = {
    findFirst: ({ where }) =>
      Promise.resolve(patients.get(where.id) === where.tenantId ? { id: where.id } : null),
  };

  const membershipDelegate: AppointmentMembershipDelegate = {
    findFirst: ({ where }) => {
      const membership = memberships.get(where.id);
      if (!membership) {
        return Promise.resolve(null);
      }
      if (membership.tenantId !== where.tenantId) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: where.id, role: { code: membership.roleCode } });
    },
    findMany: ({ where }) =>
      Promise.resolve(
        [...memberships.entries()]
          .filter(
            ([, membership]) =>
              membership.tenantId === where.tenantId && membership.roleCode === where.role.code
          )
          .map(([id]) => ({ id }))
      ),
  };

  const appointmentDelegate: AppointmentDelegate = {
    findMany: ({ where, orderBy }) => {
      const matched = [...rows.values()].filter((row) => matchesAppointment(row, where));
      matched.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
      if (orderBy?.startAt === "desc") matched.reverse();
      return Promise.resolve(matched);
    },
    findFirst: ({ where }) =>
      Promise.resolve([...rows.values()].find((row) => matchesAppointment(row, where)) ?? null),
    create: ({ data }) => {
      const now = new Date();
      const created: AppointmentRow = {
        id: `apt-${nextId++}`,
        ...data,
        serviceId: data.serviceId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(created.id, { ...created });
      return Promise.resolve(created);
    },
    updateMany: ({ where, data }) => {
      const row = [...rows.values()].find((candidate) => matchesAppointment(candidate, where));
      if (!row) return Promise.resolve({ count: 0 });
      const next: AppointmentRow = { ...row };
      const { version, ...rest } = data;
      Object.assign(next, rest);
      if (version !== undefined) {
        if (typeof version === "number") next.version = version;
        else next.version += version.increment;
      }
      next.updatedAt = new Date();
      rows.set(next.id, next);
      return Promise.resolve({ count: 1 });
    },
  };

  const queryRawMock = vi.fn().mockResolvedValue([]);
  const tx: AppointmentTransaction = {
    appointment: appointmentDelegate,
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-tx" }) },
    $queryRaw: queryRawMock,
  };

  const catalogItemDelegate: AppointmentCatalogItemDelegate = {
    findFirst: ({ where }) => {
      const item = catalogItems.get(where.id);
      if (item?.tenantId !== where.tenantId) return Promise.resolve(null);
      return Promise.resolve({ id: where.id, kind: item.kind, isActive: item.isActive });
    },
    findMany: ({ where }) =>
      Promise.resolve(
        [...catalogItems.entries()]
          .filter(([id, item]) => item.tenantId === where.tenantId && where.id.in.includes(id))
          .map(([id, item]) => ({ id, name: item.name, kind: item.kind }))
      ),
  };

  const prisma: AppointmentPrisma = {
    $transaction: async <T>(work: (scope: AppointmentTransaction) => Promise<T>): Promise<T> => {
      const snapshot = new Map(rows);
      try {
        return await work(tx);
      } catch (error) {
        rows.clear();
        for (const [key, value] of snapshot) rows.set(key, value);
        throw error;
      }
    },
    branch: branchDelegate,
    patient: patientDelegate,
    tenantMembership: membershipDelegate,
    appointment: appointmentDelegate,
    catalogItem: catalogItemDelegate,
  };

  const appendMock: AppendMock = vi.fn().mockResolvedValue({ id: "audit-1" });
  const resolveMock = vi
    .fn<() => Promise<Set<string>>>()
    .mockResolvedValue(new Set(ALL_PERMISSIONS));
  const settingsMock = vi
    .fn<(namespace: string) => Promise<unknown>>()
    .mockResolvedValue({ conflictPolicy: "REJECT", availability: [], blocks: [] });

  const service = new AppointmentService(
    prisma,
    requestContext,
    { resolveForActiveRequest: resolveMock } as unknown as PermissionResolver,
    { append: appendMock } as unknown as AuditWriter,
    { get: settingsMock } as unknown as TenantSettingsService
  );

  const seed = (overrides: Partial<AppointmentRow> = {}): AppointmentRow => {
    const now = new Date();
    const row: AppointmentRow = {
      id: `seed-${rows.size + 1}`,
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      status: "SCHEDULED",
      serviceId: null,
      version: 1,
      startAt: new Date(START),
      endAt: new Date(END),
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    rows.set(row.id, { ...row });
    return row;
  };

  return {
    service,
    rows,
    memberships,
    catalogItems,
    appendMock,
    resolveMock,
    settingsMock,
    queryRawMock,
    lastTx: () => tx,
    seed,
  };
}

describe("AppointmentService (EPIC-07 WU2 domain service)", () => {
  let requestContext: RequestContextService;
  let harness: Harness;

  beforeEach(() => {
    requestContext = new RequestContextService();
    harness = buildHarness(requestContext);
  });

  function withContext<T>(work: () => T, tenantId = TENANT_A): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId(ACTOR);
      requestContext.setTenantMembership({
        tenantId,
        membershipId: "mem-actor",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  function createInput(overrides: Partial<CreateAppointmentInput> = {}): CreateAppointmentInput {
    return {
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      startAt: START,
      endAt: END,
      ...overrides,
    };
  }

  function settings(overrides: Partial<SchedulingSettings>): SchedulingSettings {
    return { conflictPolicy: "REJECT", availability: [], blocks: [], ...overrides };
  }

  // -------------------------------------------------------------------------
  // 2.1 / 2.2 transitions
  // -------------------------------------------------------------------------

  it("confirm advances SCHEDULED to CONFIRMED, bumps the version, and audits once", async () => {
    const seeded = harness.seed({ status: "SCHEDULED", version: 3 });

    const result = await withContext(() =>
      harness.service.transitionAppointment(seeded.id, "confirm")
    );

    expect(result.status).toBe("CONFIRMED");
    expect(result.version).toBe(4);
    expect(harness.rows.get(seeded.id)?.status).toBe("CONFIRMED");
    expect(harness.appendMock).toHaveBeenCalledTimes(1);
    expect(harness.appendMock.mock.calls[0][0]).toMatchObject({
      action: "appointment.confirmed",
      targetId: seeded.id,
      targetType: "appointment",
    });
    // Co-committed: the audit append joined the caller's transaction handle.
    expect(harness.appendMock.mock.calls[0][1]).toBe(harness.lastTx());
  });

  it("rejects an illegal edge and leaves the state unchanged", async () => {
    const seeded = harness.seed({ status: "SCHEDULED" });

    await expect(
      withContext(() => harness.service.transitionAppointment(seeded.id, "complete"))
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(harness.rows.get(seeded.id)?.status).toBe("SCHEDULED");
    expect(harness.rows.get(seeded.id)?.version).toBe(1);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("rejects every command from a terminal COMPLETED appointment with 409 unchanged", async () => {
    const seeded = harness.seed({ status: "COMPLETED", version: 5 });
    const commands: AppointmentTransitionCommand[] = [
      "confirm",
      "arrive",
      "start",
      "complete",
      "cancel",
      "no-show",
    ];

    for (const command of commands) {
      await expect(
        withContext(() => harness.service.transitionAppointment(seeded.id, command))
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }

    expect(harness.rows.get(seeded.id)?.status).toBe("COMPLETED");
    expect(harness.rows.get(seeded.id)?.version).toBe(5);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("requires the transition permission", async () => {
    const seeded = harness.seed({ status: "SCHEDULED" });
    harness.resolveMock.mockResolvedValue(new Set([SCHEDULING_PERMISSIONS.read]));

    await expect(
      withContext(() => harness.service.transitionAppointment(seeded.id, "confirm"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(harness.rows.get(seeded.id)?.status).toBe("SCHEDULED");
  });

  // -------------------------------------------------------------------------
  // 2.3 / 2.4 create, tenant anchors, validation, DTO
  // -------------------------------------------------------------------------

  it("persists a valid appointment as SCHEDULED in UTC and audits once", async () => {
    const result = await withContext(() => harness.service.createAppointment(createInput()));

    expect(result).toMatchObject({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      status: "SCHEDULED",
      version: 1,
      startAt: "2026-09-14T12:00:00.000Z",
      endAt: "2026-09-14T12:30:00.000Z",
    });
    expect(harness.rows.size).toBe(1);
    expect(harness.appendMock).toHaveBeenCalledTimes(1);
    expect(harness.appendMock.mock.calls[0][0]).toMatchObject({ action: "appointment.created" });
  });

  it("rejects a non-ordered range with VALIDATION_FAILED and persists nothing", async () => {
    await expect(
      withContext(() =>
        harness.service.createAppointment(createInput({ endAt: START, startAt: END }))
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(harness.rows.size).toBe(0);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("masks a cross-tenant Branch as NOT_FOUND and persists nothing", async () => {
    await expect(
      withContext(() => harness.service.createAppointment(createInput({ branchId: BRANCH_B })))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.rows.size).toBe(0);
  });

  it("masks a cross-tenant Patient as NOT_FOUND and persists nothing", async () => {
    await expect(
      withContext(() => harness.service.createAppointment(createInput({ patientId: PATIENT_B })))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.rows.size).toBe(0);
  });

  it("masks a cross-tenant professional membership as NOT_FOUND and persists nothing", async () => {
    await expect(
      withContext(() =>
        harness.service.createAppointment(createInput({ professionalMembershipId: VET_B }))
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.rows.size).toBe(0);
  });

  it("rejects an in-tenant non-VETERINARIAN membership with VALIDATION_FAILED", async () => {
    harness.memberships.set(VET_A, { tenantId: TENANT_A, roleCode: "RECEPTIONIST" });

    await expect(
      withContext(() => harness.service.createAppointment(createInput()))
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(harness.rows.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 2.5 / 2.6 availability, blocks, conflict policy, advisory lock, audit
  // -------------------------------------------------------------------------

  it("returns CONFLICT for an overlapping create under REJECT and persists nothing", async () => {
    harness.seed({ status: "SCHEDULED", startAt: new Date(START), endAt: new Date(END) });

    await expect(
      withContext(() =>
        harness.service.createAppointment(
          createInput({ startAt: OVERLAP_START, endAt: OVERLAP_END })
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(harness.rows.size).toBe(1);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("persists the overlap under ALLOW without taking the advisory lock", async () => {
    harness.settingsMock.mockResolvedValue(settings({ conflictPolicy: "ALLOW" }));
    harness.seed({ status: "SCHEDULED", startAt: new Date(START), endAt: new Date(END) });

    const result = await withContext(() =>
      harness.service.createAppointment(createInput({ startAt: OVERLAP_START, endAt: OVERLAP_END }))
    );

    expect(result.status).toBe("SCHEDULED");
    expect(harness.rows.size).toBe(2);
    expect(harness.queryRawMock).not.toHaveBeenCalled();
  });

  it("does not let a terminal appointment block a new booking", async () => {
    harness.seed({ status: "CANCELLED", startAt: new Date(START), endAt: new Date(END) });

    const result = await withContext(() =>
      harness.service.createAppointment(createInput({ startAt: OVERLAP_START, endAt: OVERLAP_END }))
    );
    expect(result.status).toBe("SCHEDULED");
    expect(harness.rows.size).toBe(2);
  });

  it("takes a transaction-scoped advisory lock on the professional under REJECT", async () => {
    await withContext(() => harness.service.createAppointment(createInput()));

    expect(harness.queryRawMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = harness.queryRawMock.mock.calls[0];
    expect(strings.join("?")).toContain("pg_advisory_xact_lock");
    expect(values).toContain(`${TENANT_A}:${VET_A}`);
  });

  it("rejects a create outside the professional's availability with CONFLICT", async () => {
    const startAt = new Date(START);
    const parts = toZonedParts(startAt);
    const windows: SchedulingAvailabilityWindow[] = [
      {
        membershipId: VET_A,
        branchId: BRANCH_A,
        weekday: parts.weekday,
        startMinute: parts.minuteOfDay - 1,
        endMinute: parts.minuteOfDay,
      },
    ];
    harness.settingsMock.mockResolvedValue(settings({ availability: windows }));

    await expect(
      withContext(() => harness.service.createAppointment(createInput()))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(harness.rows.size).toBe(0);
  });

  it("rejects a create inside an active one-off block with CONFLICT", async () => {
    const blocks: SchedulingBlock[] = [
      {
        membershipId: VET_A,
        branchId: BRANCH_A,
        startsAt: "2026-09-14T12:10:00.000Z",
        endsAt: "2026-09-14T12:20:00.000Z",
      },
    ];
    harness.settingsMock.mockResolvedValue(settings({ blocks }));

    await expect(
      withContext(() => harness.service.createAppointment(createInput()))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(harness.rows.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // OPTIONAL Catalog SERVICE association (EPIC-09 WU4)
  // -------------------------------------------------------------------------

  it("creates an appointment with no service: serviceId and service are null", async () => {
    const result = await withContext(() => harness.service.createAppointment(createInput()));

    expect(result.serviceId).toBeNull();
    expect(result.service).toBeNull();
    expect(harness.rows.get(result.id)?.serviceId).toBeNull();
  });

  it("attaches an in-tenant ACTIVE SERVICE and projects its identity", async () => {
    const result = await withContext(() =>
      harness.service.createAppointment(createInput({ serviceId: SERVICE_A }))
    );

    expect(result.serviceId).toBe(SERVICE_A);
    // Identity only: no price, tax, rate or currency key is present.
    expect(result.service).toEqual({ id: SERVICE_A, name: "Consulta", kind: "SERVICE" });
    expect(Object.keys(result.service ?? {}).sort()).toEqual(["id", "kind", "name"]);
    expect(harness.rows.get(result.id)?.serviceId).toBe(SERVICE_A);
    const auditInput = harness.appendMock.mock.calls[0][0];
    expect((auditInput.metadata as { changedFields: string[] }).changedFields).toContain(
      "serviceId"
    );
  });

  it("masks an unknown or foreign service UUID as NOT_FOUND and persists nothing", async () => {
    for (const serviceId of [SERVICE_UNKNOWN, SERVICE_FOREIGN]) {
      await expect(
        withContext(() => harness.service.createAppointment(createInput({ serviceId })))
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    expect(harness.rows.size).toBe(0);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("rejects an inactive or wrong-kind in-tenant item with VALIDATION_FAILED and persists nothing", async () => {
    for (const serviceId of [SERVICE_INACTIVE, SERVICE_PRODUCT]) {
      await expect(
        withContext(() => harness.service.createAppointment(createInput({ serviceId })))
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }

    expect(harness.rows.size).toBe(0);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("never derives the duration from the attached service", async () => {
    const seeded = harness.seed({ serviceId: null });

    const result = await withContext(() =>
      harness.service.rescheduleAppointment(seeded.id, {
        startAt: "2026-09-14T15:00:00.000Z",
        endAt: "2026-09-14T15:15:00.000Z",
        version: 1,
        serviceId: SERVICE_A,
      })
    );

    // The caller-supplied 15-minute span is preserved verbatim.
    expect(result.startAt).toBe("2026-09-14T15:00:00.000Z");
    expect(result.endAt).toBe("2026-09-14T15:15:00.000Z");
    expect(result.serviceId).toBe(SERVICE_A);
  });

  it("leaves the service untouched when the update omits it and clears it on null", async () => {
    const seeded = harness.seed({ serviceId: SERVICE_A, version: 1 });

    const untouched = await withContext(() =>
      harness.service.rescheduleAppointment(seeded.id, {
        startAt: "2026-09-14T16:00:00.000Z",
        endAt: "2026-09-14T16:30:00.000Z",
        version: 1,
      })
    );
    expect(untouched.serviceId).toBe(SERVICE_A);

    const cleared = await withContext(() =>
      harness.service.rescheduleAppointment(seeded.id, {
        startAt: "2026-09-14T17:00:00.000Z",
        endAt: "2026-09-14T17:30:00.000Z",
        version: 2,
        serviceId: null,
      })
    );
    expect(cleared.serviceId).toBeNull();
    expect(cleared.service).toBeNull();
  });

  it("filters the agenda list by service and leaves an omitted filter unfiltered", async () => {
    const linked = await withContext(() =>
      harness.service.createAppointment(createInput({ serviceId: SERVICE_A }))
    );
    harness.seed();

    const filtered = await withContext(() =>
      harness.service.listAppointments({ serviceId: SERVICE_A })
    );
    expect(filtered.map((row) => row.id)).toEqual([linked.id]);

    const all = await withContext(() => harness.service.listAppointments());
    expect(all).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // audit co-commit (fail-closed transaction rollback)
  // -------------------------------------------------------------------------

  it("rolls back the created appointment when the co-committed audit append fails", async () => {
    harness.appendMock.mockRejectedValue(new Error("audit sink unavailable"));

    await expect(
      withContext(() => harness.service.createAppointment(createInput()))
    ).rejects.toThrow("audit sink unavailable");

    // The insert ran inside the transaction and handed its generated id to the
    // audit append, which joined the caller's transaction handle...
    expect(harness.appendMock).toHaveBeenCalledTimes(1);
    const [auditInput, auditTx] = harness.appendMock.mock.calls[0];
    expect(auditInput.action).toBe("appointment.created");
    expect(auditTx).toBe(harness.lastTx());
    // ...but the auditable transaction aborted, so the row never became visible.
    expect(auditInput.targetId).toBeDefined();
    expect(harness.rows.has(auditInput.targetId!)).toBe(false);
    expect(harness.rows.size).toBe(0);
  });

  it("rolls back a transition when the co-committed audit append fails", async () => {
    const seeded = harness.seed({ status: "SCHEDULED", version: 3 });
    harness.appendMock.mockRejectedValue(new Error("audit sink unavailable"));

    await expect(
      withContext(() => harness.service.transitionAppointment(seeded.id, "confirm"))
    ).rejects.toThrow("audit sink unavailable");

    expect(harness.rows.get(seeded.id)?.status).toBe("SCHEDULED");
    expect(harness.rows.get(seeded.id)?.version).toBe(3);
    expect(harness.rows.size).toBe(1);
  });

  it("rolls back a reschedule when the co-committed audit append fails", async () => {
    const seeded = harness.seed({ status: "SCHEDULED", version: 2 });
    harness.appendMock.mockRejectedValue(new Error("audit sink unavailable"));

    await expect(
      withContext(() =>
        harness.service.rescheduleAppointment(seeded.id, {
          startAt: "2026-09-14T14:00:00.000Z",
          endAt: "2026-09-14T14:30:00.000Z",
          version: 2,
        })
      )
    ).rejects.toThrow("audit sink unavailable");

    expect(harness.rows.get(seeded.id)?.version).toBe(2);
    expect(harness.rows.get(seeded.id)?.startAt.toISOString()).toBe(START);
    expect(harness.rows.get(seeded.id)?.endAt.toISOString()).toBe(END);
    expect(harness.rows.size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // reschedule
  // -------------------------------------------------------------------------

  it("reschedules under REJECT with the version guard and audits once", async () => {
    const seeded = harness.seed({ status: "SCHEDULED", version: 2 });

    const result = await withContext(() =>
      harness.service.rescheduleAppointment(seeded.id, {
        startAt: "2026-09-14T14:00:00.000Z",
        endAt: "2026-09-14T14:30:00.000Z",
        version: 2,
      })
    );

    expect(result.version).toBe(3);
    expect(result.startAt).toBe("2026-09-14T14:00:00.000Z");
    expect(harness.appendMock.mock.calls[0][0]).toMatchObject({
      action: "appointment.rescheduled",
      targetId: seeded.id,
    });
  });

  it("rejects a stale reschedule version with CONFLICT and keeps the stored row", async () => {
    const seeded = harness.seed({ status: "SCHEDULED", version: 2 });

    await expect(
      withContext(() =>
        harness.service.rescheduleAppointment(seeded.id, {
          startAt: "2026-09-14T14:00:00.000Z",
          endAt: "2026-09-14T14:30:00.000Z",
          version: 1,
        })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(harness.rows.get(seeded.id)?.version).toBe(2);
    expect(harness.rows.get(seeded.id)?.startAt.toISOString()).toBe(START);
  });

  it("rejects rescheduling a terminal appointment with CONFLICT", async () => {
    const seeded = harness.seed({ status: "CANCELLED", version: 2 });

    await expect(
      withContext(() =>
        harness.service.rescheduleAppointment(seeded.id, {
          startAt: "2026-09-14T14:00:00.000Z",
          endAt: "2026-09-14T14:30:00.000Z",
          version: 2,
        })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(harness.rows.get(seeded.id)?.status).toBe("CANCELLED");
  });

  it("excludes the appointment itself from its own reschedule overlap check", async () => {
    const seeded = harness.seed({ status: "SCHEDULED", version: 1 });

    const result = await withContext(() =>
      harness.service.rescheduleAppointment(seeded.id, {
        startAt: "2026-09-14T13:00:00.000Z",
        endAt: "2026-09-14T13:30:00.000Z",
        version: 1,
      })
    );
    expect(result.version).toBe(2);
  });

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  it("masks a cross-tenant appointment read as NOT_FOUND", async () => {
    harness.seed({ tenantId: TENANT_B });
    const foreign = [...harness.rows.values()][0];

    await expect(
      withContext(() => harness.service.getAppointment(foreign.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filters list results by branch and professional within the active tenant", async () => {
    harness.seed({ branchId: BRANCH_A, professionalMembershipId: VET_A });
    harness.seed({ branchId: BRANCH_A, professionalMembershipId: VET_A });
    harness.seed({ tenantId: TENANT_B });

    const result = await withContext(() =>
      harness.service.listAppointments({
        branchId: BRANCH_A,
        professionalMembershipId: VET_A,
      } satisfies AppointmentFilters)
    );
    expect(result).toHaveLength(2);
    expect(result.every((row) => row.tenantId === TENANT_A)).toBe(true);
  });

  it("returns only VETERINARIAN memberships in the agenda options", async () => {
    const result = await withContext(() => harness.service.listAppointmentOptions());
    expect(result.professionals).toEqual([{ membershipId: VET_A }]);
    expect(result.branches).toEqual([{ id: BRANCH_A, name: `Branch ${BRANCH_A}` }]);
  });
});

describe("scheduling time math", () => {
  it("converts UTC instants to tenant-timezone wall clock", () => {
    // 2026-09-14T12:00Z is 09:00 (Monday) in America/Asuncion: the tenant has
    // been permanently on UTC-3 since the 2024-10-06 change, so the offset is
    // exact — a frozen UTC-4 implementation yields 08:00 and fails here.
    const parts = toZonedParts(new Date("2026-09-14T12:00:00.000Z"));
    expect(parts).toEqual({
      daySerial: localDaySerial(2026, 9, 14),
      weekday: 1,
      minuteOfDay: 9 * 60,
    });
  });

  it("treats a (professional, branch) with no windows as unrestricted", () => {
    const startAt = new Date(START);
    const endAt = new Date(END);
    expect(isWithinAvailability(startAt, endAt, [], VET_A, BRANCH_A)).toBe(true);
  });

  it("accepts a range contained in a window and rejects one that ends after it", () => {
    const startAt = new Date(START);
    const parts = toZonedParts(startAt);
    const window: SchedulingAvailabilityWindow = {
      membershipId: VET_A,
      branchId: BRANCH_A,
      weekday: parts.weekday,
      startMinute: parts.minuteOfDay,
      endMinute: parts.minuteOfDay + 60,
    };
    expect(isWithinAvailability(startAt, new Date(END), [window], VET_A, BRANCH_A)).toBe(true);
    expect(
      isWithinAvailability(startAt, new Date("2026-09-14T14:00:00.000Z"), [window], VET_A, BRANCH_A)
    ).toBe(false);
  });

  it("detects block intersection only for the same professional and branch", () => {
    const blocks: SchedulingBlock[] = [
      {
        membershipId: VET_A,
        branchId: BRANCH_A,
        startsAt: "2026-09-14T12:10:00.000Z",
        endsAt: "2026-09-14T12:20:00.000Z",
      },
    ];
    const startAt = new Date(START);
    const endAt = new Date(END);
    expect(intersectsBlock(startAt, endAt, blocks, VET_A, BRANCH_A)).toBe(true);
    expect(intersectsBlock(startAt, endAt, blocks, VET_B, BRANCH_A)).toBe(false);
    expect(intersectsBlock(startAt, endAt, blocks, VET_A, BRANCH_B)).toBe(false);
    expect(
      intersectsBlock(
        new Date("2026-09-14T15:00:00.000Z"),
        new Date("2026-09-14T15:30:00.000Z"),
        blocks,
        VET_A,
        BRANCH_A
      )
    ).toBe(false);
  });
});

describe("America/Asuncion DST-boundary behavior", () => {
  // Paraguay's last DST transitions are historical and stable: clocks spring
  // forward on 2024-10-06 (UTC-4 → UTC-3) and fall back on 2024-03-24
  // (UTC-3 → UTC-4). Asserting exact wall-clock parts across these instants
  // fails for any implementation that freezes one offset instead of resolving
  // the tenant zone per instant.
  const window = (
    weekday: number,
    startMinute: number,
    endMinute: number
  ): SchedulingAvailabilityWindow => ({
    membershipId: VET_A,
    branchId: BRANCH_A,
    weekday,
    startMinute,
    endMinute,
  });

  it("resolves the 2024-10-06 spring-forward gap (UTC-4 to UTC-3)", () => {
    const before = toZonedParts(new Date("2024-10-06T03:59:00.000Z"));
    const after = toZonedParts(new Date("2024-10-06T04:00:00.000Z"));

    // 23:59 on Saturday the 5th immediately becomes 01:00 on Sunday the 6th;
    // the skipped 00:00–00:59 local hour is never produced.
    expect(before).toEqual({
      daySerial: localDaySerial(2024, 10, 5),
      weekday: 6,
      minuteOfDay: 23 * 60 + 59,
    });
    expect(after).toEqual({
      daySerial: localDaySerial(2024, 10, 6),
      weekday: 0,
      minuteOfDay: 60,
    });
    expect(after.daySerial - before.daySerial).toBe(1);
  });

  it("resolves the 2024-03-24 fall-back (UTC-3 to UTC-4) that repeats local 23:00–23:59", () => {
    const before = toZonedParts(new Date("2024-03-24T02:59:00.000Z"));
    const after = toZonedParts(new Date("2024-03-24T03:00:00.000Z"));

    expect(before).toEqual({
      daySerial: localDaySerial(2024, 3, 23),
      weekday: 6,
      minuteOfDay: 23 * 60 + 59,
    });
    expect(after).toEqual({
      daySerial: localDaySerial(2024, 3, 23),
      weekday: 6,
      minuteOfDay: 23 * 60,
    });
    // The local clock rewinds instead of advancing into the next local day.
    expect(after.daySerial).toBe(before.daySerial);
    expect(after.minuteOfDay).toBeLessThan(before.minuteOfDay);
  });

  it("rejects a range straddling the gap as spanning two local days (a frozen UTC-3 offset would accept it)", () => {
    // Correct: start Sat 2024-10-05 23:30, end Sun 2024-10-06 01:30 → two local
    // days, so the Sunday 00:00–02:00 window cannot contain it. A frozen UTC-3
    // offset maps both ends to Sunday 00:30–01:30 and would wrongly accept.
    expect(
      isWithinAvailability(
        new Date("2024-10-06T03:30:00.000Z"),
        new Date("2024-10-06T04:30:00.000Z"),
        [window(0, 0, 120)],
        VET_A,
        BRANCH_A
      )
    ).toBe(false);
  });

  it("accepts a post-gap range using the DST-adjusted offset (a frozen UTC-4 offset would reject it)", () => {
    // Correct: 04:00Z–05:00Z is Sunday 01:00–02:00 local and fits the window. A
    // frozen UTC-4 offset maps it to 00:00–01:00 and rejects the start.
    expect(
      isWithinAvailability(
        new Date("2024-10-06T04:00:00.000Z"),
        new Date("2024-10-06T05:00:00.000Z"),
        [window(0, 60, 120)],
        VET_A,
        BRANCH_A
      )
    ).toBe(true);
  });
});
