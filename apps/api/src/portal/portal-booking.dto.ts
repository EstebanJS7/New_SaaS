import { z } from "zod";

/**
 * Holder booking-request command contracts (EPIC-08 WU4A).
 *
 * The holder submits a desired start/end instant pair for a pet they own; the
 * API persists a PENDING `portal_booking_request` for staff to decide later
 * (PRD: "Portal can request appointments", default booking policy
 * REQUIRE_APPROVAL). Nothing else is accepted: service/professional selection,
 * contact data and any client-supplied identity belong to a later slice or are
 * resolved server-side from the portal session.
 *
 * Data classification: the requested range is CONFIDENTIAL scheduling detail.
 * It is never echoed into a log line nor written into audit metadata — the
 * audit row carries stable ids and field NAMES only (same convention as
 * `appointment.created`).
 */

/** Current contract version of the portal booking-request DTO. */
export const PORTAL_BOOKING_DTO_SCHEMA_VERSION = 1;

/** Mirrors the `portal_booking_request_status` database enum. */
export type PortalBookingRequestStatusDto = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

/**
 * Create payload: two ISO-8601 instants and NOTHING else. `.strict()` rejects
 * any extra key, so a `serviceId`, `email`, `notes`, `tenantId`, `customerId`
 * or `patientId` smuggled into the body is a 400 rather than silently ignored.
 */
const createPortalBookingRequestPayload = z
  .object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .strict();

/**
 * Ordered-range rule: a zero-length or inverted range is invalid. The database
 * CHECK constraint (`portal_booking_request_time_range_check`) is the last line
 * of defence, not the first: rejecting here keeps the answer a 400
 * VALIDATION_FAILED instead of a constraint-driven 500.
 */
export const createPortalBookingRequestBody = createPortalBookingRequestPayload.superRefine(
  (value, ctx) => {
    if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must be after startAt.",
      });
    }
  }
);

export type CreatePortalBookingRequestInput = z.infer<typeof createPortalBookingRequestPayload>;

/** Row shape the service maps from — never returned raw. */
export interface PortalBookingRequestRecord {
  readonly id: string;
  readonly patientId: string;
  readonly status: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * Allowlisted portal booking-request DTO: the created identity plus its
 * lifecycle status. No `tenantId`/`customerId` echo (identity is resolved
 * server-side from the session) and no audit linkage.
 */
export interface PortalBookingRequestResponse {
  readonly id: string;
  readonly patientId: string;
  readonly status: PortalBookingRequestStatusDto;
  readonly startAt: string;
  readonly endAt: string;
}

/** Maps a persisted row; never spreads it (allowlist by construction). */
export function toPortalBookingRequestResponse(
  row: PortalBookingRequestRecord
): PortalBookingRequestResponse {
  return {
    id: row.id,
    patientId: row.patientId,
    status: toStatusDto(row.status),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
  };
}

/** Mirrors `toPortalAccessResponse`: an unexpected status never leaks raw. */
function toStatusDto(status: string): PortalBookingRequestStatusDto {
  return status === "APPROVED" || status === "REJECTED" || status === "CANCELLED"
    ? status
    : "PENDING";
}
