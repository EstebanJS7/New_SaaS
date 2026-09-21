import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import { toZonedParts } from "../scheduling/appointment-invariants.js";
import type {
  AppointmentRow,
  PatientRow,
  PortalBookingRequestRow,
} from "../../test/support/in-memory-database.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface BookingRequestBody {
  id: string;
  patientId: string;
  status: string;
  startAt: string;
  endAt: string;
}

interface AppointmentBody {
  id: string;
  patientId: string;
  status: string;
  startAt: string;
  endAt: string;
  version: number;
}

/** Stable action codes the audit rows must carry (pinned, not imported). */
const BOOKING_CANCELLED_ACTION = "portal_booking.cancelled";
const APPOINTMENT_CANCELLED_ACTION = "appointment.cancelled";
const APPOINTMENT_RESCHEDULED_ACTION = "appointment.rescheduled";

const BOOKING_KEYS = ["endAt", "id", "patientId", "startAt", "status"];
const APPOINTMENT_KEYS = ["endAt", "id", "patientId", "startAt", "status", "version"];

/** Default conflict policy the settings fall back to when no row is stored. */
const SCHEDULING_DEFAULTS = { conflictPolicy: "REJECT" as const, availability: [], blocks: [] };

/** Target slot every reschedule fixture moves to (Monday 10:00 local, UTC-3). */
const TARGET_START = "2026-05-04T13:00:00.000Z";
const TARGET_END = "2026-05-04T13:30:00.000Z";

/**
 * DEC-007 A2d — holder cancellation and reschedule over real HTTP and the full
 * guard chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves the two ownership rules TOGETHER and on purpose:
 * - a booking request is owner-scoped by its own stored `(tenantId, customerId)`
 *   and stays cancellable after the guardian link to its pet is revoked;
 * - an appointment is guardian-scoped, so a revoked link makes it a
 *   byte-equivalent 404.
 *
 * It also proves the state/scheduling rules are the SHARED ones (illegal states
 * produce the staff `409`, unavailable/blocked/overlapping/stale slots persist
 * nothing), exactly one co-committed PORTAL audit row per mutation, and the
 * allowlisted projection.
 */
