"use client";

/**
 * Pure date/time helpers for the staff agenda (EPIC-07 WU4).
 *
 * Appointment instants are persisted in UTC and converted to the tenant wall
 * clock only at the presentation/input boundary, mirroring the API's shared
 * `TENANT_TIMEZONE`. Nothing here mutates its inputs; every conversion goes
 * through `Intl` so DST transitions resolve against real tzdata instead of a
 * frozen offset.
 */

/** Tenant wall clock used by the MVP (PRD fixes a single timezone). */
export const AGENDA_TIME_ZONE = "America/Asuncion";

/** Calendar weeks start on Monday. */
const WEEK_START_OFFSET: Record<number, number> = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };

export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Splits a `YYYY-MM-DD` calendar key into its numeric parts. */
export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    throw new Error(`Invalid date key: ${key}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // `Date.UTC` silently rolls impossible dates over (e.g. Feb 30 → Mar 2), so a
  // round-trip mismatch means the key is not a real calendar date.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${key}`);
  }
  return { year, month, day };
}

/** Formats numeric calendar parts as a `YYYY-MM-DD` key. */
export function formatDateKey(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Splits an instant into the wall-clock parts of the given timezone. */
export function zonedParts(date: Date, timeZone = AGENDA_TIME_ZONE): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number(value);
  };
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** The wall-clock calendar key (`YYYY-MM-DD`) for an instant. */
export function dateKeyOf(iso: string, timeZone = AGENDA_TIME_ZONE): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return formatDateKey(parts.year, parts.month, parts.day);
}

/** The wall-clock minutes since local midnight for an instant. */
export function minuteOfDay(iso: string, timeZone = AGENDA_TIME_ZONE): number {
  const parts = zonedParts(new Date(iso), timeZone);
  return parts.hour * 60 + parts.minute;
}

/**
 * The wall clock, encoded as a `Date.UTC` value, that the timezone shows for a
 * given UTC instant. Exact to the second, so DST gaps and folds can be detected.
 */
function wallClockUtcMs(utcMs: number, timeZone: string): number {
  const base = Math.floor(utcMs / 1000) * 1000;
  const parts = formatterFor(timeZone).formatToParts(new Date(base));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second")
  );
}

/**
 * The UTC offset (minutes east of UTC) that the timezone applies at an instant.
 * Computed from `Intl` parts, so it reflects real DST data.
 */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const base = Math.floor(utcMs / 1000) * 1000;
  return (wallClockUtcMs(base, timeZone) - base) / 60000;
}

/**
 * Converts a tenant wall-clock instant (`YYYY-MM-DD` key + local minutes) to its
 * UTC ISO string.
 *
 * DST handling is explicit and deterministic:
 * - a nonexistent local time inside a spring-forward gap (e.g.
 *   `America/Asuncion` 2024-10-06 00:30) throws, so staff are told the wall time
 *   does not exist instead of being silently moved to a different instant;
 * - an ambiguous local time inside a fall-back fold (e.g. 2024-03-23 23:30)
 *   resolves to the earlier (pre-transition) instant.
 */
export function zonedLocalToIso(
  dateKey: string,
  minutes: number,
  timeZone = AGENDA_TIME_ZONE
): string {
  const { year, month, day } = parseDateKey(dateKey);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error(`Invalid local minutes: ${minutes}`);
  }
  const target = Date.UTC(year, month - 1, day, 0, minutes);
  // Two offset probes are enough: the first candidate is resolved from the
  // wall-clock value treated as UTC, the second from the instant that candidate
  // maps to. A spring-forward gap matches neither; a fall-back fold matches the
  // first (earlier) instant.
  const firstOffset = offsetMinutesAt(target, timeZone);
  const firstCandidate = target - firstOffset * 60000;
  if (wallClockUtcMs(firstCandidate, timeZone) === target) {
    return new Date(firstCandidate).toISOString();
  }
  const secondOffset = offsetMinutesAt(firstCandidate, timeZone);
  const secondCandidate = target - secondOffset * 60000;
  if (wallClockUtcMs(secondCandidate, timeZone) === target) {
    return new Date(secondCandidate).toISOString();
  }
  throw new Error(`Nonexistent local time ${dateKey} ${minutes} in ${timeZone}`);
}

