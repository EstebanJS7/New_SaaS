/**
 * Pure rules of the «Agenda» availability windows and blocks editor
 * ([[CFG-001]] T2). UX only: the API's `schedulingSettingsSchema`
 * (`apps/api/src/settings/registry.ts`) re-validates every write.
 *
 * Semantics, as the API's scheduling invariants read them
 * (`apps/api/src/scheduling/appointment-invariants.ts`, `toZonedParts` and
 * `isWithinAvailability`):
 * - `weekday` is 0 (Sunday) to 6 (Saturday) of the clinic's calendar day;
 * - `startMinute`/`endMinute` are minutes past local midnight in the clinic
 *   timezone, `endMinute` 1440 being the end of the day;
 * - block `startsAt`/`endsAt` are absolute UTC instants, entered and shown in
 *   the clinic timezone through the agenda's own helpers.
 */

import { isoToLocalInput } from "@/app/(app)/app/agenda/agenda-time";

export interface AvailabilityWindow {
  readonly membershipId: string;
  readonly branchId: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface ScheduleBlock {
  readonly membershipId: string;
  readonly branchId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Display order (Monday first) with the API's weekday numbers. */
export const WEEKDAYS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

export function weekdayLabel(weekday: number): string {
  return WEEKDAYS.find((day) => day.value === weekday)?.label ?? String(weekday);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Minutes past local midnight → `HH:MM`; 1440 reads as `24:00`. */
export function minuteToTime(minute: number): string {
  return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}

/** The `<input type="time">` value of a window bound; the end of the day is `00:00`. */
export function minuteToTimeInput(minute: number): string {
  return minuteToTime(minute === 1440 ? 0 : minute);
}

/**
 * `HH:MM` → minutes past local midnight, or null when not a valid time. As an
 * end bound, `00:00` means midnight at the end of the day (1440), the only way
 * a time input can express the API's upper bound.
 */
export function timeToMinute(value: string, bound: "start" | "end"): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const total = hour * 60 + minute;
  return bound === "end" && total === 0 ? 1440 : total;
}

/** An instant as `DD/MM/AAAA HH:MM` on the clinic's wall clock. */
export function formatBlockInstant(iso: string): string {
  const local = isoToLocalInput(iso); // YYYY-MM-DDTHH:MM
  const [date = "", time = ""] = local.split("T");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWindow(value: unknown): value is AvailabilityWindow {
  if (!isRecord(value)) return false;
  const { membershipId, branchId, weekday, startMinute, endMinute } = value;
  return (
    typeof membershipId === "string" &&
    typeof branchId === "string" &&
    Number.isInteger(weekday) &&
    (weekday as number) >= 0 &&
    (weekday as number) <= 6 &&
    Number.isInteger(startMinute) &&
    (startMinute as number) >= 0 &&
    (startMinute as number) <= 1439 &&
    Number.isInteger(endMinute) &&
    (endMinute as number) >= 1 &&
    (endMinute as number) <= 1440 &&
    (endMinute as number) > (startMinute as number)
  );
}

function isBlock(value: unknown): value is ScheduleBlock {
  if (!isRecord(value)) return false;
  const { membershipId, branchId, startsAt, endsAt } = value;
  return (
    typeof membershipId === "string" &&
    typeof branchId === "string" &&
    typeof startsAt === "string" &&
    typeof endsAt === "string" &&
    Number.isFinite(Date.parse(startsAt)) &&
    Date.parse(endsAt) > Date.parse(startsAt)
  );
}

/**
 * The stored lists, or null when either is malformed. A malformed entry fails
 * both: editing from a partial list would overwrite the stored one whole.
 */
export function parseScheduleLists(settings: Readonly<Record<string, unknown>>): {
  availability: AvailabilityWindow[];
  blocks: ScheduleBlock[];
} | null {
  const { availability = [], blocks = [] } = settings;
  if (!Array.isArray(availability) || !availability.every(isWindow)) return null;
  if (!Array.isArray(blocks) || !blocks.every(isBlock)) return null;
  return {
    availability: availability.map((window) => ({
      membershipId: window.membershipId,
      branchId: window.branchId,
      weekday: window.weekday,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    })),
    blocks: blocks.map((block) => ({
      membershipId: block.membershipId,
      branchId: block.branchId,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
    })),
  };
}

/** The Spanish refusal of a window draft, or null when it can be added. */
export function windowError(draft: {
  membershipId: string;
  branchId: string;
  startMinute: number | null;
  endMinute: number | null;
}): string | null {
  if (draft.membershipId === "") return "Elegí un profesional.";
  if (draft.branchId === "") return "Elegí una sucursal.";
  if (draft.startMinute === null) return "Ingresá la hora de inicio.";
  if (draft.endMinute === null) return "Ingresá la hora de fin.";
  if (draft.endMinute <= draft.startMinute) {
    return "La hora de fin debe ser posterior a la de inicio.";
  }
  return null;
}

/** The Spanish refusal of a block draft, or null when it can be added. */
export function blockError(draft: {
  membershipId: string;
  branchId: string;
  startsAt: string | null;
  endsAt: string | null;
}): string | null {
  if (draft.membershipId === "") return "Elegí un profesional.";
  if (draft.branchId === "") return "Elegí una sucursal.";
  if (draft.startsAt === null) return "Ingresá una fecha y hora de inicio válidas.";
  if (draft.endsAt === null) return "Ingresá una fecha y hora de fin válidas.";
  if (Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) {
    return "El fin del bloqueo debe ser posterior al inicio.";
  }
  return null;
}
