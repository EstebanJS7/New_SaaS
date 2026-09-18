import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import type { PatientRow } from "../../test/support/in-memory-database.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface PetBody {
  id: string;
  name: string;
  speciesId: string;
  breedId: string | null;
  sex: string;
  birthDate: string | null;
  isActive: boolean;
  clinical: {
    encounters: { id: string; status: string; clientSummary: string; closedAt: string | null }[];
    vaccinations: { id: string; vaccine: string; administeredAt: string }[];
  };
}

interface AppointmentBody {
  id: string;
  patientId: string;
  status: string;
  startAt: string;
  endAt: string;
}

/**
 * Distinctive, searchable CONFIDENTIAL markers. The whole point of WU3 is that
 * neither can reach a response or a log line.
 */
const INTERNAL_NOTES_MARKER = "SECRET-INTERNAL-NOTES-4f21";
const DRAFT_INTERNAL_MARKER = "SECRET-DRAFT-NOTES-9c07";
const CLIENT_SUMMARY = "Routine wellness visit completed.";

const PET_DETAIL_KEYS = [
  "birthDate",
  "breedId",
  "clinical",
  "id",
  "isActive",
  "name",
  "sex",
  "speciesId",
];

const APPOINTMENT_KEYS = ["endAt", "id", "patientId", "startAt", "status"];

/**
 * EPIC-08 WU3 — holder-owned portal READ surface over real HTTP and the full
 * guard chain (AppModule + AppGuards + in-memory Prisma boundary).
 *
 * Proves: own-pet scoping through the guardian chain, cross-tenant and
 * same-tenant non-owned resources masked as byte-equivalent 404, an allowlisted
 * clinical projection that never exposes `internalNotes`/staff free text to a
 * response or a log, and that the deferred surfaces are simply absent.
 */
