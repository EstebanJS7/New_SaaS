import { DomainError } from "@newsaas/shared";
import {
  schedulingSettingsSchema,
  type SchedulingAvailabilityWindow,
  type SchedulingBlock,
  type SchedulingSettings,
} from "../settings/registry.js";
import type { AppointmentStatusDto } from "./appointment.dto.js";

/**
 * Shared appointment-creation invariants (EPIC-07 WU2, reused by EPIC-08 WU4B).
 *
 * `AppointmentService.createAppointment` and the staff booking-request approval
 * path must enforce the SAME preconditions before an active appointment exists:
 * tenant anchors (branch/patient/membership plus the VETERINARIAN role rule),
 * availability windows and one-off blocks, and — under
 * `conflictPolicy === "REJECT"` — a `pg_advisory_xact_lock` on the professional
 * followed by an overlap check. Extracting them here keeps the two entry points
 * from drifting: both call the same functions, and the transaction-scoped half
 * takes the caller's OPEN transaction handle so the invariant reads, the
 * appointment insert and the caller's own status flip stay in ONE transaction.
 */

/** The single tenant timezone fixed by the PRD for v1. */
export const TENANT_TIMEZONE = "America/Asuncion";

/** Non-terminal states that participate in overlap detection. */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatusDto[] = [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_PROGRESS",
];

// ---------------------------------------------------------------------------
// Timezone / availability math
// ---------------------------------------------------------------------------

interface ZonedParts {
  /** Days since the Unix epoch in the tenant timezone (calendar-day identity). */
  readonly daySerial: number;
  readonly weekday: number;
  readonly minuteOfDay: number;
}

const zonedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TENANT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Converts an absolute UTC instant to tenant-timezone wall-clock parts. Using
 * `Intl` (not a fixed offset) means the tenant offset, including any DST shift,
 * is resolved per instant instead of frozen into storage.
 */
export function toZonedParts(date: Date): ZonedParts {
  const parts = zonedFormatter.formatToParts(date);
  const read = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const hour = read("hour");
  const minute = read("minute");
  const startOfDayUtc = Date.UTC(year, month - 1, day);
  return {
    daySerial: Math.floor(startOfDayUtc / 86_400_000),
    weekday: new Date(startOfDayUtc).getUTCDay(),
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * True when the appointment range fits inside one availability window for the
 * (professional, branch) pair. No windows means unrestricted (design decision);
 * a range spanning more than one local calendar day never fits.
 */
export function isWithinAvailability(
  startAt: Date,
  endAt: Date,
  windows: readonly SchedulingAvailabilityWindow[],
  membershipId: string,
  branchId: string
): boolean {
  const applicable = windows.filter(
    (window) => window.membershipId === membershipId && window.branchId === branchId
  );
  if (applicable.length === 0) {
    return true;
  }

  const start = toZonedParts(startAt);
  const end = toZonedParts(endAt);

  let endMinuteOnStartDay: number;
  if (end.minuteOfDay === 0 && end.daySerial === start.daySerial + 1) {
    // A range ending exactly at local midnight belongs to the start day's 24:00.
    endMinuteOnStartDay = 1440;
  } else if (end.daySerial === start.daySerial) {
    endMinuteOnStartDay = end.minuteOfDay;
  } else {
    return false;
  }

  return applicable.some(
    (window) =>
      window.weekday === start.weekday &&
      window.startMinute <= start.minuteOfDay &&
      endMinuteOnStartDay <= window.endMinute
  );
}

/** True when the appointment range intersects an active one-off block. */
export function intersectsBlock(
  startAt: Date,
  endAt: Date,
  blocks: readonly SchedulingBlock[],
  membershipId: string,
  branchId: string
): boolean {
  return blocks.some((block) => {
    if (block.membershipId !== membershipId || block.branchId !== branchId) {
      return false;
    }
    const blockStart = Date.parse(block.startsAt);
    const blockEnd = Date.parse(block.endsAt);
    if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) {
      return false;
    }
    return startAt.getTime() < blockEnd && endAt.getTime() > blockStart;
  });
}

// ---------------------------------------------------------------------------
// Tenant anchors
// ---------------------------------------------------------------------------

/** The three tenant-owned anchors every appointment creation must resolve. */
export interface AppointmentAnchors {
  readonly branchId: string;
  readonly patientId: string;
  readonly membershipId: string;
}

/** Root/tx-client seam for the tenant-ownership anchor reads. */
export interface AppointmentAnchorPrisma {
  branch: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  patient: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  tenantMembership: {
    findFirst: (args: {
      where: { id: string; tenantId: string };
      select: { id: true; role: { select: { code: true } } };
    }) => Promise<{ id: string; role: { code: string } } | null>;
  };
}

/**
 * Resolves the Branch, Patient and professional membership within the active
 * tenant. A foreign (or unknown) UUID is always 404; an in-tenant membership
 * without the VETERINARIAN role is a 400 rule violation.
 */
export async function assertAppointmentAnchors(
  prisma: AppointmentAnchorPrisma,
  tenantId: string,
  anchors: AppointmentAnchors
): Promise<void> {
  const [branch, patient, membership] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: anchors.branchId, tenantId },
      select: { id: true },
    }),
    prisma.patient.findFirst({
      where: { id: anchors.patientId, tenantId },
      select: { id: true },
    }),
    prisma.tenantMembership.findFirst({
      where: { id: anchors.membershipId, tenantId },
      select: { id: true, role: { select: { code: true } } },
    }),
  ]);

  if (!branch) {
    throw new DomainError("NOT_FOUND", "Branch was not found.");
  }
  if (!patient) {
    throw new DomainError("NOT_FOUND", "Patient was not found.");
  }
  if (!membership) {
    throw new DomainError("NOT_FOUND", "Professional membership was not found.");
  }
  if (membership.role.code !== "VETERINARIAN") {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The assigned professional must have the VETERINARIAN role."
    );
  }
}

