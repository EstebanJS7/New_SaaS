import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import type { PatientRow, PortalBookingRequestRow } from "../../test/support/in-memory-database.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface BookingSummaryBody {
  id: string;
  patientId: string;
  patientName: string;
  status: string;
  startAt: string;
  endAt: string;
}

interface BookingListBody {
  timeZone: string;
  bookings: BookingSummaryBody[];
}

/** Exact allowlisted keys of the read envelope and of one booking. */
const ENVELOPE_KEYS = ["bookings", "timeZone"];
const BOOKING_KEYS = ["endAt", "id", "patientId", "patientName", "startAt", "status"];

/**
 * Exact error-envelope key set rendered by `GlobalExceptionFilter`
 * (`{ error: { code, message, requestId } }` — verified against the filter, not
 * assumed). Every failure path in this suite is pinned to it.
 */
const ERROR_ENVELOPE_KEYS = ["error"];
const ERROR_BODY_KEYS = ["code", "message", "requestId"];

/** Pinned tenant zone (the same constant the availability read ships). */
const TENANT_TIME_ZONE = "America/Asuncion";

/**
 * EPIC-08 — holder-facing booking-request READ over real HTTP and the full guard
 * chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves: the holder sees EVERY status of their own requests, the patient name
 * is resolved server-side in ONE set-based query, the ownership scope pins both
 * the stored `(tenantId, customerId)` clauses (another Customer in the same
 * tenant AND another tenant both excluded, even when the row is crafted to
 * evade one of the two clauses), the projection is allowlisted with no branch/
 * professional/staff/provenance identifier, and the read writes nothing.
 */
