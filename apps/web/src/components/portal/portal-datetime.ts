/**
 * Clinic-zone rendering helpers shared by the portal appointment list and the
 * booking-requests section.
 *
 * Both surfaces render UTC instants in the CLINIC's time zone (the `timeZone`
 * each read ships), never the holder's browser zone, so a shared helper keeps
 * the two lists in the same zone by construction.
 */

/** Renders an instant as a clinic-local date, not the holder's browser date. */
export function formatClinicDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Renders an instant as a clinic-local `HH:mm`, matching the booking grid. */
export function formatClinicTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
