import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_DTO_SCHEMA_VERSION,
  createAppointmentInputSchema,
  rescheduleAppointmentInputSchema,
  toAppointmentResponse,
} from "./appointment.dto.js";
import type { AppointmentResponseSource } from "./appointment.dto.js";

const BRANCH_A = "11111111-1111-4111-8111-111111111101";
const PATIENT_A = "22222222-2222-4222-8222-222222222201";
const VET_A = "33333333-3333-4333-8333-333333333301";
const START = "2026-09-14T12:00:00.000Z";
const END = "2026-09-14T12:30:00.000Z";

/** Exact allowlisted key set of the staff appointment response DTO. */
const APPOINTMENT_DTO_KEYS = [
  "branchId",
  "createdAt",
  "endAt",
  "id",
  "patientId",
  "professionalMembershipId",
  "startAt",
  "status",
  "tenantId",
  "updatedAt",
  "version",
].sort();

describe("appointment input schemas (400-class validation)", () => {
  it("accepts a valid create payload", () => {
    const parsed = createAppointmentInputSchema.safeParse({
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      startAt: START,
      endAt: END,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an equal or inverted range, reporting the end field", () => {
    for (const [startAt, endAt] of [
      [START, START],
      [END, START],
    ]) {
      const parsed = createAppointmentInputSchema.safeParse({
        branchId: BRANCH_A,
        patientId: PATIENT_A,
        professionalMembershipId: VET_A,
        startAt,
        endAt,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.path).toEqual(["endAt"]);
      }
    }
  });

  it("rejects non-UUID anchors and non-UTC offset timestamps", () => {
    const nonUuid = createAppointmentInputSchema.safeParse({
      branchId: "not-a-uuid",
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      startAt: START,
      endAt: END,
    });
    expect(nonUuid.success).toBe(false);

    // Persisted times must be unambiguous UTC; an offset is rejected.
    const offset = createAppointmentInputSchema.safeParse({
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      startAt: "2026-09-14T12:00:00.000+03:00",
      endAt: END,
    });
    expect(offset.success).toBe(false);
  });

  it("rejects unknown fields rather than silently dropping them (strict)", () => {
    const parsed = createAppointmentInputSchema.safeParse({
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      startAt: START,
      endAt: END,
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a positive integer version for reschedule", () => {
    const missing = rescheduleAppointmentInputSchema.safeParse({ startAt: START, endAt: END });
    expect(missing.success).toBe(false);
    const zero = rescheduleAppointmentInputSchema.safeParse({
      startAt: START,
      endAt: END,
      version: 0,
    });
    expect(zero.success).toBe(false);
    const valid = rescheduleAppointmentInputSchema.safeParse({
      startAt: START,
      endAt: END,
      version: 1,
    });
    expect(valid.success).toBe(true);
  });
});

describe("appointment response DTO (CONFIDENTIAL allowlist)", () => {
  function source(overrides: Partial<AppointmentResponseSource> = {}): AppointmentResponseSource {
    return {
      id: "apt-1",
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      branchId: BRANCH_A,
      patientId: PATIENT_A,
      professionalMembershipId: VET_A,
      status: "SCHEDULED",
      version: 1,
      startAt: new Date(START),
      endAt: new Date(END),
      createdAt: new Date(START),
      updatedAt: new Date(START),
      ...overrides,
    };
  }

  it("emits exactly the allowlisted keys and no internals or service field", () => {
    const response = toAppointmentResponse({
      ...source(),
      // Extra row fields a Prisma model could carry must never leak.
      ...({ serviceId: "svc-1", catalogItemId: "cat-1", internalNotes: "secret" } as object),
    });

    expect(Object.keys(response).sort()).toEqual(APPOINTMENT_DTO_KEYS);
    const record = response as unknown as Record<string, unknown>;
    expect(record.serviceId).toBeUndefined();
    expect(record.catalogItemId).toBeUndefined();
    expect(record.internalNotes).toBeUndefined();
  });

  it("renders every timestamp as an ISO-8601 UTC string", () => {
    const response = toAppointmentResponse(source());
    expect(response.startAt).toBe("2026-09-14T12:00:00.000Z");
    expect(response.endAt).toBe("2026-09-14T12:30:00.000Z");
    expect(response.createdAt.endsWith("Z")).toBe(true);
    expect(response.updatedAt.endsWith("Z")).toBe(true);
  });

  it("pins the DTO contract version", () => {
    expect(APPOINTMENT_DTO_SCHEMA_VERSION).toBe(1);
  });
});
