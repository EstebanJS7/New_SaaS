import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  seedPatientHttp,
  type PatientFactoryResult,
  type PatientHttpFixture,
} from "../../test/support/patient-http-fixture.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import type { PatientIdentityResponse } from "./patient-lookup.dto.js";

interface LookupRead {
  where: {
    tenantId: string;
    isActive?: boolean;
    id?: { in: string[] };
    OR?: [{ name: { contains: string } }];
  };
  take: number;
}

describe("Patient identity lookup HTTP boundary (UX-003)", () => {
  let booted: BootedTestApp;
  let fixture: PatientHttpFixture;
  let records: PatientFactoryResult[];
  let reads: LookupRead[];
  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedPatientHttp(booted.db);
    // Real guard chain and application service over a projection-specific fake.
    // Extra database fields deliberately test the response allowlist.
    vi.spyOn(booted.db.prisma.patient, "findMany").mockImplementation((args) => {
      const query = args as unknown as LookupRead;
      reads.push(query);
      const term = query.where.OR?.[0].name.contains.toLowerCase();
      return records
        .filter(
          ({ patient, customer, guardian }) =>
            patient.tenantId === query.where.tenantId &&
            (query.where.isActive === undefined || patient.isActive === query.where.isActive) &&
            (query.where.id === undefined || query.where.id.in.includes(patient.id)) &&
            (term === undefined ||
              patient.name.toLowerCase().includes(term) ||
              (guardian.isActive &&
                guardian.isPrimary &&
                customer.isActive &&
                customer.displayName.toLowerCase().includes(term)))
        )
        .sort(
          (a, b) =>
            a.patient.name.localeCompare(b.patient.name) || a.patient.id.localeCompare(b.patient.id)
        )
        .slice(0, query.take)
        .map(({ patient, customer, guardian }) => ({
          ...patient,
          species: { name: fixture.species.name },
          guardians:
            guardian.isActive && customer.isActive
              ? [{ customer: { displayName: customer.displayName, taxId: "never-expose" } }]
              : [],
        }));
    });
  });
  beforeEach(() => {
    records = [];
    reads = [];
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await booted.close();
  });
  function add(name: string, foreign = false, inactive = false) {
    const row = foreign
      ? fixture.createPatientB({ isActive: !inactive })
      : fixture.createPatientA({ isActive: !inactive });
    const record = { ...row, patient: { ...row.patient, name } };
    records.push(record);
    return record;
  }
  function lookup(body: object, cookie = fixture.a.actor.cookie) {
    return supertest(booted.app.getHttpServer())
      .post("/patients/lookup")
      .set("Cookie", cookie)
      .set("x-request-id", "patient-lookup-isolation")
      .send(body);
  }
  it("requires authentication", async () => {
    await supertest(booted.app.getHttpServer())
      .post("/patients/lookup")
      .send({ q: "Luna" })
      .expect(401);
    expect(reads).toHaveLength(0);
  });
  it.each([{ keys: [] }, { keys: ["patients.read"] }, { keys: ["customers.read"] }])(
    "requires both permissions: %j",
    async ({ keys }) => {
      const role = seedRoleWithKeys(booted.db, `LOOKUP_${randomUUID()}`, "Lookup probe", keys);
      const actor = seedRbacActor(booted.db, {
        email: `${randomUUID()}@lookup.test`,
        tenantId: fixture.a.tenant.id,
        roleId: role.role.id,
      });
      await lookup({ q: "Luna" }, actor.cookie).expect(403);
      expect(reads).toHaveLength(0);
    }
  );
  it("enforces the veterinary entitlement", async () => {
    expect((await lookup({ q: "Luna" }, fixture.c.actor.cookie).expect(403)).body).toMatchObject({
      error: { code: "FEATURE_NOT_ENTITLED" },
    });
    expect(reads).toHaveLength(0);
  });
  it.each([
    {},
    { q: "a" },
    { q: "  " },
    { q: "a".repeat(81) },
    { ids: [] },
    { ids: ["invalid"] },
    { ids: Array.from({ length: 51 }, () => randomUUID()) },
    { q: "Luna", ids: [randomUUID()] },
    { q: "Luna", tenantId: randomUUID() },
  ])("rejects an invalid selector: %j", async (body) => {
    await lookup(body).expect(400);
    expect(reads).toHaveLength(0);
  });
  it("searches own active patients and returns only identity fields", async () => {
    const own = add("Luna");
    add("Luna", true);
    add("Luna inactiva", false, true);
    expect((await lookup({ q: " lu " }).expect(200)).body).toEqual([
      {
        id: own.patient.id,
        name: "Luna",
        isActive: true,
        speciesName: "Dog",
        primaryGuardianName: "Customer A",
      },
    ]);
    expect(reads[0]).toMatchObject({
      where: { tenantId: fixture.a.tenant.id, isActive: true },
      take: 20,
    });
    expect(reads[0]).toMatchObject({
      where: {
        OR: [
          { name: { contains: "lu", mode: "insensitive" } },
          {
            guardians: {
              some: {
                tenantId: fixture.a.tenant.id,
                isPrimary: true,
                isActive: true,
                customer: { tenantId: fixture.a.tenant.id, isActive: true },
              },
            },
          },
        ],
      },
    });
    expect(reads[0]).toMatchObject({
      select: {
        guardians: {
          where: { tenantId: fixture.a.tenant.id, customer: { tenantId: fixture.a.tenant.id } },
          take: 1,
        },
      },
    });
  });
  it("searches the primary guardian name and caps results at 20", async () => {
    for (let index = 0; index < 25; index++) add(`Paciente ${index}`);
    add("Paciente extranjero", true);
    expect(
      await lookup({ q: "customer a" })
        .expect(200)
        .then((response) => response.body as PatientIdentityResponse[])
    ).toHaveLength(20);
  });
  it("resolves inactive history and masks foreign/unknown UUIDs with identical 404 responses", async () => {
    const own = add("Luna archivada", false, true);
    const foreign = add("Luna privada", true);
    const response = await lookup({ ids: [own.patient.id, own.patient.id] }).expect(200);
    expect((response.body as PatientIdentityResponse[]).map((row) => row.id)).toEqual([
      own.patient.id,
    ]);
    expect(reads[0]).toMatchObject({ where: { tenantId: fixture.a.tenant.id }, take: 50 });
    const foreignResponse = await lookup({ ids: [foreign.patient.id] }).expect(404);
    const missingResponse = await lookup({ ids: [randomUUID()] }).expect(404);
    expect(foreignResponse.body).toEqual(missingResponse.body);
    const mixed = await lookup({ ids: [own.patient.id, foreign.patient.id] }).expect(404);
    expect(mixed.body).not.toHaveProperty("name");
    expect(JSON.stringify(mixed.body)).not.toContain(own.patient.id);
  });
  it("keeps confidential search terms out of request logs", async () => {
    await lookup({ q: "confidential-lookup-marker" }).expect(200);
    expect(booted.logLines().join("\n")).not.toContain("confidential-lookup-marker");
  });
});
