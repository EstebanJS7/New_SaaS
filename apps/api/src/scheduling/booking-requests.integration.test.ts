import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  createIsolationDatabase,
  type AppointmentRow,
  type AuditLogRow,
  type PortalBookingRequestRow,
} from "../../test/support/in-memory-database.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  seedSchedulingHttp,
  type SchedulingHttpFixture,
} from "../../test/support/scheduling-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";

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
  tenantId: string;
  branchId: string;
  patientId: string;
  professionalMembershipId: string;
  status: string;
  startAt: string;
  endAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Allowlisted staff booking-request DTO surface. */
const BOOKING_REQUEST_KEYS = ["endAt", "id", "patientId", "startAt", "status"];

/**
 * Allowlisted staff appointment DTO surface (EPIC-07 WU3 contract, widened by
 * EPIC-09 WU4 with the OPTIONAL Catalog SERVICE reference and its identity
 * projection). The approval response is the SAME `AppointmentResponse` the
 * appointments routes return, so it carries the same exact key set.
 */
const APPOINTMENT_KEYS = [
  "branchId",
  "createdAt",
  "endAt",
  "id",
  "patientId",
  "professionalMembershipId",
  "service",
  "serviceId",
  "startAt",
  "status",
  "tenantId",
  "updatedAt",
  "version",
];

/** Stable action codes the audit rows must carry (pinned, not imported). */
const APPROVED_ACTION = "portal_booking.approved";
const REJECTED_ACTION = "portal_booking.rejected";

/** Stable CONFLICT message for a revoked guardian link. */
const GUARDIAN_REVOKED_MESSAGE = "The patient is no longer linked to the requesting guardian.";

/**
 * EPIC-08 WU4B — staff booking-request decisions over real HTTP and the full
 * guard chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves: staff-only authority (`scheduling.appointment.manage`) with a portal
 * session rejected at the boundary, tenant scoping with byte-equivalent 404
 * masking, idempotent promotion to exactly one `PORTAL` appointment, no silent
 * promotion after a guardian revocation, rejection with no appointment, and
 * exactly one co-committed STAFF audit row per command — plus the side effects
 * this slice must NOT have (no event, no cash/stock/fiscal, no portal change).
 */
