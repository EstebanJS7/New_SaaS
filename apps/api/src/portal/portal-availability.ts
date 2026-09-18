import type { SchedulingSettings } from "../settings/registry.js";
import {
  DEFAULT_DAY_RANGE,
  calendarDaySerial,
  resolveExistingDayMinuteUtc,
} from "../scheduling/appointment-availability.js";
import {
  appointmentsOverlap,
  intersectsBlock,
  isWithinAvailability,
} from "../scheduling/appointment-invariants.js";
import {
  resolvePortalStepMinutes,
  type PortalAvailabilityQuery,
  type PortalAvailabilitySlot,
} from "./portal-availability.dto.js";

/**
 * Portal availability UNION computation (DEC-007 A2a).
 *
 * SACRED RULE — reuse, do not re-derive. A candidate slot is filtered by
 * CALLING the SAME shared scheduling predicates the staff read and the write
 * path call:
 *   - {@link isWithinAvailability} decides whether a professional's windows
 *     accept the slot (and treats a window-less membership as unrestricted);
 *   - {@link intersectsBlock} decides the one-off block exclusion;
 *   - {@link appointmentsOverlap} decides the active-appointment exclusion.
 * Window minutes, overlap boundaries and the local->UTC conversion are NEVER
 * compared by hand here: the resolver comes from the staff availability module.
 *
 * The union differs from the staff read in ONE way: a slot is offered when AT
 * LEAST ONE in-tenant VETERINARIAN can take it, not when a specific
 * professional can. It is the "any available" reading the holder-facing
 * contract needs because the holder does not pick a practitioner.
 *
 * BRANCH DIMENSION: the holder does not pick a branch either. A professional
 * with windows is therefore evaluated at EACH branch it has windows for — the
 * shared predicate is called per branch — and accepted when at least one such
 * branch accepts. A branch where the professional has NO window is deliberately
 * NOT evaluated, because {@link isWithinAvailability} reports it as
 * unrestricted and would otherwise offer every slot. A professional with NO
 * windows at all is unrestricted, exactly as the write path treats it.
 *
 * KNOWN CONSERVATIVE OMISSION — grid alignment: the union tiles ONE global grid
 * anchored at the earliest contributing range start (the shared
 * `DEFAULT_DAY_RANGE` start when any professional is unrestricted). A window
 * whose first start falls off that grid is therefore not guaranteed to have
 * that exact first minute offered — only its grid-aligned minutes are. This is
 * a deliberate, conservative omission, NOT a correctness claim: every slot that
 * IS offered is still accepted by the write path for a candidate professional,
 * and the response stays ordered and non-overlapping. Per-window alignment
 * would offer strictly more starts and is out of scope here.
 */

/** One in-tenant membership the union is computed over (id only — never exposed). */
export interface PortalAvailabilityMembership {
  readonly id: string;
}

/** The subset of an active appointment row the overlap filter reads. */
export interface PortalAvailabilityAppointment {
  readonly professionalMembershipId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** Per-membership window/block view derived once, never inside the slot loop. */
interface MembershipProfile {
  readonly id: string;
  readonly hasWindows: boolean;
  /** Distinct branches the membership has windows for (the evaluation set). */
  readonly windowBranches: readonly string[];
  /** Distinct branches the membership has blocks for (unrestricted case only). */
  readonly blockBranches: readonly string[];
}

/** The display grid the union tiles. */
export interface PortalAvailabilityGrid {
  readonly startMinute: number;
  readonly endMinute: number;
  /** False when no membership contributes a candidate range on this weekday. */
  readonly hasCandidates: boolean;
}

/** Two-element `Set` factory used only to collect distinct branch ids. */
function distinctBranches(entries: readonly { readonly branchId: string }[]): string[] {
  return [...new Set(entries.map((entry) => entry.branchId))];
}

/**
 * Resolves the candidate grid across every VETERINARIAN membership:
 * - a membership with windows contributes the union of its windows that apply
 *   to the query's weekday (none -> it accepts nothing that day);
 * - a membership with NO windows is unrestricted, so it contributes the shared
 *   {@link DEFAULT_DAY_RANGE} fallback (07:00–21:00).
 * The grid is the envelope of those contributions. (The staff read's `basis`
 * flag is deliberately NOT computed: the holder response omits it.)
 */
export function resolvePortalAvailabilityGrid(
  settings: SchedulingSettings,
  membershipIds: readonly string[],
  date: string
): PortalAvailabilityGrid {
  // The weekday identity is derived EXACTLY as the staff window resolver derives
  // it: days-since-epoch of the local calendar date -> UTC weekday.
  const weekday = new Date(calendarDaySerial(date) * 86_400_000).getUTCDay();

  let startMinute = Number.POSITIVE_INFINITY;
  let endMinute = Number.NEGATIVE_INFINITY;

  for (const membershipId of membershipIds) {
    const windows = settings.availability.filter((window) => window.membershipId === membershipId);
    if (windows.length === 0) {
      startMinute = Math.min(startMinute, DEFAULT_DAY_RANGE.startMinute);
      endMinute = Math.max(endMinute, DEFAULT_DAY_RANGE.endMinute);
      continue;
    }
    const weekdayWindows = windows.filter((window) => window.weekday === weekday);
    if (weekdayWindows.length === 0) {
      continue;
    }
    startMinute = Math.min(startMinute, ...weekdayWindows.map((window) => window.startMinute));
    endMinute = Math.max(endMinute, ...weekdayWindows.map((window) => window.endMinute));
  }

  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
    return { startMinute: 0, endMinute: 0, hasCandidates: false };
  }
  return { startMinute, endMinute, hasCandidates: true };
}

