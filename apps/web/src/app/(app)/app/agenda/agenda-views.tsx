"use client";

import type { CSSProperties, JSX } from "react";
import { useEffect, useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DateSelectArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { AGENDA_TIME_ZONE, dateKeyOf, formatDayHeading, formatTimeRange } from "./agenda-time";
import type { Appointment, AppointmentStatus, BookingRequest } from "./agenda-api";
import type { AvailabilityOverlay } from "./agenda-availability";
import {
  appointmentToEvent,
  bookingRequestEventId,
  bookingRequestToEvent,
  FULL_CALENDAR_VIEW,
  resolveRescheduledRange,
  type AgendaView,
  type CalendarView,
} from "./agenda-calendar";

export type { AgendaView, CalendarView } from "./agenda-calendar";

/** Semantic-token status styling; no literal brand colors. */
const STATUS_CLASSES: Record<AppointmentStatus, string> = {
  SCHEDULED: "border-border bg-secondary text-secondary-foreground",
  CONFIRMED: "border-primary bg-primary/10 text-foreground",
  ARRIVED: "border-accent-foreground/40 bg-accent text-accent-foreground",
  IN_PROGRESS: "border-primary bg-primary/20 text-foreground",
  COMPLETED: "border-status-success bg-status-success/10 text-foreground",
  CANCELLED: "border-destructive bg-destructive/10 text-destructive",
  NO_SHOW: "border-muted-foreground bg-muted text-muted-foreground",
};

/**
 * Pending-request styling. A request is demand, not a booking, so it is
 * deliberately unlike every appointment status: a dashed double-weight border
 * over the plain background instead of a status colour fill. Nobody should read
 * a requested slot as an occupied one.
 */
const REQUEST_CLASSES = "border-2 border-dashed border-foreground/40 bg-background text-foreground";

/**
 * FullCalendar theming through its CSS variables, resolved from the app's
 * semantic design tokens. Event backgrounds stay transparent so the semantic
 * status classes on the event content control the per-status look; no literal
 * brand color is introduced.
 */
const CALENDAR_STYLE = {
  "--fc-page-bg-color": "hsl(var(--card))",
  "--fc-neutral-bg-color": "hsl(var(--muted))",
  "--fc-neutral-text-color": "hsl(var(--muted-foreground))",
  "--fc-border-color": "hsl(var(--border))",
  "--fc-event-bg-color": "transparent",
  "--fc-event-border-color": "transparent",
  "--fc-event-text-color": "hsl(var(--foreground))",
  "--fc-highlight-color": "hsl(var(--accent) / 0.5)",
  "--fc-today-bg-color": "hsl(var(--accent) / 0.4)",
  "--fc-now-indicator-color": "hsl(var(--destructive))",
  // Availability overlay: the routine outside-working-hours complement is a
  // muted wash, while a one-off block is a stronger destructive-tinted wash so
  // the two are never confused. Both resolve from semantic tokens.
  "--fc-non-business-color": "hsl(var(--muted-foreground) / 0.12)",
  "--fc-bg-event-color": "hsl(var(--destructive))",
  "--fc-bg-event-opacity": "0.15",
  "--fc-small-font-size": "0.7rem",
} as CSSProperties;

export interface AgendaViewsProps {
  readonly view: AgendaView;
  readonly anchor: string;
  readonly appointments: readonly Appointment[];
  readonly requests: readonly BookingRequest[];
  readonly branchLabel: (branchId: string) => string;
  /** Availability/block shading for a selected pair; absent for list and month. */
  readonly overlay?: AvailabilityOverlay;
  readonly onOpen: (appointment: Appointment) => void;
  readonly onOpenRequest: (request: BookingRequest) => void;
  readonly onCreateRange: (startIso: string, endIso: string) => void;
  readonly onRescheduleRange: (appointment: Appointment, startIso: string, endIso: string) => void;
}

function StatusBadge({ status }: { readonly status: AppointmentStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide ${STATUS_CLASSES[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/** Distinct badge for a pending request; never reuses an appointment status. */
function RequestBadge(): JSX.Element {
  return (
    <span
      data-testid="request-badge"
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide ${REQUEST_CLASSES}`}
    >
      Request
    </span>
  );
}

interface AgendaCalendarProps {
  readonly view: CalendarView;
  readonly anchor: string;
  readonly appointments: readonly Appointment[];
  readonly requests: readonly BookingRequest[];
  readonly overlay?: AvailabilityOverlay;
  readonly onOpen: (appointment: Appointment) => void;
  readonly onOpenRequest: (request: BookingRequest) => void;
  readonly onCreateRange: (startIso: string, endIso: string) => void;
  readonly onRescheduleRange: (appointment: Appointment, startIso: string, endIso: string) => void;
}

/**
 * Day/week/month calendar rendered by the approved FullCalendar React component
 * (daygrid + timegrid + interaction plugins). Drag-to-move and resize are
 * delegated to FullCalendar's `editable` interaction and normalized back into
 * the version-guarded reschedule contract; time-range creation is delegated to
 * FullCalendar's `select`. Pending requests ride the same grid as a distinct,
 * non-editable layer so demand is visible where staff plan the day. The
 * accessible, deterministic management path lives in the agenda's List view and
 * Manage form, not in calendar pointer gestures.
 */
function AgendaCalendar({
  view,
  anchor,
  appointments,
  requests,
  overlay,
  onOpen,
  onOpenRequest,
  onCreateRange,
  onRescheduleRange,
}: AgendaCalendarProps): JSX.Element {
  const calendarRef = useRef<FullCalendar | null>(null);
  const byId = useMemo(
    () => new Map(appointments.map((appointment) => [appointment.id, appointment] as const)),
    [appointments]
  );
  const requestByEventId = useMemo(
    () => new Map(requests.map((request) => [bookingRequestEventId(request.id), request] as const)),
    [requests]
  );
  const events = useMemo<EventInput[]>(
    () => [
      ...appointments.map(appointmentToEvent),
      ...requests.map(bookingRequestToEvent),
      ...(overlay?.blockEvents ?? []),
    ],
    [appointments, requests, overlay]
  );

  useEffect(() => {
    calendarRef.current?.getApi().changeView(FULL_CALENDAR_VIEW[view]);
  }, [view]);

  useEffect(() => {
    calendarRef.current?.getApi().gotoDate(anchor);
  }, [anchor]);

  function renderEventContent(arg: EventContentArg): JSX.Element {
    if (requestByEventId.has(arg.event.id)) {
      return (
        <div className={`h-full w-full overflow-hidden rounded-sm px-1 py-0.5 ${REQUEST_CLASSES}`}>
          <span className="block truncate text-[0.7rem] font-semibold">{arg.timeText}</span>
          <span className="block truncate text-[0.6rem] font-medium uppercase tracking-wide">
            Request
          </span>
        </div>
      );
    }
    const status = byId.get(arg.event.id)?.status ?? "SCHEDULED";
    return (
      <div
        className={`h-full w-full overflow-hidden rounded-sm border px-1 py-0.5 ${STATUS_CLASSES[status]}`}
      >
        <span className="block truncate text-[0.7rem] font-semibold">{arg.timeText}</span>
        <span className="block truncate text-[0.6rem] font-medium uppercase tracking-wide">
          {status.replace("_", " ")}
        </span>
      </div>
    );
  }

  function applyReschedule(
    appointmentId: string,
    start: Date | null,
    end: Date | null,
    revert: () => void
  ): void {
    const appointment = byId.get(appointmentId);
    if (appointment === undefined) {
      // A request event is non-editable; if a gesture still reaches here, revert
      // rather than reschedule demand that was never approved.
      revert();
      return;
    }
    const range = resolveRescheduledRange(appointment, start, end);
    onRescheduleRange(appointment, range.startIso, range.endIso);
  }

  function handleEventDrop(arg: EventDropArg): void {
    applyReschedule(arg.event.id, arg.event.start, arg.event.end, arg.revert);
  }

  function handleEventResize(arg: EventResizeDoneArg): void {
    applyReschedule(arg.event.id, arg.event.start, arg.event.end, arg.revert);
  }

  function handleEventClick(arg: EventClickArg): void {
    const request = requestByEventId.get(arg.event.id);
    if (request !== undefined) {
      onOpenRequest(request);
      return;
    }
    const appointment = byId.get(arg.event.id);
    if (appointment !== undefined) {
      onOpen(appointment);
    }
  }

  function handleSelect(arg: DateSelectArg): void {
    // All-day selections come from the month grid; time-range creation only
    // applies to timed selections inside the day/week grids.
    if (arg.allDay) {
      return;
    }
    onCreateRange(arg.start.toISOString(), arg.end.toISOString());
  }

  return (
    <div className="rounded-lg border bg-card p-2 text-card-foreground" style={CALENDAR_STYLE}>
      {/*
        DISPLAY ONLY. `businessHours` shades the complement of the selected
        pair's windows; it is deliberately NOT wired to `selectConstraint`,
        `eventConstraint` or `overlap`. The write path requires the whole
        appointment inside ONE window, which a union of ranges cannot express,
        and a forbidden block cannot be passed directly as an allowed-range
        constraint; enforcing the overlay here would make the calendar a second
        source of truth and let staff pick a range the API rejects with 409
        CONFLICT.
      */}
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={FULL_CALENDAR_VIEW[view]}
        headerToolbar={{ left: "", center: "title", right: "" }}
        firstDay={1}
        timeZone={AGENDA_TIME_ZONE}
        height="auto"
        nowIndicator
        editable
        selectable
        selectMirror
        dayMaxEvents={3}
        slotMinTime="07:00:00"
        slotMaxTime="21:00:00"
        events={events}
        businessHours={overlay?.businessHours ?? false}
        eventContent={renderEventContent}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        select={handleSelect}
      />
    </div>
  );
}

function ListView({
  appointments,
  requests,
  branchLabel,
  onOpen,
  onOpenRequest,
}: {
  readonly appointments: readonly Appointment[];
  readonly requests: readonly BookingRequest[];
  readonly branchLabel: (branchId: string) => string;
  readonly onOpen: (appointment: Appointment) => void;
  readonly onOpenRequest: (request: BookingRequest) => void;
}): JSX.Element {
  const ordered = [...appointments].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const orderedRequests = [...requests].sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
  );
  return (
    <div className="space-y-4">
      {orderedRequests.length > 0 && (
        <section aria-label="Pending booking requests" className="space-y-2">
          <h2 className="text-sm font-semibold">Pending requests</h2>
          <ul className="space-y-2">
            {orderedRequests.map((request) => (
              <li
                key={`request:${request.id}`}
                data-testid="pending-request-row"
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 ${REQUEST_CLASSES}`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {formatDayHeading(dateKeyOf(request.startAt))} ·{" "}
                    {formatTimeRange(request.startAt, request.endAt)}
                  </p>
                  <p className="text-xs opacity-80">Requested · Patient {request.patientId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <RequestBadge />
                  <button
                    type="button"
                    onClick={() => onOpenRequest(request)}
                    className="rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    Review
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="space-y-2">
        {ordered.map((appointment) => (
          <li
            key={appointment.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-card-foreground"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">
                {formatDayHeading(dateKeyOf(appointment.startAt))} ·{" "}
                {formatTimeRange(appointment.startAt, appointment.endAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                {branchLabel(appointment.branchId)} · Professional{" "}
                {appointment.professionalMembershipId.slice(0, 8)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={appointment.status} />
              <button
                type="button"
                onClick={() => onOpen(appointment)}
                className="rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Manage
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Renders the selected agenda view over the already-filtered appointments and requests. */
export function AgendaViews(props: AgendaViewsProps): JSX.Element {
  if (props.view === "list") {
    return (
      <ListView
        appointments={props.appointments}
        requests={props.requests}
        branchLabel={props.branchLabel}
        onOpen={props.onOpen}
        onOpenRequest={props.onOpenRequest}
      />
    );
  }
  return (
    <AgendaCalendar
      view={props.view}
      anchor={props.anchor}
      appointments={props.appointments}
      requests={props.requests}
      {...(props.overlay !== undefined && { overlay: props.overlay })}
      onOpen={props.onOpen}
      onOpenRequest={props.onOpenRequest}
      onCreateRange={props.onCreateRange}
      onRescheduleRange={props.onRescheduleRange}
    />
  );
}
