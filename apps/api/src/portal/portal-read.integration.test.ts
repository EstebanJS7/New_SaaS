import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { seedPortalAccess, type PortalAccessFixture } from "../../test/support/seed-portal.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import { TENANT_TIMEZONE } from "../scheduling/appointment-invariants.js";
import type { PatientRow } from "../../test/support/in-memory-database.js";

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

interface PetSummaryBody {
  id: string;
  name: string;
  speciesId: string;
  speciesName: string;
  breedId: string | null;
  breedName: string | null;
  sex: string;
  birthDate: string | null;
  isActive: boolean;
}

interface PetBody extends PetSummaryBody {
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

interface AppointmentSummaryBody extends AppointmentBody {
  patientName: string;
}

interface AppointmentListBody {
  timeZone: string;
  appointments: AppointmentSummaryBody[];
}

/**
 * Distinctive, searchable CONFIDENTIAL markers. The whole point of WU3 is that
 * neither can reach a response or a log line.
 */
const INTERNAL_NOTES_MARKER = "SECRET-INTERNAL-NOTES-4f21";
const DRAFT_INTERNAL_MARKER = "SECRET-DRAFT-NOTES-9c07";
const CLIENT_SUMMARY = "Routine wellness visit completed.";

const PET_SUMMARY_KEYS = [
  "birthDate",
  "breedId",
  "breedName",
  "id",
  "isActive",
  "name",
  "sex",
  "speciesId",
  "speciesName",
];

const PET_DETAIL_KEYS = [...PET_SUMMARY_KEYS, "clinical"].sort();

const APPOINTMENT_KEYS = ["endAt", "id", "patientId", "startAt", "status", "version"];
const APPOINTMENT_SUMMARY_KEYS = [
  "endAt",
  "id",
  "patientId",
  "patientName",
  "startAt",
  "status",
  "version",
];
const APPOINTMENT_LIST_ENVELOPE_KEYS = ["appointments", "timeZone"];

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
  let holderC: PortalAccessFixture;
  let petA: PatientRow;
  let petA2: PatientRow;
  let petA3: PatientRow;
  let petB: PatientRow;
  let breachPetId: string;
  let breachSpeciesId: string;
  let breachBreedId: string;
  let breachBreedPetId: string;
  let otherSpeciesId: string;
  let otherBreedId: string;
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
    const breed = prisma.breed.create({
      data: {
        speciesId: species.id,
        code: `labrador-${fixture.suffix}`,
        name: "Labrador Retriever",
      },
    });
    // Taxonomy the holder's pets do NOT reference: proves the response is scoped
    // to the pets' own species/breed and is never a slice of the global catalog.
    const otherSpecies = prisma.species.create({
      data: { code: `cat-${fixture.suffix}`, name: "Cat" },
    });
    const otherBreed = prisma.breed.create({
      data: { speciesId: otherSpecies.id, code: `siamese-${fixture.suffix}`, name: "Siamese" },
    });
    otherSpeciesId = otherSpecies.id;
    otherBreedId = otherBreed.id;

    // Ids that exist in no reference row, so the pet rows below reference an
    // unresolvable species and an unresolvable breed respectively.
    breachSpeciesId = randomUUID();
    breachBreedId = randomUUID();

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
    const customerA3 = createCustomer(tenantA, "Holder C Customer");
    const customerB = createCustomer(tenantB, "Holder B Customer");

    const createPatient = (
      tenantId: string,
      name: string,
      breedId: string | null = null
    ): PatientRow =>
      prisma.patient.create({
        data: {
          tenantId,
          name,
          speciesId: species.id,
          breedId,
          sex: "MALE",
          birthDate: new Date("2020-01-02T00:00:00.000Z"),
          isActive: true,
        },
      });

    petA = createPatient(tenantA, "Pet A (holder-owned)", breed.id);
    petA2 = createPatient(tenantA, "Pet A2 (other customer)");
    // A second holder-owned pet with NO breed: the null `breedId` must stay null.
    petA3 = createPatient(tenantA, "Pet Z (holder-owned, no breed)");
    petB = createPatient(tenantB, "Pet B (other tenant)");

