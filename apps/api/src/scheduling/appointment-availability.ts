import { DomainError } from "@newsaas/shared";
import { z } from "zod";
import type { SchedulingSettings } from "../settings/registry.js";
import {
  TENANT_TIMEZONE,
  appointmentsOverlap,
  intersectsBlock,
  isWithinAvailability,
  toZonedParts,
} from "./appointment-invariants.js";

/**
 * Read-only appointment availability (DEC-007 A1, "agenda v2").
 *
 * ONE-WAY GUARANTEE: every slot offered here is accepted by the write path for
 * the same branch and professional (a valid patient is still required). The
 * converse does NOT hold: the read may hide a slot the write path would accept,
 * in exactly four cases:
 *   1. active overlaps under `conflictPolicy: "ALLOW"` — the write path permits
 *      overlaps, the read always excludes them (a "free" slot already taken
 *      would be a lie);
 *   2. starts that are off the requested `stepMinutes` grid;
 *   3. times outside the 07:00–21:00 fallback day when the pair has no
 *      configured availability windows (the write path is unrestricted there);
 *   4. the second occurrence of an ambiguous wall time during a fall-back DST
 *      fold (the grid visits each local wall minute once).
 *
 * It does not re-derive the math: candidate slots are filtered by CALLING
 * {@link isWithinAvailability} and {@link intersectsBlock}, and the day's active
 * appointments are read with the SAME status list and the SAME strict interval
 * predicate the create/approve paths use ({@link appointmentsOverlap} is the
 * in-memory twin of `assertNoOverlap`'s SQL).
 */

/** Inclusive duration bounds for a candidate slot, in minutes. */
export const AVAILABILITY_DURATION_MINUTES = Object.freeze({ min: 5, max: 480 });

/** Inclusive start-grid step bounds, in minutes. */
export const AVAILABILITY_STEP_MINUTES = Object.freeze({ min: 5, max: 480 });

/**
 * The day range offered when the (professional, branch) pair has NO availability
 * windows configured at all. `isWithinAvailability` treats that case as
 * unrestricted — the write path ACCEPTS any in-day range — so the endpoint has
 * to pick a display window of its own. 07:00–21:00 is the range the staff agenda
 * already renders, so the product default and the offered grid agree.
 */
export const DEFAULT_DAY_RANGE = Object.freeze({ startMinute: 7 * 60, endMinute: 21 * 60 });

/**
 * Which basis produced the offered slots:
 * - `CONFIGURED_WINDOWS` — the pair has availability windows and the day was
 *   derived from the windows that apply to this weekday (an empty day is
 *   possible, and then the response carries zero slots).
 * - `DEFAULT_DAY_RANGE` — the pair has no windows at all, so the write path is
 *   unrestricted and the endpoint used {@link DEFAULT_DAY_RANGE}.
 */
export type AvailabilityBasis = "CONFIGURED_WINDOWS" | "DEFAULT_DAY_RANGE";

/** One offered slot as UTC ISO instants (never a Prisma model). */
export interface AvailabilitySlotDto {
  readonly startAt: string;
  readonly endAt: string;
}

/** Allowlisted CONFIDENTIAL availability response. */
export interface AvailabilityResponse {
  readonly date: string;
  readonly branchId: string;
  readonly professionalMembershipId: string;
  readonly durationMinutes: number;
  readonly stepMinutes: number;
  readonly timeZone: string;
  readonly basis: AvailabilityBasis;
  readonly slots: readonly AvailabilitySlotDto[];
}

