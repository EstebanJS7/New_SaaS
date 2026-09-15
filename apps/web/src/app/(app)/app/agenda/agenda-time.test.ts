/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  addMonthsToKey,
  dateKeyOf,
  durationMinutes,
  formatDateKey,
  isoToLocalInput,
  localInputToIso,
  minuteOfDay,
  monthGridKeys,
  parseDateKey,
  shiftIsoByMinutes,
  startOfWeekKey,
  tryLocalInputToIso,
  weekKeys,
  zonedLocalToIso,
} from "./agenda-time";

describe("agenda-time calendar keys", () => {
  it("parses and formats calendar keys", () => {
    expect(parseDateKey("2026-09-14")).toEqual({ year: 2026, month: 9, day: 14 });
    expect(formatDateKey(2026, 9, 4)).toBe("2026-09-04");
  });

  it("adds days and months across boundaries", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonthsToKey("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("builds Monday-first weeks and 42-day month grids", () => {
    const week = weekKeys("2026-09-14");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe(startOfWeekKey("2026-09-14"));
    expect(parseDateKey(week[0])).toBeDefined();
    // The first grid key is the Monday on or before the first of the month.
    const grid = monthGridKeys("2026-09-14");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe(startOfWeekKey("2026-09-01"));
  });
});

describe("agenda-time tenant wall clock", () => {
  it("round-trips a tenant wall-clock input through UTC", () => {
    const iso = localInputToIso("2026-09-14T09:00");
    expect(iso.endsWith("Z")).toBe(true);
    expect(isoToLocalInput(iso)).toBe("2026-09-14T09:00");
    expect(minuteOfDay(iso)).toBe(540);
  });

  it("round-trips wall-clock inputs on both sides of the DST regime", () => {
    for (const value of ["2024-07-01T10:00", "2024-12-01T10:00", "2026-03-15T18:30"]) {
      const iso = zonedLocalToIso(
        value.slice(0, 10),
        Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16))
      );
      expect(isoToLocalInput(iso)).toBe(value);
    }
  });

  it("derives the calendar key and duration from instants", () => {
    const iso = localInputToIso("2026-09-14T23:30");
    expect(dateKeyOf(iso)).toBe("2026-09-14");
    expect(durationMinutes("2026-09-14T12:00:00.000Z", "2026-09-14T12:45:00.000Z")).toBe(45);
  });

  it("shifts instants by minutes without mutating the source", () => {
    const iso = "2026-09-14T12:00:00.000Z";
    expect(shiftIsoByMinutes(iso, 30)).toBe("2026-09-14T12:30:00.000Z");
    expect(shiftIsoByMinutes(iso, -15)).toBe("2026-09-14T11:45:00.000Z");
    expect(iso).toBe("2026-09-14T12:00:00.000Z");
  });

  it("rejects malformed wall-clock input", () => {
    expect(() => localInputToIso("not-a-date")).toThrowError(/Invalid local datetime/);
  });

  it("rejects clock components outside the 00–23 hour / 00–59 minute range", () => {
    // `Date` would silently roll these forward (`24:00` → next day 00:00,
    // `09:60` → 10:00); the input must instead be rejected so staff never write a
    // different instant than the one they typed.
    expect(() => localInputToIso("2026-09-14T24:00")).toThrowError(/Invalid local datetime/);
    expect(() => localInputToIso("2026-09-14T09:60")).toThrowError(/Invalid local datetime/);
    expect(() => localInputToIso("2026-09-14T25:00")).toThrowError(/Invalid local datetime/);
    expect(() => localInputToIso("2026-09-14T99:99")).toThrowError(/Invalid local datetime/);
    expect(tryLocalInputToIso("2026-09-14T24:00")).toBeNull();
    expect(tryLocalInputToIso("2026-09-14T09:60")).toBeNull();
  });

  it("still accepts the inclusive 00:00 and 23:59 boundaries", () => {
    expect(isoToLocalInput(localInputToIso("2026-09-14T00:00"))).toBe("2026-09-14T00:00");
    expect(isoToLocalInput(localInputToIso("2026-09-14T23:59"))).toBe("2026-09-14T23:59");
  });
});

describe("agenda-time DST gaps and folds", () => {
  // Paraguay's spring-forward: 2024-10-06 04:00Z switches UTC-4 → UTC-3, so the
  // local wall clock jumps from 2024-10-05T23:59 to 2024-10-06T01:00 — the
  // 00:00–00:59 local hour does not exist.
  it("rejects a local wall time that falls inside a spring-forward gap", () => {
    expect(() => zonedLocalToIso("2024-10-06", 0)).toThrowError(/Nonexistent local time/);
    expect(() => zonedLocalToIso("2024-10-06", 30)).toThrowError(/Nonexistent local time/);
    expect(tryLocalInputToIso("2024-10-06T00:30")).toBeNull();
  });

  it("accepts the first real local time after a spring-forward gap", () => {
    const iso = zonedLocalToIso("2024-10-06", 60);
    expect(iso).toBe("2024-10-06T04:00:00.000Z");
    expect(isoToLocalInput(iso)).toBe("2024-10-06T01:00");
  });

  // Paraguay's fall-back: 2024-03-24 03:00Z switches UTC-3 → UTC-4, repeating the
  // 2024-03-23 23:00–23:59 local hour. The fold resolves to the earlier instant.
  it("resolves an ambiguous fall-back fold to the earlier instant", () => {
    const iso = zonedLocalToIso("2024-03-23", 23 * 60 + 30);
    expect(iso).toBe("2024-03-24T02:30:00.000Z");
    expect(isoToLocalInput(iso)).toBe("2024-03-23T23:30");
  });

  it("rejects an impossible calendar date", () => {
    expect(() => parseDateKey("2026-02-30")).toThrowError(/Invalid calendar date/);
    expect(() => parseDateKey("2026-13-01")).toThrowError(/Invalid calendar date/);
    expect(tryLocalInputToIso("2026-02-30T09:00")).toBeNull();
  });
});
