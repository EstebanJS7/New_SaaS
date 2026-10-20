import { DomainError, TENANT_TIME_ZONE } from "@newsaas/shared";

/**
 * The reporting period rule — the ONE place in the system where a calendar
 * period becomes an instant range (EPIC-18 REP-002, [[DEC-063]]).
 *
 * WHY THIS MODULE EXISTS: eleven reports each inventing a date filter would be
 * eleven chances to disagree about which day a sale belongs to. A cash session
 * closed at 21:00 in Asunción lands on the next UTC day, so a report that cut
 * its day in UTC would contradict the cash screen about the same session. Two
 * truths about one fact is the failure this repository spends the most effort
 * avoiding, so every report takes its range from here.
 *
 * THE SHAPE OF THE RANGE: `[fromInstant, toInstant)` — inclusive start,
 * EXCLUSIVE end, where `toInstant` is the first instant of the day AFTER
 * `toDate`. Half-open is what makes consecutive periods partition without
 * double-counting a sale that lands exactly on a boundary.
 *
 * THE ZONE: `TENANT_TIME_ZONE` ([[DEC-063]]). It is a constant, never a request
 * parameter, and the client may not send instants: only `YYYY-MM-DD` calendar
 * dates are accepted, because a caller that could choose instants could also
 * bypass the 366-day span bound.
 *
 * WHY THE ARITHMETIC HAPPENS IN UTC: calendar maths (adding days, finding the
 * first of a month, counting days) is done on `YYYY-MM-DD` strings and
 * UTC-midnight `Date`s, which have no DST and therefore no 23- or 25-hour day.
 * The tenant zone is used at exactly ONE moment per boundary — the conversion of
 * a resolved calendar date into an instant.
 */

/**
 * The five accepted presets ([[DEC-063]]). Fixed and closed: an unknown token
 * is refused rather than defaulted, because a silently defaulted period is a
 * report about a different question than the one that was asked.
 */
export const REPORT_PERIOD_PRESETS = [
  "today",
  "last7Days",
  "last30Days",
  "thisMonth",
  "lastMonth",
] as const;

export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number];

/**
 * Maximum span of a custom range, inclusive of both ends ([[DEC-063]]). A year
 * and a day, so a leap year is never a surprise rejection. Exceeding it is a
 * VALIDATION_FAILED, never a truncated result: a report that quietly stopped at
 * day 366 would be a wrong answer that looks like a right one.
 */
export const REPORT_PERIOD_MAX_DAYS = 366;

/**
 * One stable message per rejection condition, so a caller (and a test) can tell
 * them apart. `packages/shared/src/errors/registry.ts` is a frozen, CLOSED
 * registry — `ErrorCode` is a union of its keys and modules never mint new
 * codes — so every rejection here is the shared `VALIDATION_FAILED` code with a
 * specific message, exactly as the notifications surface does it.
 */
export const REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE = "The report period preset is unknown.";

/** A preset and an explicit range are two different questions, not a refinement. */
export const REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE =
  "A report period takes either a preset or a from/to range, not both.";

/** No period at all: there is nothing honest to aggregate. */
export const REPORT_PERIOD_MISSING_MESSAGE =
  "A report period requires either a preset or a from/to range.";

/** Half a range is ambiguous — an implied "today" would be a guess. */
export const REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE =
  "A custom report period requires both from and to.";

/**
 * The malformed-date rejection, which ALSO carries the raw-instant refusal: an
 * ISO instant such as `2026-01-01T00:00:00Z` does not match the calendar-date
 * shape and is therefore refused here rather than resolved ([[DEC-063]]).
 */
export const REPORT_PERIOD_DATE_FORMAT_MESSAGE =
  "A report period date must be a real calendar date in YYYY-MM-DD form.";

/**
 * `from` after `to`. Note the adjacent case that is NOT a rejection: `from`
 * equal to `to` is a single calendar day (dayCount 1), never a "zero-length"
 * range.
 */
export const REPORT_PERIOD_INVERTED_MESSAGE = "The report period starts after it ends.";

/** Over the span bound ([[DEC-063]]). Never truncated, never swapped. */
export const REPORT_PERIOD_TOO_LONG_MESSAGE = `The report period spans more than ${REPORT_PERIOD_MAX_DAYS} days.`;