/** Validated availability query. `tenantId` is NEVER accepted. */
export interface AvailabilityQuery {
  readonly branchId: string;
  readonly professionalMembershipId: string;
  readonly date: string;
  readonly durationMinutes: number;
  /** Optional; when omitted the service tiles the day with `durationMinutes`. */
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
 * Availability query. Strict: unknown keys are rejected. `stepMinutes` defaults
 * to `durationMinutes` so the offered slots tile the day without overlapping;
 * an explicit step smaller than the duration is rejected for the same reason.
 */
export const availabilityQuerySchema = z
  .object({
    branchId: z.string().uuid(),
    professionalMembershipId: z.string().uuid(),
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
export function resolveStepMinutes(input: AvailabilityQuery): number {
  return input.stepMinutes ?? input.durationMinutes;
}

// ---------------------------------------------------------------------------
// Timezone conversion (tenant-local wall clock -> absolute UTC instant)
// ---------------------------------------------------------------------------

/**
 * Instant -> tenant offset in milliseconds. Using `Intl` (not a fixed offset)
 * means the tenant offset, including any DST shift, is resolved per instant.
 */
const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TENANT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function timeZoneOffsetMs(instant: Date): number {
  const parts = offsetFormatter.formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const wallAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second")
  );
  return wallAsUtc - instant.getTime();
}

/** Resolves one tenant-local wall-clock minute to its absolute UTC instant. */
function zonedWallTimeToUtc(year: number, month: number, day: number, minuteOfDay: number): Date {
  const wallMs = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // Two passes are enough for the fixed tenant offsets in play; the loop stops
  // as soon as the offset is stable.
  let candidate = wallMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const adjusted = wallMs - timeZoneOffsetMs(new Date(candidate));
    if (adjusted === candidate) {
      break;
    }
    candidate = adjusted;
  }
  return new Date(candidate);
}

function parseCalendarDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  if (!isRealCalendarDate(date) || !Number.isFinite(year)) {
    throw new DomainError("VALIDATION_FAILED", "date must be a real calendar date.");
  }
  return { year, month, day };
}

/**
 * Calendar-day identity of a tenant-local `YYYY-MM-DD`, derived EXACTLY the way
 * {@link toZonedParts} derives `daySerial` (days since the Unix epoch of the
 * formatted local date). Sharing the formula keeps the endpoint and the
 * availability predicate on the same day identity.
 */
