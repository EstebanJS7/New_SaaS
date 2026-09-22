import type { EventInput } from "@fullcalendar/core";
import type {
  SchedulingAvailabilityWindow,
  SchedulingBlock,
  SchedulingSettings,
} from "./agenda-api";

/**
 * Staff-agenda availability overlay (EPIC-07; authorized by DEC-009).
 *
 * DISPLAY ONLY. This module never feeds FullCalendar's `selectConstraint`,
 * `eventConstraint` or `overlap` options. The write path
 * (`apps/api/src/scheduling/appointment-invariants.ts` ->
 * `assertAppointmentAvailability`) requires the WHOLE appointment to fit inside
 * ONE availability window (`isWithinAvailability`) and to avoid every one-off
 * block (`intersectsBlock`). `businessHours` is a UNION of ranges, so it cannot
 * express the one-window rule, and a forbidden block cannot be handed DIRECTLY
 * to `selectConstraint` as an allowed-range constraint. Equivalent logic COULD
 * be enforced through custom allow callbacks or computed allowed ranges, but
 * reusing this display overlay as the enforcement source would make the calendar
 * a second, wrong source of truth — and DEC-007 frames availability as a hint,
 * not a reservation. The overlay only shades what staff can see; the API stays
 * the source of truth.
 *
 * The `(membershipId, branchId)` pair is TRI-STATE:
 * - the pair has NO windows at all -> the write path is unrestricted -> shade
 *   NOTHING (`businessHours: false`);
 * - the pair HAS windows but none on this weekday -> the day is unavailable ->
 *   the whole day is shaded;
 * - the pair has windows on this weekday -> the COMPLEMENT of those windows is
 *   shaded.
 *
 * The second and third states fall out of FullCalendar's `businessHours`
 * semantics: it shades the non-business complement, so a weekday that appears in
 * no entry is shaded in full. Conflating the first state with the second would
 * shade every day for a pair the backend actually treats as unrestricted — the
 * bug this module exists to prevent.
 */

/** One local wall-clock availability window, keyed to a (professional, branch) pair. */
export type AvailabilityWindow = SchedulingAvailabilityWindow;

/** One non-recurring block over an absolute UTC range for a professional. */
export type AvailabilityBlock = SchedulingBlock;

/** The tri-state of a (professional, branch) pair for one weekday. */
export type AvailabilityState = "unrestricted" | "unavailable" | "available";

/** The overlay props threaded into the FullCalendar views. */
export interface AvailabilityOverlay {
  /** `false` when the pair is unrestricted, so FullCalendar shades nothing. */
  readonly businessHours: false | readonly EventInput[];
  /** One-off blocks as `display: "background"` events. */
  readonly blockEvents: readonly EventInput[];
}

/** Namespaces a block background event id so it can never collide with an appointment. */
export const AVAILABILITY_BLOCK_EVENT_PREFIX = "availability-block:";

/** Formats minutes past local midnight as a FullCalendar `"HH:mm"` bound. */
function minuteToHhmm(minute: number): string {
  const hour = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const minutePart = (minute % 60).toString().padStart(2, "0");
  return `${hour}:${minutePart}`;
}

/**
 * Resolves the tri-state for ONE weekday. The pair-level `unrestricted` case
 * wins regardless of weekday: it is the case where the write path accepts any
 * in-day range, so the overlay must not shade anything.
 */
export function resolveAvailabilityState(
  windows: readonly AvailabilityWindow[],
  membershipId: string,
  branchId: string,
  weekday: number
): AvailabilityState {
  const pairWindows = windows.filter(
    (window) => window.membershipId === membershipId && window.branchId === branchId
  );
  if (pairWindows.length === 0) {
    return "unrestricted";
  }
  return pairWindows.some((window) => window.weekday === weekday) ? "available" : "unavailable";
}

/**
 * Groups windows into `businessHours` entries by weekday and `"HH:mm"` bounds.
 * FullCalendar shades the complement of these ranges, so an omitted weekday is
 * shaded in full and a listed weekday keeps only its windows clear. Duplicate
 * `(weekday, start, end)` triples are collapsed and the output is sorted for
 * deterministic rendering.
 */
export function windowsToBusinessHours(
  windows: readonly AvailabilityWindow[]
): readonly EventInput[] {
  const seen = new Set<string>();
  const entries: EventInput[] = [];
  const ordered = [...windows].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute || a.endMinute - b.endMinute
  );
  for (const window of ordered) {
    const startTime = minuteToHhmm(window.startMinute);
    const endTime = minuteToHhmm(window.endMinute);
    const key = `${window.weekday}:${startTime}-${endTime}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ daysOfWeek: [window.weekday], startTime, endTime });
  }
  return entries;
}

/** Maps one block to a non-interactive background event on the calendar. */
function blockToBackgroundEvent(block: AvailabilityBlock, index: number): EventInput {
  return {
    id: `${AVAILABILITY_BLOCK_EVENT_PREFIX}${index}`,
    start: block.startsAt,
    end: block.endsAt,
    display: "background",
    editable: false,
  };
}

/**
 * Builds the overlay for one selected pair. The blocks of the pair are shaded
 * independently of the window tri-state: the write path rejects a range inside a
 * block even when the pair has no windows, so a block is real unavailability in
 * every state.
 */
export function buildAvailabilityOverlay(
  settings: SchedulingSettings,
  membershipId: string,
  branchId: string
): AvailabilityOverlay {
  const pairWindows = settings.availability.filter(
    (window) => window.membershipId === membershipId && window.branchId === branchId
  );
  const blockEvents = settings.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.membershipId === membershipId && block.branchId === branchId)
    .map(({ block, index }) => blockToBackgroundEvent(block, index));

  if (pairWindows.length === 0) {
    // Unrestricted pair: FullCalendar shades nothing at all.
    return { businessHours: false, blockEvents };
  }
  return { businessHours: windowsToBusinessHours(pairWindows), blockEvents };
}