function buildMembershipProfile(
  settings: SchedulingSettings,
  membershipId: string
): MembershipProfile {
  const windows = settings.availability.filter((window) => window.membershipId === membershipId);
  const blocks = settings.blocks.filter((block) => block.membershipId === membershipId);
  return {
    id: membershipId,
    hasWindows: windows.length > 0,
    windowBranches: distinctBranches(windows),
    blockBranches: distinctBranches(blocks),
  };
}

/**
 * True when the membership could take the slot: BOTH the availability/block
 * predicates accept it (per branch) AND no active appointment overlaps it.
 *
 * Appointments are membership-level by contract ("no ACTIVE appointment for
 * that membership overlaps the slot"), so they suppress the membership wherever
 * the slot is offered.
 */
function membershipAccepts(
  profile: MembershipProfile,
  settings: SchedulingSettings,
  startAt: Date,
  endAt: Date,
  activeAppointments: readonly PortalAvailabilityAppointment[]
): boolean {
  const busy = activeAppointments.some(
    (appointment) =>
      appointment.professionalMembershipId === profile.id &&
      appointmentsOverlap(startAt, endAt, appointment.startAt, appointment.endAt)
  );
  if (busy) {
    return false;
  }

  if (!profile.hasWindows) {
    // Unrestricted: the write path accepts any in-day range, so only a one-off
    // block can withhold the slot. Blocks are branch-scoped and the holder picks
    // no branch, so a block on ANY of the membership's block branches withholds
    // it (conservative: never offer a slot staff could find blocked).
    return !profile.blockBranches.some((branchId) =>
      intersectsBlock(startAt, endAt, settings.blocks, profile.id, branchId)
    );
  }

  return profile.windowBranches.some(
    (branchId) =>
      isWithinAvailability(startAt, endAt, settings.availability, profile.id, branchId) &&
      !intersectsBlock(startAt, endAt, settings.blocks, profile.id, branchId)
  );
}

/**
 * Pure union slot computation over an already-fetched membership set and the
 * day's active appointments. Every boundary is decided by a shared predicate;
 * this function only tiles the grid, unions the accepting memberships and
 * enforces the ordered/non-overlapping response contract.
 */
export function computePortalAvailableSlots(params: {
  readonly query: PortalAvailabilityQuery;
  readonly settings: SchedulingSettings;
  readonly membershipIds: readonly string[];
  readonly activeAppointments: readonly PortalAvailabilityAppointment[];
}): readonly PortalAvailabilitySlot[] {
  const { query, settings, membershipIds, activeAppointments } = params;
  const grid = resolvePortalAvailabilityGrid(settings, membershipIds, query.date);
  if (!grid.hasCandidates) {
    return [];
  }

  const durationMs = query.durationMinutes * 60_000;
  const stepMinutes = resolvePortalStepMinutes(query);
  // Profiles are derived ONCE, outside the candidate loop.
  const profiles = membershipIds.map((membershipId) =>
    buildMembershipProfile(settings, membershipId)
  );

  const slots: PortalAvailabilitySlot[] = [];
  let lastEndMs = Number.NEGATIVE_INFINITY;

  for (
    let minute = grid.startMinute;
    minute + query.durationMinutes <= grid.endMinute;
    minute += stepMinutes
  ) {
    const startAt = resolveExistingDayMinuteUtc(query.date, minute);
    // DST gap: a local time that does not exist yields no instant, so skip it.
    if (startAt === null) {
      continue;
    }
    const endAt = new Date(startAt.getTime() + durationMs);
    // The response contract is "ordered and non-overlapping"; with
    // step >= duration the grid cannot self-overlap, but the guard keeps that
    // guarantee true for the union of overlapping memberships too.
    if (startAt.getTime() < lastEndMs) {
      continue;
    }
    if (
      !profiles.some((profile) =>
        membershipAccepts(profile, settings, startAt, endAt, activeAppointments)
      )
    ) {
      continue;
    }

    slots.push({ startAt: startAt.toISOString(), endAt: endAt.toISOString() });
    lastEndMs = endAt.getTime();
  }

  return slots;
}