    // A pet whose GLOBAL species row cannot be resolved: the RESTRICT FK makes
    // this an integrity breach the read must surface as INTERNAL, never a blank
    // or a raw id. It belongs to its own holder so the happy-path list stays clean.
    const breachPet = prisma.patient.create({
      data: {
        tenantId: tenantA,
        name: "Pet C (unresolvable species)",
        speciesId: breachSpeciesId,
        breedId: null,
        sex: "MALE",
        birthDate: null,
        isActive: true,
      },
    });
    breachPetId = breachPet.id;

    // A resolvable species with an unresolvable BREED is the other half of the
    // same integrity breach, and the read must fail the same way rather than
    // dropping the breed name or substituting the id.
    const breachBreedPet = prisma.patient.create({
      data: {
        tenantId: tenantA,
        name: "Pet C2 (unresolvable breed)",
        speciesId: petA.speciesId,
        breedId: breachBreedId,
        sex: "MALE",
        birthDate: null,
        isActive: true,
      },
    });
    breachBreedPetId = breachBreedPet.id;

    const linkGuardian = (tenantId: string, patientId: string, customerId: string): void => {
      prisma.patientGuardian.create({
        data: { tenantId, patientId, customerId, isPrimary: true, isActive: true, position: 0 },
      });
    };
    linkGuardian(tenantA, petA.id, customerA1);
    linkGuardian(tenantA, petA2.id, customerA2);
    linkGuardian(tenantA, petA3.id, customerA1);
    linkGuardian(tenantA, breachPet.id, customerA3);
    linkGuardian(tenantA, breachBreedPet.id, customerA3);
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
    holderC = seedPortalAccess(booted.db, { tenantId: tenantA, customerId: customerA3 });

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

