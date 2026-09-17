import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import { SCHEDULING_PERMISSIONS } from "./appointment.permissions.js";
import {
  BookingRequestService,
  type BookingRequestAppointmentRow,
  type BookingRequestPrisma,
  type BookingRequestRow,
  type BookingRequestTransaction,
} from "./booking-request.service.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_A = "11111111-1111-4111-8111-111111111101";
const PATIENT_A = "22222222-2222-4222-8222-222222222201";
const VET_A = "33333333-3333-4333-8333-333333333301";
const CUSTOMER_A = "55555555-5555-4555-8555-555555555501";
const ACTOR = "44444444-4444-4444-8444-444444444401";
const REQUEST_ID = "66666666-6666-4666-8666-666666666601";
const APPOINTMENT_ID = "77777777-7777-4777-8777-777777777701";
const START = new Date("2026-09-14T12:00:00.000Z");
const END = new Date("2026-09-14T12:30:00.000Z");

/** Prisma-shaped unique violation on `(tenantId, portalBookingRequestId)`. */
function linkConflict(): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: ["tenantId", "portalBookingRequestId"] },
  });
}

/** An unrelated unique violation (the `(tenantId, id)` key) must propagate. */
function unrelatedConflict(): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: ["tenantId", "id"] },
  });
}

interface Harness {
  service: BookingRequestService;
  rootFindFirst: ReturnType<typeof vi.fn>;
  appendMock: ReturnType<typeof vi.fn<(input: AuditAppendInput, tx?: unknown) => Promise<unknown>>>;
}

interface HarnessOptions {
  /**
   * Makes the in-transaction overlap read see a row, which is what the LOSER of
   * a concurrent same-slot approval sees under the default REJECT policy.
   */
  readonly overlappingAppointment?: boolean;
  /**
   * Whether the post-failure recovery read finds an appointment linked to the
   * request. `false` models a genuine slot conflict with nothing promoted.
   */
  readonly recoveryFindsLinked?: boolean;
}

