import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import type { PatientRow } from "../../test/support/in-memory-database.js";

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

const BOOKING_KEYS = ["endAt", "id", "patientId", "startAt", "status"];

/** Exact allowlisted payload keys of a created request. */
const VALID_BODY = {
  startAt: "2026-05-01T09:00:00.000Z",
  endAt: "2026-05-01T10:00:00.000Z",
};

/** Stable action code the audit row must carry (pinned, not imported). */
const BOOKING_ACTION = "portal_booking.requested";

/**
 * EPIC-08 WU4A — holder booking-request COMMAND over real HTTP and the full
 * guard chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves: holder-owned-pet scoping with byte-equivalent 404 masking, a strict
 * payload contract, one PENDING `portal_booking_request` per submission with
 * exactly one co-committed PORTAL-attributed audit row, and — just as
 * importantly — the side effects this slice must NOT have: no Appointment row,
 * no overlap/availability evaluation, no auto-confirmation.
 */
describe("portal booking-request command (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let holderA: PortalAccessFixture;
  let holderB: PortalAccessFixture;
  let tenantA: string;
  let customerA1: string;
  let petA: PatientRow;
  let petA2: PatientRow;
  let petB: PatientRow;
  let appointmentAId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = booted.db.prisma;
    tenantA = fixture.tenants.a.id;
    const tenantB = fixture.tenants.b.id;

    const species = prisma.species.create({ data: { code: `dog-${fixture.suffix}`, name: "Dog" } });

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
    const customerA2 = createCustomer(tenantA, "Other Customer A");
    const customerB = createCustomer(tenantB, "Holder B Customer");

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
    petA2 = createPatient(tenantA, "Pet A2 (other customer)");
    petB = createPatient(tenantB, "Pet B (other tenant)");

    const linkGuardian = (tenantId: string, patientId: string, customerId: string): void => {
      prisma.patientGuardian.create({
        data: { tenantId, patientId, customerId, isPrimary: true, isActive: true, position: 0 },
      });
    };
    linkGuardian(tenantA, petA.id, customerA1);
    linkGuardian(tenantA, petA2.id, customerA2);
    linkGuardian(tenantB, petB.id, customerB);

    // The appointment ledger this slice must never touch.
    appointmentAId = prisma.appointment.create({
      data: {
        tenantId: tenantA,
        branchId: randomUUID(),
        patientId: petA.id,
        professionalMembershipId: randomUUID(),
        status: "SCHEDULED",
        version: 1,
        startAt: new Date("2026-04-01T09:00:00.000Z"),
        endAt: new Date("2026-04-01T10:00:00.000Z"),
      },
    }).id;

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

  const server = (): ReturnType<BootedTestApp["app"]["getHttpServer"]> =>
    booted.app.getHttpServer();

  const bookingUrl = (patientId: string): string => `/portal/pets/${patientId}/bookings`;

  /** Persisted requests for one pet, read back through the boundary fake. */
  const requestRowsFor = (patientId: string) =>
    booted.db.prisma.portalBookingRequest.findMany({ where: { tenantId: tenantA, patientId } });

  describe("authentication and entitlement boundary", () => {
    it("returns 401 for an anonymous submission and for a staff session", async () => {
      await supertest(server()).post(bookingUrl(petA.id)).send(VALID_BODY).expect(401);
      await supertest(server())
        .post(bookingUrl(petA.id))
        .set("Cookie", fixture.actors.a.cookie)
        .send(VALID_BODY)
        .expect(401);
    });

    it("returns 403 FEATURE_NOT_ENTITLED for an entitled-less tenant holder", async () => {
      const response = await supertest(server())
        .post(bookingUrl(petB.id))
        .set("Cookie", holderB.cookie)
        .send(VALID_BODY)
        .expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    });

    it("401 when a portal identity attempts a staff appointment transition", async () => {
      const response = await supertest(server())
        .post(`/appointments/${appointmentAId}/confirm`)
        .set("Cookie", holderA.cookie)
        .expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("holder-owned booking-request creation", () => {
    it("persists exactly one PENDING request and returns the created identity/status", async () => {
      const before = requestRowsFor(petA.id).length;

      const response = await supertest(server())
        .post(bookingUrl(petA.id))
        .set("Cookie", holderA.cookie)
        .send(VALID_BODY)
        .expect(201);

      const body = response.body as BookingRequestBody;
      expect(Object.keys(body).sort()).toEqual(BOOKING_KEYS);
      expect(body.status).toBe("PENDING");
      expect(body.patientId).toBe(petA.id);
      expect(body.startAt).toBe(VALID_BODY.startAt);
      expect(body.endAt).toBe(VALID_BODY.endAt);
      // No identity echo: tenant/Customer are server-side facts.
      expect(response.text).not.toContain(tenantA);
      expect(response.text).not.toContain(customerA1);

      const rows = requestRowsFor(petA.id);
      expect(rows).toHaveLength(before + 1);
      const created = rows.find((row) => row.id === body.id);
      expect(created).toMatchObject({
        tenantId: tenantA,
        customerId: customerA1,
        patientId: petA.id,
        status: "PENDING",
      });
      expect(created?.startAt.toISOString()).toBe(VALID_BODY.startAt);
      expect(created?.endAt.toISOString()).toBe(VALID_BODY.endAt);
    });

    it("ignores client identity hints in the query and headers", async () => {
      const before = requestRowsFor(petA.id).length;

      const response = await supertest(server())
        .post(bookingUrl(petA.id))
        .query({ tenantId: fixture.tenants.b.id, customerId: petA2.id })
        .set("x-tenant-id", fixture.tenants.b.id)
        .set("Cookie", holderA.cookie)
        .send(VALID_BODY)
        .expect(201);

      const created = requestRowsFor(petA.id).find(
        (row) => row.id === (response.body as BookingRequestBody).id
      );
      expect(created?.tenantId).toBe(tenantA);
      expect(created?.customerId).toBe(customerA1);
      expect(requestRowsFor(petA.id)).toHaveLength(before + 1);
    });

    it("creates no Appointment and leaves the appointment ledger untouched", async () => {
      const beforeAppointments = [...booted.db.tables.appointments.values()].map((row) => ({
        id: row.id,
        status: row.status,
      }));
      const beforeRequests = requestRowsFor(petA.id).length;

      const response = await supertest(server())
        .post(bookingUrl(petA.id))
        .set("Cookie", holderA.cookie)
        .send(VALID_BODY)
        .expect(201);

      // The request was really persisted …
      expect(requestRowsFor(petA.id)).toHaveLength(beforeRequests + 1);
      // … and produced NO appointment, transition or provenance link.
      const afterAppointments = [...booted.db.tables.appointments.values()].map((row) => ({
        id: row.id,
        status: row.status,
      }));
      expect(afterAppointments).toEqual(beforeAppointments);
      expect(booted.db.tables.appointments.get(appointmentAId)?.status).toBe("SCHEDULED");
      expect(response.text).not.toContain(appointmentAId);
      expect(response.text).not.toContain("portalBookingRequestId");
    });
  });

  describe("strict payload contract", () => {
    it.each([
      ["an equal range", VALID_BODY.startAt, VALID_BODY.startAt],
      ["an inverted range", "2026-05-01T10:00:00.000Z", "2026-05-01T09:00:00.000Z"],
    ])(
      "rejects %s with 400 VALIDATION_FAILED and persists nothing",
      async (_label, startAt, endAt) => {
        const before = requestRowsFor(petA.id).length;
        const response = await supertest(server())
          .post(bookingUrl(petA.id))
          .set("Cookie", holderA.cookie)
          .send({ startAt, endAt })
          .expect(400);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
        expect(requestRowsFor(petA.id)).toHaveLength(before);
      }
    );

    it.each([
      ["a service selection", { serviceId: randomUUID() }],
      ["an email", { email: "holder@portal.test" }],
      ["free-text notes", { notes: "please bring the cat" }],
      ["a client-supplied tenantId", { tenantId: "11111111-1111-1111-1111-111111111111" }],
      ["a client-supplied customerId", { customerId: "22222222-2222-2222-2222-222222222222" }],
    ])("rejects %s as an unknown key with 400 and persists nothing", async (_label, extra) => {
      const before = requestRowsFor(petA.id).length;
      const response = await supertest(server())
        .post(bookingUrl(petA.id))
        .set("Cookie", holderA.cookie)
        .send({ ...VALID_BODY, ...extra })
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(requestRowsFor(petA.id)).toHaveLength(before);
    });

    it.each([
      ["an empty body", {}],
      ["a non-ISO timestamp", { startAt: "2026-05-01", endAt: VALID_BODY.endAt }],
      ["a non-date endAt", { startAt: VALID_BODY.startAt, endAt: "tomorrow" }],
    ])("rejects %s with 400 and persists nothing", async (_label, body) => {
      const before = requestRowsFor(petA.id).length;
      const response = await supertest(server())
        .post(bookingUrl(petA.id))
        .set("Cookie", holderA.cookie)
        .send(body)
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
      expect(requestRowsFor(petA.id)).toHaveLength(before);
    });

    it("rejects a malformed pet id with 400 VALIDATION_FAILED", async () => {
      const response = await supertest(server())
        .post("/portal/pets/not-a-uuid/bookings")
        .set("Cookie", holderA.cookie)
        .send(VALID_BODY)
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("ownership masking", () => {
    it("masks a cross-tenant pet as a byte-equivalent 404", async () => {
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        method: "POST",
        body: VALID_BODY,
        nonexistentUrl: bookingUrl(randomUUID()),
        foreignUrl: bookingUrl(petB.id),
        forbiddenIdentifiers: [petB.id, petB.name],
      });
    });

    it("masks another Customer's pet, a cross-tenant pet and an unknown id identically", async () => {
      // ONE pinned request id for all three probes, so the raw envelopes must be
      // byte-identical — not merely the same status.
      const sharedRequestId = randomUUID();
      const probe = (patientId: string) =>
        supertest(server())
          .post(bookingUrl(patientId))
          .set("Cookie", holderA.cookie)
          .set(REQUEST_ID_HEADER, sharedRequestId)
          .send(VALID_BODY);

      const [unknownResponse, otherCustomerResponse, crossTenantResponse] = await Promise.all([
        probe(randomUUID()),
        probe(petA2.id),
        probe(petB.id),
      ]);

      for (const response of [unknownResponse, otherCustomerResponse, crossTenantResponse]) {
        expect(response.status).toBe(404);
        expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
        expect(response.headers[REQUEST_ID_HEADER]).toBe(sharedRequestId);
      }
      expect(otherCustomerResponse.text).toBe(unknownResponse.text);
      expect(crossTenantResponse.text).toBe(unknownResponse.text);

      const serialized = `${unknownResponse.text}${otherCustomerResponse.text}${crossTenantResponse.text}`;
      for (const identifier of [petA2.id, petA2.name, petB.id, petB.name]) {
        expect(serialized).not.toContain(identifier);
      }
      // Nothing was written by any of the masked attempts.
      expect(requestRowsFor(petA2.id)).toHaveLength(0);
      expect(
        booted.db.prisma.portalBookingRequest.findMany({
          where: { tenantId: fixture.tenants.b.id, patientId: petB.id },
        })
      ).toHaveLength(0);
    });
  });

  describe("audit trail", () => {
    it("writes exactly one co-committed PORTAL-attributed row per request", async () => {
      const requestId = `portal-booking-audit-${randomUUID()}`;

      const response = await supertest(server())
        .post(bookingUrl(petA.id))
        .set("Cookie", holderA.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .send(VALID_BODY)
        .expect(201);
      const createdId = (response.body as BookingRequestBody).id;

      const rows = booted.db.prisma.auditLog.findMany({ where: { requestId } });
      expect(rows).toHaveLength(1);
      const audit = rows[0];
      expect(audit.action).toBe(BOOKING_ACTION);
      expect(audit.actorType).toBe("PORTAL");
      expect(audit.actorPortalAccessId).toBe(holderA.access.id);
      // A PORTAL row never carries a staff actor.
      expect(audit.actorUserProfileId).toBeUndefined();
      expect(audit.tenantId).toBe(tenantA);
      expect(audit.targetType).toBe("portal_booking_request");
      expect(audit.targetId).toBe(createdId);
      expect(audit.metadata).toEqual({
        schemaVersion: 1,
        changedFields: ["patientId", "startAt", "endAt", "status"],
      });
    });

    it("persists nothing when the audit append fails (audit-or-nothing)", async () => {
      const before = requestRowsFor(petA.id).length;
      const originalCreate = booted.db.prisma.auditLog.create;
      booted.db.prisma.auditLog.create = () => {
        throw new Error("audit storage unavailable");
      };

      let status = 0;
      let code = "";
      try {
        const response = await supertest(server())
          .post(bookingUrl(petA.id))
          .set("Cookie", holderA.cookie)
          .send(VALID_BODY);
        status = response.status;
        code = (response.body as ErrorEnvelopeBody).error.code;
      } finally {
        booted.db.prisma.auditLog.create = originalCreate;
      }

      expect(status).toBe(500);
      expect(code).toBe("INTERNAL");
      // The transaction rolled back: the request row never committed.
      expect(requestRowsFor(petA.id)).toHaveLength(before);
    });
  });
});
