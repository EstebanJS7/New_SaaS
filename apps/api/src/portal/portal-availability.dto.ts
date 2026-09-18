import { z } from "zod";
import {
  AVAILABILITY_DURATION_MINUTES,
  AVAILABILITY_STEP_MINUTES,
} from "../scheduling/appointment-availability.js";
import { TENANT_TIMEZONE } from "../scheduling/appointment-invariants.js";

/**
 * Holder-facing availability contract (DEC-007 A2a).
 *
 * The holder does NOT choose a professional (DEC-007: staff assigns branch and
 * professional at approval) and the booking request carries neither, so this
 * read is a UNION across every in-tenant VETERINARIAN rather than a
 * per-professional schedule. Its query is therefore branch-less and
 * professional-less: `date`, `durationMinutes` and an optional `stepMinutes`.
 *
 * PRIVACY IS PART OF THE CONTRACT: the response is a list of times and nothing
 * else. It never names a professional, never returns a membership id, and never
 * exposes how many professionals are free or which one would take a slot (no
 * counts that imply staffing levels). It also omits the staff read's `basis`
 * flag: even "which day extent was used" is one scheduling-configuration bit
 * the holder does not need, and keeping it would falsify a literal "times only"
 * guarantee. The projection is built explicitly; a settings or membership row
 * is never spread.
 *
 * Data classification: appointment times are CONFIDENTIAL scheduling detail.
 * Nothing here is logged.
 */

/**
 * The query ALREADY normalized: the router hands `unknown` here and the service
 * only ever consumes a validated value.
 */
export interface PortalAvailabilityQuery {
  readonly date: string;
  readonly durationMinutes: number;
  /** Optional; when omitted the grid tiles the day with `durationMinutes`. */
  readonly stepMinutes?: number;
}

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/** Local calendar date `YYYY-MM-DD`; a non-existent day (e.g. Feb 30) fails. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealCalendarDate, { message: "date must be a real calendar date." });

/**
 * Portal availability query. Strict: unknown keys are rejected (a smuggled
 * `tenantId`, `branchId` or `professionalMembershipId` is a 400, never
 * silently ignored). `stepMinutes` defaults to `durationMinutes`; an explicit
 * step smaller than the duration is rejected so offered slots never overlap.
 */
export const portalAvailabilityQuerySchema = z
  .object({
    date: calendarDate,
    durationMinutes: z.coerce
      .number()
      .int()
      .min(AVAILABILITY_DURATION_MINUTES.min)
      .max(AVAILABILITY_DURATION_MINUTES.max),
    stepMinutes: z.coerce
      .number()
      .int()
      .min(AVAILABILITY_STEP_MINUTES.min)
      .max(AVAILABILITY_STEP_MINUTES.max)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const step = value.stepMinutes ?? value.durationMinutes;
    if (step < value.durationMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stepMinutes"],
        message: "stepMinutes must be at least durationMinutes so offered slots do not overlap.",
      });
    }
  });

/** The step actually used when the caller omitted `stepMinutes`. */
export function resolvePortalStepMinutes(query: PortalAvailabilityQuery): number {
  return query.stepMinutes ?? query.durationMinutes;
}

/** One offered slot as UTC ISO instants — times only, never an identity. */
export interface PortalAvailabilitySlot {
  readonly startAt: string;
  readonly endAt: string;
}

/**
 * Allowlisted CONFIDENTIAL response: exactly `date`, `timeZone`,
 * `durationMinutes`, `stepMinutes` and `slots`. No branch id, no professional
 * id, no free-professional count, and no basis/configuration flag — the fields
 * DEC-007 A2a forbids, plus the one bit that would break "times only".
 */
export interface PortalAvailabilityResponse {
  readonly date: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly stepMinutes: number;
  readonly slots: readonly PortalAvailabilitySlot[];
}

/** Builds the allowlisted response; never spreads a settings/membership row. */
export function toPortalAvailabilityResponse(
  query: PortalAvailabilityQuery,
  slots: readonly PortalAvailabilitySlot[]
): PortalAvailabilityResponse {
  return {
    date: query.date,
    timeZone: TENANT_TIMEZONE,
    durationMinutes: query.durationMinutes,
    stepMinutes: resolvePortalStepMinutes(query),
    slots,
  };
}
