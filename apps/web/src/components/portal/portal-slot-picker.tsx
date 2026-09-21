"use client";

import { useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isPortalDeniedError,
  listPortalAvailability,
  userFacingPortalError,
  type PortalAvailabilitySlot,
} from "@/lib/portal-api";

/**
 * Duration stand-in until EPIC-09 (service catalog).
 *
 * The availability contract REQUIRES `durationMinutes`, and there is no service
 * catalog yet (DEC-007 explicitly defers it to EPIC-09), so the holder picks
 * from this fixed set instead of typing a number. The chosen value is used for
 * BOTH the availability query and the submitted slot, so the offered range and
 * the requested range can never disagree. The set is deliberately small and
 * covers the common visit lengths; when the catalog lands it replaces this list
 * without touching the query or the submission contract, which already take the
 * duration as an explicit parameter.
 */
const DURATION_OPTIONS = [15, 30, 45, 60] as const;
type DurationMinutes = (typeof DURATION_OPTIONS)[number];

const DEFAULT_DURATION: DurationMinutes = 30;

/** Shared alert chrome so denied/error read the same to a holder. */
const alertClassName =
  "rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive";

const fieldClassName =
  "rounded-md border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const slotButtonClassName =
  "rounded-md border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Local calendar date used as the date input's starting value. It is only a
 * default the holder can change; it is never trusted as an authority and never
 * sent anywhere except as the availability query's `date`.
 */
function todayLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Renders a returned UTC instant in the CLINIC's timezone (the `timeZone` the
 * availability read returns), not the browser's. The instant is the API's own
 * value verbatim — only its DISPLAY is localized — so the holder sees the time
 * staff would see instead of a time shifted by their own device.
 */
function formatSlotTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export interface PortalSlotPickerProps {
  /** Receives the exact slot the API offered; the caller owns the mutation. */
  readonly onSelectSlot: (slot: PortalAvailabilitySlot) => void;
  /** Disables every slot button while the caller's mutation is in flight. */
  readonly disabled?: boolean;
}

/**
 * Shared holder-facing slot picker (DEC-007 A2 booking, A2d move).
 *
 * The picker IS the availability: every rendered time comes from
 * `GET /portal/availability` for the selected date and duration, and nothing is
 * synthesized client-side, so a slot the holder can click is a slot the clinic
 * offered. It is extracted from the booking grid so the booking flow and the
 * appointment-move flow share ONE picker instead of two drifting copies; both
 * consumers receive the selected slot's exact `startAt`/`endAt` verbatim.
 *
 * States are kept visibly distinct: loading, empty (a NORMAL result, never an
 * error) and denied/error. The `409`/`404` copy never picks a cause the API
 * masks; see `userFacingPortalError`. The `portal-booking-*` test ids are
 * inherited from the booking grid to keep that suite's contract unchanged.
 */
export function PortalSlotPicker({
  onSelectSlot,
  disabled = false,
}: PortalSlotPickerProps): JSX.Element {
  const [date, setDate] = useState<string>(todayLocalDate);
  const [durationMinutes, setDurationMinutes] = useState<DurationMinutes>(DEFAULT_DURATION);

  const availability = useQuery({
    queryKey: ["portal", "availability", date, durationMinutes],
    queryFn: () => listPortalAvailability({ date, durationMinutes, stepMinutes: durationMinutes }),
    enabled: date.length > 0,
  });

  const availabilityData = availability.data;

  return (
    <div className="space-y-4" data-testid="portal-slot-picker">
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="portal-booking-date" className="text-sm font-medium">
            Date
          </label>
          <input
            id="portal-booking-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={fieldClassName}
            data-testid="portal-booking-date"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="portal-booking-duration" className="text-sm font-medium">
            Length
          </label>
          <select
            id="portal-booking-duration"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(Number(event.target.value) as DurationMinutes)}
            className={fieldClassName}
            data-testid="portal-booking-duration"
          >
            {DURATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} minutes
              </option>
            ))}
          </select>
        </div>
      </div>

      {availability.isLoading ? (
        <p
          role="status"
          data-testid="portal-booking-loading"
          className="text-sm text-muted-foreground"
        >
          Loading available times...
        </p>
      ) : availability.error ? (
        isPortalDeniedError(availability.error) ? (
          <div role="alert" data-testid="portal-booking-denied" className={alertClassName}>
            {userFacingPortalError(availability.error)}
          </div>
        ) : (
          <div role="alert" data-testid="portal-booking-error" className={alertClassName}>
            {userFacingPortalError(availability.error)}
          </div>
        )
      ) : !availabilityData ? null : availabilityData.slots.length === 0 ? (
        <div
          data-testid="portal-booking-empty"
          className="rounded-lg border bg-card p-6 text-card-foreground"
        >
          <h2 className="font-medium">No available times</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            There are no free times for this date and length. Try another day or a different length.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2" data-testid="portal-booking-slots">
          {availabilityData.slots.map((slot) => (
            <button
              key={slot.startAt}
              type="button"
              onClick={() => onSelectSlot(slot)}
              disabled={disabled}
              className={slotButtonClassName}
              data-testid="portal-slot"
            >
              {formatSlotTime(slot.startAt, availabilityData.timeZone)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