describe("portal appointment writes (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let holderA: PortalAccessFixture;
  let holderB: PortalAccessFixture;
  let tenantA: string;
  let customerA1: string;
  let customerA2: string;
  let customerB: string;
  let petA: PatientRow;
  let petAOther: PatientRow;
  let petB: PatientRow;
  let speciesId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = booted.db.prisma;
    tenantA = fixture.tenants.a.id;
    const tenantB = fixture.tenants.b.id;

    const species = prisma.species.create({ data: { code: `dog-${fixture.suffix}`, name: "Dog" } });
    speciesId = species.id;

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

    customerA1 = createCustomer(tenantA, "Holder A Customer");
    customerA2 = createCustomer(tenantA, "Other Customer A");
    customerB = createCustomer(tenantB, "Holder B Customer");

    const createPatient = (tenantId: string, name: string): PatientRow =>
      prisma.patient.create({
        data: {
          tenantId,
          name,
          speciesId: species.id,
          breedId: null,
          sex: "MALE",
          birthDate: new Date("2020-01-02T00:00:00.000Z"),
          isActive: true,
        },
      });

    petA = createPatient(tenantA, "Pet A (holder-owned)");
    petAOther = createPatient(tenantA, "Pet A2 (other customer)");
    petB = createPatient(tenantB, "Pet B (other tenant)");

    const linkGuardian = (tenantId: string, patientId: string, customerId: string): void => {
      prisma.patientGuardian.create({
        data: { tenantId, patientId, customerId, isPrimary: true, isActive: true, position: 0 },
      });
    };
    linkGuardian(tenantA, petA.id, customerA1);
    linkGuardian(tenantA, petAOther.id, customerA2);
    linkGuardian(tenantB, petB.id, customerB);

    holderA = seedPortalAccess(booted.db, { tenantId: tenantA, customerId: customerA1 });
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

  afterEach(() => {
    // Settings are tenant-global; reset so one test's windows/blocks cannot
    // influence the next.
    setSchedulingSettings(SCHEDULING_DEFAULTS);
  });

  const server = (): ReturnType<BootedTestApp["app"]["getHttpServer"]> =>
    booted.app.getHttpServer();

  function setSchedulingSettings(data: {
    conflictPolicy?: "REJECT" | "ALLOW";
    availability?: unknown[];
    blocks?: unknown[];
  }): void {
    const payload = {
      conflictPolicy: data.conflictPolicy ?? "REJECT",
      availability: data.availability ?? [],
      blocks: data.blocks ?? [],
    };
    booted.db.prisma.tenantSettingNamespace.upsert({
      where: { tenantId_namespace: { tenantId: tenantA, namespace: "scheduling" } },
      create: { tenantId: tenantA, namespace: "scheduling", schemaVersion: 1, data: payload },
      update: { schemaVersion: 1, data: payload },
    });
  }

  /** Creates an appointment owned by holder A (guardian link on `petA`). */
  function createAppointment(
    overrides: Partial<{
      patientId: string;
      status: AppointmentRow["status"];
      version: number;
      startAt: Date;
      endAt: Date;
      professionalMembershipId: string;
      branchId: string;
      tenantId: string;
    }> = {}
  ): AppointmentRow {
    return booted.db.prisma.appointment.create({
      data: {
        tenantId: tenantA,
        branchId: overrides.branchId ?? randomUUID(),
        patientId: overrides.patientId ?? petA.id,
        professionalMembershipId: overrides.professionalMembershipId ?? randomUUID(),
        status: overrides.status ?? "SCHEDULED",
        version: overrides.version ?? 1,
        startAt: overrides.startAt ?? new Date(TARGET_START),
        endAt: overrides.endAt ?? new Date(TARGET_END),
        ...(overrides.tenantId !== undefined && { tenantId: overrides.tenantId }),
      },
    });
  }

  function createBookingRequest(
    overrides: Partial<{
      customerId: string;
      patientId: string;
      status: PortalBookingRequestRow["status"];
      tenantId: string;
    }> = {}
  ): PortalBookingRequestRow {
    return booted.db.prisma.portalBookingRequest.create({
      data: {
        tenantId: overrides.tenantId ?? tenantA,
        customerId: overrides.customerId ?? customerA1,
        patientId: overrides.patientId ?? petA.id,
        status: overrides.status ?? "PENDING",
        startAt: new Date("2026-05-01T09:00:00.000Z"),
        endAt: new Date("2026-05-01T10:00:00.000Z"),
      },
    });
  }

  const appointmentById = (id: string): AppointmentRow | null =>
    booted.db.tables.appointments.get(id) ?? null;
  const requestById = (id: string): PortalBookingRequestRow | null =>
    booted.db.tables.portalBookingRequests.get(id) ?? null;
  const auditsFor = (requestId: string) =>
    booted.db.prisma.auditLog.findMany({ where: { requestId } });
  const auditCount = (): number => booted.db.tables.audits.size;

  const cancelBookingUrl = (id: string): string => `/portal/bookings/${id}/cancel`;
  const cancelAppointmentUrl = (id: string): string => `/portal/appointments/${id}/cancel`;
  const rescheduleUrl = (id: string): string => `/portal/appointments/${id}`;

  describe("authentication and entitlement boundary", () => {
    it("returns 401 for anonymous callers and for a staff session", async () => {
      const id = randomUUID();
      for (const url of [cancelBookingUrl(id), cancelAppointmentUrl(id)]) {
        await supertest(server()).post(url).expect(401);
        await supertest(server()).post(url).set("Cookie", fixture.actors.a.cookie).expect(401);
      }
      await supertest(server()).put(rescheduleUrl(id)).send({}).expect(401);
      await supertest(server())
        .put(rescheduleUrl(id))
        .set("Cookie", fixture.actors.a.cookie)
        .send({})
        .expect(401);
    });

    it("returns 403 FEATURE_NOT_ENTITLED for an entitled-less tenant holder", async () => {
      const id = randomUUID();
      for (const url of [cancelBookingUrl(id), cancelAppointmentUrl(id)]) {
        const response = await supertest(server())
          .post(url)
          .set("Cookie", holderB.cookie)
          .expect(403);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
      }
      const response = await supertest(server())
        .put(rescheduleUrl(id))
        .set("Cookie", holderB.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    });
  });

  describe("booking-request cancellation (owner-scoped)", () => {
    it("cancels a PENDING request and appends exactly one PORTAL audit row", async () => {
      const request = createBookingRequest({ status: "PENDING" });
      const requestId = `portal-booking-cancel-${randomUUID()}`;

      const response = await supertest(server())
        .post(cancelBookingUrl(request.id))
        .set("Cookie", holderA.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .expect(200);

      const body = response.body as BookingRequestBody;
      expect(Object.keys(body).sort()).toEqual(BOOKING_KEYS);
      expect(body).toMatchObject({
        id: request.id,
        patientId: petA.id,
        status: "CANCELLED",
      });
      expect(requestById(request.id)?.status).toBe("CANCELLED");

      const audits = auditsFor(requestId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: BOOKING_CANCELLED_ACTION,
        actorType: "PORTAL",
        actorPortalAccessId: holderA.access.id,
        tenantId: tenantA,
        targetType: "portal_booking_request",
        targetId: request.id,
        metadata: { schemaVersion: 1, changedFields: ["status"] },
      });
      expect(audits[0].actorUserProfileId).toBeUndefined();
    });

    it("rejects an already-decided request with 409 and changes nothing", async () => {
      for (const status of ["APPROVED", "REJECTED", "CANCELLED"] as const) {
        const request = createBookingRequest({ status });
        const requestId = `portal-booking-cancel-${randomUUID()}`;

        const response = await supertest(server())
          .post(cancelBookingUrl(request.id))
          .set("Cookie", holderA.cookie)
          .set(REQUEST_ID_HEADER, requestId)
          .expect(409);

        expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
        expect(requestById(request.id)?.status).toBe(status);
        expect(auditsFor(requestId)).toHaveLength(0);
      }
    });

    it("masks another Customer's request and a cross-tenant request as byte-equivalent 404", async () => {
      const otherCustomerRequest = createBookingRequest({
        customerId: customerA2,
        patientId: petAOther.id,
      });
      const crossTenantRequest = createBookingRequest({
        tenantId: fixture.tenants.b.id,
        customerId: customerB,
        patientId: petB.id,
      });

      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "POST",
        nonexistentUrl: cancelBookingUrl(randomUUID()),
        foreignUrl: cancelBookingUrl(otherCustomerRequest.id),
        forbiddenIdentifiers: [otherCustomerRequest.id, petAOther.id],
      });
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "POST",
        nonexistentUrl: cancelBookingUrl(randomUUID()),
        foreignUrl: cancelBookingUrl(crossTenantRequest.id),
        forbiddenIdentifiers: [crossTenantRequest.id, petB.id],
      });

      // Neither foreign request was mutated.
      expect(requestById(otherCustomerRequest.id)?.status).toBe("PENDING");
      expect(requestById(crossTenantRequest.id)?.status).toBe("PENDING");
    });

    it("STILL cancels the holder's OWN request after the guardian link to its pet is revoked", async () => {
      // The owner-scoped half of the documented asymmetry: the request stores
      // the Customer that submitted it, so revoking the pet's guardian link must
      // NOT hide the holder's own submission.
      const prisma = booted.db.prisma;
      const detachedPet = prisma.patient.create({
        data: {
          tenantId: tenantA,
          name: "Detached pet (link revoked)",
          speciesId,
          breedId: null,
          sex: "MALE",
          birthDate: null,
          isActive: true,
        },
      });
      const link = prisma.patientGuardian.create({
        data: {
          tenantId: tenantA,
          patientId: detachedPet.id,
          customerId: customerA1,
          isPrimary: true,
          isActive: true,
          position: 0,
        },
      });
      const detachedRequest = createBookingRequest({
        patientId: detachedPet.id,
        status: "PENDING",
      });

      try {
        const revoked = prisma.patientGuardian.updateMany({
          where: { id: link.id, tenantId: tenantA, patientId: detachedPet.id },
          data: { isActive: false },
        });
        expect(revoked.count).toBe(1);

        await supertest(server())
          .post(cancelBookingUrl(detachedRequest.id))
          .set("Cookie", holderA.cookie)
          .expect(200);
        expect(requestById(detachedRequest.id)?.status).toBe("CANCELLED");
      } finally {
        booted.db.tables.portalBookingRequests.delete(detachedRequest.id);
        booted.db.tables.patientGuardians.delete(link.id);
        booted.db.tables.patients.delete(detachedPet.id);
      }
    });

    it("rejects a malformed request id with 400 VALIDATION_FAILED", async () => {
      const response = await supertest(server())
        .post(cancelBookingUrl("not-a-uuid"))
        .set("Cookie", holderA.cookie)
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("appointment cancellation (guardian-scoped)", () => {
    it("cancels an owned SCHEDULED appointment, bumps the version and audits once", async () => {
      const appointment = createAppointment({ status: "SCHEDULED", version: 3 });
      const requestId = `portal-appt-cancel-${randomUUID()}`;

      const response = await supertest(server())
        .post(cancelAppointmentUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .expect(200);

      const body = response.body as AppointmentBody;
      expect(Object.keys(body).sort()).toEqual(APPOINTMENT_KEYS);
      expect(body).toMatchObject({ id: appointment.id, status: "CANCELLED", version: 4 });
      expect(appointmentById(appointment.id)).toMatchObject({ status: "CANCELLED", version: 4 });

      const audits = auditsFor(requestId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: APPOINTMENT_CANCELLED_ACTION,
        actorType: "PORTAL",
        actorPortalAccessId: holderA.access.id,
        tenantId: tenantA,
        targetType: "appointment",
        targetId: appointment.id,
        metadata: { schemaVersion: 1, changedFields: ["status", "version"] },
      });
      expect(audits[0].actorUserProfileId).toBeUndefined();
    });

    it("cancels an owned CONFIRMED appointment", async () => {
      const appointment = createAppointment({ status: "CONFIRMED" });
      await supertest(server())
        .post(cancelAppointmentUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .expect(200);
      expect(appointmentById(appointment.id)?.status).toBe("CANCELLED");
    });

    it.each(["CANCELLED", "COMPLETED", "NO_SHOW", "ARRIVED", "IN_PROGRESS"] as const)(
      "rejects cancellation from %s with the staff 409 and changes nothing",
      async (status) => {
        const appointment = createAppointment({ status });
        const before = auditCount();

        const response = await supertest(server())
          .post(cancelAppointmentUrl(appointment.id))
          .set("Cookie", holderA.cookie)
          .expect(409);

        expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
        expect((response.body as ErrorEnvelopeBody).error.message).toBe(
          `Cannot cancel an appointment in status ${status}.`
        );
        expect(appointmentById(appointment.id)).toMatchObject({ status, version: 1 });
        expect(auditCount()).toBe(before);
      }
    );

    it("masks a non-owned appointment (same tenant and cross-tenant) as byte-equivalent 404", async () => {
      const otherCustomerAppointment = createAppointment({ patientId: petAOther.id });
      const crossTenantAppointment = createAppointment({
        tenantId: fixture.tenants.b.id,
        patientId: petB.id,
      });

      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "POST",
        nonexistentUrl: cancelAppointmentUrl(randomUUID()),
        foreignUrl: cancelAppointmentUrl(otherCustomerAppointment.id),
        forbiddenIdentifiers: [otherCustomerAppointment.id, petAOther.id],
      });
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "POST",
        nonexistentUrl: cancelAppointmentUrl(randomUUID()),
        foreignUrl: cancelAppointmentUrl(crossTenantAppointment.id),
        forbiddenIdentifiers: [crossTenantAppointment.id, petB.id],
      });

      expect(appointmentById(otherCustomerAppointment.id)?.status).toBe("SCHEDULED");
      expect(appointmentById(crossTenantAppointment.id)?.status).toBe("SCHEDULED");
    });

    it("refuses an appointment whose guardian link was revoked (the OTHER half of the asymmetry)", async () => {
      const prisma = booted.db.prisma;
      const detachedPet = prisma.patient.create({
        data: {
          tenantId: tenantA,
          name: "Detached pet (link revoked)",
          speciesId,
          breedId: null,
          sex: "MALE",
          birthDate: null,
          isActive: true,
        },
      });
      const link = prisma.patientGuardian.create({
        data: {
          tenantId: tenantA,
          patientId: detachedPet.id,
          customerId: customerA1,
          isPrimary: true,
          isActive: true,
          position: 0,
        },
      });
      const detachedAppointment = createAppointment({ patientId: detachedPet.id });

      try {
        prisma.patientGuardian.updateMany({
          where: { id: link.id, tenantId: tenantA, patientId: detachedPet.id },
          data: { isActive: false },
        });

        // The SAME holder that could still cancel their booking request for this
        // pet can no longer act on the appointment: authority over a pet you no
        // longer guard is gone, even though the pet still exists.
        await supertest(server())
          .post(cancelAppointmentUrl(detachedAppointment.id))
          .set("Cookie", holderA.cookie)
          .expect(404);
        expect(appointmentById(detachedAppointment.id)?.status).toBe("SCHEDULED");
      } finally {
        booted.db.tables.appointments.delete(detachedAppointment.id);
        booted.db.tables.patientGuardians.delete(link.id);
        booted.db.tables.patients.delete(detachedPet.id);
      }
    });

    it("rejects a malformed appointment id with 400 VALIDATION_FAILED", async () => {
      const response = await supertest(server())
        .post(cancelAppointmentUrl("not-a-uuid"))
        .set("Cookie", holderA.cookie)
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("appointment reschedule (guardian-scoped)", () => {
    it("moves the times, bumps the version and appends one audit row", async () => {
      const professional = randomUUID();
      const branch = randomUUID();
      const appointment = createAppointment({
        status: "SCHEDULED",
        version: 1,
        professionalMembershipId: professional,
        branchId: branch,
        startAt: new Date("2026-05-04T09:00:00.000Z"),
        endAt: new Date("2026-05-04T09:30:00.000Z"),
      });
      const requestId = `portal-appt-reschedule-${randomUUID()}`;

      const response = await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(200);

      const body = response.body as AppointmentBody;
      expect(Object.keys(body).sort()).toEqual(APPOINTMENT_KEYS);
      expect(body).toMatchObject({
        id: appointment.id,
        status: "SCHEDULED",
        startAt: TARGET_START,
        endAt: TARGET_END,
        version: 2,
      });
      const stored = appointmentById(appointment.id);
      expect(stored?.startAt.toISOString()).toBe(TARGET_START);
      expect(stored?.endAt.toISOString()).toBe(TARGET_END);
      expect(stored?.version).toBe(2);

      const audits = auditsFor(requestId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: APPOINTMENT_RESCHEDULED_ACTION,
        actorType: "PORTAL",
        actorPortalAccessId: holderA.access.id,
        tenantId: tenantA,
        targetType: "appointment",
        targetId: appointment.id,
        metadata: { schemaVersion: 1, changedFields: ["startAt", "endAt", "version"] },
      });
      // No CONFIDENTIAL scheduling value ever enters the audit trail.
      const serializedMetadata = JSON.stringify(audits[0].metadata);
      expect(serializedMetadata).not.toContain(TARGET_START);
      expect(serializedMetadata).not.toContain(TARGET_END);
    });

    it("accepts a slot inside the professional's availability window", async () => {
      const professional = randomUUID();
      const branch = randomUUID();
      const weekday = toZonedParts(new Date(TARGET_START)).weekday;
      setSchedulingSettings({
        availability: [
          {
            membershipId: professional,
            branchId: branch,
            weekday,
            startMinute: 480,
            endMinute: 720,
          },
        ],
      });
      const appointment = createAppointment({
        professionalMembershipId: professional,
        branchId: branch,
      });

      await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(200);
      expect(appointmentById(appointment.id)?.startAt.toISOString()).toBe(TARGET_START);
    });

    it("rejects a slot outside availability with 409 and persists nothing", async () => {
      const professional = randomUUID();
      const branch = randomUUID();
      const weekday = toZonedParts(new Date(TARGET_START)).weekday;
      setSchedulingSettings({
        availability: [
          // Same (professional, branch) but a window that cannot contain the
          // target local time (10:00), so the shared predicate rejects it.
          { membershipId: professional, branchId: branch, weekday, startMinute: 0, endMinute: 60 },
        ],
      });
      const appointment = createAppointment({
        professionalMembershipId: professional,
        branchId: branch,
        startAt: new Date("2026-05-04T09:00:00.000Z"),
        endAt: new Date("2026-05-04T09:30:00.000Z"),
      });
      const before = auditCount();

      const response = await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(409);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      const stored = appointmentById(appointment.id);
      expect(stored?.startAt.toISOString()).toBe("2026-05-04T09:00:00.000Z");
      expect(stored?.version).toBe(1);
      expect(auditCount()).toBe(before);
    });

    it("rejects a blocked slot with 409 and persists nothing", async () => {
      const professional = randomUUID();
      const branch = randomUUID();
      setSchedulingSettings({
        blocks: [
          {
            membershipId: professional,
            branchId: branch,
            startsAt: "2026-05-04T12:00:00.000Z",
            endsAt: "2026-05-04T15:00:00.000Z",
          },
        ],
      });
      const appointment = createAppointment({
        professionalMembershipId: professional,
        branchId: branch,
        startAt: new Date("2026-05-04T09:00:00.000Z"),
        endAt: new Date("2026-05-04T09:30:00.000Z"),
      });
      const before = auditCount();

      const response = await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(409);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(appointmentById(appointment.id)?.startAt.toISOString()).toBe(
        "2026-05-04T09:00:00.000Z"
      );
      expect(auditCount()).toBe(before);
    });

    it("rejects an overlapping slot with 409 and persists nothing", async () => {
      const professional = randomUUID();
      const branch = randomUUID();
      const appointment = createAppointment({
        professionalMembershipId: professional,
        branchId: branch,
        startAt: new Date("2026-05-04T09:00:00.000Z"),
        endAt: new Date("2026-05-04T09:30:00.000Z"),
      });
      // A second active appointment for the same professional overlaps the target.
      createAppointment({
        professionalMembershipId: professional,
        branchId: branch,
        startAt: new Date("2026-05-04T12:45:00.000Z"),
        endAt: new Date("2026-05-04T13:15:00.000Z"),
      });
      const before = auditCount();

      const response = await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(409);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(appointmentById(appointment.id)?.startAt.toISOString()).toBe(
        "2026-05-04T09:00:00.000Z"
      );
      expect(appointmentById(appointment.id)?.version).toBe(1);
      expect(auditCount()).toBe(before);
    });

    it("rejects a stale version with 409 and changes nothing", async () => {
      const appointment = createAppointment({ version: 2 });
      const before = auditCount();

      const response = await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(409);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(appointmentById(appointment.id)?.version).toBe(2);
      expect(appointmentById(appointment.id)?.startAt.toISOString()).toBe(TARGET_START);
      expect(auditCount()).toBe(before);
    });

    it.each(["COMPLETED", "CANCELLED", "NO_SHOW", "IN_PROGRESS"] as const)(
      "rejects rescheduling a %s appointment with 409",
      async (status) => {
        const appointment = createAppointment({ status });
        const before = auditCount();

        const response = await supertest(server())
          .put(rescheduleUrl(appointment.id))
          .set("Cookie", holderA.cookie)
          .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
          .expect(409);

        expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
        expect(appointmentById(appointment.id)?.status).toBe(status);
        expect(auditCount()).toBe(before);
      }
    );

    it("masks a non-owned appointment as byte-equivalent 404", async () => {
      const otherCustomerAppointment = createAppointment({ patientId: petAOther.id });
      const crossTenantAppointment = createAppointment({
        tenantId: fixture.tenants.b.id,
        patientId: petB.id,
      });

      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "PUT",
        body: { startAt: TARGET_START, endAt: TARGET_END, version: 1 },
        nonexistentUrl: rescheduleUrl(randomUUID()),
        foreignUrl: rescheduleUrl(otherCustomerAppointment.id),
        forbiddenIdentifiers: [otherCustomerAppointment.id, petAOther.id],
      });
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "PUT",
        body: { startAt: TARGET_START, endAt: TARGET_END, version: 1 },
        nonexistentUrl: rescheduleUrl(randomUUID()),
        foreignUrl: rescheduleUrl(crossTenantAppointment.id),
        forbiddenIdentifiers: [crossTenantAppointment.id, petB.id],
      });

      expect(appointmentById(otherCustomerAppointment.id)?.version).toBe(1);
      expect(appointmentById(crossTenantAppointment.id)?.version).toBe(1);
    });

    it("refuses to reschedule after the guardian link to the pet is revoked (guardian-scoped 404)", async () => {
      const prisma = booted.db.prisma;
      const detachedPet = prisma.patient.create({
        data: {
          tenantId: tenantA,
          name: "Detached pet (link revoked)",
          speciesId,
          breedId: null,
          sex: "MALE",
          birthDate: null,
          isActive: true,
        },
      });
      const link = prisma.patientGuardian.create({
        data: {
          tenantId: tenantA,
          patientId: detachedPet.id,
          customerId: customerA1,
          isPrimary: true,
          isActive: true,
          position: 0,
        },
      });
      const detachedAppointment = createAppointment({ patientId: detachedPet.id });
      const before = auditCount();

      try {
        prisma.patientGuardian.updateMany({
          where: { id: link.id, tenantId: tenantA, patientId: detachedPet.id },
          data: { isActive: false },
        });

        // Authority over the pet's schedule is guardian-scoped: once the link
        // is revoked the appointment is no longer actionable, exactly like the
        // cancel path — and the attempt persists nothing. The submitted times
        // DIFFER from the seeded ones on purpose: rescheduling to the same
        // times would satisfy the assertion below even if the write succeeded.
        const movedStart = "2026-05-04T15:00:00.000Z";
        const movedEnd = "2026-05-04T15:30:00.000Z";
        const revoked = await supertest(server())
          .put(rescheduleUrl(detachedAppointment.id))
          .set("Cookie", holderA.cookie)
          .send({ startAt: movedStart, endAt: movedEnd, version: 1 });
        expect(revoked.status).toBe(404);

        // Indistinguishable from an appointment that does not exist: the holder
        // must not be able to tell "not yours" from "not there". Only the
        // requestId may differ, so the comparison is on code and message.
        const unknown = await supertest(server())
          .put(rescheduleUrl(randomUUID()))
          .set("Cookie", holderA.cookie)
          .send({ startAt: movedStart, endAt: movedEnd, version: 1 });
        expect(unknown.status).toBe(404);
        expect(revoked.body.error.code).toBe(unknown.body.error.code);
        expect(revoked.body.error.message).toBe(unknown.body.error.message);

        expect(appointmentById(detachedAppointment.id)).toMatchObject({
          startAt: new Date(TARGET_START),
          endAt: new Date(TARGET_END),
          version: 1,
        });
        expect(auditCount()).toBe(before);
      } finally {
        booted.db.tables.appointments.delete(detachedAppointment.id);
        booted.db.tables.patientGuardians.delete(link.id);
        booted.db.tables.patients.delete(detachedPet.id);
      }
    });

    it.each([
      ["a missing version", { startAt: TARGET_START, endAt: TARGET_END }],
      ["an inverted range", { startAt: TARGET_END, endAt: TARGET_START, version: 1 }],
      [
        "an unknown key",
        {
          startAt: TARGET_START,
          endAt: TARGET_END,
          version: 1,
          patientId: "11111111-1111-1111-1111-111111111111",
        },
      ],
      ["a non-UUID body id", { startAt: TARGET_START, endAt: TARGET_END, version: 1, id: "x" }],
    ])("rejects %s with 400 VALIDATION_FAILED and persists nothing", async (_label, body) => {
      const appointment = createAppointment();
      const before = auditCount();

      const response = await supertest(server())
        .put(rescheduleUrl(appointment.id))
        .set("Cookie", holderA.cookie)
        .send(body)
        .expect(400);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(appointmentById(appointment.id)?.version).toBe(1);
      expect(auditCount()).toBe(before);
    });

    it("rejects a malformed appointment id with 400 VALIDATION_FAILED", async () => {
      const response = await supertest(server())
        .put(rescheduleUrl("not-a-uuid"))
        .set("Cookie", holderA.cookie)
        .send({ startAt: TARGET_START, endAt: TARGET_END, version: 1 })
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("audit-or-nothing and ledger isolation", () => {
    it("rolls back the booking-request cancel when the audit append fails", async () => {
      const request = createBookingRequest({ status: "PENDING" });
      const originalCreate = booted.db.prisma.auditLog.create;
      booted.db.prisma.auditLog.create = () => {
        throw new Error("audit storage unavailable");
      };

      let status = 0;
      let code = "";
      try {
        const response = await supertest(server())
          .post(cancelBookingUrl(request.id))
          .set("Cookie", holderA.cookie);
        status = response.status;
        code = (response.body as ErrorEnvelopeBody).error.code;
      } finally {
        booted.db.prisma.auditLog.create = originalCreate;
      }

      expect(status).toBe(500);
      expect(code).toBe("INTERNAL");
      // The transaction rolled back: the status flip never committed.
      expect(requestById(request.id)?.status).toBe("PENDING");
    });

    it("cancelling a booking request creates no appointment and touches no ledger", async () => {
      const request = createBookingRequest({ status: "PENDING" });
      const beforeAppointments = booted.db.tables.appointments.size;

      await supertest(server())
        .post(cancelBookingUrl(request.id))
        .set("Cookie", holderA.cookie)
        .expect(200);

      expect(booted.db.tables.appointments.size).toBe(beforeAppointments);
      expect(requestById(request.id)?.status).toBe("CANCELLED");
    });
  });
});
