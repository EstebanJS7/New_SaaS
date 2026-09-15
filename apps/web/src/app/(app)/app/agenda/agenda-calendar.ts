import type { EventInput } from "@fullcalendar/core";
import type { Appointment } from "./agenda-api";
import { durationMinutes, shiftIsoByMinutes } from "./agenda-time";

/** The four staff agenda views. */
export type AgendaView = "day" | "week" | "month" | "list";

/** The agenda views rendered by the FullCalendar React component. */
export type CalendarView = Exclude<AgendaView, "list">;

/**
 * Maps an agenda view to a FullCalendar view name. `list` is intentionally not
 * mapped: the agenda keeps its own accessible list (with a Manage action) rather
 * than a calendar view, so keyboard users always have a deterministic
 * management path that does not depend on calendar pointer interaction.
 */
export const FULL_CALENDAR_VIEW: Record<CalendarView, string> = {
  day: "timeGridDay",
  week: "timeGridWeek",
  month: "dayGridMonth",
};

/** Maps an allowlisted appointment to the event object FullCalendar renders. */
export function appointmentToEvent(appointment: Appointment): EventInput {
  return {
    id: appointment.id,
    title: appointment.status,
    start: appointment.startAt,
    end: appointment.endAt,
    allDay: false,
  };
}

export interface RescheduledRange {
  readonly startIso: string;
  readonly endIso: string;
}

/**
 * Normalizes a FullCalendar drag/resize result into the version-guarded
 * reschedule range.
 *
 * When the interaction yields no start (a degenerate drop) the original range is
 * preserved, and a missing end is derived from the original duration so the API
 * always receives an ordered UTC range. FullCalendar reports event instants as
 * `Date` objects; `toISOString` keeps them absolute UTC, which is the persisted
 * contract.
 */
export function resolveRescheduledRange(
  appointment: Appointment,
  start: Date | null,
  end: Date | null
): RescheduledRange {
  if (start === null) {
    return { startIso: appointment.startAt, endIso: appointment.endAt };
  }
  const startIso = start.toISOString();
  const endIso =
    end === null
      ? shiftIsoByMinutes(startIso, durationMinutes(appointment.startAt, appointment.endAt))
      : end.toISOString();
  return { startIso, endIso };
}
