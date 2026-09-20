"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isPortalDeniedError,
  listPortalBookings,
  userFacingPortalError,
  type PortalBookingRequestStatus,
} from "@/lib/portal-api";
import { formatClinicDay, formatClinicTime } from "@/components/portal/portal-datetime";

/** Shared alert chrome so denied/error read the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

/**
 * Holder-facing labels for the booking-request lifecycle.
 *
 * Two rules shape this map:
 * - no raw enum value ever reaches a holder;
 * - no two statuses may read the same. `PENDING` and `APPROVED` are distinct
 *   stages of a request that is still moving (awaiting staff vs approved), and
 *   `REJECTED` and `CANCELLED` are two different endings (the clinic declined
 *   it vs the holder withdrew it), so each gets its own words. The `Record` is
 *   exhaustive by type, so a new enum member fails the build here instead of
 *   rendering a blank badge.
 */
const REQUEST_STATUS_LABELS: Record<PortalBookingRequestStatus, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  CANCELLED: "Cancelled",
};

/**
 * Holder-facing booking-requests section.
 *
 * Lists the holder's OWN requests (`GET /portal/bookings`), each with its
 * holder-facing status label, the pet name the API resolves server-side, and
 * the requested range rendered in the clinic's time zone. This is the follow-up
 * the booking success screen points at, so a PENDING request no longer
 * disappears into a void.
 *
 * The pet name is intentionally plain text, not a link: the read keeps showing
 * a request after the guardian link to its pet is revoked, and the pet detail
 * read would then answer 404. States are kept visibly distinct: loading,
 * denied, error, empty and success. An empty list is NORMAL for a holder — most
 * have never submitted a request — and never renders as an alert.
 */
export function PortalBookingRequests(): JSX.Element {
  const query = useQuery({
    queryKey: ["portal", "bookings"],
    queryFn: listPortalBookings,
  });

  const data = query.data;

  return (
    <section className="space-y-4" data-testid="portal-booking-requests">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">My booking requests</h2>
        <p className="text-sm text-muted-foreground">
          Requests you have sent to the clinic. Times are shown in the clinic&apos;s time zone.
        </p>
      </div>

      {query.isLoading ? (
        <p
          role="status"
          data-testid="portal-booking-requests-loading"
          className="text-sm text-muted-foreground"
        >
          Loading your requests...
        </p>
      ) : query.error ? (
        isPortalDeniedError(query.error) ? (
          <div role="alert" data-testid="portal-booking-requests-denied" className={alertClassName}>
            {userFacingPortalError(query.error)}
          </div>
        ) : (
          <div role="alert" data-testid="portal-booking-requests-error" className={alertClassName}>
            {userFacingPortalError(query.error)}
          </div>
        )
      ) : !data || data.bookings.length === 0 ? (
        <div
          data-testid="portal-booking-requests-empty"
          className="rounded-lg border bg-card p-6 text-card-foreground"
        >
          <h3 className="font-medium">No requests yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            When you request an appointment for one of your pets, it will appear here.
          </p>
        </div>
      ) : (
        <ul data-testid="portal-booking-requests-list" className="space-y-3">
          {data.bookings.map((booking) => (
            <li
              key={booking.id}
              data-testid="portal-booking-request"
              className="rounded-lg border bg-card p-4 text-card-foreground"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium" data-testid="portal-booking-request-pet">
                  {booking.patientName}
                </p>
                <span
                  data-testid="portal-booking-request-status"
                  className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {REQUEST_STATUS_LABELS[booking.status]}
                </span>
              </div>
              <p
                data-testid="portal-booking-request-time"
                className="mt-1 text-sm text-muted-foreground"
              >
                {formatClinicDay(booking.startAt, data.timeZone)} ·{" "}
                {formatClinicTime(booking.startAt, data.timeZone)}–
                {formatClinicTime(booking.endAt, data.timeZone)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
