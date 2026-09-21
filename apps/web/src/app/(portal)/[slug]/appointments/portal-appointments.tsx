"use client";

import { useState, type JSX } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelPortalAppointment,
  isPortalConflictError,
  isPortalDeniedError,
  listPortalAppointments,
  reschedulePortalAppointment,
  userFacingPortalAppointmentCancelError,
  userFacingPortalAppointmentsError,
  userFacingPortalRescheduleError,
  type PortalAppointment,
  type PortalAppointmentStatus,
  type PortalAvailabilitySlot,
} from "@/lib/portal-api";
import { formatClinicDay, formatClinicTime } from "@/components/portal/portal-datetime";
import { PortalBookingRequests } from "@/components/portal/portal-booking-requests";
import { PortalSlotPicker } from "@/components/portal/portal-slot-picker";

interface PortalAppointmentsViewProps {
  readonly slug: string;
}

/** Shared alert chrome so denied/error read the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

const actionButtonClassName =
  "rounded-md border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const bookLinkClassName =
  "mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Appointment states the holder may act on, mirroring the scheduling-owned
 * contract: `APPOINTMENT_TRANSITIONS.cancel` accepts `SCHEDULED`/`CONFIRMED`
 * and `RESCHEDULABLE_STATUSES` is the same pair. Rendering an action for any
 * other state would offer a button that is guaranteed to 409, so every other
 * state renders nothing and the header copy claims nothing else.
 */
const ACTIONABLE_STATUSES: readonly PortalAppointmentStatus[] = ["SCHEDULED", "CONFIRMED"];

function isActionable(status: PortalAppointmentStatus): boolean {
  return ACTIONABLE_STATUSES.includes(status);
}

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

interface MoveInput {
  readonly appointment: PortalAppointment;
  readonly slot: PortalAvailabilitySlot;
}

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
 * ACTIONS (DEC-007 A2d). A `SCHEDULED`/`CONFIRMED` row can be cancelled
 * (`POST /portal/appointments/:id/cancel`) or moved (`PUT
 * /portal/appointments/:id`) with the shared `PortalSlotPicker` and the
 * appointment's own `version`. The action is offered for exactly the two states
 * the API accepts; a completed, cancelled, missed, arrived or in-progress
 * appointment renders nothing, and the header copy claims only those two
 * states, so nothing here implies a finished visit can be undone.
 *
 * Every mutation has a distinct submitting, success and failure state, and a
 * failure leaves the row actionable. Both commands check their preconditions,
 * so their `409` copy names the cause it actually knows — and invalidates the
 * list so the UI self-corrects instead of contradicting the server.
 *
 * Times are rendered in the envelope's clinic time zone, never the holder's
 * browser zone. States are kept visibly distinct: loading, denied, error, empty
 * and success. An empty list is NORMAL for a holder and never renders as an
 * alert; it offers a slug-correct route into the booking flow instead.
 */
export function PortalAppointmentsView({ slug }: PortalAppointmentsViewProps): JSX.Element {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["portal", "appointments"],
    queryFn: listPortalAppointments,
  });

  const [movingId, setMovingId] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: (appointment: PortalAppointment) => cancelPortalAppointment(appointment.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portal", "appointments"] });
    },
    onError: (error) => {
      if (isPortalConflictError(error)) {
        void queryClient.invalidateQueries({ queryKey: ["portal", "appointments"] });
      }
    },
  });

  const move = useMutation({
    mutationFn: (input: MoveInput) =>
      reschedulePortalAppointment(input.appointment.id, {
        startAt: input.slot.startAt,
        endAt: input.slot.endAt,
        version: input.appointment.version,
      }),
    onSuccess: () => {
      // Close the picker so the refreshed row is what the holder reads; the
      // action buttons stay available for a further move.
      setMovingId(null);
      void queryClient.invalidateQueries({ queryKey: ["portal", "appointments"] });
    },
    onError: (error) => {
      // A 409 here means the slot is gone or the version is stale; either way
      // the loaded row is no longer the server's truth, so refresh it.
      if (isPortalConflictError(error)) {
        void queryClient.invalidateQueries({ queryKey: ["portal", "appointments"] });
      }
    },
  });

  const data = query.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My appointments</h1>
        <p className="text-sm text-muted-foreground">
          Times are shown in the clinic&apos;s time zone. You can cancel or move an appointment
          while it is scheduled or confirmed.
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
          {data.appointments.map((appointment) => {
            const cancelling = cancel.variables?.id === appointment.id;
            const moved = move.variables?.appointment.id === appointment.id;
            const cancelSettled = cancelling && cancel.isSuccess;
            const moveSettled = moved && move.isSuccess;

            return (
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

                {isActionable(appointment.status) ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => cancel.mutate(appointment)}
                        disabled={cancel.isPending || move.isPending}
                        className={actionButtonClassName}
                        data-testid="portal-appointment-cancel"
                      >
                        Cancel appointment
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setMovingId(movingId === appointment.id ? null : appointment.id)
                        }
                        disabled={cancel.isPending || move.isPending}
                        className={actionButtonClassName}
                        data-testid="portal-appointment-move"
                      >
                        Move appointment
                      </button>
                    </div>

                    {movingId === appointment.id ? (
                      <div className="space-y-3 rounded-md border bg-background p-3">
                        <p className="text-sm font-medium">Move to a new time</p>
                        <PortalSlotPicker
                          onSelectSlot={(slot) => move.mutate({ appointment, slot })}
                          disabled={move.isPending}
                        />
                        <button
                          type="button"
                          onClick={() => setMovingId(null)}
                          className="text-sm font-medium text-primary hover:underline"
                          data-testid="portal-appointment-move-close"
                        >
                          Close
                        </button>
                      </div>
                    ) : null}

                    {cancelling && cancel.isPending ? (
                      <p
                        role="status"
                        data-testid="portal-appointment-cancel-pending"
                        className="text-sm text-muted-foreground"
                      >
                        Cancelling your appointment...
                      </p>
                    ) : null}
                    {moved && move.isPending ? (
                      <p
                        role="status"
                        data-testid="portal-appointment-move-pending"
                        className="text-sm text-muted-foreground"
                      >
                        Moving your appointment...
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {cancelSettled ? (
                  <p
                    role="status"
                    data-testid="portal-appointment-cancel-success"
                    className="mt-3 text-sm text-muted-foreground"
                  >
                    Appointment cancelled.
                  </p>
                ) : null}
                {moveSettled ? (
                  <p
                    role="status"
                    data-testid="portal-appointment-move-success"
                    className="mt-3 text-sm text-muted-foreground"
                  >
                    Appointment moved.
                  </p>
                ) : null}

                {cancelling && cancel.error ? (
                  <div
                    role="alert"
                    data-testid="portal-appointment-cancel-error"
                    className={`mt-2 ${alertClassName}`}
                  >
                    {userFacingPortalAppointmentCancelError(cancel.error)}
                  </div>
                ) : null}
                {moved && move.error ? (
                  <div
                    role="alert"
                    data-testid="portal-appointment-move-error"
                    className={`mt-2 ${alertClassName}`}
                  >
                    {userFacingPortalRescheduleError(move.error)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <PortalBookingRequests />
    </div>
  );
}