// ---------------------------------------------------------------------------
// Availability / blocks (settings-driven, unconditional 409)
// ---------------------------------------------------------------------------

/** One candidate appointment range plus the (professional, branch) it belongs to. */
export interface AppointmentSlot {
  readonly membershipId: string;
  readonly branchId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** Availability and block violations are unconditional 409s (not policy-driven). */
export function assertAppointmentAvailability(
  settings: SchedulingSettings,
  slot: AppointmentSlot
): void {
  if (
    !isWithinAvailability(
      slot.startAt,
      slot.endAt,
      settings.availability,
      slot.membershipId,
      slot.branchId
    )
  ) {
    throw new DomainError(
      "CONFLICT",
      "The appointment is outside the professional's availability for this branch."
    );
  }
  if (
    intersectsBlock(slot.startAt, slot.endAt, settings.blocks, slot.membershipId, slot.branchId)
  ) {
    throw new DomainError(
      "CONFLICT",
      "The appointment falls inside a one-off block for the professional."
    );
  }
}

// ---------------------------------------------------------------------------
// Transaction-scoped conflict serialization
// ---------------------------------------------------------------------------

/** The overlap predicate shape the transaction-scoped read uses. */
export interface AppointmentConflictWhere {
  tenantId: string;
  professionalMembershipId: string;
  status: { in: AppointmentStatusDto[] };
  startAt: { lt: Date };
  endAt: { gt: Date };
  id?: { not: string };
}

/** The transaction handle the conflict serialization needs. */
export interface AppointmentConflictTx {
  appointment: {
    findFirst: (args: { where: AppointmentConflictWhere }) => Promise<unknown>;
  };
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
}

/** Tenant + professional the advisory lock serializes on, plus optional self-exclusion. */
export interface AppointmentConflictCheck extends AppointmentSlot {
  readonly tenantId: string;
  readonly excludeId?: string;
}

/**
 * Acquires a transaction-scoped advisory lock on the professional so overlap
 * detection and insert serialize: the second concurrent create blocks until the
 * first commits, then observes the committed row and returns 409 CONFLICT. The
 * lock releases automatically at commit/rollback.
 */
export async function lockProfessional(
  tx: AppointmentConflictTx,
  tenantId: string,
  membershipId: string
): Promise<void> {
  const key = `${tenantId}:${membershipId}`;
  // `pg_advisory_xact_lock` returns `void`; Prisma `$queryRaw` cannot
  // deserialize that column type (P2010), so cast the result to `text` — the
  // lock still blocks and the query returns one row.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}

/**
 * The transaction-scoped half of the creation invariant sequence: under REJECT,
 * serialize on the professional and reject an overlap. Under ALLOW it is a
 * deliberate no-op (the policy explicitly permits overlaps).
 */
export async function assertNoConflictInTransaction(
  tx: AppointmentConflictTx,
  settings: SchedulingSettings,
  check: AppointmentConflictCheck
): Promise<void> {
  if (settings.conflictPolicy !== "REJECT") {
    return;
  }
  await lockProfessional(tx, check.tenantId, check.membershipId);
  await assertNoOverlap(
    tx,
    check.tenantId,
    check.membershipId,
    check.startAt,
    check.endAt,
    check.excludeId
  );
}

async function assertNoOverlap(
  tx: AppointmentConflictTx,
  tenantId: string,
  membershipId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string
): Promise<void> {
  const overlap = await tx.appointment.findFirst({
    where: {
      tenantId,
      professionalMembershipId: membershipId,
      status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeId !== undefined && { id: { not: excludeId } }),
    },
  });
  if (overlap) {
    throw new DomainError("CONFLICT", "The professional already has an overlapping appointment.");
  }
}

// ---------------------------------------------------------------------------
// Settings loading
// ---------------------------------------------------------------------------

/** The typed `scheduling` settings reader the creation paths share. */
export interface SchedulingSettingsReader {
  get: (namespace: string) => Promise<Record<string, unknown>>;
}

/**
 * Loads and validates the `scheduling` namespace. A stored-but-invalid namespace
 * is an INTERNAL (never client-caused); the same error surfaces for staff
 * create, reschedule and portal booking approval.
 */
export async function loadSchedulingSettings(
  settings: SchedulingSettingsReader
): Promise<SchedulingSettings> {
  const raw = await settings.get("scheduling");
  const parsed = schedulingSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("INTERNAL", "Stored scheduling settings are invalid.");
  }
  return parsed.data;
}