/** Formats an instant as a `datetime-local` input value in the tenant clock. */
export function isoToLocalInput(iso: string, timeZone = AGENDA_TIME_ZONE): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return `${formatDateKey(parts.year, parts.month, parts.day)}T${pad2(parts.hour)}:${pad2(
    parts.minute
  )}`;
}

/** Converts a `datetime-local` input value in the tenant clock to a UTC ISO string. */
export function localInputToIso(value: string, timeZone = AGENDA_TIME_ZONE): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Invalid local datetime: ${value}`);
  }
  const dateKey = match[1];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  // `Date.UTC` silently rolls impossible clock components forward (`24:00` →
  // next day 00:00, `09:60` → 10:00), so a malformed input would persist a
  // different instant than the one the staff member typed. Reject them here so
  // the create/Manage forms surface an error instead.
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid local datetime: ${value}`);
  }
  return zonedLocalToIso(dateKey, hour * 60 + minute, timeZone);
}

/** Parses a `datetime-local` input (or `null` when incomplete/invalid). */
export function tryLocalInputToIso(value: string, timeZone = AGENDA_TIME_ZONE): string | null {
  try {
    return localInputToIso(value, timeZone);
  } catch {
    return null;
  }
}

/** Shifts an instant by a number of minutes, returning a UTC ISO string. */
export function shiftIsoByMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}

/** The whole-minute duration between two instants. */
export function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
}

/** Adds whole days to a calendar key. */
export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return formatDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Adds whole months to a calendar key, clamping to the first of the target month. */
export function addMonthsToKey(key: string, months: number): string {
  const { year, month } = parseDateKey(key);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return formatDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1);
}

/** The Monday that starts the week containing the key. */
export function startOfWeekKey(key: string): string {
  const { year, month, day } = parseDateKey(key);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysToKey(key, -(WEEK_START_OFFSET[weekday] ?? 0));
}

/** The seven calendar keys of the week containing the key (Monday first). */
export function weekKeys(key: string): string[] {
  const start = startOfWeekKey(key);
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(start, index));
}

/** The 42 calendar keys of the month grid containing the key (Monday first). */
export function monthGridKeys(key: string): string[] {
  const { year, month } = parseDateKey(key);
  const firstOfMonth = formatDateKey(year, month, 1);
  const gridStart = startOfWeekKey(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addDaysToKey(gridStart, index));
}

/** True when the instant falls on the wall-clock calendar key. */
export function isOnDateKey(iso: string, key: string, timeZone = AGENDA_TIME_ZONE): boolean {
  return dateKeyOf(iso, timeZone) === key;
}

/** True when two instants fall on the same wall-clock day. */
export function isSameZonedDay(aIso: string, bIso: string, timeZone = AGENDA_TIME_ZONE): boolean {
  return dateKeyOf(aIso, timeZone) === dateKeyOf(bIso, timeZone);
}

function timeLabel(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** `HH:mm – HH:mm` range in the tenant clock. */
export function formatTimeRange(
  startIso: string,
  endIso: string,
  timeZone = AGENDA_TIME_ZONE
): string {
  return `${timeLabel(startIso, timeZone)} – ${timeLabel(endIso, timeZone)}`;
}

/** Human day heading, e.g. `Mon, 14 Sep`. */
export function formatDayHeading(key: string): string {
  const { year, month, day } = parseDateKey(key);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Human month heading, e.g. `September 2026`. */
export function formatMonthHeading(key: string): string {
  const { year, month } = parseDateKey(key);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