/** The raw request-shaped input this resolver accepts. */
export interface ReportPeriodInput {
  readonly preset?: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * A period resolved to BOTH of its representations: the calendar dates a report
 * echoes back to the caller, and the half-open instant range the query applies.
 */
export interface ResolvedReportPeriod {
  /** The preset that produced the range, or `null` for a custom `from`/`to` pair. */
  readonly preset: ReportPeriodPreset | null;
  /** First calendar day of the period, `YYYY-MM-DD` in the tenant zone. */
  readonly fromDate: string;
  /** Last calendar day of the period, inclusive, `YYYY-MM-DD` in the tenant zone. */
  readonly toDate: string;
  /** The zone the boundaries were resolved in — `TENANT_TIME_ZONE`. */
  readonly timeZone: string;
  /** INCLUSIVE: the first instant of `fromDate` in the tenant zone. */
  readonly fromInstant: Date;
  /** EXCLUSIVE: the first instant of the day AFTER `toDate` in the tenant zone. */
  readonly toInstant: Date;
  /** Inclusive count of CALENDAR days — never a count of 24-hour blocks. */
  readonly dayCount: number;
}

const MS_PER_DAY = 86_400_000;

/** Digits only: an ISO instant fails this shape, which is the point. */
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface ZonedParts extends CalendarDateParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Formatters are per ZONE and memoised: `Intl.DateTimeFormat` construction is
 * expensive and a report resolves only a handful of boundaries, but the same
 * handful on every call.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  // `hourCycle: "h23"` is load-bearing: with the default `en-US` h12 cycle a
  // midnight renders as hour `24`, and the offset computed from it comes out a
  // day wrong.
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, created);
  return created;
}

/** Absolute instant -> wall-clock parts as read in `timeZone`. */
function readZonedParts(instant: Date, formatter: Intl.DateTimeFormat): ZonedParts {
  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * The zone's UTC offset at one instant, in milliseconds: the wall clock read as
 * if it were UTC, minus the real instant. Taken from `Intl`, never assumed, so
 * a DST shift is resolved per instant instead of frozen into a constant.
 */
function offsetMs(instant: Date, formatter: Intl.DateTimeFormat): number {
  const parts = readZonedParts(instant, formatter);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallClockAsUtc - instant.getTime();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatCalendarDate(parts: CalendarDateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of THIS one; pure UTC arithmetic.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parses a `YYYY-MM-DD` calendar date, refusing anything else — including a
 * well-formed ISO instant and a date that looks plausible but does not exist
 * (`2026-02-30`).
 */
function parseCalendarDate(value: string): CalendarDateParts {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_DATE_FORMAT_MESSAGE);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_DATE_FORMAT_MESSAGE);
  }
  return { year, month, day };
}

