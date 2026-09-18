import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import { calendarDaySerial, zonedDayMinuteToUtc } from "../scheduling/appointment-availability.js";
import { TENANT_TIMEZONE, toZonedParts } from "../scheduling/appointment-invariants.js";
import type { AppointmentStatusRow } from "../../test/support/in-memory-database.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface AvailabilitySlotBody {
  startAt: string;
  endAt: string;
}

interface AvailabilityBody {
  date: string;
  timeZone: string;
  durationMinutes: number;
  stepMinutes: number;
  slots: AvailabilitySlotBody[];
}

/** Allowlisted CONFIDENTIAL surface — any extra key (a staffing count) fails. */
const RESPONSE_KEYS = ["date", "durationMinutes", "slots", "stepMinutes", "timeZone"].sort();

const SLOT_KEYS = ["endAt", "startAt"].sort();

const MINUTE_MS = 60_000;

/**
 * Distinctive professional identity markers. Neither may reach a portal
 * response body or a captured log line, on any status code.
 */
const PROFESSIONAL_NAME_MARKER = "PRIVACY-NAME-MARKER-7f3a";
const PROFESSIONAL_EMAIL_MARKER = "privacy-email-marker-7f3a@isolation.test";

/** Distinct local dates per case so no case can leak rows into another. */
const DATE_UNION = "2026-06-15";
const DATE_BUSY = "2026-06-16";
const DATE_BLOCK = "2026-06-17";
const DATE_MIDNIGHT = "2026-06-18";
const DATE_DURATION = "2026-06-19";
const DATE_DEFAULT = "2026-06-22";
const DATE_TENANT = "2026-06-23";
const DATE_WRITE = "2026-06-24";
const DATE_BRANCH = "2026-06-25";
const DATE_UNRESTRICTED_BLOCK = "2026-06-26";

function weekdayOf(date: string): number {
  return new Date(calendarDaySerial(date) * 86_400_000).getUTCDay();
}

function localParts(iso: string): { daySerial: number; minuteOfDay: number } {
  return toZonedParts(new Date(iso));
}

function minutesOf(slots: readonly AvailabilitySlotBody[]): number[] {
  return slots.map((slot) => localParts(slot.startAt).minuteOfDay);
}

/**
 * DEC-007 A2a — holder-facing availability read over the REAL HTTP surface and
 * the full guard chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves the UNION contract: a slot is offered when AT LEAST ONE in-tenant
 * VETERINARIAN can take it, and it disappears only when every professional who
 * could take it is busy. Also pins the privacy contract (times only) and the
 * read-only contract (nothing is written).
 */
