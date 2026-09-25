import { z } from "zod";

/**
 * Allowlisted staff appointment response contracts (EPIC-07 WU2). Prisma models
 * are NEVER returned from the service; every field that crosses the boundary is
 * listed here explicitly.
 *
 * Data classification: appointment scheduling details are CONFIDENTIAL. EPIC-09
 * WU4 adds the OPTIONAL Catalog SERVICE association as `serviceId` plus a small
 * read-only IDENTITY projection of the item. No price, tax, rate or currency
 * value is ever read or projected here, so the scheduling boundary cannot derive
 * a monetary value from the association. Logs and audit metadata carry stable
 * IDs and field names only.
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

/**
 * Read-only IDENTITY projection of the linked Catalog item (EPIC-09 WU4).
 *
 * Deliberately CARRY-FREE: there is no `referencePriceAmount`,
 * `referencePriceCurrency`, `taxRateId` or rate. The only keys are the item's
 * stable id, its staff-facing name and its kind, so a linked appointment can
 * never become a price, tax or fiscal source. The kind stays a plain literal
 * union (not a monetary dimension) and mirrors `catalog_item_kind`.
 */
export interface AppointmentServiceProjection {
  readonly id: string;
  readonly name: string;
  readonly kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
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
  /**
   * OPTIONAL Catalog SERVICE reference. Absent on rows that predate EPIC-09 WU4
   * and on the portal approval row type, which is deliberately not edited by
   * this slice; both render as `null`.
   */
  readonly serviceId?: string | null;
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
  /** OPTIONAL Catalog SERVICE reference; `null` means no service is attached. */
  readonly serviceId: string | null;
  /** Identity of the attached service, or `null`; never carries a monetary value. */
  readonly service: AppointmentServiceProjection | null;
}

/**
 * Builds the allowlisted DTO; never spreads the source row. The linked service
 * projection is passed SEPARATELY (the caller resolves it with one batched
 * read), so the mapper itself reads no relation and can never leak one.
 */
export function toAppointmentResponse(
  row: AppointmentResponseSource,
  service: AppointmentServiceProjection | null = null
): AppointmentResponse {
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
    serviceId: row.serviceId ?? null,
    service,
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

/**
 * OPTIONAL Catalog SERVICE reference (EPIC-09 WU4). Absent leaves it unset on
 * create / untouched on update; an explicit `null` clears it on update. A
 * present value must be a UUID — resolution to an in-tenant ACTIVE SERVICE item
 * is the anchor guard's job, so a malformed reference is a 400 here and an
 * unresolvable one is 404/400 from the service.
 */
const optionalServiceId = z.string().uuid().nullable().optional();

/** Create payload. `tenantId` is never accepted — it comes from request context. */
export const createAppointmentInputSchema = z
  .object({
    branchId: z.string().uuid(),
    patientId: z.string().uuid(),
    professionalMembershipId: z.string().uuid(),
    startAt: utcDateTime,
    endAt: utcDateTime,
    serviceId: optionalServiceId,
  })
  .strict()
  .superRefine(assertOrderedRange);

export type CreateAppointmentInput = z.infer<typeof createAppointmentInputSchema>;

/**
 * Reschedule payload; `version` is the caller's last-read optimistic guard and
 * `serviceId` is the OPTIONAL Catalog SERVICE reference (absent = untouched,
 * `null` = cleared). The duration is never derived from it.
 */
export const rescheduleAppointmentInputSchema = z
  .object({
    startAt: utcDateTime,
    endAt: utcDateTime,
    version: z.number().int().positive(),
    serviceId: optionalServiceId,
  })
  .strict()
  .superRefine(assertOrderedRange);

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentInputSchema>;

/** Agenda filter options: tenant branches plus assignable VETERINARIAN memberships. */
export interface AppointmentOptionsResponse {
  readonly branches: { readonly id: string; readonly name: string }[];
  readonly professionals: { readonly membershipId: string }[];
}
