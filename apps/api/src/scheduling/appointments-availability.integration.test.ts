import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  seedSchedulingHttp,
  type SchedulingHttpFixture,
} from "../../test/support/scheduling-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import type { AppointmentStatusRow } from "../../test/support/in-memory-database.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import { TENANT_TIMEZONE, toZonedParts } from "./appointment-invariants.js";

interface ErrorDto {
  error: { code: string };
}

interface AvailabilitySlotBody {
  startAt: string;
  endAt: string;
}

interface AvailabilityBody {
  date: string;
  branchId: string;
  professionalMembershipId: string;
  durationMinutes: number;
  stepMinutes: number;
  timeZone: string;
  basis: string;
  slots: AvailabilitySlotBody[];
}

/** Allowlisted CONFIDENTIAL surface — any extra key must fail. */
const RESPONSE_KEYS = [
  "date",
  "branchId",
  "professionalMembershipId",
  "durationMinutes",
  "stepMinutes",
  "timeZone",
  "basis",
  "slots",
] as const;

const SLOT_KEYS = ["startAt", "endAt"] as const;

/** Local calendar dates reused across cases; distinct days keep absolute times apart. */
const DATE_WINDOW = "2026-06-15";
const DATE_BLOCK = "2026-06-16";
const DATE_OVERLAP = "2026-06-17";
const DATE_ADJACENT = "2026-06-18";
const DATE_TERMINAL = "2026-06-19";
const DATE_DURATION = "2026-06-20";
const DATE_MIDNIGHT = "2026-06-21";
const DATE_DEFAULT = "2026-06-22";
const DATE_NO_WINDOW = "2026-06-16";
const DATE_TENANT = "2026-06-23";
const DATE_STATUSES = "2026-06-24";
const DATE_OUTSIDE = "2026-06-26";
const DATE_ALLOW = "2026-06-27";

const MINUTE_MS = 60_000;

function calendarDaySerial(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function weekdayOf(date: string): number {
  return new Date(calendarDaySerial(date) * 86_400_000).getUTCDay();
}

function localParts(iso: string): { daySerial: number; minuteOfDay: number } {
  return toZonedParts(new Date(iso));
}

// ---------------------------------------------------------------------------
// Zone-derived DST fixtures (no hardcoded offsets or transition instants)
// ---------------------------------------------------------------------------

const zonePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TENANT_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Tenant-zone offset at an instant, derived from `Intl` (never hardcoded). */
function zoneOffsetMsAt(instantMs: number): number {
  const parts = zonePartsFormatter.formatToParts(new Date(instantMs));
  const read = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const wallAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second")
  );
  return wallAsUtc - instantMs;
}

interface ZoneTransition {
  readonly utcMs: number;
  readonly offsetBeforeMs: number;
  readonly offsetAfterMs: number;
}