describe("portal availability union read (DEC-007 A2a)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let holderA: PortalAccessFixture;
  let holderB: PortalAccessFixture;
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  /** A second tenant-A branch with NO windows for any professional. */
  let branchA2: string;
  let branchB: string;
  /** A staff actor holding `scheduling.appointment.manage` (write-path half). */
  let staffActor: RbacActor;
  /** A tenant-A patient usable as the appointment anchor. */
  let patientA: string;
  /** Two candidate professionals of tenant A plus one foreign professional. */
  let vetA1: string;
  let vetA2: string;
  let vetB: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = booted.db.prisma;
    tenantA = fixture.tenants.a.id;
    tenantB = fixture.tenants.b.id;

    const createCustomer = (tenantId: string, displayName: string): string =>
      prisma.customer.create({
        data: {
          tenantId,
          kind: "INDIVIDUAL",
          displayName,
          legalName: null,
          taxId: null,
          firstName: null,
          lastName: null,
          documentNumber: null,
          isActive: true,
        },
      }).id;

    const customerA = createCustomer(tenantA, "Availability Holder A");
    const customerB = createCustomer(tenantB, "Availability Holder B");

    // Distinct role rows keep each membership's VETERINARIAN code resolvable.
    const vetRole = prisma.role.create({
      data: { code: "VETERINARIAN", name: "Veterinarian (portal availability fixture)" },
    });

    const seedVet = (
      tenantId: string,
      label: string,
      profileOverrides: { displayName?: string; email?: string } = {}
    ): string => {
      const profile = prisma.userProfile.create({
        data: {
          email:
            profileOverrides.email ??
            `avail-vet-${label}-${randomUUID().slice(0, 8)}@isolation.test`,
          displayName: profileOverrides.displayName ?? `Availability Vet ${label}`,
          status: "active",
        },
      });
      return prisma.tenantMembership.create({
        data: { tenantId, userProfileId: profile.id, roleId: vetRole.id, status: "ACTIVE" },
      }).id;
    };

    branchA = prisma.branch.create({
      data: { tenantId: tenantA, name: "Availability Branch A" },
    }).id;
    branchA2 = prisma.branch.create({
      data: { tenantId: tenantA, name: "Availability Branch A2 (no windows)" },
    }).id;
    branchB = prisma.branch.create({
      data: { tenantId: tenantB, name: "Availability Branch B" },
    }).id;
    vetA1 = seedVet(tenantA, "A1", {
      displayName: PROFESSIONAL_NAME_MARKER,
      email: PROFESSIONAL_EMAIL_MARKER,
    });
    vetA2 = seedVet(tenantA, "A2");
    vetB = seedVet(tenantB, "B1");

    // STAFF half of the write-path agreement test: an actor that holds only
    // `scheduling.appointment.manage` on tenant A, plus the anchors a staff
    // create needs (branch, patient).
    const schedulingManagerRole = seedRoleWithKeys(
      booted.db,
      `AVAIL_MGR_${randomUUID().slice(0, 8)}`,
      "Scheduling manager (portal availability fixture)",
      ["scheduling.appointment.manage"]
    );
    staffActor = seedRbacActor(booted.db, {
      email: `avail-manager-${randomUUID().slice(0, 8)}@isolation.test`,
      tenantId: tenantA,
      roleId: schedulingManagerRole.role.id,
    });
    const species = prisma.species.create({
      data: { code: `avail-species-${randomUUID().slice(0, 8)}`, name: "Availability Species" },
    });
    patientA = prisma.patient.create({
      data: {
        tenantId: tenantA,
        name: "Availability Patient",
        speciesId: species.id,
        breedId: null,
        sex: "MALE",
        birthDate: null,
        isActive: true,
      },
    }).id;

    holderA = seedPortalAccess(booted.db, { tenantId: tenantA, customerId: customerA });
    holderB = seedPortalAccess(booted.db, { tenantId: tenantB, customerId: customerB });

    // Only tenant A holds the explicit `portal` grant.
    const portalFeature = prisma.featureCode.create({ data: { code: "portal" } });
    prisma.tenantEntitlement.create({
      data: { tenantId: tenantA, featureCodeId: portalFeature.id },
    });
  });

  afterAll(async () => {
    fixture.cleanup();
    await booted.close();
  });

  const server = () => booted.app.getHttpServer();

  function setSettings(
    data: { availability?: unknown[]; blocks?: unknown[] },
    tenantId = tenantA
  ): void {
    const payload = {
      conflictPolicy: "REJECT",
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
    membershipId: string,
    branchId: string,
    date: string,
    startMinute: number,
    endMinute: number
  ): Record<string, unknown> {
    return { membershipId, branchId, weekday: weekdayOf(date), startMinute, endMinute };
  }

  /**
   * A window on a neighbouring weekday: it keeps a professional "configured"
   * (so it is NOT unrestricted) without contributing any candidate on the query
   * day. This isolates the subject professional in each case.
   */
  function offDayWindow(
    membershipId: string,
    branchId: string,
    date: string
  ): Record<string, unknown> {
    return {
      membershipId,
      branchId,
      weekday: (weekdayOf(date) + 1) % 7,
      startMinute: 8 * 60,
      endMinute: 12 * 60,
    };
  }

  function createAppointment(
    membershipId: string,
    startAt: Date,
    endAt: Date,
    status: AppointmentStatusRow = "SCHEDULED",
    tenantId = tenantA
  ): void {
    booted.db.prisma.appointment.create({
      data: {
        tenantId,
        branchId: tenantId === tenantA ? branchA : branchB,
        patientId: randomUUID(),
        professionalMembershipId: membershipId,
        status,
        version: 1,
        startAt,
        endAt,
      },
    });
  }

  function createAppointmentViaStaff(
    membershipId: string,
    branchId: string,
    slot: AvailabilitySlotBody
  ) {
    return supertest(server()).post("/appointments").set("Cookie", staffActor.cookie).send({
      branchId,
      patientId: patientA,
      professionalMembershipId: membershipId,
      startAt: slot.startAt,
      endAt: slot.endAt,
    });
  }

  function availabilityRequest(
    params: Record<string, string | number | undefined>,
    cookie: string | null = holderA.cookie
  ) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const qs = search.toString();
    const request = supertest(server()).get(`/portal/availability${qs.length > 0 ? `?${qs}` : ""}`);
    return cookie === null ? request : request.set("Cookie", cookie);
  }

  async function bodyFor(
    date: string,
    overrides: Record<string, string | number | undefined> = {}
  ): Promise<AvailabilityBody> {
    const response = await availabilityRequest({ date, durationMinutes: 30, ...overrides }).expect(
      200
    );
    return response.body as AvailabilityBody;
  }

  describe("authentication, entitlement and privacy boundary", () => {
    it("rejects an anonymous read and a staff session with 401", async () => {
      setSettings({ availability: [windowFor(vetA1, branchA, DATE_UNION, 8 * 60, 12 * 60)] });
      const anonymous = await availabilityRequest(
        {
          date: DATE_UNION,
          durationMinutes: 30,
        },
        null
      ).expect(401);
      expect((anonymous.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");

      const staff = await availabilityRequest(
        { date: DATE_UNION, durationMinutes: 30 },
        fixture.actors.a.cookie
      ).expect(401);
      expect((staff.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects a holder whose tenant has no portal entitlement with 403", async () => {
      const response = await availabilityRequest(
        { date: DATE_UNION, durationMinutes: 30 },
        holderB.cookie
      ).expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    });

    it("reveals times only — no professional identity, name or email, and no staffing count", async () => {
      const settings = {
        availability: [
          windowFor(vetA1, branchA, DATE_UNION, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_UNION),
        ],
      };
      setSettings(settings);

      /** Identity, configuration and staffing data that must never leak. */
      const forbidden = [
        vetA1,
        vetA2,
        branchA,
        branchA2,
        PROFESSIONAL_NAME_MARKER,
        PROFESSIONAL_EMAIL_MARKER,
        "professionalMembershipId",
        "branchId",
        "professionalCount",
        "availableProfessionals",
        "basis",
      ];

      // Successful read: exact allowlist, then the anti-leak scan.
      const response = await availabilityRequest({
        date: DATE_UNION,
        durationMinutes: 30,
      }).expect(200);
      const body = response.body as AvailabilityBody;
      expect(Object.keys(body).sort()).toEqual(RESPONSE_KEYS);
      expect(body.slots.length).toBeGreaterThan(0);
      for (const slot of body.slots) {
        expect(Object.keys(slot).sort()).toEqual(SLOT_KEYS);
      }
      for (const marker of forbidden) {
        expect(response.text, `success body leaked ${marker}`).not.toContain(marker);
      }

      // Validation failure body (real 400 envelope).
      const invalid = await availabilityRequest({ date: DATE_UNION, durationMinutes: 4 }).expect(
        400
      );
      for (const marker of forbidden) {
        expect(invalid.text, `validation body leaked ${marker}`).not.toContain(marker);
      }

      // Entitlement failure body (real 403 envelope) — a second real error path.
      const notEntitled = await availabilityRequest(
        { date: DATE_UNION, durationMinutes: 30 },
        holderB.cookie
      ).expect(403);
      for (const marker of forbidden) {
        expect(notEntitled.text, `entitlement body leaked ${marker}`).not.toContain(marker);
      }

      // Log coverage for the REAL requests above: the harness captures the pino
      // stream in memory. Checked BEFORE the forced failure below, whose crafted
      // internal message deliberately carries a marker.
      const realLogs = booted.logLines().join("\n");
      for (const marker of [PROFESSIONAL_NAME_MARKER, PROFESSIONAL_EMAIL_MARKER]) {
        expect(realLogs, `captured logs leaked ${marker}`).not.toContain(marker);
      }

      // Internal-error body: force the availability overlap read to throw an
      // error whose OWN message carries the email marker, then prove the
      // sanitized 500 INTERNAL envelope never echoes it. The delegate is
      // restored in `finally` so later cases keep the real boundary.
      const originalFindMany = booted.db.prisma.appointment.findMany;
      booted.db.prisma.appointment.findMany = () => {
        throw new Error(`forced internal failure for ${PROFESSIONAL_EMAIL_MARKER}`);
      };
      try {
        const internal = await availabilityRequest({
          date: DATE_UNION,
          durationMinutes: 30,
        }).expect(500);
        expect((internal.body as ErrorEnvelopeBody).error.code).toBe("INTERNAL");
        for (const marker of forbidden) {
          expect(internal.text, `internal-error body leaked ${marker}`).not.toContain(marker);
        }
      } finally {
        booted.db.prisma.appointment.findMany = originalFindMany;
      }

      // Restore valid settings for later cases.
      setSettings(settings);
    });
  });

  describe("union semantics", () => {
    it("offers the union of two professionals' disjoint windows", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_UNION, 8 * 60, 12 * 60),
          windowFor(vetA2, branchA, DATE_UNION, 14 * 60, 18 * 60),
        ],
      });

      const body = await bodyFor(DATE_UNION);
      expect(body.timeZone).toBe(TENANT_TIMEZONE);
      expect(minutesOf(body.slots)).toEqual([
        480, 510, 540, 570, 600, 630, 660, 690, 840, 870, 900, 930, 960, 990, 1020, 1050,
      ]);
    });

    it("keeps a slot one busy professional cannot take but another can", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_BUSY, 8 * 60, 12 * 60),
          windowFor(vetA2, branchA, DATE_BUSY, 8 * 60, 12 * 60),
        ],
      });
      const before = await bodyFor(DATE_BUSY);
      const first = before.slots[0];
      expect(localParts(first.startAt).minuteOfDay).toBe(480);

      // Only vet A1 is busy at the first slot.
      createAppointment(vetA1, new Date(first.startAt), new Date(first.endAt));
      const withOneBusy = await bodyFor(DATE_BUSY);
      expect(minutesOf(withOneBusy.slots)).toContain(480);

      // Now vet A2 is busy too: the slot disappears only once EVERY taker is busy.
      createAppointment(vetA2, new Date(first.startAt), new Date(first.endAt));
      const withBothBusy = await bodyFor(DATE_BUSY);
      expect(minutesOf(withBothBusy.slots)).not.toContain(480);
      expect(minutesOf(withBothBusy.slots)).toContain(510);
      expect(withBothBusy.slots).toHaveLength(before.slots.length - 1);
    });
  });

  describe("window, block and day boundaries", () => {
    it("withholds a slot covered by a one-off block", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_BLOCK, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_BLOCK),
        ],
      });
      const before = await bodyFor(DATE_BLOCK);
      const target = before.slots[1];

      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_BLOCK, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_BLOCK),
        ],
        blocks: [
          {
            membershipId: vetA1,
            branchId: branchA,
            startsAt: target.startAt,
            endsAt: target.endAt,
          },
        ],
      });

      const after = await bodyFor(DATE_BLOCK);
      expect(after.slots.map((slot) => slot.startAt)).not.toContain(target.startAt);
      // The neighbour stays: only the blocked slot is withheld.
      expect(after.slots.map((slot) => slot.startAt)).toContain(before.slots[2].startAt);
      expect(after.slots).toHaveLength(before.slots.length - 1);
    });

    it("keeps a window at the local day boundary and never overruns it", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_MIDNIGHT, 23 * 60, 24 * 60),
          offDayWindow(vetA2, branchA, DATE_MIDNIGHT),
        ],
      });

      const body = await bodyFor(DATE_MIDNIGHT);
      expect(body.slots).toHaveLength(2);
      const targetSerial = calendarDaySerial(DATE_MIDNIGHT);
      expect(localParts(body.slots[0].startAt)).toEqual({
        daySerial: targetSerial,
        weekday: weekdayOf(DATE_MIDNIGHT),
        minuteOfDay: 23 * 60,
      });
      const last = body.slots[body.slots.length - 1];
      expect(localParts(last.endAt).daySerial).toBe(targetSerial + 1);
      expect(localParts(last.endAt).minuteOfDay).toBe(0);
    });

    it("respects duration and step, including the default step", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_DURATION, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_DURATION),
        ],
      });

      const hourly = await bodyFor(DATE_DURATION, { durationMinutes: 60 });
      expect(hourly.durationMinutes).toBe(60);
      expect(hourly.stepMinutes).toBe(60);
      expect(minutesOf(hourly.slots)).toEqual([480, 540, 600, 660]);
      for (const slot of hourly.slots) {
        expect(Date.parse(slot.endAt) - Date.parse(slot.startAt)).toBe(60 * MINUTE_MS);
      }

      const long = await bodyFor(DATE_DURATION, { durationMinutes: 90 });
      expect(long.stepMinutes).toBe(90);
      expect(minutesOf(long.slots)).toEqual([480, 570]);
    });
  });

  describe("write-path agreement (offered slots survive the write path)", () => {
    it("accepts an offered slot and rejects a withheld slot for the same professional", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_WRITE, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_WRITE),
        ],
      });

      const before = await bodyFor(DATE_WRITE);
      expect(minutesOf(before.slots)).toEqual([480, 510, 540, 570, 600, 630, 660, 690]);

      // Occupy the professional inside their own window: 09:00-10:00 local,
      // covering the third and fourth grid starts.
      const withheld = before.slots[2];
      createAppointment(vetA1, new Date(withheld.startAt), new Date(before.slots[4].startAt));

      const after = await bodyFor(DATE_WRITE);
      const offered = after.slots.map((slot) => slot.startAt);
      // Both overlapping starts are withheld; the touching neighbour and the
      // first start stay offered.
      expect(offered).not.toContain(withheld.startAt);
      expect(offered).not.toContain(before.slots[3].startAt);
      expect(offered).toContain(before.slots[0].startAt);

      // REVERSE: the staff write path refuses the withheld slot with exactly
      // the conflict the shared invariants produce (REJECT overlap -> 409).
      const rejected = await createAppointmentViaStaff(vetA1, branchA, withheld).expect(409);
      expect((rejected.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");

      // FORWARD: the staff write path ACCEPTS an offered slot for that SAME
      // professional, proving the union is a usable hint and not decorative.
      const created = await createAppointmentViaStaff(vetA1, branchA, before.slots[0]).expect(201);
      const body = created.body as {
        professionalMembershipId: string;
        branchId: string;
        startAt: string;
        endAt: string;
      };
      expect(body.professionalMembershipId).toBe(vetA1);
      expect(body.branchId).toBe(branchA);
      expect(body.startAt).toBe(before.slots[0].startAt);
      expect(body.endAt).toBe(before.slots[0].endAt);
    });
  });

  describe("conservative behaviours (regression pins)", () => {
    it("a professional with windows in one branch offers nothing outside those windows", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_BRANCH, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_BRANCH),
        ],
      });

      const body = await bodyFor(DATE_BRANCH);
      const offered = minutesOf(body.slots);
      expect(offered).toEqual([480, 510, 540, 570, 600, 630, 660, 690]);
      // 14:00 is inside the fallback day range but outside the configured branch
      // windows, so the union withholds it even though branch A2 has no windows.
      expect(offered).not.toContain(14 * 60);

      // Pins the deliberate conservative gap: the write path at the window-less
      // branch A2 DOES accept 14:00, so the portal offers strictly less there.
      const start = zonedDayMinuteToUtc(DATE_BRANCH, 14 * 60);
      const end = new Date(start.getTime() + 30 * MINUTE_MS);
      await createAppointmentViaStaff(vetA1, branchA2, {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      }).expect(201);
    });

    it("a block on any branch withholds the slot for a professional that has no windows", async () => {
      const blockStart = zonedDayMinuteToUtc(DATE_UNRESTRICTED_BLOCK, 8 * 60);
      const blockEnd = new Date(blockStart.getTime() + 30 * MINUTE_MS);
      setSettings({
        availability: [offDayWindow(vetA2, branchA, DATE_UNRESTRICTED_BLOCK)],
        blocks: [
          {
            membershipId: vetA1,
            branchId: branchA2,
            startsAt: blockStart.toISOString(),
            endsAt: blockEnd.toISOString(),
          },
        ],
      });

      const body = await bodyFor(DATE_UNRESTRICTED_BLOCK);
      const offered = minutesOf(body.slots);
      // vet A1 has NO windows (unrestricted), so the fallback range is offered
      // and only the block withholds its slot.
      expect(offered).toContain(7 * 60);
      expect(offered).not.toContain(8 * 60);
      expect(offered).toContain(8 * 60 + 30);
    });
  });

  describe("unrestricted day range", () => {
    it("falls back to the 07:00–21:00 product range when no professional has windows", async () => {
      setSettings({ availability: [] });

      const body = await bodyFor(DATE_DEFAULT);
      expect(body.slots).toHaveLength(28);
      expect(localParts(body.slots[0].startAt).minuteOfDay).toBe(7 * 60);
      expect(localParts(body.slots[body.slots.length - 1].endAt).minuteOfDay).toBe(21 * 60);
    });
  });

  describe("strict query validation", () => {
    it("rejects unknown keys, malformed values and out-of-range duration/step with 400", async () => {
      const cases: Record<string, string | number | undefined>[] = [
        {},
        { date: DATE_UNION },
        { durationMinutes: 30 },
        { date: "not-a-date", durationMinutes: 30 },
        { date: "2026-06-31", durationMinutes: 30 },
        { date: "2026-13-01", durationMinutes: 30 },
        { date: DATE_UNION, durationMinutes: 4 },
        { date: DATE_UNION, durationMinutes: 481 },
        { date: DATE_UNION, durationMinutes: "" },
        { date: DATE_UNION, durationMinutes: 30, stepMinutes: 4 },
        { date: DATE_UNION, durationMinutes: 30, stepMinutes: 481 },
        { date: DATE_UNION, durationMinutes: 60, stepMinutes: 30 },
        { date: DATE_UNION, durationMinutes: 30, tenantId: randomUUID() },
        { date: DATE_UNION, durationMinutes: 30, branchId: randomUUID() },
        { date: DATE_UNION, durationMinutes: 30, professionalMembershipId: vetA1 },
      ];

      for (const params of cases) {
        const response = await availabilityRequest(params).expect(400);
        expect((response.body as ErrorEnvelopeBody).error.code, JSON.stringify(params)).toBe(
          "VALIDATION_FAILED"
        );
      }
    });
  });

  describe("tenant isolation", () => {
    it("never lets another tenant's professionals or appointments affect the result", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_TENANT, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_TENANT),
        ],
      });
      const before = await bodyFor(DATE_TENANT);
      const first = before.slots[0];

      // Foreign tenant: a professional with the SAME weekday window and a busy
      // appointment at A's first slot. Neither may reach A's response.
      setSettings(
        {
          availability: [windowFor(vetB, branchB, DATE_TENANT, 8 * 60, 12 * 60)],
        },
        tenantB
      );
      createAppointment(vetB, new Date(first.startAt), new Date(first.endAt), "SCHEDULED", tenantB);

      const after = await bodyFor(DATE_TENANT);
      expect(after.slots.map((slot) => slot.startAt)).toEqual(
        before.slots.map((slot) => slot.startAt)
      );
      expect(after.slots.map((slot) => slot.startAt)).toContain(first.startAt);

      const response = await availabilityRequest({ date: DATE_TENANT, durationMinutes: 30 });
      expect(response.text).not.toContain(vetB);
      expect(response.text).not.toContain(branchB);
      expect(response.text).not.toContain(tenantB);
    });
  });

  describe("read-only guarantee", () => {
    it("writes nothing: no appointment, booking request, audit row or settings change", async () => {
      setSettings({
        availability: [
          windowFor(vetA1, branchA, DATE_UNION, 8 * 60, 12 * 60),
          offDayWindow(vetA2, branchA, DATE_UNION),
        ],
      });
      const requestId = randomUUID();
      const tables = booted.db.tables;
      const before = {
        appointments: tables.appointments.size,
        bookingRequests: tables.portalBookingRequests.size,
        audits: tables.audits.size,
        settings: tables.settingNamespaces.size,
      };

      await availabilityRequest({ date: DATE_UNION, durationMinutes: 30 })
        .set(REQUEST_ID_HEADER, requestId)
        .expect(200);

      expect(tables.appointments.size).toBe(before.appointments);
      expect(tables.portalBookingRequests.size).toBe(before.bookingRequests);
      expect(tables.audits.size).toBe(before.audits);
      expect(tables.settingNamespaces.size).toBe(before.settings);
      const audits = [...tables.audits.values()].filter((row) => row.requestId === requestId);
      expect(audits).toEqual([]);
    });
  });
});
