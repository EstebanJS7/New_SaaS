"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  isPortalDeniedError,
  listPortalAppointments,
  listPortalAvailability,
  listPortalPets,
  userFacingPortalAppointmentsError,
  type PortalAppointment,
  type PortalAppointmentStatus,
  type PortalPet,
} from "@/lib/portal-api";

interface PortalAppointmentsViewProps {
  readonly slug: string;
}

/** Shared alert chrome so denied/error read the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

const bookLinkClassName =
  "mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Holder-facing labels for the FULL appointment lifecycle enum.
 *
 * Two rules shape this map:
 * - no raw enum value ever reaches a holder;
 * - no two statuses that MEAN different things may read the same. `SCHEDULED`
 *   and `CONFIRMED` are distinct clinic states (a request may still need staff
 *   confirmation), `ARRIVED` and `IN_PROGRESS` are distinct visit stages, and
 *   `CANCELLED` and `NO_SHOW` describe different events, so each gets its own
 *   words. The `Record` is exhaustive by type, so a new enum member fails the
 *   build here instead of rendering a blank badge.
 */
const STATUS_LABELS: Record<PortalAppointmentStatus, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  ARRIVED: "Checked in",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "Missed",
};

/**
 * Neutral fallback used when an appointment's `patientId` is not in the
 * holder's pets list. It is intentionally a word, never the identifier: a raw
 * UUID must not surface even in the edge case where the join misses.
 */
const UNKNOWN_PET_LABEL = "Unknown pet";

/** Availability duration used ONLY to probe the clinic time zone (see below). */
const ZONE_PROBE_DURATION_MINUTES = 30;

/**
 * Local calendar date used as the availability probe's starting day. It is only
 * a default that selects which day's slots are computed; it is never trusted as
 * an authority and never displayed. Mirrors the booking grid's own default so
 * both surfaces ask the availability read the same way.
 */
function todayLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Renders an instant as a clinic-local date, not the holder's browser date. */
function formatClinicDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Renders an instant as a clinic-local `HH:mm`, matching the booking grid. */
function formatClinicTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

interface AppointmentsData {
  readonly appointments: readonly PortalAppointment[];
  readonly pets: readonly PortalPet[];
  readonly timeZone: string;
}

/**
 * Loads everything the list needs in one page-level query.
 *
 * Two secondary reads ride along with the appointments:
 * 1. the holder's pets, to JOIN the displayed pet name (see below);
 * 2. the availability read, to obtain the CLINIC time zone.
 *
 * The three are combined so the page keeps the single loading/empty/error/
 * denied/success state machine the other portal pages use; a failure in any of
 * them is one page-level failure rather than a half-rendered list.
 */
async function loadAppointments(): Promise<AppointmentsData> {
  const [appointments, pets, availability] = await Promise.all([
    listPortalAppointments(),
    listPortalPets(),
    listPortalAvailability({
      date: todayLocalDate(),
      durationMinutes: ZONE_PROBE_DURATION_MINUTES,
      stepMinutes: ZONE_PROBE_DURATION_MINUTES,
    }),
  ]);
  return { appointments, pets, timeZone: availability.timeZone };
}

/**
 * Booking entry point for the empty state.
 *
 * The booking flow is per-pet (`/[slug]/pets/:id/book`), so a holder with at
 * least one pet goes straight to that pet's grid; a holder with no pet is sent
 * to the pets list, the only page from which a pet (and therefore a booking)
 * can exist. The slug is always preserved so neither path leaves the tenant.
 */
function bookingHref(slug: string, pets: readonly PortalPet[]): string {
  const base = `/${encodeURIComponent(slug)}`;
  const firstPet = pets[0];
  return firstPet ? `${base}/pets/${firstPet.id}/book` : `${base}/pets`;
}