describe("portal booking-request read (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let holderA: PortalAccessFixture;
  let holderB: PortalAccessFixture;
  let tenantA: string;
  let customerA1: string;
  let speciesId: string;
  let petA: PatientRow;
  let petASecond: PatientRow;
  let petAOther: PatientRow;
  let petB: PatientRow;
  /** Holder A's OWN requests, oldest start first. */
  let owned: PortalBookingRequestRow[];
  /** Same tenant, DIFFERENT Customer — must never reach holder A. */
  let otherCustomerRow: PortalBookingRequestRow;
  /** Another tenant, crafted with holder A's OWN customer id — must never reach. */
  let foreignTenantRow: PortalBookingRequestRow;
  /** Another tenant's genuine request. */
  let tenantBRow: PortalBookingRequestRow;
  /** Real staff identifiers that must never appear in a holder response. */
  let branchId: string;
  let professionalMembershipId: string;

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

    petA = createPatient(tenantA, "Rex (holder-owned)");
    petASecond = createPatient(tenantA, "Milo (holder-owned)");
    petAOther = createPatient(tenantA, "Foreign pet (other customer)");
    petB = createPatient(tenantB, "Tenant B pet");

    const linkGuardian = (tenantId: string, patientId: string, customerId: string): void => {
      prisma.patientGuardian.create({
        data: { tenantId, patientId, customerId, isPrimary: true, isActive: true, position: 0 },
      });
    };
    linkGuardian(tenantA, petA.id, customerA1);
    linkGuardian(tenantA, petASecond.id, customerA1);
    linkGuardian(tenantA, petAOther.id, customerA2);
    linkGuardian(tenantB, petB.id, customerB);

    const createRequest = (
      tenantId: string,
      customerId: string,
      patientId: string,
      status: PortalBookingRequestRow["status"],
      startAt: string
    ): PortalBookingRequestRow =>
      prisma.portalBookingRequest.create({
        data: {
          tenantId,
          customerId,
          patientId,
          status,
          startAt: new Date(startAt),
          endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000),
        },
      });

    // Every lifecycle status, across two holder-owned pets.
    owned = [
      createRequest(tenantA, customerA1, petA.id, "PENDING", "2026-05-01T09:00:00.000Z"),
      createRequest(tenantA, customerA1, petA.id, "APPROVED", "2026-05-02T09:00:00.000Z"),
      createRequest(tenantA, customerA1, petA.id, "REJECTED", "2026-05-03T09:00:00.000Z"),
      createRequest(tenantA, customerA1, petASecond.id, "CANCELLED", "2026-05-04T09:00:00.000Z"),
    ];

    // Adversarial rows: each is crafted to slip past ONE of the two scope
    // clauses (customer id, tenant id) if the read only pinned the other.
    otherCustomerRow = createRequest(
      tenantA,
      customerA2,
      petA.id,
      "APPROVED",
      "2026-05-01T12:00:00.000Z"
    );
    foreignTenantRow = createRequest(
      tenantB,
      customerA1,
      petA.id,
      "APPROVED",
      "2026-05-02T12:00:00.000Z"
    );
    tenantBRow = createRequest(tenantB, customerB, petB.id, "PENDING", "2026-05-03T12:00:00.000Z");

    // Real staff/branch rows whose identifiers must never reach a holder.
    branchId = prisma.branch.create({
      data: { tenantId: tenantA, name: "Branch A" },
    }).id;
    professionalMembershipId = fixture.actors.a.membership?.id ?? randomUUID();

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

  /**
   * Real staff/branch/portal identifiers that must never appear in ANY holder
   * response — success OR failure. Shared so the error path is held to exactly
   * the same bar as the success path.
   */
  const staffIdentifiers = (): string[] =>
    [
      branchId,
      professionalMembershipId,
      fixture.actors.a.profile.id,
      fixture.actors.a.membership?.id ?? "",
      holderA.access.id,
    ].filter((identifier) => identifier.length > 0);

  /** Field NAMES that would even hint at a staff/provenance identifier. */
  const FORBIDDEN_RESPONSE_KEYS = [
    "branchId",
    "branch",
    "professional",
    "professionalMembershipId",
    "customerId",
    "tenantId",
    "portalAccess",
    "source",
    "version",
    "portalBookingRequestId",
    "createdAt",
    "updatedAt",
  ] as const;

  /** Byte-level scan: no staff identifier and no staff field name in `text`. */
  const expectNoStaffIdentifiers = (text: string): void => {
    for (const identifier of staffIdentifiers()) {
      expect(text).not.toContain(identifier);
    }
    for (const forbiddenKey of FORBIDDEN_RESPONSE_KEYS) {
      expect(text).not.toContain(forbiddenKey);
    }
  };

  describe("authentication and entitlement boundary", () => {
    it("returns 401 for an anonymous read and for a staff session", async () => {
      await supertest(server()).get("/portal/bookings").expect(401);
      const staffResponse = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", fixture.actors.a.cookie)
        .expect(401);
      expect((staffResponse.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FEATURE_NOT_ENTITLED for an entitled-less tenant holder", async () => {
      const response = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderB.cookie)
        .expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    });
  });

  describe("own booking-request listing", () => {
    it("returns every own request, oldest start first, with status and resolved patient name", async () => {
      const response = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as BookingListBody;
      expect(Object.keys(body).sort()).toEqual(ENVELOPE_KEYS);
      expect(body.timeZone).toBe(TENANT_TIME_ZONE);

      expect(body.bookings.map((booking) => booking.id)).toEqual(owned.map((row) => row.id));
      expect(body.bookings.map((booking) => booking.status)).toEqual([
        "PENDING",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
      ]);

      for (const booking of body.bookings) {
        expect(Object.keys(booking).sort()).toEqual(BOOKING_KEYS);
      }
      const named = new Map(body.bookings.map((booking) => [booking.id, booking.patientName]));
      expect(named.get(owned[0].id)).toBe(petA.name);
      expect(named.get(owned[1].id)).toBe(petA.name);
      expect(named.get(owned[2].id)).toBe(petA.name);
      expect(named.get(owned[3].id)).toBe(petASecond.name);

      // UTC instants, exact round-trip.
      expect(body.bookings[0].startAt).toBe("2026-05-01T09:00:00.000Z");
      expect(body.bookings[0].endAt).toBe("2026-05-01T10:00:00.000Z");
      // No identity echo: tenant and Customer are server-side facts.
      expect(response.text).not.toContain(tenantA);
      expect(response.text).not.toContain(customerA1);
    });

    it("resolves every involved patient name in exactly ONE set-based query", async () => {
      const originalFindMany = booted.db.prisma.patient.findMany;
      let patientQueries = 0;
      booted.db.prisma.patient.findMany = (args) => {
        patientQueries += 1;
        return originalFindMany(args);
      };

      try {
        await supertest(server()).get("/portal/bookings").set("Cookie", holderA.cookie).expect(200);
      } finally {
        booted.db.prisma.patient.findMany = originalFindMany;
      }

      // Two distinct patients across four rows: one query, not one per row.
      expect(patientQueries).toBe(1);
    });

    it("ignores client identity hints in the query and headers", async () => {
      const reference = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const hinted = await supertest(server())
        .get("/portal/bookings")
        .query({ tenantId: fixture.tenants.b.id, customerId: randomUUID() })
        .set("x-tenant-id", fixture.tenants.b.id)
        .set("Cookie", holderA.cookie)
        .expect(200);

      expect((hinted.body as BookingListBody).bookings).toEqual(
        (reference.body as BookingListBody).bookings
      );
    });
  });

  describe("ownership scoping", () => {
    it("omits a request belonging to another Customer in the same tenant", async () => {
      const response = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as BookingListBody;
      expect(body.bookings.map((booking) => booking.id)).not.toContain(otherCustomerRow.id);
      expect(response.text).not.toContain(otherCustomerRow.id);
      expect(response.text).not.toContain(petAOther.id);
      expect(response.text).not.toContain(petAOther.name);
      // The other Customer's customer id never leaks either.
      expect(response.text).not.toContain(otherCustomerRow.customerId);
    });

    it("omits another tenant's requests and is not influenced by them", async () => {
      const response = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as BookingListBody;
      // The foreign row was crafted with holder A's OWN customer id and pet id,
      // so only the tenant clause can exclude it.
      expect(body.bookings.map((booking) => booking.id)).not.toContain(foreignTenantRow.id);
      expect(body.bookings.map((booking) => booking.id)).not.toContain(tenantBRow.id);
      expect(response.text).not.toContain(foreignTenantRow.id);
      expect(response.text).not.toContain(tenantBRow.id);
      expect(response.text).not.toContain(petB.id);
      expect(response.text).not.toContain(petB.name);
      expect(response.text).not.toContain(fixture.tenants.b.id);
      // Exactly the holder's own requests: the foreign rows changed nothing.
      expect(body.bookings.map((booking) => booking.id)).toEqual(owned.map((row) => row.id));
    });

    it("keeps showing the holder's OWN request after the guardian link to that pet is revoked", async () => {
      const prisma = booted.db.prisma;
      // THIS is the case that separates owner-scoping from guardian-chain
      // scoping. A request is the holder's own submission (the row stores the
      // Customer that made it), not a property of the pet's CURRENT guardian
      // chain. If the read were ever "improved" to derive ownership from active
      // guardian links, this holder would silently lose sight of a request they
      // own — and this test would fail.
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
      const detachedRequest = prisma.portalBookingRequest.create({
        data: {
          tenantId: tenantA,
          customerId: customerA1,
          patientId: detachedPet.id,
          status: "APPROVED",
          startAt: new Date("2026-07-01T09:00:00.000Z"),
          endAt: new Date("2026-07-01T10:00:00.000Z"),
        },
      });

      try {
        // The guardian link is revoked AFTER the request already exists.
        const revoked = prisma.patientGuardian.updateMany({
          where: { id: link.id, tenantId: tenantA, patientId: detachedPet.id },
          data: { isActive: false },
        });
        expect(revoked.count).toBe(1);

        const response = await supertest(server())
          .get("/portal/bookings")
          .set("Cookie", holderA.cookie)
          .expect(200);

        const booking = (response.body as BookingListBody).bookings.find(
          (row) => row.id === detachedRequest.id
        );
        expect(booking).toBeDefined();
        expect(booking?.status).toBe("APPROVED");
        expect(booking?.patientName).toBe(detachedPet.name);
      } finally {
        booted.db.tables.portalBookingRequests.delete(detachedRequest.id);
        booted.db.tables.patientGuardians.delete(link.id);
        booted.db.tables.patients.delete(detachedPet.id);
      }
    });
  });

  describe("allowlisted projection", () => {
    it("exposes no branch, professional, staff or provenance identifier", async () => {
      const response = await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as BookingListBody;
      for (const booking of body.bookings) {
        expect(Object.keys(booking).sort()).toEqual(BOOKING_KEYS);
      }

      expectNoStaffIdentifiers(response.text);
    });

    it("fails loudly instead of printing an identifier when a patient cannot be resolved", async () => {
      const prisma = booted.db.prisma;
      // A row whose patient is gone is an integrity breach, not a client error:
      // the read must not print the patient id and must not silently drop a
      // status the holder is waiting for.
      //
      // The ghost patient is NOT restored: it exists only for this test and is
      // removed before the request, so no shared fixture state survives. The
      // only thing left to clean up is the request row, deleted in `finally`.
      const ghostPatient = prisma.patient.create({
        data: {
          tenantId: tenantA,
          name: "Ghost pet (unresolvable)",
          speciesId,
          breedId: null,
          sex: "MALE",
          birthDate: null,
          isActive: true,
        },
      });
      const ghostRequest = prisma.portalBookingRequest.create({
        data: {
          tenantId: tenantA,
          customerId: customerA1,
          patientId: ghostPatient.id,
          status: "PENDING",
          startAt: new Date("2026-06-01T09:00:00.000Z"),
          endAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      });
      booted.db.tables.patients.delete(ghostPatient.id);

      try {
        const response = await supertest(server())
          .get("/portal/bookings")
          .set("Cookie", holderA.cookie);

        expect(response.status).toBe(500);
        // Exact envelope contract, not a loose code check.
        const body = response.body as ErrorEnvelopeBody;
        expect(Object.keys(body).sort()).toEqual(ERROR_ENVELOPE_KEYS);
        expect(Object.keys(body.error).sort()).toEqual(ERROR_BODY_KEYS);
        expect(body.error.code).toBe("INTERNAL");
        expect(response.text).not.toContain(ghostPatient.id);
        expect(response.text).not.toContain(ghostPatient.name);
        // The failure path is held to the SAME staff-identifier bar as success.
        expectNoStaffIdentifiers(response.text);
      } finally {
        booted.db.tables.portalBookingRequests.delete(ghostRequest.id);
      }
    });
  });

  describe("read-only guarantee", () => {
    it("writes nothing: no booking request, appointment, audit row or settings change", async () => {
      const requestId = randomUUID();
      const tables = booted.db.tables;
      const before = {
        bookingRequests: tables.portalBookingRequests.size,
        appointments: tables.appointments.size,
        audits: tables.audits.size,
        settings: tables.settingNamespaces.size,
        patients: tables.patients.size,
        guardians: tables.patientGuardians.size,
        customers: tables.customers.size,
      };

      await supertest(server())
        .get("/portal/bookings")
        .set("Cookie", holderA.cookie)
        .set(REQUEST_ID_HEADER, requestId)
        .expect(200);

      expect(tables.portalBookingRequests.size).toBe(before.bookingRequests);
      expect(tables.appointments.size).toBe(before.appointments);
      expect(tables.audits.size).toBe(before.audits);
      expect(tables.settingNamespaces.size).toBe(before.settings);
      expect(tables.patients.size).toBe(before.patients);
      expect(tables.patientGuardians.size).toBe(before.guardians);
      expect(tables.customers.size).toBe(before.customers);
      expect([...tables.audits.values()].filter((row) => row.requestId === requestId)).toEqual([]);
    });
  });
});