export function calendarDaySerial(date: string): number {
  const { year, month, day } = parseCalendarDate(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Raw conversion of a tenant-local wall-clock minute to an absolute UTC
 * instant. It does NOT refuse a nonexistent wall time: a spring-forward gap
 * minute resolves to a real nearby instant. This is what the overlap query's
 * day bounds need (a monotonic superset bound). Candidate generation must use
 * {@link resolveExistingDayMinuteUtc} instead.
 */
export function zonedDayMinuteToUtc(date: string, minuteOfDay: number): Date {
  const { year, month, day } = parseCalendarDate(date);
  return zonedWallTimeToUtc(year, month, day, minuteOfDay);
}

/**
 * Resolves a tenant-local wall-clock minute to its absolute UTC instant, or
 * `null` when that wall time does not exist (a spring-forward gap). A gap minute
 * maps onto a real post-gap instant whose local reading differs, so it is
 * REFUSED rather than offered. On a fall-back fold (an ambiguous wall minute)
 * the offset iteration deterministically resolves to the FIRST occurrence.
 *
 * Exported so a direct unit test keeps this refusal revert-sensitive: the HTTP
 * integration test cannot observe its removal, because the mapped post-gap
 * candidates are also suppressed by the non-overlap guard.
 */
export function resolveExistingDayMinuteUtc(date: string, minuteOfDay: number): Date | null {
  const instant = zonedDayMinuteToUtc(date, minuteOfDay);
  const parts = toZonedParts(instant);
  if (parts.daySerial !== calendarDaySerial(date) || parts.minuteOfDay !== minuteOfDay) {
    return null;
  }
  return instant;
}

// ---------------------------------------------------------------------------
// Candidate window
// ---------------------------------------------------------------------------

/** The day range the endpoint searches, plus which basis produced it. */
export interface AvailabilityWindow {
  readonly basis: AvailabilityBasis;
  readonly weekday: number;
  readonly dayStartMinute: number;
  readonly dayEndMinute: number;
  /** False when the pair is configured but has NO windows on this weekday. */
  readonly hasCandidates: boolean;
}

/**
 * Resolves the day the endpoint searches. The `(membership, branch)` filter and
 * the weekday are copied from the predicate's own rule, so the endpoint cannot
 * offer a slot the predicate would reject for a missing window.
 */
export function resolveAvailabilityWindow(
  date: string,
  membershipId: string,
  branchId: string,
  settings: SchedulingSettings
): AvailabilityWindow {
  const targetDaySerial = calendarDaySerial(date);
  const weekday = new Date(targetDaySerial * 86_400_000).getUTCDay();
  const pairWindows = settings.availability.filter(
    (window) => window.membershipId === membershipId && window.branchId === branchId
  );

  if (pairWindows.length === 0) {
    return {
      basis: "DEFAULT_DAY_RANGE",
      weekday,
      dayStartMinute: DEFAULT_DAY_RANGE.startMinute,
      dayEndMinute: DEFAULT_DAY_RANGE.endMinute,
      hasCandidates: true,
    };
  }

  const weekdayWindows = pairWindows.filter((window) => window.weekday === weekday);
  if (weekdayWindows.length === 0) {
    // Windows exist for the pair but not for this weekday: the write path
    // rejects every slot on this day, so the endpoint offers none.
    return {
      basis: "CONFIGURED_WINDOWS",
      weekday,
      dayStartMinute: 0,
      dayEndMinute: 0,
      hasCandidates: false,
    };
  }

  return {
    basis: "CONFIGURED_WINDOWS",
    weekday,
    dayStartMinute: Math.min(...weekdayWindows.map((window) => window.startMinute)),
    dayEndMinute: Math.max(...weekdayWindows.map((window) => window.endMinute)),
    hasCandidates: true,
  };
}

// ---------------------------------------------------------------------------
// Slot computation
// ---------------------------------------------------------------------------

/** Minimal active-appointment range the overlap filter needs. */
export interface ActiveAppointmentRange {
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * Pure slot computation over an already-fetched set of the day's active
 * appointments. Availability, blocks, DST and overlap are decided by the SAME
 * shared predicates/functions the write path uses — never by new math.
 */
export function computeAvailableSlots(params: {
  readonly input: AvailabilityQuery;
  readonly settings: SchedulingSettings;
  readonly window: AvailabilityWindow;
  readonly activeAppointments: readonly ActiveAppointmentRange[];
}): AvailabilitySlotDto[] {
  const { input, settings, window, activeAppointments } = params;
  if (!window.hasCandidates) {
    return [];
  }

  const durationMs = input.durationMinutes * 60_000;
  const stepMinutes = resolveStepMinutes(input);
  const slots: AvailabilitySlotDto[] = [];
  let lastEndMs = Number.NEGATIVE_INFINITY;

  for (
    let minute = window.dayStartMinute;
    minute + input.durationMinutes <= window.dayEndMinute;
    minute += stepMinutes
  ) {
    const startAt = resolveExistingDayMinuteUtc(input.date, minute);
    // DST gap: a local time that does not exist yields no instant, so skip it.
    if (startAt === null) {
      continue;
    }

    const endAt = new Date(startAt.getTime() + durationMs);
    if (
      !isWithinAvailability(
        startAt,
        endAt,
        settings.availability,
        input.professionalMembershipId,
        input.branchId
      )
    ) {
      continue;
    }
    if (
      intersectsBlock(
        startAt,
        endAt,
        settings.blocks,
        input.professionalMembershipId,
        input.branchId
      )
    ) {
      continue;
    }
    // Defensive: with step >= duration the grid cannot self-overlap, but the
    // response contract is "ordered and non-overlapping", so enforce it.
    if (startAt.getTime() < lastEndMs) {
      continue;
    }
    if (
      activeAppointments.some((appointment) =>
        appointmentsOverlap(startAt, endAt, appointment.startAt, appointment.endAt)
      )
    ) {
      continue;
    }

    slots.push({ startAt: startAt.toISOString(), endAt: endAt.toISOString() });
    lastEndMs = endAt.getTime();
  }

  return slots;
}

/** Builds the allowlisted response; never spreads a row or settings value. */
export function toAvailabilityResponse(
  input: AvailabilityQuery,
  basis: AvailabilityBasis,
  slots: readonly AvailabilitySlotDto[]
): AvailabilityResponse {
  return {
    date: input.date,
    branchId: input.branchId,
    professionalMembershipId: input.professionalMembershipId,
    durationMinutes: input.durationMinutes,
    stepMinutes: resolveStepMinutes(input),
    timeZone: TENANT_TIMEZONE,
    basis,
    slots,
  };
}
