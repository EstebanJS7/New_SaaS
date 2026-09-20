"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  isPortalDeniedError,
  listPortalAppointments,
  userFacingPortalAppointmentsError,
  type PortalAppointmentStatus,
} from "@/lib/portal-api";
import { formatClinicDay, formatClinicTime } from "@/components/portal/portal-datetime";
import { PortalBookingRequests } from "@/components/portal/portal-booking-requests";

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
 * Holder-facing appointments list.
 *
 * `GET /portal/appointments` returns `{ timeZone, appointments }` and each
 * appointment already carries the pet name the API resolved server-side. That
 * envelope is the WHOLE data need of this list: there is no pets join and no
 * availability probe, because the zone that names each row and the label each
 * row shows both arrive with the read. The page therefore issues ONE request
 * instead of three, and a transient availability failure can no longer hide an
 * otherwise readable list.
 *
 * Times are rendered in the envelope's clinic time zone, never the holder's
 * browser zone. States are kept visibly distinct: loading, denied, error, empty
 * and success. An empty list is NORMAL for a holder and never renders as an
 * alert; it offers a slug-correct route into the booking flow instead. The
 * status labels are display-only — the portal has no cancel or reschedule yet,
 * so nothing here implies a status can be changed.
 */
export function PortalAppointmentsView({ slug }: PortalAppointmentsViewProps): JSX.Element {
  const query = useQuery({
    queryKey: ["portal", "appointments"],
    queryFn: listPortalAppointments,
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
            href={`/${encodeURIComponent(slug)}/pets`}
            className={bookLinkClassName}
            data-testid="portal-appointments-book-link"
          >
            Request an appointment
          </Link>
        </div>
      ) : (
        <ul data-testid="portal-appointments-list" className="space-y-3">
          {data.appointments.map((appointment) => (
            <li
              key={appointment.id}
              data-testid="portal-appointment"
              className="rounded-lg border bg-card p-4 text-card-foreground"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  <Link
                    href={`/${encodeURIComponent(slug)}/pets/${appointment.patientId}`}
                    className="text-primary hover:underline"
                    data-testid="portal-appointment-pet"
                  >
                    {appointment.patientName}
                  </Link>
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
          ))}
        </ul>
      )}

      <PortalBookingRequests />
    </div>
  );
}