/** Every tenant-zone offset change in `year`, resolved by hourly probing. */
function findZoneTransitions(year: number): ZoneTransition[] {
  const transitions: ZoneTransition[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  let previous = zoneOffsetMsAt(start);
  for (let ms = start + 3_600_000; ms < end; ms += 3_600_000) {
    const current = zoneOffsetMsAt(ms);
    if (current !== previous) {
      transitions.push({ utcMs: ms, offsetBeforeMs: previous, offsetAfterMs: current });
      previous = current;
    }
  }
  return transitions;
}

const ASUNCION_2024_TRANSITIONS = findZoneTransitions(2024);
const SPRING_FORWARD = ASUNCION_2024_TRANSITIONS.find(
  (transition) => transition.offsetAfterMs > transition.offsetBeforeMs
);
const FALL_BACK = ASUNCION_2024_TRANSITIONS.find(
  (transition) => transition.offsetAfterMs < transition.offsetBeforeMs
);

/** Wall-clock reading of an instant as a UTC-encoded value (zone offset added). */
function wallClockUtc(instantMs: number, offsetMs: number): number {
  return instantMs + offsetMs;
}

function dateKeyOfWallClock(wallMs: number): string {
  return new Date(wallMs).toISOString().slice(0, 10);
}

function minuteOfWallClock(wallMs: number): number {
  const wall = new Date(wallMs);
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
}

/**
 * DEC-007 A1 HTTP boundary: the read-only availability endpoint over the SAME
 * guard chain and scheduling fixture the write path uses. Every test seeds its
 * own settings namespace (upsert replaces it) and, where needed, its own
 * appointments on a date no other case uses.
 */
describe("Appointment availability HTTP boundary (DEC-007 A1)", () => {
  let booted: BootedTestApp;
  let fixture: SchedulingHttpFixture;
  let tenantA: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    await booted.app.listen(0);
    fixture = seedSchedulingHttp(booted.db);
    tenantA = fixture.a.tenant.id;
  });

  afterAll(async () => {
    await booted.close();
  });

  const server = () => booted.app.getHttpServer();

  function setSettings(
    data: { conflictPolicy?: "REJECT" | "ALLOW"; availability?: unknown[]; blocks?: unknown[] },
    tenantId = tenantA
  ): void {
    const payload = {
      conflictPolicy: data.conflictPolicy ?? "REJECT",
      availability: data.availability ?? [],
      blocks: data.blocks ?? [],
    };
    booted.db.prisma.tenantSettingNamespace.upsert({
      where: { tenantId_namespace: { tenantId, namespace: "scheduling" } },
      create: { tenantId, namespace: "scheduling", schemaVersion: 1, data: payload },
      update: { schemaVersion: 1, data: payload },
    });
  }

  function windowFor(
    date: string,
    overrides: { startMinute?: number; endMinute?: number } = {}
  ): Record<string, unknown> {
    return {
      membershipId: fixture.a.professionalMembershipId,
      branchId: fixture.a.branch.id,
      weekday: weekdayOf(date),
      startMinute: overrides.startMinute ?? 8 * 60,
      endMinute: overrides.endMinute ?? 12 * 60,
    };
  }

  function availabilityUrl(overrides: Record<string, string | number | undefined> = {}): string {
    const merged: Record<string, string | number | undefined> = {
      branchId: fixture.a.branch.id,
      professionalMembershipId: fixture.a.professionalMembershipId,
      date: DATE_WINDOW,
      durationMinutes: 30,
      ...overrides,
    };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) search.set(key, String(value));
    }
    return `/appointments/availability?${search.toString()}`;
  }

  function availabilityRequest(
    overrides: Record<string, string | number | undefined> = {},
    cookie = fixture.a.actor.cookie
  ) {
    return supertest(server()).get(availabilityUrl(overrides)).set("Cookie", cookie);
  }

  function createAppointmentHttp(slot: AvailabilitySlotBody) {
    return supertest(server()).post("/appointments").set("Cookie", fixture.a.actor.cookie).send({
      branchId: fixture.a.branch.id,
      patientId: fixture.a.patientId,
      professionalMembershipId: fixture.a.professionalMembershipId,
      startAt: slot.startAt,
      endAt: slot.endAt,
    });
  }

  async function slotsFor(
    date: string,
    overrides: Record<string, string | number | undefined> = {}
  ): Promise<AvailabilityBody> {
    const response = await availabilityRequest({ date, ...overrides }).expect(200);
    return response.body as AvailabilityBody;
  }

  it("rejects anonymous callers with 401 UNAUTHENTICATED", async () => {
    const response = await supertest(server()).get(availabilityUrl()).expect(401);
    expect((response.body as ErrorDto).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a role without the read permission with 403 FORBIDDEN", async () => {
    const manageOnlyRole = seedRoleWithKeys(
      booted.db,
      `AVAIL_MGR_${randomUUID().slice(0, 8)}`,
      "Scheduling manage-only (availability fixture)",
      ["scheduling.appointment.manage"]
    );
    const manageOnly = seedRbacActor(booted.db, {
      email: `avail-mgr-${randomUUID().slice(0, 8)}@isolation.test`,
      tenantId: tenantA,
      roleId: manageOnlyRole.role.id,
    });
    const response = await availabilityRequest({}, manageOnly.cookie).expect(403);
    expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
  });

  it("rejects unknown keys, malformed ids/date and out-of-range duration/step with 400", async () => {
    const cases: Record<string, string | number | undefined>[] = [
      { tenantId: fixture.b.tenant.id },
      { branchId: "not-a-uuid" },
      { professionalMembershipId: "not-a-uuid" },
      { date: "2026-06-31" },
      { date: "2026-13-01" },
      { durationMinutes: 4 },
      { durationMinutes: 481 },
      { durationMinutes: "" },
      { stepMinutes: 4 },
      { stepMinutes: 481 },
      { durationMinutes: 60, stepMinutes: 30 },
    ];
    for (const overrides of cases) {
      const response = await availabilityRequest(overrides).expect(400);
      expect((response.body as ErrorDto).error.code, JSON.stringify(overrides)).toBe(
        "VALIDATION_FAILED"
      );
    }
  });

  it("offers ordered, non-overlapping slots inside a configured window", async () => {
    setSettings({ availability: [windowFor(DATE_WINDOW)] });

    const body = await slotsFor(DATE_WINDOW);
    expect(Object.keys(body).sort()).toEqual([...RESPONSE_KEYS].sort());
    expect(body.date).toBe(DATE_WINDOW);
    expect(body.branchId).toBe(fixture.a.branch.id);
    expect(body.professionalMembershipId).toBe(fixture.a.professionalMembershipId);
    expect(body.durationMinutes).toBe(30);
    expect(body.stepMinutes).toBe(30);
    expect(body.timeZone).toBe(TENANT_TIMEZONE);
    expect(body.basis).toBe("CONFIGURED_WINDOWS");

    expect(body.slots.map((slot) => localParts(slot.startAt).minuteOfDay)).toEqual([
      480, 510, 540, 570, 600, 630, 660, 690,
    ]);
    const targetSerial = calendarDaySerial(DATE_WINDOW);
    for (const slot of body.slots) {
      expect(Object.keys(slot).sort()).toEqual([...SLOT_KEYS].sort());
      expect(localParts(slot.startAt).daySerial).toBe(targetSerial);
      expect(Date.parse(slot.endAt) - Date.parse(slot.startAt)).toBe(30 * MINUTE_MS);
    }
    for (let index = 1; index < body.slots.length; index += 1) {
      expect(Date.parse(body.slots[index].startAt)).toBeGreaterThanOrEqual(
        Date.parse(body.slots[index - 1].endAt)
      );
    }

    // Agreement, forward direction: the write path accepts a slot the read
    // offered inside the configured window.
    await createAppointmentHttp(body.slots[0]).expect(201);
  });

  it("excludes the slot a one-off block covers", async () => {
    setSettings({ availability: [windowFor(DATE_BLOCK)] });
    const before = await slotsFor(DATE_BLOCK);
    const target = before.slots[1];

    setSettings({
      availability: [windowFor(DATE_BLOCK)],
      blocks: [
        {
          membershipId: fixture.a.professionalMembershipId,
          branchId: fixture.a.branch.id,
          startsAt: target.startAt,
          endsAt: target.endAt,
        },
      ],
    });

    const after = await slotsFor(DATE_BLOCK);
    expect(after.slots.map((slot) => slot.startAt)).not.toContain(target.startAt);
    expect(after.slots).toHaveLength(before.slots.length - 1);

    // Agreement, reverse direction: the write path REJECTS the slot the read
    // withheld, so a picker can never offer a blocked time.
    const rejected = await createAppointmentHttp(target).expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
  });

  it("excludes the slot an overlapping active appointment occupies", async () => {
    setSettings({ availability: [windowFor(DATE_OVERLAP)] });
    const before = await slotsFor(DATE_OVERLAP);
    const target = before.slots[1];

    fixture.createAppointment(fixture.a, {
      startAt: new Date(target.startAt),
      endAt: new Date(target.endAt),
      status: "SCHEDULED",
    });

    const after = await slotsFor(DATE_OVERLAP);
    expect(after.slots.map((slot) => slot.startAt)).not.toContain(target.startAt);
    expect(after.slots).toHaveLength(before.slots.length - 1);

    // Agreement, reverse direction: the write path refuses the SAME slot under
    // the default REJECT policy.
    const rejected = await createAppointmentHttp(target).expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
  });

  it("withholds slots occupied by ARRIVED and IN_PROGRESS appointments", async () => {
    setSettings({ availability: [windowFor(DATE_STATUSES)] });
    const before = await slotsFor(DATE_STATUSES);

    const arrived = before.slots[1];
    const inProgress = before.slots[3];
    fixture.createAppointment(fixture.a, {
      startAt: new Date(arrived.startAt),
      endAt: new Date(arrived.endAt),
      status: "ARRIVED",
    });
    fixture.createAppointment(fixture.a, {
      startAt: new Date(inProgress.startAt),
      endAt: new Date(inProgress.endAt),
      status: "IN_PROGRESS",
    });

    const after = await slotsFor(DATE_STATUSES);
    const offered = after.slots.map((slot) => slot.startAt);
    expect(offered).not.toContain(arrived.startAt);
    expect(offered).not.toContain(inProgress.startAt);
    expect(offered).toContain(before.slots[0].startAt);
    expect(after.slots).toHaveLength(before.slots.length - 2);

    // Agreement, reverse direction: the write path refuses the withheld slot.
    const rejected = await createAppointmentHttp(inProgress).expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
  });

  it("under conflictPolicy ALLOW the read withholds an overlap the write accepts", async () => {
    setSettings({ conflictPolicy: "ALLOW", availability: [windowFor(DATE_ALLOW)] });
    const before = await slotsFor(DATE_ALLOW);
    const target = before.slots[1];
    fixture.createAppointment(fixture.a, {
      startAt: new Date(target.startAt),
      endAt: new Date(target.endAt),
      status: "SCHEDULED",
    });

    const after = await slotsFor(DATE_ALLOW);
    expect(after.slots.map((slot) => slot.startAt)).not.toContain(target.startAt);

    // Pins the documented strict-subset divergence: ALLOW explicitly permits the
    // overlap on the write path, so the read offers fewer slots than it accepts.
    await createAppointmentHttp(target).expect(201);
  });

  it("does NOT exclude a slot that only touches an active appointment's edge", async () => {
    setSettings({ availability: [windowFor(DATE_ADJACENT)] });
    const before = await slotsFor(DATE_ADJACENT);
    const target = before.slots[1];

    // An appointment ending exactly at the target start, and one starting
    // exactly at the target end. Both edges touch the target without overlapping.
    fixture.createAppointment(fixture.a, {
      startAt: new Date(Date.parse(target.startAt) - 30 * MINUTE_MS),
      endAt: new Date(target.startAt),
      status: "SCHEDULED",
    });
    fixture.createAppointment(fixture.a, {
      startAt: new Date(target.endAt),
      endAt: new Date(Date.parse(target.endAt) + 30 * MINUTE_MS),
      status: "CONFIRMED",
    });

    const after = await slotsFor(DATE_ADJACENT);
    expect(after.slots.map((slot) => slot.startAt)).toContain(target.startAt);
    // The neighbours that the seeded rows DO occupy are gone, proving the
    // seeded rows were visible to the overlap read.
    expect(after.slots.map((slot) => slot.startAt)).not.toContain(before.slots[0].startAt);
    expect(after.slots.map((slot) => slot.startAt)).not.toContain(before.slots[2].startAt);
  });

  it("does NOT exclude slots for CANCELLED, NO_SHOW or COMPLETED appointments", async () => {
    setSettings({ availability: [windowFor(DATE_TERMINAL)] });
    const before = await slotsFor(DATE_TERMINAL);
    const target = before.slots[1];

    const terminalStatuses: AppointmentStatusRow[] = ["CANCELLED", "NO_SHOW", "COMPLETED"];
    for (const status of terminalStatuses) {
      fixture.createAppointment(fixture.a, {
        startAt: new Date(target.startAt),
        endAt: new Date(target.endAt),
        status,
      });
    }

    const after = await slotsFor(DATE_TERMINAL);
    expect(after.slots.map((slot) => slot.startAt)).toContain(target.startAt);
  });

  it("honors duration and step, and drops a start whose duration overruns the window", async () => {
    setSettings({
      availability: [windowFor(DATE_DURATION, { startMinute: 8 * 60, endMinute: 12 * 60 })],
    });
    const stepped = await slotsFor(DATE_DURATION, { durationMinutes: 30, stepMinutes: 60 });
    expect(stepped.stepMinutes).toBe(60);
    expect(stepped.slots.map((slot) => localParts(slot.startAt).minuteOfDay)).toEqual([
      480, 540, 600, 660,
    ]);

    // 08:00–10:00 window with a 90-minute duration: only the 08:00 start fits;
    // a 09:30 start would run past 10:00 and is never offered.
    setSettings({
      availability: [windowFor(DATE_DURATION, { startMinute: 8 * 60, endMinute: 10 * 60 })],
    });
    const long = await slotsFor(DATE_DURATION, { durationMinutes: 90, stepMinutes: 90 });
    expect(long.durationMinutes).toBe(90);
    expect(long.slots.map((slot) => localParts(slot.startAt).minuteOfDay)).toEqual([480]);
    expect(localParts(long.slots[0].endAt).minuteOfDay).toBe(570);
  });

  it("withholds a slot outside a configured window and the write refuses it", async () => {
    setSettings({
      availability: [windowFor(DATE_OUTSIDE, { startMinute: 8 * 60, endMinute: 12 * 60 })],
    });

    const body = await slotsFor(DATE_OUTSIDE);
    expect(body.slots.length).toBeGreaterThan(0);
    for (const slot of body.slots) {
      expect(localParts(slot.startAt).minuteOfDay).toBeGreaterThanOrEqual(8 * 60);
      expect(localParts(slot.endAt).minuteOfDay).toBeLessThanOrEqual(12 * 60);
    }

    // Local ~05:00–06:00 on the same weekday is outside the window on BOTH paths.
    const outside = {
      startAt: new Date("2026-06-26T09:00:00.000Z").toISOString(),
      endAt: new Date("2026-06-26T09:30:00.000Z").toISOString(),
    };
    expect(body.slots.map((slot) => slot.startAt)).not.toContain(outside.startAt);
    const rejected = await createAppointmentHttp(outside).expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
  });

  it("keeps a slot near local midnight on the correct local date", async () => {
    setSettings({
      availability: [windowFor(DATE_MIDNIGHT, { startMinute: 23 * 60, endMinute: 24 * 60 })],
    });

    const body = await slotsFor(DATE_MIDNIGHT);
    expect(body.slots).toHaveLength(2);
    const targetSerial = calendarDaySerial(DATE_MIDNIGHT);
    expect(localParts(body.slots[0].startAt)).toMatchObject({
      daySerial: targetSerial,
      minuteOfDay: 1380,
    });
    const lastSlot = body.slots[body.slots.length - 1];
    expect(localParts(lastSlot.endAt)).toMatchObject({
      daySerial: targetSerial + 1,
      minuteOfDay: 0,
    });

    // The write path accepts the last slot the read offered: it ends exactly at
    // local midnight, the day-boundary case the shared predicate special-cases.
    const created = await createAppointmentHttp(lastSlot).expect(201);
    expect((created.body as { endAt: string }).endAt).toBe(lastSlot.endAt);
  });

  it("falls back to the product default day range when the pair has no windows", async () => {
    setSettings({ availability: [] });

    const body = await slotsFor(DATE_DEFAULT, { stepMinutes: 30 });
    expect(body.basis).toBe("DEFAULT_DAY_RANGE");
    expect(body.slots).toHaveLength(28);
    expect(localParts(body.slots[0].startAt).minuteOfDay).toBe(7 * 60);
    expect(localParts(body.slots[body.slots.length - 1].endAt).minuteOfDay).toBe(21 * 60);

    // Unrestricted on the write path, so the first offered slot is accepted.
    await createAppointmentHttp(body.slots[0]).expect(201);
  });

  it("offers nothing when the pair is configured but has no window on that weekday", async () => {
    setSettings({ availability: [windowFor(DATE_WINDOW)] });

    const body = await slotsFor(DATE_NO_WINDOW);
    expect(body.basis).toBe("CONFIGURED_WINDOWS");
    expect(body.slots).toEqual([]);

    // The write path refuses the same day: the pair has windows, none matching
    // this weekday, so no candidate on it is accepted.
    const rejected = await createAppointmentHttp({
      startAt: new Date("2026-06-16T12:00:00.000Z").toISOString(),
      endAt: new Date("2026-06-16T12:30:00.000Z").toISOString(),
    }).expect(409);
    expect((rejected.body as ErrorDto).error.code).toBe("CONFLICT");
  });

  it("masks a foreign branch and a foreign professional as byte-equivalent 404", async () => {
    setSettings({ availability: [windowFor(DATE_WINDOW)] });
    const params = (branchId: string, professionalMembershipId: string): string =>
      `?branchId=${branchId}&professionalMembershipId=${professionalMembershipId}&date=${DATE_WINDOW}&durationMinutes=30`;

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/appointments/availability${params(randomUUID(), fixture.a.professionalMembershipId)}`,
      foreignUrl: `/appointments/availability${params(fixture.b.branch.id, fixture.a.professionalMembershipId)}`,
      forbiddenIdentifiers: [fixture.b.branch.id, fixture.b.tenant.id],
    });
    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.a.actor.cookie,
      nonexistentUrl: `/appointments/availability${params(fixture.a.branch.id, randomUUID())}`,
      foreignUrl: `/appointments/availability${params(fixture.a.branch.id, fixture.b.professionalMembershipId)}`,
      forbiddenIdentifiers: [fixture.b.professionalMembershipId, fixture.b.tenant.id],
    });
  });

  it("rejects a same-tenant non-VETERINARIAN professional exactly like the write path", async () => {
    const membership = fixture.a.actor.membership;
    if (!membership) throw new Error("fixture actor membership missing");
    setSettings({ availability: [windowFor(DATE_WINDOW)] });

    const read = await availabilityRequest({
      professionalMembershipId: membership.id,
    }).expect(400);
    expect((read.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");

    const write = await supertest(server())
      .post("/appointments")
      .set("Cookie", fixture.a.actor.cookie)
      .send({
        branchId: fixture.a.branch.id,
        patientId: fixture.a.patientId,
        professionalMembershipId: membership.id,
        startAt: new Date(Date.UTC(2026, 5, 15, 12, 0)).toISOString(),
        endAt: new Date(Date.UTC(2026, 5, 15, 12, 30)).toISOString(),
      })
      .expect(400);
    expect((write.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
  });

  it("never lets another tenant's appointments affect the result", async () => {
    setSettings({ availability: [windowFor(DATE_TENANT)] });
    const before = await slotsFor(DATE_TENANT);

    // The foreign appointment occupies the exact range of A's first slot; A's
    // own appointment occupies the third. Only the own row may remove a slot.
    fixture.createAppointment(fixture.b, {
      startAt: new Date(before.slots[0].startAt),
      endAt: new Date(before.slots[0].endAt),
      status: "SCHEDULED",
    });
    fixture.createAppointment(fixture.a, {
      startAt: new Date(before.slots[2].startAt),
      endAt: new Date(before.slots[2].endAt),
      status: "SCHEDULED",
    });

    const after = await slotsFor(DATE_TENANT);
    expect(after.slots.map((slot) => slot.startAt)).toContain(before.slots[0].startAt);
    expect(after.slots.map((slot) => slot.startAt)).not.toContain(before.slots[2].startAt);
  });

  it("never offers a wall time that does not exist on the spring-forward day", async () => {
    if (!SPRING_FORWARD) {
      throw new Error("America/Asuncion 2024 spring-forward transition not found");
    }
    const gapStartWall = wallClockUtc(SPRING_FORWARD.utcMs, SPRING_FORWARD.offsetBeforeMs);
    const gapEndWall = wallClockUtc(SPRING_FORWARD.utcMs, SPRING_FORWARD.offsetAfterMs);
    const gapDate = dateKeyOfWallClock(gapStartWall);
    const gapStartMinute = minuteOfWallClock(gapStartWall);
    const gapEndMinute = minuteOfWallClock(gapEndWall);
    expect(gapEndMinute).toBeGreaterThan(gapStartMinute);

    setSettings({
      availability: [
        windowFor(gapDate, { startMinute: gapStartMinute, endMinute: gapEndMinute + 120 }),
      ],
    });

    const body = await slotsFor(gapDate);
    const offeredMinutes = body.slots.map((slot) => localParts(slot.startAt).minuteOfDay);
    for (const minute of offeredMinutes) {
      expect(
        minute < gapStartMinute || minute >= gapEndMinute,
        `nonexistent wall minute ${minute} was offered`
      ).toBe(true);
    }
    // The nonexistent grid points are skipped; the first existing start after
    // the gap and the ones after it are offered.
    expect(offeredMinutes).toEqual([
      gapEndMinute,
      gapEndMinute + 30,
      gapEndMinute + 60,
      gapEndMinute + 90,
    ]);

    await createAppointmentHttp(body.slots[0]).expect(201);
  });

  it("offers an ambiguous fall-back wall time at most once", async () => {
    if (!FALL_BACK) {
      throw new Error("America/Asuncion 2024 fall-back transition not found");
    }
    const wallBefore = wallClockUtc(FALL_BACK.utcMs, FALL_BACK.offsetBeforeMs);
    const wallAfter = wallClockUtc(FALL_BACK.utcMs, FALL_BACK.offsetAfterMs);
    const foldDate = dateKeyOfWallClock(wallAfter);
    const ambiguousStartMinute = minuteOfWallClock(wallAfter);
    const foldDayStartUtc = Date.UTC(
      new Date(wallAfter).getUTCFullYear(),
      new Date(wallAfter).getUTCMonth(),
      new Date(wallAfter).getUTCDate()
    );
    const ambiguousEndMinute = (wallBefore - foldDayStartUtc) / MINUTE_MS;
    expect(ambiguousEndMinute).toBeGreaterThan(ambiguousStartMinute);

    setSettings({
      availability: [
        windowFor(foldDate, { startMinute: ambiguousStartMinute, endMinute: ambiguousEndMinute }),
      ],
    });

    const body = await slotsFor(foldDate);
    const offeredMinutes = body.slots.map((slot) => localParts(slot.startAt).minuteOfDay);
    // Each ambiguous wall minute is visited once by the grid, so it is offered
    // exactly once — never the two real occurrences of that wall time.
    expect(new Set(offeredMinutes).size).toBe(offeredMinutes.length);
    expect(offeredMinutes).toEqual([ambiguousStartMinute, ambiguousStartMinute + 30]);

    for (const slot of body.slots) {
      const wallMs = foldDayStartUtc + localParts(slot.startAt).minuteOfDay * MINUTE_MS;
      // The offered instant is the FIRST occurrence; the second is hidden.
      expect(Date.parse(slot.startAt)).toBe(wallMs - FALL_BACK.offsetBeforeMs);
      expect(Date.parse(slot.startAt)).not.toBe(wallMs - FALL_BACK.offsetAfterMs);
    }

    await createAppointmentHttp(body.slots[0]).expect(201);
  });

  it("writes nothing: no appointment, no audit row, no settings change", async () => {
    setSettings({ availability: [windowFor(DATE_WINDOW)] });
    const requestId = randomUUID();
    const appointmentsBefore = booted.db.tables.appointments.size;
    const auditsBefore = booted.db.tables.audits.size;
    const settingsBefore = booted.db.tables.settingNamespaces.size;

    await availabilityRequest({ date: DATE_WINDOW }).set(REQUEST_ID_HEADER, requestId).expect(200);

    expect(booted.db.tables.appointments.size).toBe(appointmentsBefore);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
    expect(booted.db.tables.settingNamespaces.size).toBe(settingsBefore);
    const audits = [...booted.db.tables.audits.values()].filter(
      (row) => row.requestId === requestId
    );
    expect(audits).toEqual([]);
  });
});
