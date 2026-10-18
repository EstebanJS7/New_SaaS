"use client";

import type { JSX } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import {
  createPortalBooking,
  userFacingPortalError,
  type PortalAvailabilitySlot,
} from "@/lib/portal-api";
import { PortalSlotPicker } from "@/components/portal/portal-slot-picker";

interface PortalBookingGridProps {
  readonly slug: string;
  readonly petId: string;
}

/** Shared alert chrome so submit-failure reads the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

/**
 * Holder-facing booking grid (DEC-007 A2).
 *
 * The slot choosing UI is the shared `PortalSlotPicker` (also used by the
 * appointment-move flow on the appointments page), so there is exactly ONE
 * availability read and one slot grid in the portal. Selecting a slot submits
 * that slot's exact `startAt`/`endAt` to
 * `POST /portal/pets/:id/bookings`.
 *
 * States are kept visibly distinct: submitting and error live here because this
 * surface owns the create mutation. The success copy is deliberately honest —
 * the request is PENDING and needs staff approval, it is NOT a confirmed
 * appointment — and it points the holder at the booking-requests section on
 * their appointments page, which is now the way to follow the request's status.
 *
 * The tenant slug is preserved on the "back" link so the holder never leaves
 * their own tenant.
 */
export function PortalBookingGrid({ slug, petId }: PortalBookingGridProps): JSX.Element {
  const booking = useMutation({
    mutationFn: (slot: PortalAvailabilitySlot) =>
      createPortalBooking(petId, { startAt: slot.startAt, endAt: slot.endAt }),
  });

  const backHref = `/${encodeURIComponent(slug)}/pets/${petId}`;
  const requestsHref = `/${encodeURIComponent(slug)}/appointments`;

  if (booking.data) {
    return (
      <div className="space-y-4" data-testid="portal-booking-success" role="status">
        <h1 className="text-2xl font-semibold tracking-tight">Request sent</h1>
        <p className="text-sm text-muted-foreground">
          Your request is pending. Clinic staff must approve it before it becomes an appointment, so
          it is not confirmed yet. You can follow its status in the booking requests on your
          appointments page.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href={requestsHref}
            className="text-sm font-medium text-primary hover:underline"
            data-testid="portal-booking-requests-link"
          >
            View my requests
          </Link>
          <Link href={backHref} className="text-sm font-medium text-primary hover:underline">
            Back to this pet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Request an appointment</h1>
        <p className="text-sm text-muted-foreground">
          Pick a date and a length. The times below are the clinic&apos;s real free slots.
        </p>
      </div>

      <PortalSlotPicker
        onSelectSlot={(slot) => booking.mutate(slot)}
        disabled={booking.isPending}
      />

      {booking.isPending ? (
        <p
          role="status"
          data-testid="portal-booking-submitting"
          className="text-sm text-muted-foreground"
        >
          Submitting your request...
        </p>
      ) : null}

      {booking.error ? (
        <div role="alert" data-testid="portal-booking-submit-error" className={alertClassName}>
          {userFacingPortalError(booking.error)}
        </div>
      ) : null}

      <Link
        href={backHref}
        className="text-sm font-medium text-primary hover:underline"
        data-testid="portal-booking-back"
      >
        Back to this pet
      </Link>
    </div>
  );
}
