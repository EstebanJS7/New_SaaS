import { DomainError, TENANT_TIME_ZONE } from "@newsaas/shared";
import { shiftCalendarDays, startOfTenantDay, tenantCalendarDate } from "./report.period.js";

/**
 * The horizon rule of the two DUE reports (EPIC-18 REP-006 part 2, [[DEC-065]]).
 *
 * WHY THIS MODULE EXISTS: `vaccines-due` and `deworming-due` do not answer "what
 * happened in a window" — they answer "what is due". So they take no period, and
 * the period rule cannot describe them. What they DO take is a forward horizon,
 * and that horizon is a calendar-date question ("which local day is the last one
 * this report will show?") resolved into an instant — exactly the two halves the
 * period rule separates. Re-implementing either half here would be the drift both
 * modules exist to prevent, so the arithmetic is DELEGATED:
 *
 * - `tenantCalendarDate` decides which local day "today" is;
 * - `shiftCalendarDays` moves whole calendar days on UTC-midnight serials;
 * - `startOfTenantDay` turns the resulting calendar date into an instant.
 *
 * THE SHAPE OF THE BOUND: the read is HALF-OPEN and there is NO lower bound. A
 * due date on the LAST horizon day must be INCLUDED, so the exclusive bound is
 * the first instant of the day AFTER `horizonEndDate` — the same
 * `[fromInstant, toInstant)` construction every period uses, only with the start
 * left open. Overdue records are overdue however old they are, so an unbounded
 * past is correct rather than sloppy; the row cap is what keeps the read honest.
 */

/**
 * The horizon a caller gets when it omits `horizonDays`.
 *
 * Thirty days is a month of forward notice: long enough for a practice to call
 * the owner and book the appointment, short enough that the list stays a
 * working list rather than a second patient registry. It is a DEFAULT, not a
 * protocol: nothing is derived from it ([[DEC-065]] rejected projecting booster
 * intervals), it only bounds how far ahead the report looks.
 */
export const REPORT_HORIZON_DEFAULT_DAYS = 30;

/** Smallest accepted horizon: today alone (a due date on the last horizon day is included). */
export const REPORT_HORIZON_MIN_DAYS = 1;

/**
 * Largest accepted horizon: one year. The same order of bound as the period
 * rule's `REPORT_PERIOD_MAX_DAYS` (366 days, a year and a day, so a leap year is
 * never a surprise rejection) and far past any forward notice a practice needs.
 */
export const REPORT_HORIZON_MAX_DAYS = 365;

/**
 * Stable message for a horizon that is not a whole number of days. Its OWN
 * message, distinct from the range refusal: "1.5" is a different mistake from
 * "400", and the caller should be told which one it made.
 */
export const REPORT_HORIZON_INTEGER_MESSAGE = "The report horizon must be a whole number of days.";

/**
 * Stable message for a whole number outside `[1, 365]`. Never clamped and never
 * truncated: a horizon silently widened to the bound would answer a different
 * question than the one that was asked.
 */
export const REPORT_HORIZON_RANGE_MESSAGE = `The report horizon must be between ${REPORT_HORIZON_MIN_DAYS} and ${REPORT_HORIZON_MAX_DAYS} days.`;

/** The raw request-shaped input this resolver accepts: a query string, unparsed. */
export interface ReportHorizonInput {
  /**
   * The query value EXACTLY as the route received it. A string and not a
   * `number`, because that is the only thing a query string can carry: coercing
   * it in the controller would put the parse somewhere the stable messages do
   * not reach.
   */
  readonly horizonDays?: string;
}

/** A horizon resolved to the calendar dates the report echoes and the instant the query applies. */
export interface ResolvedReportHorizon {
  /** The horizon the report actually used, after the default and the bounds. */
  readonly horizonDays: number;
  /** Today's calendar date in the tenant zone, `YYYY-MM-DD` — the overdue/upcoming pivot. */
  readonly asOfDate: string;
  /** The LAST local day the upcoming set may include, `YYYY-MM-DD`. */
  readonly horizonEndDate: string;
  /** EXCLUSIVE: the first instant of the day AFTER `horizonEndDate`, in the tenant zone. */
  readonly horizonEndInstant: Date;
  /** The zone `asOfDate` and `horizonEndInstant` were resolved in — `TENANT_TIME_ZONE`. */
  readonly timeZone: string;
}

/** Whole-number shape, sign included so a negative reaches the RANGE refusal, not the shape one. */
const INTEGER_SHAPE = /^-?\d+$/;

/**
 * Resolves `?horizonDays=` and the request's "now" into the horizon the due
 * reports read, or refuses with ONE stable message per condition.
 *
 * Precedence is deliberate: an absent value takes the default and reaches no
 * rejection at all; a value that is not integer-SHAPED is refused before it is
 * converted, because `Number("abc")` is `NaN` and `NaN` comparisons are all
 * false — a horizon of `NaN` would silently match nothing and report an empty
 * practice; the RANGE bound is applied last, to a real integer.
 */
export function resolveReportHorizon(
  input: ReportHorizonInput,
  now: Date,
  timeZone: string = TENANT_TIME_ZONE
): ResolvedReportHorizon {
  const horizonDays = resolveHorizonDays(input.horizonDays);
  // Today in the TENANT's calendar. The same helper the period rule uses, so the
  // pivot of the overdue/upcoming split and the boundaries of every other report
  // can never disagree about which day it is.
  const asOfDate = tenantCalendarDate(now, timeZone);
  const horizonEndDate = shiftCalendarDays(asOfDate, horizonDays);

  return {
    horizonDays,
    asOfDate,
    horizonEndDate,
    // EXCLUSIVE end: the first instant of the day AFTER the horizon, which is
    // what includes a due date exactly on `horizonEndDate` and excludes the one
    // that falls on the next day.
    horizonEndInstant: startOfTenantDay(shiftCalendarDays(horizonEndDate, 1), timeZone),
    timeZone,
  };
}

/** The default, or a validated integer in `[REPORT_HORIZON_MIN_DAYS, REPORT_HORIZON_MAX_DAYS]`. */
function resolveHorizonDays(raw: string | undefined): number {
  if (raw === undefined) {
    return REPORT_HORIZON_DEFAULT_DAYS;
  }
  if (!INTEGER_SHAPE.test(raw)) {
    throw new DomainError("VALIDATION_FAILED", REPORT_HORIZON_INTEGER_MESSAGE);
  }
  const parsed = Number(raw);
  // A DIGIT-ONLY string always converts to a whole-number double (an absurdly
  // long one becomes `Infinity`), so the shape test above is the integer test and
  // the only condition left is the BOUND. A whole number outside it — `0`, a
  // negative, `366` — is refused here rather than clamped, because a horizon
  // widened to the bound would answer a different question than the caller's.
  if (parsed < REPORT_HORIZON_MIN_DAYS || parsed > REPORT_HORIZON_MAX_DAYS) {
    throw new DomainError("VALIDATION_FAILED", REPORT_HORIZON_RANGE_MESSAGE);
  }
  return parsed;
}
