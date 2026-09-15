import { z } from "zod";

/**
 * Allowlisted staff appointment response contracts (EPIC-07 WU2). Prisma models
 * are NEVER returned from the service; every field that crosses the boundary is
 * listed here explicitly.
 *
 * Data classification: appointment scheduling details are CONFIDENTIAL, so the
 * DTO deliberately carries no free-text service/Catalog field and no internal
 * linkage. Logs and audit metadata carry stable IDs and field names only.
 */

/** Current contract version of the Appointment DTO. */
export const APPOINTMENT_DTO_SCHEMA_VERSION = 1;

/** Appointment lifecycle states, pinned by the EPIC-07 spec. */
export type AppointmentStatusDto =
  "SCHEDULED" | "CONFIRMED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/** ISO-8601 rendering for every `Date` that crosses the scheduling boundary. */
export function toIso(value: Date): string {
  return value.toISOString();
}

/** The row shape the mapper reads; generated rows and test fakes both satisfy it. */
export interface AppointmentResponseSource {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly status: AppointmentStatusDto;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Staff appointment response; exactly the allowlisted fields, nothing else. */
export interface AppointmentResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly professionalMembershipId: string;
  readonly status: AppointmentStatusDto;
  readonly startAt: string;
  readonly endAt: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Builds the allowlisted DTO; never spreads the source row. */
export function toAppointmentResponse(row: AppointmentResponseSource): AppointmentResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    patientId: row.patientId,
    professionalMembershipId: row.professionalMembershipId,
    status: row.status,
    startAt: toIso(row.startAt),
    endAt: toIso(row.endAt),
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Cross-field order rule shared by create and reschedule. Both bounds are valid
 * ISO datetimes on their own, so the ordering is enforced as a cross-field rule
 * reported on `endAt`.
 */
function assertOrderedRange(value: { startAt: string; endAt: string }, ctx: z.RefinementCtx): void {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endAt"],
      message: "endAt must be after startAt.",
    });
  }
}

/** UTC-only datetime: offsets are rejected so persisted times are unambiguous. */
const utcDateTime = z.string().datetime();

/** Create payload. `tenantId` is never accepted — it comes from request context. */
export const createAppointmentInputSchema = z
  .object({
    branchId: z.string().uuid(),
    patientId: z.string().uuid(),
    professionalMembershipId: z.string().uuid(),
    startAt: utcDateTime,
    endAt: utcDateTime,
  })
  .strict()
  .superRefine(assertOrderedRange);

export type CreateAppointmentInput = z.infer<typeof createAppointmentInputSchema>;

/** Reschedule payload; `version` is the caller's last-read optimistic guard. */
export const rescheduleAppointmentInputSchema = z
  .object({
    startAt: utcDateTime,
    endAt: utcDateTime,
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine(assertOrderedRange);

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentInputSchema>;

/** Agenda filter options: tenant branches plus assignable VETERINARIAN memberships. */
export interface AppointmentOptionsResponse {
  readonly branches: { readonly id: string; readonly name: string }[];
  readonly professionals: { readonly membershipId: string }[];
}