describe("portal read surface (real HTTP, full guard chain)", () => {
  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;
  let holderA: PortalAccessFixture;
  let holderB: PortalAccessFixture;
  let petA: PatientRow;
  let petA2: PatientRow;
  let petB: PatientRow;
  let encounterWithNotesId: string;
  let appointmentAId: string;
  let appointmentA2Id: string;
  let appointmentBId: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedTwoTenants(booted.db);
    const prisma = booted.db.prisma;
    const tenantA = fixture.tenants.a.id;
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

    const customerA1 = createCustomer(tenantA, "Holder A Customer");
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

    // Clinical: one CLOSED encounter carrying a client-safe summary AND a
    // confidential staff note, plus a DRAFT with no summary.
    const encounterWithNotes = prisma.clinicalEncounter.create({
      data: {
        tenantId: tenantA,
        patientId: petA.id,
        status: "CLOSED",
        clientSummary: CLIENT_SUMMARY,
        internalNotes: INTERNAL_NOTES_MARKER,
        closedAt: new Date("2026-03-01T10:00:00.000Z"),
      },
    });
    encounterWithNotesId = encounterWithNotes.id;
    prisma.clinicalEncounter.create({
      data: {
        tenantId: tenantA,
        patientId: petA.id,
        status: "DRAFT",
        clientSummary: null,
        internalNotes: DRAFT_INTERNAL_MARKER,
        closedAt: null,
      },
    });
    prisma.clinicalVaccination.create({
      data: {
        tenantId: tenantA,
        patientId: petA.id,
        vaccine: "Rabies",
        administeredAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    // A foreign-tenant clinical row must never reach holder A.
    prisma.clinicalEncounter.create({
      data: {
        tenantId: tenantB,
        patientId: petB.id,
        status: "CLOSED",
        clientSummary: "Foreign tenant summary",
        internalNotes: "foreign",
        closedAt: new Date("2026-03-02T10:00:00.000Z"),
      },
    });

    const createAppointment = (tenantId: string, patientId: string, startAt: Date): string =>
      prisma.appointment.create({
        data: {
          tenantId,
          branchId: randomUUID(),
          patientId,
          professionalMembershipId: randomUUID(),
          status: "SCHEDULED",
          version: 1,
          startAt,
          endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        },
      }).id;
    appointmentAId = createAppointment(tenantA, petA.id, new Date("2026-04-01T09:00:00.000Z"));
    appointmentA2Id = createAppointment(tenantA, petA2.id, new Date("2026-04-02T09:00:00.000Z"));
    appointmentBId = createAppointment(tenantB, petB.id, new Date("2026-04-03T09:00:00.000Z"));

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

  describe("authentication and entitlement boundary", () => {
    it("returns 401 for an anonymous read and for a staff session", async () => {
      await supertest(server()).get("/portal/pets").expect(401);
      await supertest(server())
        .get("/portal/pets")
        .set("Cookie", fixture.actors.a.cookie)
        .expect(401);
    });

    it("returns 403 FEATURE_NOT_ENTITLED for an entitled-less tenant holder", async () => {
      const response = await supertest(server())
        .get("/portal/pets")
        .set("Cookie", holderB.cookie)
        .expect(403);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("FEATURE_NOT_ENTITLED");
    });
  });

  describe("holder-owned pet reads", () => {
    it("lists only the holder's own pets and ignores client identity hints", async () => {
      const response = await supertest(server())
        .get("/portal/pets")
        .query({ tenantId: fixture.tenants.b.id, customerId: petA2.id })
        .set("x-tenant-id", fixture.tenants.b.id)
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as { id: string; name: string }[];
      expect(body.map((pet) => pet.id)).toEqual([petA.id]);
      expect(response.text).not.toContain(petA2.id);
      expect(response.text).not.toContain(petB.id);
      expect(response.text).not.toContain(fixture.tenants.b.id);
    });

    it("returns the allowlisted pet detail with clinical summary and vaccinations", async () => {
      const response = await supertest(server())
        .get(`/portal/pets/${petA.id}`)
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as PetBody;
      expect(Object.keys(body).sort()).toEqual(PET_DETAIL_KEYS);
      expect(body.id).toBe(petA.id);
      expect(body.name).toBe(petA.name);
      expect(body.clinical.encounters).toHaveLength(1);
      expect(body.clinical.encounters[0]).toMatchObject({
        id: encounterWithNotesId,
        status: "CLOSED",
        clientSummary: CLIENT_SUMMARY,
      });
      expect(Object.keys(body.clinical.encounters[0]).sort()).toEqual([
        "clientSummary",
        "closedAt",
        "id",
        "status",
      ]);
      expect(body.clinical.vaccinations).toHaveLength(1);
      expect(body.clinical.vaccinations[0].vaccine).toBe("Rabies");
      expect(Object.keys(body.clinical.vaccinations[0]).sort()).toEqual([
        "administeredAt",
        "id",
        "vaccine",
      ]);
      // No tenant echo.
      expect(body).not.toHaveProperty("tenantId");
    });

    it("never returns internalNotes or the staff clinical free text", async () => {
      const response = await supertest(server())
        .get(`/portal/pets/${petA.id}`)
        .set("Cookie", holderA.cookie)
        .expect(200);

      expect(response.text).not.toContain(INTERNAL_NOTES_MARKER);
      expect(response.text).not.toContain(DRAFT_INTERNAL_MARKER);
      expect(response.text).not.toContain("internalNotes");
      expect(response.text).not.toContain("reasonForVisit");
      // The DRAFT encounter (no client summary) is not exposed at all.
      expect(response.text).not.toContain("DRAFT");
    });

    it("logs carry stable ids only — no CONFIDENTIAL payload", () => {
      const logs = booted.logLines().join("\n");
      expect(logs).not.toContain(INTERNAL_NOTES_MARKER);
      expect(logs).not.toContain(DRAFT_INTERNAL_MARKER);
      expect(logs).not.toContain(CLIENT_SUMMARY);
      expect(logs).toContain(petA.id);
    });

    it("masks a cross-tenant pet and an unknown id as byte-equivalent 404", async () => {
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        nonexistentUrl: `/portal/pets/${randomUUID()}`,
        foreignUrl: `/portal/pets/${petB.id}`,
        forbiddenIdentifiers: [petB.id, petB.name],
      });
    });

    it("masks another Customer's pet in the same tenant as 404", async () => {
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        nonexistentUrl: `/portal/pets/${randomUUID()}`,
        foreignUrl: `/portal/pets/${petA2.id}`,
        forbiddenIdentifiers: [petA2.id, petA2.name],
      });
    });

    it("rejects a malformed pet id with 400 VALIDATION_FAILED", async () => {
      const response = await supertest(server())
        .get("/portal/pets/not-a-uuid")
        .set("Cookie", holderA.cookie)
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("holder-owned appointment reads", () => {
    it("lists only appointments for holder-owned pets", async () => {
      const response = await supertest(server())
        .get("/portal/appointments")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as AppointmentBody[];
      expect(body.map((appointment) => appointment.id)).toEqual([appointmentAId]);
      expect(body[0]).toMatchObject({ patientId: petA.id, status: "SCHEDULED" });
      expect(Object.keys(body[0]).sort()).toEqual(APPOINTMENT_KEYS);
      // No provenance/internal linkage leaks.
      expect(response.text).not.toContain("portalBookingRequestId");
      expect(response.text).not.toContain(appointmentA2Id);
      expect(response.text).not.toContain(appointmentBId);
    });

    it("serves one holder-owned appointment with the allowlisted projection", async () => {
      const response = await supertest(server())
        .get(`/portal/appointments/${appointmentAId}`)
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as AppointmentBody;
      expect(Object.keys(body).sort()).toEqual(APPOINTMENT_KEYS);
      expect(body.id).toBe(appointmentAId);
      expect(body).not.toHaveProperty("tenantId");
    });

    it("masks a cross-tenant appointment and a same-tenant non-owned one as 404", async () => {
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        nonexistentUrl: `/portal/appointments/${randomUUID()}`,
        foreignUrl: `/portal/appointments/${appointmentBId}`,
      });
      await expectCrossTenant404({
        app: booted.app,
        cookie: holderA.cookie,
        nonexistentUrl: `/portal/appointments/${randomUUID()}`,
        foreignUrl: `/portal/appointments/${appointmentA2Id}`,
      });
    });

    it("rejects a malformed appointment id with 400 VALIDATION_FAILED", async () => {
      const response = await supertest(server())
        .get("/portal/appointments/not-a-uuid")
        .set("Cookie", holderA.cookie)
        .expect(400);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("deferred surfaces stay absent", () => {
    const deferredGets = [
      "/portal/email",
      "/portal/notifications",
      "/portal/invoices",
      "/portal/documents",
      "/portal/files",
      `/portal/treatments/${randomUUID()}`,
      `/portal/studies/${randomUUID()}`,
      `/portal/deworming/${randomUUID()}`,
      `/portal/weights/${randomUUID()}`,
    ];

    it.each(deferredGets)("404 for %s", async (path) => {
      const response = await supertest(server())
        .get(path)
        .set("Cookie", holderA.cookie)
        .expect(404);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    });

    it("404 for a POST to the profile write path — the write shipped as PUT in WU4C", async () => {
      const response = await supertest(server())
        .post("/portal/profile")
        .set("Cookie", holderA.cookie)
        .send({ phone: "+595981000000" })
        .expect(404);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
    });

    it("401 when a portal identity attempts a staff appointment transition", async () => {
      const response = await supertest(server())
        .post(`/appointments/${appointmentAId}/confirm`)
        .set("Cookie", holderA.cookie)
        .expect(401);
      expect((response.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
    });
  });
});
