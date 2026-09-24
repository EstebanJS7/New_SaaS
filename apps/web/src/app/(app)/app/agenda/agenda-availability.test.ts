/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { EventInput } from "@fullcalendar/core";
import {
  AVAILABILITY_BLOCK_EVENT_PREFIX,
  buildAvailabilityOverlay,
  resolveAvailabilityState,
  windowsToBusinessHours,
} from "./agenda-availability";
import type { SchedulingSettings } from "./agenda-api";

const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_BRANCH_ID = "66666666-6666-4666-8666-666666666666";

const WINDOWS: SchedulingSettings["availability"] = [
  // Monday split shift for the selected pair.
  {
    membershipId: MEMBERSHIP_ID,
    branchId: BRANCH_ID,
    weekday: 1,
    startMinute: 9 * 60,
    endMinute: 13 * 60,
  },
  {
    membershipId: MEMBERSHIP_ID,
    branchId: BRANCH_ID,
    weekday: 1,
    startMinute: 14 * 60,
    endMinute: 18 * 60,
  },
  // Wednesday morning.
  {
    membershipId: MEMBERSHIP_ID,
    branchId: BRANCH_ID,
    weekday: 3,
    startMinute: 8 * 60,
    endMinute: 12 * 60,
  },
  // Another professional on Monday: must never leak into the selected overlay.
  {
    membershipId: OTHER_MEMBERSHIP_ID,
    branchId: BRANCH_ID,
    weekday: 1,
    startMinute: 0,
    endMinute: 1440,
  },
  // Same professional at another branch: must never leak either.
  {
    membershipId: MEMBERSHIP_ID,
    branchId: OTHER_BRANCH_ID,
    weekday: 1,
    startMinute: 6 * 60,
    endMinute: 20 * 60,
  },
];

const BLOCKS: SchedulingSettings["blocks"] = [
  {
    membershipId: MEMBERSHIP_ID,
    branchId: BRANCH_ID,
    startsAt: "2026-09-14T13:00:00.000Z",
    endsAt: "2026-09-14T14:00:00.000Z",
  },
  {
    membershipId: OTHER_MEMBERSHIP_ID,
    branchId: BRANCH_ID,
    startsAt: "2026-09-14T15:00:00.000Z",
    endsAt: "2026-09-14T16:00:00.000Z",
  },
];

function settings(overrides: Partial<SchedulingSettings> = {}): SchedulingSettings {
  return {
    conflictPolicy: "REJECT",
    availability: WINDOWS,
    blocks: BLOCKS,
    ...overrides,
  };
}

describe("resolveAvailabilityState tri-state", () => {
  it("is unrestricted when the pair has no windows at all, so nothing is shaded", () => {
    // Only the OTHER professional has windows: the selected pair is unrestricted
    // and the write path accepts any in-day range, so the overlay must not shade.
    const windows = WINDOWS.filter((window) => window.membershipId === OTHER_MEMBERSHIP_ID);

    expect(resolveAvailabilityState(windows, MEMBERSHIP_ID, BRANCH_ID, 1)).toBe("unrestricted");

    const overlay = buildAvailabilityOverlay(
      settings({ availability: windows, blocks: [] }),
      MEMBERSHIP_ID,
      BRANCH_ID
    );
    expect(overlay.businessHours).toBe(false);
    expect(overlay.blockEvents).toEqual([]);
  });

  it("is unavailable when the pair has windows but none on this weekday", () => {
    // The pair is configured (Monday/Wednesday), but Tuesday has no window.
    expect(resolveAvailabilityState(WINDOWS, MEMBERSHIP_ID, BRANCH_ID, 2)).toBe("unavailable");

    const businessHours = buildAvailabilityOverlay(
      settings({ blocks: [] }),
      MEMBERSHIP_ID,
      BRANCH_ID
    ).businessHours;
    expect(businessHours).not.toBe(false);
    // Tuesday is absent from every entry, so FullCalendar shades the whole day.
    const entries = businessHours as readonly EventInput[];
    expect(entries.some((entry) => (entry.daysOfWeek as readonly number[]).includes(2))).toBe(
      false
    );
  });

  it("is available when the pair has windows on this weekday, shading the complement", () => {
    expect(resolveAvailabilityState(WINDOWS, MEMBERSHIP_ID, BRANCH_ID, 1)).toBe("available");

    expect(
      buildAvailabilityOverlay(settings({ blocks: [] }), MEMBERSHIP_ID, BRANCH_ID).businessHours
    ).toEqual([
      { daysOfWeek: [1], startTime: "09:00", endTime: "13:00" },
      { daysOfWeek: [1], startTime: "14:00", endTime: "18:00" },
      { daysOfWeek: [3], startTime: "08:00", endTime: "12:00" },
    ]);
  });
});

describe("windowsToBusinessHours grouping", () => {
  it("groups by weekday and HH:mm bounds, deduping duplicates and sorting", () => {
    const windows = [
      {
        membershipId: MEMBERSHIP_ID,
        branchId: BRANCH_ID,
        weekday: 1,
        startMinute: 14 * 60,
        endMinute: 18 * 60,
      },
      {
        membershipId: MEMBERSHIP_ID,
        branchId: BRANCH_ID,
        weekday: 1,
        startMinute: 9 * 60,
        endMinute: 13 * 60,
      },
      {
        membershipId: MEMBERSHIP_ID,
        branchId: BRANCH_ID,
        weekday: 1,
        startMinute: 9 * 60,
        endMinute: 13 * 60,
      },
    ];

    expect(windowsToBusinessHours(windows)).toEqual([
      { daysOfWeek: [1], startTime: "09:00", endTime: "13:00" },
      { daysOfWeek: [1], startTime: "14:00", endTime: "18:00" },
    ]);
  });

  it("renders an end at local midnight as 24:00", () => {
    expect(
      windowsToBusinessHours([
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          weekday: 0,
          startMinute: 0,
          endMinute: 1440,
        },
      ])
    ).toEqual([{ daysOfWeek: [0], startTime: "00:00", endTime: "24:00" }]);
  });
});

describe("buildAvailabilityOverlay blocks", () => {
  it("maps only the selected pair's blocks to display:background events", () => {
    const overlay = buildAvailabilityOverlay(settings(), MEMBERSHIP_ID, BRANCH_ID);

    expect(overlay.blockEvents).toEqual([
      {
        id: `${AVAILABILITY_BLOCK_EVENT_PREFIX}0`,
        start: "2026-09-14T13:00:00.000Z",
        end: "2026-09-14T14:00:00.000Z",
        display: "background",
        editable: false,
      },
    ]);
  });

  it("shades a block even when the pair is unrestricted by windows", () => {
    // No windows for the pair, but the block is still a real unavailability:
    // the write path rejects a range inside it regardless of the window state.
    const overlay = buildAvailabilityOverlay(
      settings({
        availability: WINDOWS.filter((window) => window.membershipId === OTHER_MEMBERSHIP_ID),
        blocks: BLOCKS,
      }),
      MEMBERSHIP_ID,
      BRANCH_ID
    );

    expect(overlay.businessHours).toBe(false);
    expect(overlay.blockEvents).toHaveLength(1);
    expect(overlay.blockEvents[0]?.display).toBe("background");
  });
});
