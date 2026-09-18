import { describe, expect, it } from "vitest";
import { TENANT_TIMEZONE, toZonedParts } from "./appointment-invariants.js";
import { resolveExistingDayMinuteUtc } from "./appointment-availability.js";

/**
 * Unit proof for the nonexistent-local-time refusal (DEC-007 A1).
 *
 * The HTTP integration suite CANNOT observe this guard: a grid point inside a
 * spring-forward gap maps onto a real post-gap instant, and the later genuine
 * candidate that the guard would have prevented is then also suppressed by the
 * non-overlap guard. Removing the refusal therefore leaves the HTTP response
 * byte-identical. These assertions target the refusal directly, so its removal
 * fails a test instead of passing silently.
 */

const zoneFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TENANT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Tenant-zone offset at an instant, derived from `Intl` (never hardcoded). */
function zoneOffsetMsAt(instantMs: number): number {
  const parts = zoneFormatter.formatToParts(new Date(instantMs));
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
  return wallAsUtc - instantMs;
}

interface Transition {
  readonly utcMs: number;
  readonly offsetBeforeMs: number;
  readonly offsetAfterMs: number;
}

/** Every tenant-zone offset change in `year`, resolved by hourly probing. */
function findTransitions(year: number): Transition[] {
  const transitions: Transition[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  let previous = zoneOffsetMsAt(start);
  for (let ms = start + 3_600_000; ms < end; ms += 3_600_000) {
    const current = zoneOffsetMsAt(ms);
    if (current !== previous) {
      transitions.push({ utcMs: ms, offsetBeforeMs: previous, offsetAfterMs: current });
      previous = current;
    }
  }
  return transitions;
}

const TRANSITIONS_2024 = findTransitions(2024);
const SPRING_FORWARD = TRANSITIONS_2024.find(
  (transition) => transition.offsetAfterMs > transition.offsetBeforeMs
);
const FALL_BACK = TRANSITIONS_2024.find(
  (transition) => transition.offsetAfterMs < transition.offsetBeforeMs
);

/** Wall-clock reading of an instant as a UTC-encoded value (offset added). */
function wallClockUtc(instantMs: number, offsetMs: number): number {
  return instantMs + offsetMs;
}

function dateKeyOfWallClock(wallMs: number): string {
  return new Date(wallMs).toISOString().slice(0, 10);
}

function minuteOfWallClock(wallMs: number): number {
  const wall = new Date(wallMs);
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
}

describe("availability wall-clock conversion (unit)", () => {
  it("refuses every local minute inside a real spring-forward gap", () => {
    if (!SPRING_FORWARD) {
      throw new Error("America/Asuncion 2024 spring-forward transition not found");
    }
    const gapStartWall = wallClockUtc(SPRING_FORWARD.utcMs, SPRING_FORWARD.offsetBeforeMs);
    const gapEndWall = wallClockUtc(SPRING_FORWARD.utcMs, SPRING_FORWARD.offsetAfterMs);
    const gapDate = dateKeyOfWallClock(gapStartWall);
    const gapStartMinute = minuteOfWallClock(gapStartWall);
    const gapEndMinute = minuteOfWallClock(gapEndWall);
    expect(gapEndMinute).toBeGreaterThan(gapStartMinute);

    for (let minute = gapStartMinute; minute < gapEndMinute; minute += 1) {
      expect(resolveExistingDayMinuteUtc(gapDate, minute), `gap minute ${minute}`).toBeNull();
    }

    // The first minute after the gap is the transition instant itself.
    const firstExisting = resolveExistingDayMinuteUtc(gapDate, gapEndMinute);
    expect(firstExisting).not.toBeNull();
    expect(firstExisting!.getTime()).toBe(SPRING_FORWARD.utcMs);
    expect(toZonedParts(firstExisting!).minuteOfDay).toBe(gapEndMinute);
  });

  it("resolves an ambiguous fall-back wall minute to its FIRST occurrence", () => {
    if (!FALL_BACK) {
      throw new Error("America/Asuncion 2024 fall-back transition not found");
    }
    const wallAfter = wallClockUtc(FALL_BACK.utcMs, FALL_BACK.offsetAfterMs);
    const foldDate = dateKeyOfWallClock(wallAfter);
    const ambiguousMinute = minuteOfWallClock(wallAfter);
    const foldDayStartUtc = Date.UTC(
      new Date(wallAfter).getUTCFullYear(),
      new Date(wallAfter).getUTCMonth(),
      new Date(wallAfter).getUTCDate()
    );
    const wallMs = foldDayStartUtc + ambiguousMinute * 60_000;
    const firstOccurrence = wallMs - FALL_BACK.offsetBeforeMs;
    const secondOccurrence = wallMs - FALL_BACK.offsetAfterMs;

    const resolved = resolveExistingDayMinuteUtc(foldDate, ambiguousMinute);
    expect(resolved).not.toBeNull();
    expect(resolved!.getTime()).toBe(firstOccurrence);
    expect(resolved!.getTime()).not.toBe(secondOccurrence);
    // Both occurrences read as the SAME wall minute — which is exactly why the
    // resolver must pick one deterministically.
    expect(toZonedParts(new Date(firstOccurrence)).minuteOfDay).toBe(ambiguousMinute);
    expect(toZonedParts(new Date(secondOccurrence)).minuteOfDay).toBe(ambiguousMinute);
  });

  it("resolves an ordinary local minute to its zone-correct instant", () => {
    const minute = 9 * 60;
    const resolved = resolveExistingDayMinuteUtc("2026-06-15", minute);
    expect(resolved).not.toBeNull();
    expect(toZonedParts(resolved!)).toMatchObject({
      daySerial: Math.floor(Date.UTC(2026, 5, 15) / 86_400_000),
      minuteOfDay: minute,
    });
  });
});
