import { z } from "zod";

/**
 * Staff booking-request contracts (EPIC-08 WU4B).
 *
 * The staff side of a holder-submitted request: staff list the tenant's
 * requests and decide each one. The status vocabulary mirrors the
 * `portal_booking_request_status` database enum (and the holder-facing DTO in
 * `portal-booking.dto.ts`) but is declared locally so this staff surface stays
 * independent of the portal module — scheduling owns the promotion, not the
 * submission.
 *
 * Data classification: the requested range and the Patient/Customer link are
 * CONFIDENTIAL. They cross the boundary as an allowlisted projection and are
 * never written into audit metadata (stable ids and field NAMES only).
 */

/** Current contract version of the staff booking-request DTO. */
export const BOOKING_REQUEST_DTO_SCHEMA_VERSION = 1;

/** Mirrors the `portal_booking_request_status` database enum. */
export type BookingRequestStatusDto = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

/**
 * Staff promotion body: the two anchors staff choose when approving, plus an
 * OPTIONAL concrete slot. `.strict()` rejects a smuggled `patientId`, `tenantId`
 * or `status`. When `startAt`/`endAt` are omitted the appointment copies the
 * stored request's times; when supplied they are the real approved slot (the
 * request row keeps the times the holder originally asked for).
 *
 * `startAt`/`endAt` are all-or-nothing: one without the other is a 400, and an
 * inverted/zero-length range is a 400.
 */
export const approveBookingRequestSchema = z
  .object({
    branchId: z.string().uuid(),
    professionalMembershipId: z.string().uuid(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasStart = value.startAt !== undefined;
    const hasEnd = value.endAt !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? "endAt" : "startAt"],
        message: "startAt and endAt must be provided together.",
      });
      return;
    }
    if (hasStart && hasEnd && Date.parse(value.endAt ?? "") <= Date.parse(value.startAt ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must be after startAt.",
      });
    }
  });

export type ApproveBookingRequestInput = z.infer<typeof approveBookingRequestSchema>;

/** Row shape the mapper reads — never returned raw. */
export interface BookingRequestRecord {
  readonly id: string;
  readonly patientId: string;
  readonly status: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * Allowlisted staff DTO: the request identity plus its lifecycle status (so
 * pending work is visible in a list). No `tenantId`/`customerId` echo and no
 * audit linkage.
 */
export interface BookingRequestResponse {
  readonly id: string;
  readonly patientId: string;
  readonly status: BookingRequestStatusDto;
  readonly startAt: string;
  readonly endAt: string;
}

/** Maps a persisted row; never spreads it (allowlist by construction). */
export function toBookingRequestResponse(row: BookingRequestRecord): BookingRequestResponse {
  return {
    id: row.id,
    patientId: row.patientId,
    status: toStatusDto(row.status),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
  };
}

/** An unexpected status never leaks raw (mirrors the holder-facing mapper). */
function toStatusDto(status: string): BookingRequestStatusDto {
  return status === "APPROVED" || status === "REJECTED" || status === "CANCELLED"
    ? status
    : "PENDING";
}
