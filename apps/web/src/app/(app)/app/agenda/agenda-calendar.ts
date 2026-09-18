import type { EventInput } from "@fullcalendar/core";
import type { Appointment, BookingRequest } from "./agenda-api";
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

/**
 * Namespace for request event ids. A pending request and an appointment are two
 * different aggregates with independent id spaces, so the request event id is
 * prefixed: a request id can never collide with an appointment event id.
 */
export const BOOKING_REQUEST_EVENT_PREFIX = "booking-request:";

/** Builds the stable, collision-free FullCalendar id for a pending request. */
export function bookingRequestEventId(id: string): string {
  return `${BOOKING_REQUEST_EVENT_PREFIX}${id}`;
}

/**
 * Maps a pending booking request to a visually distinct event. The request is
 * demand, not a booking: it carries `kind: "booking-request"` in its extended
 * properties and is non-editable, so a drag or resize can never reschedule a
 * request that has not been approved into an appointment yet.
 */
export function bookingRequestToEvent(request: BookingRequest): EventInput {
  return {
    id: bookingRequestEventId(request.id),
    title: "REQUEST",
    start: request.startAt,
    end: request.endAt,
    allDay: false,
    editable: false,
    extendedProps: { kind: "booking-request" },
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
