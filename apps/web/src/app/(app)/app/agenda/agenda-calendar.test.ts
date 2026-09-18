/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  appointmentToEvent,
  bookingRequestEventId,
  bookingRequestToEvent,
  FULL_CALENDAR_VIEW,
  resolveRescheduledRange,
} from "./agenda-calendar";
import type { Appointment, BookingRequest } from "./agenda-api";

const APPOINTMENT: Appointment = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-a",
  branchId: "22222222-2222-4222-8222-222222222222",
  patientId: "33333333-3333-4333-8333-333333333333",
  professionalMembershipId: "44444444-4444-4444-8444-444444444444",
  status: "CONFIRMED",
  startAt: "2026-09-14T12:00:00.000Z",
  endAt: "2026-09-14T12:45:00.000Z",
  version: 3,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

describe("agenda-calendar view mapping", () => {
  it("maps the calendar views to FullCalendar view names", () => {
    expect(FULL_CALENDAR_VIEW).toEqual({
      day: "timeGridDay",
      week: "timeGridWeek",
      month: "dayGridMonth",
    });
  });
});

describe("agenda-calendar event mapping", () => {
  it("maps an appointment to an all-day-free event carrying the allowlisted times and status", () => {
    expect(appointmentToEvent(APPOINTMENT)).toEqual({
      id: APPOINTMENT.id,
      title: "CONFIRMED",
      start: "2026-09-14T12:00:00.000Z",
      end: "2026-09-14T12:45:00.000Z",
      allDay: false,
    });
  });

  it("namespaces a request event id and marks its kind so it can never be an appointment", () => {
    // Same UUID in both id spaces: the request event id is still distinct.
    const request: BookingRequest = {
      id: APPOINTMENT.id,
      patientId: "33333333-3333-4333-8333-333333333333",
      status: "PENDING",
      startAt: "2026-09-14T15:00:00.000Z",
      endAt: "2026-09-14T15:30:00.000Z",
    };

    const event = bookingRequestToEvent(request);
    expect(event.id).toBe(`booking-request:${APPOINTMENT.id}`);
    expect(event.id).not.toBe(APPOINTMENT.id);
    expect(event.extendedProps).toEqual({ kind: "booking-request" });
    expect(event.editable).toBe(false);
    expect(event.title).toBe("REQUEST");
    expect(event.start).toBe(request.startAt);
    expect(event.end).toBe(request.endAt);
    expect(bookingRequestEventId(APPOINTMENT.id)).toBe(event.id);
  });
});

describe("agenda-calendar reschedule normalization", () => {
  it("converts FullCalendar instants to UTC ISO", () => {
    expect(
      resolveRescheduledRange(
        APPOINTMENT,
        new Date("2026-09-14T13:00:00.000Z"),
        new Date("2026-09-14T13:30:00.000Z")
      )
    ).toEqual({ startIso: "2026-09-14T13:00:00.000Z", endIso: "2026-09-14T13:30:00.000Z" });
  });

  it("preserves the original range when the interaction has no start", () => {
    expect(resolveRescheduledRange(APPOINTMENT, null, null)).toEqual({
      startIso: APPOINTMENT.startAt,
      endIso: APPOINTMENT.endAt,
    });
  });

  it("derives a missing end from the original duration", () => {
    expect(
      resolveRescheduledRange(APPOINTMENT, new Date("2026-09-14T13:00:00.000Z"), null)
    ).toEqual({
      startIso: "2026-09-14T13:00:00.000Z",
      endIso: "2026-09-14T13:45:00.000Z",
    });
  });

  it("derives a missing end across a tenant DST spring-forward", () => {
    // 2024-10-06 is Paraguay's spring-forward day; a wall-clock start after the
    // gap keeps the original wall duration in absolute minutes.
    expect(
      resolveRescheduledRange(APPOINTMENT, new Date("2024-10-06T04:30:00.000Z"), null)
    ).toEqual({ startIso: "2024-10-06T04:30:00.000Z", endIso: "2024-10-06T05:15:00.000Z" });
  });
});