/**
 * Holder-facing appointments list.
 *
 * The API returns `{ id, patientId, status, startAt, endAt }` and NO pet name,
 * so the holder's pets are read as well and joined in memory on `patientId`.
 * Without that join a row would only have an internal identifier to show, and a
 * raw UUID must never reach a holder; an appointment whose pet is missing from
 * the pets list falls back to a neutral label instead.
 *
 * Times are rendered in the clinic's time zone. The appointments read does not
 * return one, so the zone is read from the SAME `timeZone` field the booking
 * grid renders with (`GET /portal/availability`): any valid query reports the
 * tenant zone regardless of the day's slots, so the probe reuses the booking
 * grid's own default query (today, 30 minutes). That keeps this list and the
 * booking grid in the same zone by construction rather than hardcoding a second
 * copy of the tenant constant or silently using the holder's browser, which
 * could shift every displayed time.
 *
 * States are kept visibly distinct: loading, denied, error, empty and success.
 * An empty list is NORMAL for a holder and never renders as an alert; it offers
 * a slug-correct route into the booking flow instead. The status labels are
 * display-only — the portal has no cancel or reschedule yet, so nothing here
 * implies a status can be changed.
 */
export function PortalAppointmentsView({ slug }: PortalAppointmentsViewProps): JSX.Element {
  const query = useQuery({
    queryKey: ["portal", "appointments"],
    queryFn: loadAppointments,
  });

  const data = query.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My appointments</h1>
        <p className="text-sm text-muted-foreground">
          Times are shown in the clinic&apos;s time zone. Cancelling or rescheduling is not
          available here yet.
        </p>
      </div>

      {query.isLoading ? (
        <p
          role="status"
          data-testid="portal-appointments-loading"
          className="text-sm text-muted-foreground"
        >
          Loading your appointments...
        </p>
      ) : query.error ? (
        isPortalDeniedError(query.error) ? (
          <div role="alert" data-testid="portal-appointments-denied" className={alertClassName}>
            {userFacingPortalAppointmentsError(query.error)}
          </div>
        ) : (
          <div role="alert" data-testid="portal-appointments-error" className={alertClassName}>
            {userFacingPortalAppointmentsError(query.error)}
          </div>
        )
      ) : !data || data.appointments.length === 0 ? (
        <div
          data-testid="portal-appointments-empty"
          className="rounded-lg border bg-card p-6 text-card-foreground"
        >
          <h2 className="font-medium">No appointments yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When your clinic schedules an appointment for one of your pets, it will appear here.
          </p>
          <Link
            href={bookingHref(slug, data?.pets ?? [])}
            className={bookLinkClassName}
            data-testid="portal-appointments-book-link"
          >
            Request an appointment
          </Link>
        </div>
      ) : (
        <ul data-testid="portal-appointments-list" className="space-y-3">
          {data.appointments.map((appointment) => {
            const pet = data.pets.find((candidate) => candidate.id === appointment.patientId);
            return (
              <li
                key={appointment.id}
                data-testid="portal-appointment"
                className="rounded-lg border bg-card p-4 text-card-foreground"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {pet ? (
                      <Link
                        href={`/${encodeURIComponent(slug)}/pets/${pet.id}`}
                        className="text-primary hover:underline"
                        data-testid="portal-appointment-pet"
                      >
                        {pet.name}
                      </Link>
                    ) : (
                      <span data-testid="portal-appointment-pet">{UNKNOWN_PET_LABEL}</span>
                    )}
                  </p>
                  <span
                    data-testid="portal-appointment-status"
                    className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >
                    {STATUS_LABELS[appointment.status]}
                  </span>
                </div>
                <p
                  data-testid="portal-appointment-time"
                  className="mt-1 text-sm text-muted-foreground"
                >
                  {formatClinicDay(appointment.startAt, data.timeZone)} ·{" "}
                  {formatClinicTime(appointment.startAt, data.timeZone)}–
                  {formatClinicTime(appointment.endAt, data.timeZone)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
