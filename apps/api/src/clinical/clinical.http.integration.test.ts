import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import {
  seedClinicalHttp,
  type ClinicalHttpFixture,
  type ClinicalModel,
} from "../../test/support/clinical-http-fixture.js";
import { createIsolationDatabase } from "../../test/support/in-memory-database.js";
import { seedRbacActor, seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { REQUEST_ID_HEADER } from "../common/errors/request-id.js";
import { toClientSafeEncounter, type ClinicalEncounterResponse } from "./clinical.dto.js";
import { CLINICAL_PERMISSIONS } from "./clinical.permissions.js";

interface ErrorDto {
  error: { code: string };
}

/** Fixed UTC instant for record facts; the service stores it as a Date. */
const ISO = "2026-01-15T10:00:00.000Z";

/** Staff encounter surface (WU2A `ClinicalEncounterResponse`), no Prisma internals. */
const ENCOUNTER_STAFF_KEYS: readonly string[] = [
  "id",
  "tenantId",
  "patientId",
  "status",
  "version",
  "reasonForVisit",
  "anamnesis",
  "diagnosis",
  "treatmentPlan",
  "internalNotes",
  "clientSummary",
  "amendsEncounterId",
  "amendmentReason",
  "closedAt",
  "closedByUserProfileId",
  "createdAt",
  "updatedAt",
];

type Method = "get" | "post" | "put";

/** Granular clinical permission each route must require (short name). */
type ClinicalPermissionName = "read" | "create" | "update" | "close" | "amend";

interface RouteCase {
  readonly method: Method;
  readonly label: string;
  /**
   * Intended granular `vet.clinical.*` key. Pinned per route so a selective
   * role proves the route requires THIS key, not merely "some" permission.
   */
  readonly permission: ClinicalPermissionName;
  readonly path: (patientId: string, recordId: string) => string;
  /** A structurally valid body, so entitlement checks are reached past Zod. */
  readonly body: Record<string, unknown>;
}

/**
 * Valid update bodies for the five record-kind update routes. Used by the
 * foreign-aggregate isolation probe so both the nonexistent and foreign
 * references pass Zod and reach the tenant-scoped record lookup.
 */
const RECORD_UPDATE_BODY: Readonly<Record<string, Record<string, unknown>>> = {
  treatments: { description: "Foreign update attempt" },
  vaccinations: { vaccine: "Foreign update attempt" },
  deworming: { product: "Foreign update attempt" },
  studies: { result: "Foreign update attempt" },
  weights: { quantity: "99.999" },
};

const encounterPath = (patientId: string, suffix = ""): string =>
  `/patients/${patientId}/clinical/encounters${suffix}`;

const recordPath =
  (kind: string) =>
  (patientId: string, suffix = ""): string =>
    `/patients/${patientId}/clinical/${kind}${suffix}`;

/** Every shipped clinical route with a valid body and its intended permission. */
const ROUTE_CASES: readonly RouteCase[] = [
  {
    method: "get",
    label: "list encounters",
    permission: "read",
    path: (p) => encounterPath(p),
    body: {},
  },
  {
    method: "post",
    label: "create encounter",
    permission: "create",
    path: (p) => encounterPath(p),
    body: {},
  },
  {
    method: "get",
    label: "get encounter",
    permission: "read",
    path: (p, r) => encounterPath(p, `/${r}`),
    body: {},
  },
  {
    method: "put",
    label: "autosave encounter",
    permission: "update",
    path: (p, r) => encounterPath(p, `/${r}`),
    body: { version: 1 },
  },
  {
    method: "post",
    label: "close encounter",
    permission: "close",
    path: (p, r) => encounterPath(p, `/${r}/close`),
    body: { version: 1 },
  },
  {
    method: "post",
    label: "amend encounter",
    permission: "amend",
    path: (p, r) => encounterPath(p, `/${r}/amendments`),
    body: { reason: "correction" },
  },
  {
    method: "get",
    label: "list treatments",
    permission: "read",
    path: (p) => recordPath("treatments")(p),
    body: {},
  },
  {
    method: "post",
    label: "create treatment",
    permission: "create",
    path: (p) => recordPath("treatments")(p),
    body: { description: "Antibiotic", administeredAt: ISO },
  },
  {
    method: "put",
    label: "update treatment",
    permission: "update",
    path: (p, r) => recordPath("treatments")(p, `/${r}`),
    body: { description: "Antibiotic 2" },
  },
  {
    method: "get",
    label: "list vaccinations",
    permission: "read",
    path: (p) => recordPath("vaccinations")(p),
    body: {},
  },
  {
    method: "post",
    label: "create vaccination",
    permission: "create",
    path: (p) => recordPath("vaccinations")(p),
    body: { vaccine: "Rabies", administeredAt: ISO },
  },
  {
    method: "put",
    label: "update vaccination",
    permission: "update",
    path: (p, r) => recordPath("vaccinations")(p, `/${r}`),
    body: { vaccine: "Rabies booster" },
  },
  {
    method: "get",
    label: "list deworming",
    permission: "read",
    path: (p) => recordPath("deworming")(p),
    body: {},
  },
  {
    method: "post",
    label: "create deworming",
    permission: "create",
    path: (p) => recordPath("deworming")(p),
    body: { product: "Praziquantel", administeredAt: ISO },
  },
  {
    method: "put",
    label: "update deworming",
    permission: "update",
    path: (p, r) => recordPath("deworming")(p, `/${r}`),
    body: { product: "Praziquantel 2" },
  },
  {
    method: "get",
    label: "list studies",
    permission: "read",
    path: (p) => recordPath("studies")(p),
    body: {},
  },
  {
    method: "post",
    label: "create study",
    permission: "create",
    path: (p) => recordPath("studies")(p),
    body: { studyType: "X-Ray", performedAt: ISO, result: "Clear" },
  },
  {
    method: "put",
    label: "update study",
    permission: "update",
    path: (p, r) => recordPath("studies")(p, `/${r}`),
    body: { result: "Clear (reviewed)" },
  },
  {
    method: "get",
    label: "list weights",
    permission: "read",
    path: (p) => recordPath("weights")(p),
    body: {},
  },
  {
    method: "post",
    label: "create weight",
    permission: "create",
    path: (p) => recordPath("weights")(p),
    body: { quantity: "12.500", measuredAt: ISO },
  },
  {
    method: "put",
    label: "update weight",
    permission: "update",
    path: (p, r) => recordPath("weights")(p, `/${r}`),
    body: { quantity: "13.250" },
  },
];

interface RecordCase {
  readonly kind: string;
  readonly body: Record<string, unknown>;
  readonly keys: readonly string[];
}

const RECORD_CREATE_CASES: readonly RecordCase[] = [
  {
    kind: "treatments",
    body: { description: "Antibiotic", administeredAt: ISO, context: "post-op" },
    keys: [
      "id",
      "tenantId",
      "patientId",
      "description",
      "administeredAt",
      "context",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    kind: "vaccinations",
    body: { vaccine: "Rabies", administeredAt: ISO },
    keys: ["id", "tenantId", "patientId", "vaccine", "administeredAt", "createdAt", "updatedAt"],
  },
  {
    kind: "deworming",
    body: { product: "Praziquantel", administeredAt: ISO },
    keys: ["id", "tenantId", "patientId", "product", "administeredAt", "createdAt", "updatedAt"],
  },
  {
    kind: "studies",
    body: { studyType: "X-Ray", performedAt: ISO, result: "Clear" },
    keys: [
      "id",
      "tenantId",
      "patientId",
      "studyType",
      "performedAt",
      "result",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    kind: "weights",
    body: { quantity: "12.500", measuredAt: ISO },
    keys: ["id", "tenantId", "patientId", "quantity", "measuredAt", "createdAt", "updatedAt"],
  },
];

/**
 * EPIC-06 WU3 clinical HTTP boundary over the REAL guard chain (Auth ->
 * TenantActive -> Permission) and the WU3 clinical fixture. No route trusts a
 * route/body tenant id; a foreign Patient is masked as a byte-equivalent 404.
 */
describe("Clinical HTTP boundary (WU3)", () => {
  let booted: BootedTestApp;
  let fixture: ClinicalHttpFixture;

  beforeAll(async () => {
    const db = createIsolationDatabase();
    fixture = seedClinicalHttp(db);
    booted = await bootTestApp({ db });
  });

  afterAll(async () => {
    await booted.close();
  });

  const server = () => booted.app.getHttpServer();

  function send(
    cookie: string | undefined,
    route: RouteCase,
    patientId: string,
    recordId = randomUUID()
  ) {
    const request = supertest(server())[route.method](route.path(patientId, recordId));
    if (cookie) request.set("Cookie", cookie);
    return route.method === "get" ? request : request.send(route.body);
  }

  it("denies anonymous callers on every clinical route", async () => {
    for (const route of ROUTE_CASES) {
      const response = await send(undefined, route, randomUUID());
      expect(response.status, route.label).toBe(401);
      expect((response.body as ErrorDto).error.code, route.label).toBe("UNAUTHENTICATED");
    }
  });

  it("requires its granular clinical permission on every route", async () => {
    const permissionlessRole = seedRoleWithKeys(
      booted.db,
      `CLINICAL_PERMISSIONLESS_${fixture.patient.a.tenant.slug}`,
      "Clinical permission-less (fixture)",
      []
    );
    const permissionless = seedRbacActor(booted.db, {
      email: `clinical-permissionless-${fixture.patient.a.tenant.slug}@isolation.test`,
      tenantId: fixture.patient.a.tenant.id,
      roleId: permissionlessRole.role.id,
    });

    for (const route of ROUTE_CASES) {
      const response = await send(permissionless.cookie, route, randomUUID());
      expect(response.status, route.label).toBe(403);
      expect((response.body as ErrorDto).error.code, route.label).toBe("FORBIDDEN");
    }
  });

  it("requires each route's INTENDED granular permission at runtime, not any generic key", async () => {
    // A role holding exactly ONE clinical key is probed against every route:
    // its matching routes must pass the guard (never 403) while every other
    // route is denied. This is stronger than the permission-less sweep, which
    // only proves "some" permission is required.
    const permissionNames: readonly ClinicalPermissionName[] = [
      "read",
      "create",
      "update",
      "close",
      "amend",
    ];
    const patientId = randomUUID();

    for (const name of permissionNames) {
      const suffix = randomUUID().slice(0, 8);
      const role = seedRoleWithKeys(
        booted.db,
        `CLINICAL_${name.toUpperCase()}_${suffix}`,
        `Clinical ${name} (fixture)`,
        [CLINICAL_PERMISSIONS[name]]
      );
      const actor = seedRbacActor(booted.db, {
        email: `clinical-${name}-${suffix}@isolation.test`,
        tenantId: fixture.patient.a.tenant.id,
        roleId: role.role.id,
      });

      for (const route of ROUTE_CASES) {
        const response = await send(actor.cookie, route, patientId);
        if (route.permission === name) {
          // The amend route reaches the `SELECT ... FOR UPDATE` encounter lock,
          // which the in-memory boundary deliberately does not model; its exact
          // key is pinned by the route-contract metadata fence instead.
          if (name === "amend") continue;
          expect(response.status, `${name}: ${route.label}`).not.toBe(403);
        } else {
          expect(response.status, `${name}: ${route.label}`).toBe(403);
          expect((response.body as ErrorDto).error.code, `${name}: ${route.label}`).toBe(
            "FORBIDDEN"
          );
        }
      }
    }
  });

  it("rejects every provided route when the tenant lacks the veterinary entitlement", async () => {
    // Tenant C holds every clinical key but has no `veterinary` entitlement, so
    // the failure is the entitlement gate, never the permission guard.
    for (const route of ROUTE_CASES) {
      const response = await send(fixture.patient.c.actor.cookie, route, randomUUID());
      expect(response.status, route.label).toBe(403);
      expect((response.body as ErrorDto).error.code, route.label).toBe("FEATURE_NOT_ENTITLED");
    }
  });

  it("rejects a non-positive or non-numeric weight with 400 and persists nothing", async () => {
    const { patient } = fixture.patient.createPatientA();

    for (const quantity of ["0", "0.000", "-2.5", "abc", ""]) {
      const before = fixture.tables.clinicalWeight.size;
      const response = await supertest(server())
        .post(`/patients/${patient.id}/clinical/weights`)
        .set("Cookie", fixture.patient.a.actor.cookie)
        .send({ quantity, measuredAt: ISO });
      expect(response.status, quantity).toBe(400);
      expect((response.body as ErrorDto).error.code, quantity).toBe("VALIDATION_FAILED");
      expect(fixture.tables.clinicalWeight.size, quantity).toBe(before);
    }
  });

  it("masks a foreign Patient as a byte-equivalent 404 on read and create", async () => {
    const { patient: foreignPatient } = fixture.patient.createPatientB();
    const forbidden = [foreignPatient.id, fixture.patient.b.tenant.id];

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.patient.a.actor.cookie,
      nonexistentUrl: encounterPath(randomUUID()),
      foreignUrl: encounterPath(foreignPatient.id),
      forbiddenIdentifiers: forbidden,
    });

    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.patient.a.actor.cookie,
      method: "POST",
      body: {},
      nonexistentUrl: encounterPath(randomUUID()),
      foreignUrl: encounterPath(foreignPatient.id),
      forbiddenIdentifiers: forbidden,
    });
  });

  it("masks foreign clinical AGGREGATE UUIDs as byte-equivalent 404 and writes nothing", async () => {
    // Tenant B owns a Patient with one aggregate of every clinical kind; tenant
    // A references B's aggregate UUIDs through A's OWN Patient anchor, so the
    // foreign Patient anchor is ruled out and only aggregate-level tenant
    // scoping can produce the 404.
    const { patient: foreignPatient } = fixture.patient.createPatientB();
    const { patient: probePatient } = fixture.patient.createPatientA();
    const foreignCookie = fixture.patient.b.actor.cookie;

    const foreignModelByKind: Readonly<Record<string, ClinicalModel>> = {
      treatments: "clinicalTreatment",
      vaccinations: "clinicalVaccination",
      deworming: "clinicalDeworming",
      studies: "clinicalStudy",
      weights: "clinicalWeight",
    };

    const foreignEncounter = await supertest(server())
      .post(encounterPath(foreignPatient.id))
      .set("Cookie", foreignCookie)
      .send({ reasonForVisit: "Foreign visit" })
      .expect(201);
    const foreignEncounterId = (foreignEncounter.body as ClinicalEncounterResponse).id;

    const foreignRecordIds: Record<string, string> = {};
    for (const recordCase of RECORD_CREATE_CASES) {
      const created = await supertest(server())
        .post(`/patients/${foreignPatient.id}/clinical/${recordCase.kind}`)
        .set("Cookie", foreignCookie)
        .send(recordCase.body)
        .expect(201);
      foreignRecordIds[recordCase.kind] = (created.body as { id: string }).id;
    }

    const snapshot = (model: ClinicalModel, id: string) =>
      structuredClone(fixture.tables[model].get(id));
    const before: Record<string, unknown> = {
      encounter: snapshot("clinicalEncounter", foreignEncounterId),
    };
    for (const recordCase of RECORD_CREATE_CASES) {
      before[recordCase.kind] = snapshot(
        foreignModelByKind[recordCase.kind],
        foreignRecordIds[recordCase.kind]
      );
    }
    const auditsBefore = booted.db.tables.audits.size;

    // Encounter GET: A's Patient anchor, B's encounter UUID.
    await expectCrossTenant404({
      app: booted.app,
      cookie: fixture.patient.a.actor.cookie,
      nonexistentUrl: encounterPath(probePatient.id, `/${randomUUID()}`),
      foreignUrl: encounterPath(probePatient.id, `/${foreignEncounterId}`),
      forbiddenIdentifiers: [foreignEncounterId, fixture.patient.b.tenant.id],
    });

    // The five record UPDATE routes: A's Patient anchor, B's record UUID.
    for (const recordCase of RECORD_CREATE_CASES) {
      await expectCrossTenant404({
        app: booted.app,
        cookie: fixture.patient.a.actor.cookie,
        method: "PUT",
        body: RECORD_UPDATE_BODY[recordCase.kind],
        nonexistentUrl: recordPath(recordCase.kind)(probePatient.id, `/${randomUUID()}`),
        foreignUrl: recordPath(recordCase.kind)(
          probePatient.id,
          `/${foreignRecordIds[recordCase.kind]}`
        ),
        forbiddenIdentifiers: [foreignRecordIds[recordCase.kind], fixture.patient.b.tenant.id],
      });
    }

    // Nothing was written: every foreign aggregate is unchanged and no audit
    // row (the sole write side effect of a matched mutation) appeared.
    expect(snapshot("clinicalEncounter", foreignEncounterId)).toEqual(before.encounter);
    for (const recordCase of RECORD_CREATE_CASES) {
      expect(
        snapshot(foreignModelByKind[recordCase.kind], foreignRecordIds[recordCase.kind]),
        recordCase.kind
      ).toEqual(before[recordCase.kind]);
    }
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });

  it("creates a DRAFT encounter with only allowlisted staff fields and no client-safe internalNotes", async () => {
    const { patient } = fixture.patient.createPatientA();
    const requestId = randomUUID();
    const internalNotes = "CONFIDENTIAL staff-only note";

    const response = await supertest(server())
      .post(encounterPath(patient.id))
      .set("Cookie", fixture.patient.a.actor.cookie)
      .set(REQUEST_ID_HEADER, requestId)
      .send({
        reasonForVisit: "Limping",
        anamnesis: "Onset 2 days ago",
        diagnosis: "Soft tissue injury",
        treatmentPlan: "Rest and NSAIDs",
        internalNotes,
        clientSummary: "Rest for a week",
      })
      .expect(201);

    const body = response.body as ClinicalEncounterResponse;
    expect(Object.keys(body).sort()).toEqual([...ENCOUNTER_STAFF_KEYS].sort());
    expect(body).toMatchObject({
      tenantId: fixture.patient.a.tenant.id,
      patientId: patient.id,
      status: "DRAFT",
      version: 1,
    });
    expect(body).not.toHaveProperty("idempotencyKey");

    // Staff see internalNotes; the client-safe projection NEVER carries it.
    expect(body.internalNotes).toBe(internalNotes);
    expect(toClientSafeEncounter(body)).not.toHaveProperty("internalNotes");

    // Audit carries stable ids/field names only — never the CONFIDENTIAL text.
    const audit = [...booted.db.tables.audits.values()].find(
      (row) => row.action === "clinical_encounter.created" && row.targetId === body.id
    );
    expect(audit?.requestId).toBe(requestId);
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain(internalNotes);
  });

  it("creates each of the five specialized records with an allowlisted tenant-scoped DTO", async () => {
    const { patient } = fixture.patient.createPatientA();
    const weightsBefore = fixture.tables.clinicalWeight.size;

    for (const recordCase of RECORD_CREATE_CASES) {
      const response = await supertest(server())
        .post(`/patients/${patient.id}/clinical/${recordCase.kind}`)
        .set("Cookie", fixture.patient.a.actor.cookie)
        .send(recordCase.body);

      expect(response.status, recordCase.kind).toBe(201);
      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body).sort(), recordCase.kind).toEqual([...recordCase.keys].sort());
      expect(body.tenantId, recordCase.kind).toBe(fixture.patient.a.tenant.id);
      expect(body.patientId, recordCase.kind).toBe(patient.id);
    }

    // Exactly one weight was persisted by this test (other suites/tenants may
    // already hold rows, so assert the delta rather than a global count).
    expect(fixture.tables.clinicalWeight.size).toBe(weightsBefore + 1);
  });

  it("maps lifecycle conflicts to 409 CONFLICT", async () => {
    const { patient } = fixture.patient.createPatientA();

    const created = await supertest(server())
      .post(encounterPath(patient.id))
      .set("Cookie", fixture.patient.a.actor.cookie)
      .send({})
      .expect(201);
    const encounter = created.body as ClinicalEncounterResponse;

    const stale = await supertest(server())
      .put(encounterPath(patient.id, `/${encounter.id}`))
      .set("Cookie", fixture.patient.a.actor.cookie)
      .send({ version: 999, diagnosis: "Overwrite attempt" });
    expect(stale.status).toBe(409);
    expect((stale.body as ErrorDto).error.code).toBe("CONFLICT");

    await supertest(server())
      .post(encounterPath(patient.id, `/${encounter.id}/close`))
      .set("Cookie", fixture.patient.a.actor.cookie)
      .send({ version: 1 })
      .expect(201);

    const closedAgain = await supertest(server())
      .post(encounterPath(patient.id, `/${encounter.id}/close`))
      .set("Cookie", fixture.patient.a.actor.cookie)
      .send({ version: 2 });
    expect(closedAgain.status).toBe(409);
    expect((closedAgain.body as ErrorDto).error.code).toBe("CONFLICT");
  });
});