describe("staff booking-request decisions (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: SchedulingHttpFixture;
  let holderA: PortalAccessFixture;
  let tenantA: string;
  let tenantB: string;
  let customerA: string;

  beforeAll(async () => {
    const db = createIsolationDatabase();
    booted = await bootTestApp({ db });
    await booted.app.listen(0);
    fixture = seedSchedulingHttp(booted.db);
    tenantA = fixture.a.tenant.id;
    tenantB = fixture.b.tenant.id;
    customerA = fixture.patient.a.customer.id;
    holderA = seedPortalAccess(booted.db, { tenantId: tenantA, customerId: customerA });
  });

  afterAll(async () => {
    await booted.close();
  });

  const server = (): ReturnType<BootedTestApp["app"]["getHttpServer"]> =>
    booted.app.getHttpServer();

  /** Unique one-hour slot per request so rows can never be confused. */
  let slotSerial = 0;
  function nextSlot(): { startAt: Date; endAt: Date } {
    const start = new Date(Date.UTC(2026, 6, 1, 6, 0) + slotSerial * 60 * 60_000);
    slotSerial += 1;
    return { startAt: start, endAt: new Date(start.getTime() + 60 * 60_000) };
  }

  function createRequest(
    overrides: Partial<{
      tenantId: string;
      customerId: string;
      patientId: string;
      status: PortalBookingRequestRow["status"];
      startAt: Date;
      endAt: Date;
    }> = {}
  ): PortalBookingRequestRow {
    const slot = nextSlot();
    return booted.db.prisma.portalBookingRequest.create({
      data: {
        tenantId: tenantA,
        customerId: customerA,
        patientId: fixture.a.patientId,
        status: "PENDING",
        startAt: slot.startAt,
        endAt: slot.endAt,
        ...overrides,
      },
    });
  }

  function validApprovalBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      branchId: fixture.a.branch.id,
      professionalMembershipId: fixture.a.professionalMembershipId,
      ...overrides,
    };
  }

  function approve(id: string, overrides: Record<string, unknown> = {}, cookie?: string) {
    return supertest(server())
      .post(`/booking-requests/${id}/approve`)
      .set("Cookie", cookie ?? fixture.a.actor.cookie)
      .send(validApprovalBody(overrides));
  }

  function reject(id: string, cookie?: string) {
    return supertest(server())
      .post(`/booking-requests/${id}/reject`)
      .set("Cookie", cookie ?? fixture.a.actor.cookie);
  }

  function requestRow(id: string): PortalBookingRequestRow | undefined {
    return booted.db.tables.portalBookingRequests.get(id);
  }

  function appointmentsForRequest(requestId: string): AppointmentRow[] {
    return [...booted.db.tables.appointments.values()].filter(
      (row) => row.portalBookingRequestId === requestId
    );
  }

  function appointmentCount(): number {
    return booted.db.tables.appointments.size;
  }

  function auditsWith(requestId: string): AuditLogRow[] {
    return [...booted.db.tables.audits.values()].filter((row) => row.requestId === requestId);
  }

  describe("staff authority boundary", () => {
    it("rejects anonymous and portal sessions on the staff routes with 401", async () => {
      const id = randomUUID();
      const probes = [
        (cookie?: string) =>
          supertest(server())
            .get("/booking-requests")
            .set(cookie ? { Cookie: cookie } : {}),
        (cookie?: string) =>
          supertest(server())
            .post(`/booking-requests/${id}/approve`)
            .set(cookie ? { Cookie: cookie } : {})
            .send(validApprovalBody()),
        (cookie?: string) =>
          supertest(server())
            .post(`/booking-requests/${id}/reject`)
            .set(cookie ? { Cookie: cookie } : {}),
      ];
      for (const probe of probes) {
        const anonymous = await probe();
        expect(anonymous.status).toBe(401);
        expect((anonymous.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");

        const portal = await probe(holderA.cookie);
        expect(portal.status).toBe(401);
        expect((portal.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
      }
    });

    it("returns 403 FORBIDDEN when the active role lacks scheduling.appointment.manage", async () => {
      const readOnlyRole = seedRoleWithKeys(
        booted.db,
        `BOOKING_RO_${randomUUID().slice(0, 8)}`,
        "Booking read-only (fixture)",
        ["scheduling.appointment.read"]
      );
      const readOnly = seedRbacActor(booted.db, {
        email: `booking-ro-${randomUUID().slice(0, 8)}@isolation.test`,
        tenantId: tenantA,
        roleId: readOnlyRole.role.id,
      });
      const request = createRequest();

      const denied = [
        supertest(server()).get("/booking-requests").set("Cookie", readOnly.cookie),
        approve(request.id, {}, readOnly.cookie),
        reject(request.id, readOnly.cookie),
      ];
      for (const pending of denied) {
        const response = await pending;
        expect(response.status).toBe(403);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
      }
    });
  });

  describe("listing", () => {
    it("lists the tenant's requests with status and never another tenant's", async () => {
      const mine = createRequest();
      const foreign = createRequest({
        tenantId: tenantB,
        customerId: fixture.patient.b.customer.id,
        patientId: fixture.b.patientId,
      });

      const response = await supertest(server())
        .get("/booking-requests")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as BookingRequestBody[];
      const ids = body.map((row) => row.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(foreign.id);
      const listed = body.find((row) => row.id === mine.id);
      expect(listed?.status).toBe("PENDING");
      expect(Object.keys(listed ?? {}).sort()).toEqual([...BOOKING_REQUEST_KEYS].sort());
      expect(response.text).not.toContain(foreign.id);
    });
  });

  describe("approval", () => {
    it("promotes a PENDING request to exactly one PORTAL appointment with the request's times", async () => {
      const request = createRequest();
      const requestId = randomUUID();

      const response = await approve(request.id).set(REQUEST_ID_HEADER, requestId).expect(201);

      const body = response.body as AppointmentBody;
      expect(Object.keys(body).sort()).toEqual([...APPOINTMENT_KEYS].sort());
      expect(body.status).toBe("SCHEDULED");
      expect(body.tenantId).toBe(tenantA);
      expect(body.patientId).toBe(request.patientId);
      expect(body.branchId).toBe(fixture.a.branch.id);
      expect(body.professionalMembershipId).toBe(fixture.a.professionalMembershipId);
      // Times are copied from the STORED request.
      expect(body.startAt).toBe(request.startAt.toISOString());
      expect(body.endAt).toBe(request.endAt.toISOString());

      const linked = appointmentsForRequest(request.id);
      expect(linked).toHaveLength(1);
      expect(linked[0].id).toBe(body.id);
      // Provenance is visible through the SHARED fake, not a test-local adapter.
      expect(linked[0].source).toBe("PORTAL");
      expect(linked[0].portalBookingRequestId).toBe(request.id);
      expect(linked[0].startAt.toISOString()).toBe(request.startAt.toISOString());
      expect(linked[0].endAt.toISOString()).toBe(request.endAt.toISOString());

      expect(requestRow(request.id)?.status).toBe("APPROVED");

      const audits = auditsWith(requestId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: APPROVED_ACTION,
        actorType: "STAFF",
        targetType: "portal_booking_request",
        targetId: request.id,
        tenantId: tenantA,
        metadata: { changedFields: ["status"], slotOverridden: false },
      });
      expect(audits[0].actorUserProfileId).toBe(fixture.a.actor.profile.id);
    });

    it("approves into a non-conflicting override slot and keeps the request's requested times", async () => {
      const requested = nextSlot();
      const override = nextSlot();
      const request = createRequest({ startAt: requested.startAt, endAt: requested.endAt });
      const requestId = randomUUID();

      const response = await approve(request.id, {
        startAt: override.startAt.toISOString(),
        endAt: override.endAt.toISOString(),
      })
        .set(REQUEST_ID_HEADER, requestId)
        .expect(201);

      const body = response.body as AppointmentBody;
      // The appointment carries the APPROVED slot...
      expect(body.startAt).toBe(override.startAt.toISOString());
      expect(body.endAt).toBe(override.endAt.toISOString());

      // ...while the request row keeps the holder's requested times.
      const stored = requestRow(request.id);
      expect(stored?.startAt.toISOString()).toBe(requested.startAt.toISOString());
      expect(stored?.endAt.toISOString()).toBe(requested.endAt.toISOString());
      expect(stored?.status).toBe("APPROVED");

      const linked = appointmentsForRequest(request.id);
      expect(linked).toHaveLength(1);
      expect(linked[0].startAt.toISOString()).toBe(override.startAt.toISOString());

      // The override is visible as field NAMES plus a stable boolean, never a value.
      const audits = auditsWith(requestId);
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toMatchObject({
        changedFields: ["status", "startAt", "endAt"],
        slotOverridden: true,
      });
      expect(JSON.stringify(audits[0].metadata)).not.toContain(override.startAt.toISOString());
    });

    it("returns 409 and persists nothing when the requested slot is already taken", async () => {
      const slot = nextSlot();
      const request = createRequest({ startAt: slot.startAt, endAt: slot.endAt });
      // Another staff appointment now occupies the requested slot.
      fixture.createAppointment(fixture.a, { startAt: slot.startAt, endAt: slot.endAt });
      const before = appointmentCount();

      const response = await approve(request.id).expect(409);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(requestRow(request.id)?.status).toBe("PENDING");
      expect(appointmentCount()).toBe(before);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);
    });

    it("returns 409 and persists nothing when the override slot is already taken", async () => {
      const request = createRequest();
      const taken = nextSlot();
      fixture.createAppointment(fixture.a, { startAt: taken.startAt, endAt: taken.endAt });
      const before = appointmentCount();

      const response = await approve(request.id, {
        startAt: taken.startAt.toISOString(),
        endAt: taken.endAt.toISOString(),
      }).expect(409);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(requestRow(request.id)?.status).toBe("PENDING");
      expect(appointmentCount()).toBe(before);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);
    });

    it("returns 409 and persists nothing when the requested slot falls inside a block", async () => {
      const slot = nextSlot();
      const request = createRequest({ startAt: slot.startAt, endAt: slot.endAt });
      // Only the requested slot is blocked, so no other test is affected.
      booted.db.prisma.tenantSettingNamespace.create({
        data: {
          tenantId: tenantA,
          namespace: "scheduling",
          schemaVersion: 1,
          data: {
            conflictPolicy: "REJECT",
            availability: [],
            blocks: [
              {
                membershipId: fixture.a.professionalMembershipId,
                branchId: fixture.a.branch.id,
                startsAt: slot.startAt.toISOString(),
                endsAt: slot.endAt.toISOString(),
              },
            ],
          },
        },
      });
      const before = appointmentCount();

      const response = await approve(request.id).expect(409);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(requestRow(request.id)?.status).toBe("PENDING");
      expect(appointmentCount()).toBe(before);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);
    });

    it("returns the original appointment for a repeat approve with a different override", async () => {
      const request = createRequest();
      const firstOverride = nextSlot();
      const first = await approve(request.id, {
        startAt: firstOverride.startAt.toISOString(),
        endAt: firstOverride.endAt.toISOString(),
      }).expect(201);
      const firstBody = first.body as AppointmentBody;
      const before = appointmentCount();

      const secondOverride = nextSlot();
      const repeat = await approve(request.id, {
        startAt: secondOverride.startAt.toISOString(),
        endAt: secondOverride.endAt.toISOString(),
      }).expect(201);
      const repeatBody = repeat.body as AppointmentBody;

      // The stored appointment is NOT rewritten and no second row exists.
      expect(repeatBody.id).toBe(firstBody.id);
      expect(repeatBody.startAt).toBe(firstBody.startAt);
      expect(repeatBody.endAt).toBe(firstBody.endAt);
      expect(appointmentCount()).toBe(before);
      const linked = appointmentsForRequest(request.id);
      expect(linked).toHaveLength(1);
      expect(linked[0].startAt.toISOString()).toBe(firstBody.startAt);
    });

    it("is idempotent: a repeated approve returns the same appointment and creates none", async () => {
      const request = createRequest();

      const first = await approve(request.id).expect(201);
      const firstBody = first.body as AppointmentBody;
      const countAfterFirst = appointmentCount();

      const repeatRequestId = randomUUID();
      const second = await approve(request.id).set(REQUEST_ID_HEADER, repeatRequestId).expect(201);

      expect((second.body as AppointmentBody).id).toBe(firstBody.id);
      expect(appointmentCount()).toBe(countAfterFirst);
      expect(appointmentsForRequest(request.id)).toHaveLength(1);
      // The pre-check short-circuits: no second promotion, therefore no second audit row.
      expect(auditsWith(repeatRequestId)).toHaveLength(0);
      const approved = [...booted.db.tables.audits.values()].filter(
        (row) => row.action === APPROVED_ACTION && row.targetId === request.id
      );
      expect(approved).toHaveLength(1);
    });

    it("refuses to approve a REJECTED request without side effects", async () => {
      const request = createRequest();
      await reject(request.id).expect(201);
      const countAfterReject = appointmentCount();

      const response = await approve(request.id).expect(409);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(requestRow(request.id)?.status).toBe("REJECTED");
      expect(appointmentCount()).toBe(countAfterReject);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);
    });

    it("fails with CONFLICT when the guardian link was revoked and creates nothing", async () => {
      const fresh = fixture.patient.createPatientA();
      const request = createRequest({
        customerId: fresh.customer.id,
        patientId: fresh.patient.id,
      });
      // Revoke the guardian link AFTER submission.
      booted.db.prisma.patientGuardian.updateMany({
        where: {
          tenantId: tenantA,
          patientId: fresh.patient.id,
          customerId: fresh.customer.id,
          isActive: true,
        },
        data: { isActive: false },
      });
      const before = appointmentCount();

      const response = await approve(request.id).expect(409);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect((response.body as ErrorEnvelopeBody).error.message).toBe(GUARDIAN_REVOKED_MESSAGE);
      expect(requestRow(request.id)?.status).toBe("PENDING");
      expect(appointmentCount()).toBe(before);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);
    });

    it("masks a foreign request id as a byte-equivalent 404", async () => {
      const foreign = createRequest({
        tenantId: tenantB,
        customerId: fixture.patient.b.customer.id,
        patientId: fixture.b.patientId,
      });
      await expectCrossTenant404({
        app: booted.app,
        cookie: fixture.a.actor.cookie,
        nonexistentUrl: `/booking-requests/${randomUUID()}/approve`,
        foreignUrl: `/booking-requests/${foreign.id}/approve`,
        method: "POST",
        body: validApprovalBody(),
        forbiddenIdentifiers: [foreign.id, tenantB],
      });
      await expectCrossTenant404({
        app: booted.app,
        cookie: fixture.a.actor.cookie,
        nonexistentUrl: `/booking-requests/${randomUUID()}/reject`,
        foreignUrl: `/booking-requests/${foreign.id}/reject`,
        method: "POST",
        forbiddenIdentifiers: [foreign.id, tenantB],
      });
    });

    it("rejects a foreign branch or professional anchor with 404 and creates nothing", async () => {
      const request = createRequest();
      const before = appointmentCount();

      const foreignBranch = await approve(request.id, {
        branchId: fixture.b.branch.id,
      }).expect(404);
      expect((foreignBranch.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");

      const foreignProfessional = await approve(request.id, {
        professionalMembershipId: fixture.b.professionalMembershipId,
      }).expect(404);
      expect((foreignProfessional.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");

      expect(requestRow(request.id)?.status).toBe("PENDING");
      expect(appointmentCount()).toBe(before);
    });

    it("rejects a non-VETERINARIAN professional with 400", async () => {
      const request = createRequest();
      const membership = fixture.a.actor.membership;
      if (!membership) throw new Error("fixture actor membership missing");

      const response = await approve(request.id, {
        professionalMembershipId: membership.id,
      }).expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(requestRow(request.id)?.status).toBe("PENDING");
    });

    it("rejects a malformed id or body with 400 VALIDATION_FAILED", async () => {
      const malformedId = await supertest(server())
        .post("/booking-requests/not-a-uuid/approve")
        .set("Cookie", fixture.a.actor.cookie)
        .send(validApprovalBody())
        .expect(400);
      expect((malformedId.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      const request = createRequest();
      const missingField = await supertest(server())
        .post(`/booking-requests/${request.id}/approve`)
        .set("Cookie", fixture.a.actor.cookie)
        .send({ branchId: fixture.a.branch.id })
        .expect(400);
      expect((missingField.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      const oneOfTwoStart = await supertest(server())
        .post(`/booking-requests/${request.id}/approve`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(validApprovalBody({ startAt: new Date().toISOString() }))
        .expect(400);
      expect((oneOfTwoStart.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      const oneOfTwoEnd = await supertest(server())
        .post(`/booking-requests/${request.id}/approve`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(validApprovalBody({ endAt: new Date().toISOString() }))
        .expect(400);
      expect((oneOfTwoEnd.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      const inverted = await supertest(server())
        .post(`/booking-requests/${request.id}/approve`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(
          validApprovalBody({
            startAt: "2026-07-01T07:00:00.000Z",
            endAt: "2026-07-01T06:00:00.000Z",
          })
        )
        .expect(400);
      expect((inverted.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      const extraField = await supertest(server())
        .post(`/booking-requests/${request.id}/approve`)
        .set("Cookie", fixture.a.actor.cookie)
        .send(validApprovalBody({ tenantId: tenantB }))
        .expect(400);
      expect((extraField.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      const malformedReject = await supertest(server())
        .post("/booking-requests/not-a-uuid/reject")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(400);
      expect((malformedReject.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");

      expect(requestRow(request.id)?.status).toBe("PENDING");
    });
  });

  describe("rejection", () => {
    it("sets REJECTED with one STAFF audit row and creates no appointment", async () => {
      const request = createRequest();
      const before = appointmentCount();
      const requestId = randomUUID();

      const response = await reject(request.id).set(REQUEST_ID_HEADER, requestId).expect(201);

      const body = response.body as BookingRequestBody;
      expect(Object.keys(body).sort()).toEqual([...BOOKING_REQUEST_KEYS].sort());
      expect(body.status).toBe("REJECTED");
      expect(requestRow(request.id)?.status).toBe("REJECTED");
      expect(appointmentCount()).toBe(before);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);

      const audits = auditsWith(requestId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: REJECTED_ACTION,
        actorType: "STAFF",
        targetType: "portal_booking_request",
        targetId: request.id,
        tenantId: tenantA,
      });
      expect(audits[0].actorUserProfileId).toBe(fixture.a.actor.profile.id);
    });

    it("does not double-apply an already-rejected request", async () => {
      const request = createRequest();
      const firstRequestId = randomUUID();
      await reject(request.id).set(REQUEST_ID_HEADER, firstRequestId).expect(201);

      const secondRequestId = randomUUID();
      const second = await reject(request.id).set(REQUEST_ID_HEADER, secondRequestId).expect(409);
      expect((second.body as ErrorEnvelopeBody).error.code).toBe("CONFLICT");
      expect(auditsWith(secondRequestId)).toHaveLength(0);
      expect(auditsWith(firstRequestId)).toHaveLength(1);
      expect(requestRow(request.id)?.status).toBe("REJECTED");
    });
  });

  describe("no side effects", () => {
    it("never exposes a PENDING request as an appointment", async () => {
      const fresh = fixture.patient.createPatientA();
      const request = createRequest({
        customerId: fresh.customer.id,
        patientId: fresh.patient.id,
      });

      const response = await supertest(server())
        .get("/appointments")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as AppointmentBody[];
      expect(body.some((row) => row.patientId === fresh.patient.id)).toBe(false);
      expect(appointmentsForRequest(request.id)).toHaveLength(0);

      // ...while the staff list DOES surface the pending request.
      const listed = await supertest(server())
        .get("/booking-requests")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      expect(
        (listed.body as BookingRequestBody[]).find((row) => row.id === request.id)?.status
      ).toBe("PENDING");
    });
  });
});