      const body = response.body as PetSummaryBody[];
      expect(body.map((pet) => pet.id)).toEqual([petA.id, petA3.id]);
      expect(response.text).not.toContain(petA2.id);
      expect(response.text).not.toContain(petB.id);
      expect(response.text).not.toContain(breachPetId);
      expect(response.text).not.toContain(fixture.tenants.b.id);
    });

    it("resolves only the pets' own species and breed names, never the catalog", async () => {
      const response = await supertest(server())
        .get("/portal/pets")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as PetSummaryBody[];
      expect(body.map((pet) => pet.speciesName)).toEqual(["Dog", "Dog"]);
      expect(body.map((pet) => pet.breedName)).toEqual(["Labrador Retriever", null]);
      // Every emitted field is on the allowlist: no catalog entry, no `code`,
      // no nested `breeds` array and no tenant echo.
      expect(Object.keys(body[0]).sort()).toEqual(PET_SUMMARY_KEYS);
      // The GLOBAL catalog is not exposed as a list: an unrelated species/breed
      // the holder's pets do not have can never appear in the response.
      expect(response.text).not.toContain("Cat");
      expect(response.text).not.toContain("Siamese");
      expect(response.text).not.toContain(otherSpeciesId);
      expect(response.text).not.toContain(otherBreedId);
    });

    it("resolves every involved species/breed name in exactly ONE global reference read", async () => {
      const originalFindMany = booted.db.prisma.species.findMany;
      const capturedArgs: { where: { id: { in: string[] } }; include: { breeds: boolean } }[] = [];
      booted.db.prisma.species.findMany = ((args: {
        where: { id: { in: string[] } };
        include: { breeds: boolean };
      }) => {
        capturedArgs.push(args);
        return originalFindMany(args);
      }) as typeof originalFindMany;

      try {
        await supertest(server()).get("/portal/pets").set("Cookie", holderA.cookie).expect(200);
      } finally {
        booted.db.prisma.species.findMany = originalFindMany;
      }

      // ONE set-based read for the whole batch (both pets share the species id),
      // scoped to the pets' OWN species id and deliberately NOT tenant-filtered:
      // Species/Breed carry no tenant column, so a tenant predicate would be a
      // category error (Decision #2211).
      expect(capturedArgs).toHaveLength(1);
      const captured = capturedArgs[0];
      expect(captured?.where).toEqual({ id: { in: [petA.speciesId] } });
      expect(captured?.where).not.toHaveProperty("tenantId");
      expect(captured?.include).toEqual({ breeds: true });
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

    it("resolves the names on the pet detail and keeps a null breed null", async () => {
      const withBreed = await supertest(server())
        .get(`/portal/pets/${petA.id}`)
        .set("Cookie", holderA.cookie)
        .expect(200);
      const withBreedBody = withBreed.body as PetBody;
      expect(withBreedBody).toMatchObject({
        speciesId: petA.speciesId,
        speciesName: "Dog",
        breedId: petA.breedId,
        breedName: "Labrador Retriever",
      });

      const withoutBreed = await supertest(server())
        .get(`/portal/pets/${petA3.id}`)
        .set("Cookie", holderA.cookie)
        .expect(200);
      const withoutBreedBody = withoutBreed.body as PetBody;
      expect(withoutBreedBody).toMatchObject({
        speciesName: "Dog",
        breedId: null,
        breedName: null,
      });
      expect(Object.keys(withoutBreedBody).sort()).toEqual(PET_DETAIL_KEYS);
    });

    it("fails loudly as INTERNAL when a pet's species cannot be resolved", async () => {
      const response = await supertest(server())
        .get(`/portal/pets/${breachPetId}`)
        .set("Cookie", holderC.cookie)
        .expect(500);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("INTERNAL");
      // The raw id is never returned as a substitute for a name: the id at stake
      // is the unresolvable SPECIES, not the pet's own id.
      expect(response.text).not.toContain(breachSpeciesId);
    });

    it("fails loudly as INTERNAL when a pet's breed cannot be resolved", async () => {
      const response = await supertest(server())
        .get(`/portal/pets/${breachBreedPetId}`)
        .set("Cookie", holderC.cookie)
        .expect(500);

      expect((response.body as ErrorEnvelopeBody).error.code).toBe("INTERNAL");
      expect(response.text).not.toContain(breachBreedId);
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
    it("lists only appointments for holder-owned pets inside the list envelope", async () => {
      const response = await supertest(server())
        .get("/portal/appointments")
        .set("Cookie", holderA.cookie)
        .expect(200);

      const body = response.body as AppointmentListBody;
      expect(Object.keys(body).sort()).toEqual(APPOINTMENT_LIST_ENVELOPE_KEYS);
      expect(body.timeZone).toBe(TENANT_TIMEZONE);
      expect(body.appointments.map((appointment) => appointment.id)).toEqual([appointmentAId]);
      expect(body.appointments[0]).toMatchObject({
        patientId: petA.id,
        patientName: petA.name,
        status: "SCHEDULED",
      });
      expect(Object.keys(body.appointments[0]).sort()).toEqual(APPOINTMENT_SUMMARY_KEYS);
      // No provenance/internal linkage leaks, and no other pet's name/row does.
      expect(response.text).not.toContain("portalBookingRequestId");
      expect(response.text).not.toContain(appointmentA2Id);
      expect(response.text).not.toContain(appointmentBId);
      expect(response.text).not.toContain(petA2.name);
      expect(response.text).not.toContain(petB.name);
    });

    it("resolves every involved pet name in exactly ONE tenant-scoped query", async () => {
      const originalFindMany = booted.db.prisma.patient.findMany;
      const capturedWhere: Parameters<typeof originalFindMany>[0]["where"][] = [];
      booted.db.prisma.patient.findMany = (args) => {
        capturedWhere.push(args.where);
        return originalFindMany(args);
      };

      try {
        await supertest(server())
          .get("/portal/appointments")
          .set("Cookie", holderA.cookie)
          .expect(200);
      } finally {
        booted.db.prisma.patient.findMany = originalFindMany;
      }

      // One set-based lookup, not one per row, and it is pinned to the holder's
      // OWN tenant and to the appointment's pet only.
      expect(capturedWhere).toHaveLength(1);
      const captured = capturedWhere[0];
      expect(captured?.tenantId).toBe(fixture.tenants.a.id);
      expect(captured?.id?.in).toEqual([petA.id]);
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