function buildHarness(
  createError: Error,
  requestContext: RequestContextService,
  options: HarnessOptions = {}
): Harness {
  const request: BookingRequestRow = {
    id: REQUEST_ID,
    tenantId: TENANT_A,
    customerId: CUSTOMER_A,
    patientId: PATIENT_A,
    status: "PENDING",
    startAt: START,
    endAt: END,
  };
  const linked: BookingRequestAppointmentRow = {
    id: APPOINTMENT_ID,
    tenantId: TENANT_A,
    branchId: BRANCH_A,
    patientId: PATIENT_A,
    professionalMembershipId: VET_A,
    status: "SCHEDULED",
    version: 1,
    startAt: START,
    endAt: END,
    createdAt: START,
    updatedAt: START,
  };

  // Root appointment read: #1 is the idempotency pre-check (misses), #2 is the
  // post-failure recovery (finds the winner's row unless the test says nothing
  // was promoted).
  const rootFindFirst = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValue(options.recoveryFindsLinked === false ? null : linked);

  const tx: BookingRequestTransaction = {
    portalBookingRequest: {
      findFirst: vi.fn().mockResolvedValue(request),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    appointment: {
      findFirst: vi.fn().mockResolvedValue(options.overlappingAppointment ? linked : null),
      create: vi.fn().mockImplementation(() => {
        throw createError;
      }),
    },
    patientGuardian: { findFirst: vi.fn().mockResolvedValue({ patientId: PATIENT_A }) },
    branch: { findFirst: vi.fn().mockResolvedValue({ id: BRANCH_A }) },
    patient: { findFirst: vi.fn().mockResolvedValue({ id: PATIENT_A }) },
    tenantMembership: {
      findFirst: vi.fn().mockResolvedValue({ id: VET_A, role: { code: "VETERINARIAN" } }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-tx" }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };

  const prisma: BookingRequestPrisma = {
    $transaction: async <T>(work: (scope: BookingRequestTransaction) => Promise<T>) => work(tx),
    portalBookingRequest: {
      findFirst: vi.fn().mockResolvedValue(request),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([request]),
    },
    appointment: { findFirst: rootFindFirst, create: vi.fn() },
    branch: { findFirst: vi.fn().mockResolvedValue({ id: BRANCH_A }) },
    patient: { findFirst: vi.fn().mockResolvedValue({ id: PATIENT_A }) },
    tenantMembership: {
      findFirst: vi.fn().mockResolvedValue({ id: VET_A, role: { code: "VETERINARIAN" } }),
    },
  };

  const appendMock = vi
    .fn<(input: AuditAppendInput, tx?: unknown) => Promise<unknown>>()
    .mockResolvedValue({ id: "audit-1" });
  const resolveMock = vi
    .fn<() => Promise<Set<string>>>()
    .mockResolvedValue(new Set(Object.values(SCHEDULING_PERMISSIONS)));
  const settingsMock = vi
    .fn<(namespace: string) => Promise<Record<string, unknown>>>()
    .mockResolvedValue({ conflictPolicy: "REJECT", availability: [], blocks: [] });

  const service = new BookingRequestService(
    prisma,
    requestContext,
    { resolveForActiveRequest: resolveMock } as unknown as PermissionResolver,
    { append: appendMock } as unknown as AuditWriter,
    { get: settingsMock } as unknown as TenantSettingsService
  );

  return { service, rootFindFirst, appendMock };
}

describe("BookingRequestService concurrent approval recovery (EPIC-08 WU4B)", () => {
  let requestContext: RequestContextService;

  beforeEach(() => {
    requestContext = new RequestContextService();
  });

  function withContext<T>(work: () => T): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId(ACTOR);
      requestContext.setTenantMembership({
        tenantId: TENANT_A,
        membershipId: "mem-actor",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  it("recovers from the (tenantId, portalBookingRequestId) unique to the winner's appointment", async () => {
    const harness = buildHarness(linkConflict(), requestContext);

    const result = await withContext(() =>
      harness.service.approveBookingRequest(REQUEST_ID, {
        branchId: BRANCH_A,
        professionalMembershipId: VET_A,
      })
    );

    expect(result.id).toBe(APPOINTMENT_ID);
    // Recovery re-reads by provenance; no second audit row is minted.
    expect(harness.rootFindFirst).toHaveBeenCalledTimes(2);
    expect(harness.rootFindFirst.mock.calls[1][0]).toMatchObject({
      where: { tenantId: TENANT_A, portalBookingRequestId: REQUEST_ID },
    });
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("propagates an unrelated unique violation instead of masking it", async () => {
    const harness = buildHarness(unrelatedConflict(), requestContext);

    await expect(
      withContext(() =>
        harness.service.approveBookingRequest(REQUEST_ID, {
          branchId: BRANCH_A,
          professionalMembershipId: VET_A,
        })
      )
    ).rejects.toMatchObject({ code: "P2002" });
    // Only the pre-check ran; recovery must not treat this as the link conflict.
    expect(harness.rootFindFirst).toHaveBeenCalledTimes(1);
  });

  it("recovers from a lost overlap race to the winner's appointment", async () => {
    // The loser acquires the advisory lock only AFTER the winner committed, so
    // its overlap check sees the winner's appointment and raises CONFLICT. That
    // is the same idempotent outcome as the unique conflict, not a 409: the
    // requirement is that a repeated approval never creates a second one.
    const harness = buildHarness(new Error("unused"), requestContext, {
      overlappingAppointment: true,
    });

    const result = await withContext(() =>
      harness.service.approveBookingRequest(REQUEST_ID, {
        branchId: BRANCH_A,
        professionalMembershipId: VET_A,
      })
    );

    expect(result.id).toBe(APPOINTMENT_ID);
    expect(harness.rootFindFirst).toHaveBeenCalledTimes(2);
    // Recovery returns the winner's row; it never mints a second audit row.
    expect(harness.appendMock).not.toHaveBeenCalled();
  });

  it("still surfaces a slot conflict when nothing is linked to the request", async () => {
    // Widening the recovery must not swallow a genuine 409: with no appointment
    // linked to the request the original conflict propagates.
    const harness = buildHarness(new Error("unused"), requestContext, {
      overlappingAppointment: true,
      recoveryFindsLinked: false,
    });

    await expect(
      withContext(() =>
        harness.service.approveBookingRequest(REQUEST_ID, {
          branchId: BRANCH_A,
          professionalMembershipId: VET_A,
        })
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "The professional already has an overlapping appointment.",
    });
    // Revert-sensitive: the widened recovery RUNS on a conflict (two root reads:
    // the pre-check plus the recovery probe) and still rethrows because nothing
    // is linked. A P2002-only recovery would stop after the first read.
    expect(harness.rootFindFirst).toHaveBeenCalledTimes(2);
    expect(harness.appendMock).not.toHaveBeenCalled();
  });
});