/** The UTC midnight that NAMES a calendar date — the arithmetic identity. */
function calendarSerial(parts: CalendarDateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function serialToDate(serial: number): string {
  const date = new Date(serial);
  return formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** Calendar-day arithmetic on UTC midnights: no DST, so a day is always a day. */
function shiftCalendarDays(date: string, days: number): string {
  return serialToDate(calendarSerial(parseCalendarDate(date)) + days * MS_PER_DAY);
}

/** Inclusive day count — `fromDate === toDate` is ONE day, not zero. */
function countCalendarDays(from: string, to: string): number {
  return (
    (calendarSerial(parseCalendarDate(to)) - calendarSerial(parseCalendarDate(from))) / MS_PER_DAY +
    1
  );
}

/**
 * The calendar date an INSTANT belongs to in the tenant zone — the report's
 * bucket key, and the same rule the period boundaries use. Exported so a report
 * groups rows by the tenant's day and not by a second, subtly different rule.
 */
export function tenantCalendarDate(instant: Date, timeZone: string = TENANT_TIME_ZONE): string {
  return formatCalendarDate(readZonedParts(instant, formatterFor(timeZone)));
}

/**
 * The first instant of one tenant-zone calendar day, as an absolute UTC instant.
 *
 * Two passes, because one is wrong at a DST edge: the first pass reads the
 * offset at the naive instant (the wall clock read as UTC) and the second
 * re-reads it at the instant the first pass produced and re-applies it. When the
 * two agree — every day that is not a transition — the answer is final.
 *
 * When they disagree, local midnight is either duplicated or missing, and the
 * candidates are judged by wall clock: the EARLIEST candidate that really reads
 * midnight starts an ambiguous day, and when no candidate reads midnight the
 * clock skipped it (a spring-forward crossing 00:00) so the day begins at the
 * later candidate — the first instant whose local date is this one.
 */
export function startOfTenantDay(dateISO: string, timeZone: string = TENANT_TIME_ZONE): Date {
  const target = parseCalendarDate(dateISO);
  const formatter = formatterFor(timeZone);
  const wallMidnightAsUtc = calendarSerial(target);

  const firstPass = wallMidnightAsUtc - offsetMs(new Date(wallMidnightAsUtc), formatter);
  const secondPass = wallMidnightAsUtc - offsetMs(new Date(firstPass), formatter);
  if (firstPass === secondPass) {
    return new Date(firstPass);
  }

  const isMidnight = (candidate: number): boolean => {
    const parts = readZonedParts(new Date(candidate), formatter);
    return (
      parts.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === 0 &&
      parts.minute === 0 &&
      parts.second === 0
    );
  };

  const exact = [firstPass, secondPass].filter(isMidnight);
  return new Date(exact.length > 0 ? Math.min(...exact) : Math.max(firstPass, secondPass));
}

/** Narrows a caller-supplied token to a known preset, or refuses. */
function assertPreset(value: string): ReportPeriodPreset {
  const known = REPORT_PERIOD_PRESETS.find((preset) => preset === value);
  if (known === undefined) {
    throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_UNKNOWN_PRESET_MESSAGE);
  }
  return known;
}

/** `YYYY-MM-01` of the month containing `date`. */
function firstOfMonth(date: string): string {
  const parts = parseCalendarDate(date);
  return formatCalendarDate({ year: parts.year, month: parts.month, day: 1 });
}

/** The whole previous calendar month, as `[first day, last day]`. */
function previousMonth(date: string): { fromDate: string; toDate: string } {
  const parts = parseCalendarDate(date);
  const year = parts.month === 1 ? parts.year - 1 : parts.year;
  const month = parts.month === 1 ? 12 : parts.month - 1;
  return {
    fromDate: formatCalendarDate({ year, month, day: 1 }),
    toDate: formatCalendarDate({ year, month, day: daysInMonth(year, month) }),
  };
}

/**
 * Every preset as a calendar-date range, resolved from TODAY in the tenant zone
 * ([[DEC-063]]): `today` is today only, `last7Days` is the seven days ending
 * today inclusive, `last30Days` the thirty ending today inclusive, `thisMonth`
 * is month-to-date and `lastMonth` is the whole previous calendar month.
 */
function presetRange(
  preset: ReportPeriodPreset,
  today: string
): { fromDate: string; toDate: string } {
  switch (preset) {
    case "today":
      return { fromDate: today, toDate: today };
    case "last7Days":
      return { fromDate: shiftCalendarDays(today, -6), toDate: today };
    case "last30Days":
      return { fromDate: shiftCalendarDays(today, -29), toDate: today };
    case "thisMonth":
      return { fromDate: firstOfMonth(today), toDate: today };
    case "lastMonth":
      return previousMonth(today);
  }
}

/**
 * Resolves the request's period into the half-open instant range every report
 * applies, or refuses with ONE stable message per condition.
 *
 * Precedence of the shape rejections is deliberate: a request that carries BOTH
 * shapes is refused before either half is interpreted, an unknown preset is
 * refused before it can be treated as "no preset", and a range is validated
 * before it is measured. The span bound is applied last and uniformly, so a
 * future preset can never smuggle in an unbounded range.
 */
export function resolveReportPeriod(
  input: ReportPeriodInput,
  now: Date,
  timeZone: string = TENANT_TIME_ZONE
): ResolvedReportPeriod {
  const { preset, from, to } = input;
  const hasRange = from !== undefined || to !== undefined;

  if (preset !== undefined && hasRange) {
    throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_SHAPE_CONFLICT_MESSAGE);
  }

  let dates: { preset: ReportPeriodPreset | null; fromDate: string; toDate: string };

  if (preset !== undefined) {
    const resolvedPreset = assertPreset(preset);
    dates = {
      preset: resolvedPreset,
      ...presetRange(resolvedPreset, tenantCalendarDate(now, timeZone)),
    };
  } else {
    if (from === undefined && to === undefined) {
      throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_MISSING_MESSAGE);
    }
    if (from === undefined || to === undefined) {
      throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_INCOMPLETE_RANGE_MESSAGE);
    }
    if (calendarSerial(parseCalendarDate(from)) > calendarSerial(parseCalendarDate(to))) {
      throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_INVERTED_MESSAGE);
    }
    dates = { preset: null, fromDate: from, toDate: to };
  }

  const dayCount = countCalendarDays(dates.fromDate, dates.toDate);
  if (dayCount > REPORT_PERIOD_MAX_DAYS) {
    throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_TOO_LONG_MESSAGE);
  }

  return {
    preset: dates.preset,
    fromDate: dates.fromDate,
    toDate: dates.toDate,
    timeZone,
    fromInstant: startOfTenantDay(dates.fromDate, timeZone),
    // EXCLUSIVE end: the first instant of the day after `toDate`, which is what
    // makes the range half-open and consecutive periods partition exactly.
    toInstant: startOfTenantDay(shiftCalendarDays(dates.toDate, 1), timeZone),
    dayCount,
  };
}
