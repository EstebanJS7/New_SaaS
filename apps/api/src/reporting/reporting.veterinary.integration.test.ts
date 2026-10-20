import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import type { IsolationDatabase } from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import {
  REPORT_PERIOD_DATE_FORMAT_MESSAGE,
  REPORT_PERIOD_MISSING_MESSAGE,
} from "./report.period.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  type ConsultationsResponse,
  type NewPatientsResponse,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";

/**
 * The two period-shaped veterinary reports of [[REP-006]] over the REAL guard
 * chain and the in-memory boundary: `GET /reports/consultations` and
 * `GET /reports/new-patients`.
 *
 * This is where the ROW-LEVEL boundaries are proven, because the fake actually
 * APPLIES the predicates the repository builds: the `status`/`closedAt` window of
 * the consultation read, the `createdAt` window of the patient read, the local
 * day each row is bucketed into, and tenant isolation across both.
 *
 * The range is always an explicit `from`/`to` pair: a preset resolves against the
 * live clock, and an assertion about "today" is not a test.
 *
 * What is deliberately NOT here: `vaccines-due` and `deworming-due`. They are the
 * Story's second half, they depend on the staff-entered `nextDueAt` of REP-001,
 * and their horizon logic is owned elsewhere — a fixture delegate for
 * `clinicalDeworming` is added with them, not before them.
 */

interface ErrorDto {
  error: { code: string; message: string };
}

interface ReportTenant {
  id: string;
  actor: RbacActor;
}

interface VeterinaryFixture {
  /** Probing tenant: holds `reports.read`, owns the clinical history counted. */
  a: ReportTenant;
  /** Foreign tenant: holds `reports.read` too, owns rows A must NEVER see. */
  b: ReportTenant;
  /** Member of A whose role holds NO report permission (403 probe). */
  noPermission: RbacActor;
  createPatient(
    owner: ReportTenant,
    options: { name: string; createdAt: Date; isActive?: boolean }
  ): { id: string };
  createEncounter(
    owner: ReportTenant,
    options: {
      patientId: string;
      status?: "DRAFT" | "CLOSED";
      closedAt?: Date | null;
      /** Overridable, because the draft must be CREATED inside the period. */
      createdAt?: Date;
      amendsEncounterId?: string | null;
    }
  ): { id: string };
}

/**
 * Two tenants with the same `reports.read` grant and one actor without it. No
 * entitlement is seeded for any of them, which is the point: [[DEC-062]] leaves
 * the report surface ungated by feature code.
 */
function seedVeterinary(db: IsolationDatabase): VeterinaryFixture {
  const suffix = randomUUID().slice(0, 8);
  // One global taxonomy row is enough: the reports read no species at all.
  const species = db.prisma.species.create({
    data: { code: `sp-${suffix}`, name: `Species ${suffix}` },
  });

  function seedTenant(letter: string): ReportTenant {
    const tenant = db.prisma.tenant.create({
      data: { slug: `vet-${letter}-${suffix}`, name: `Vet ${letter.toUpperCase()}` },
    });
    const role = seedRoleWithKeys(db, `VET_${letter.toUpperCase()}_${suffix}`, "Vet", [
      REPORTING_PERMISSIONS.read,
    ]);
    const actor = seedRbacActor(db, {
      email: `vet-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { id: tenant.id, actor };
  }

  const a = seedTenant("a");
  const b = seedTenant("b");

  const noPermissionRole = seedRoleWithKeys(db, `VET_NONE_${suffix}`, "Vet none", []);
  const noPermission = seedRbacActor(db, {
    email: `vet-none-${suffix}@isolation.test`,
    tenantId: a.id,
    roleId: noPermissionRole.role.id,
  });

  const createPatient: VeterinaryFixture["createPatient"] = (owner, options) => {
    const created = db.prisma.patient.create({
      data: {
        tenantId: owner.id,
        name: options.name,
        speciesId: species.id,
        breedId: null,
        sex: "UNKNOWN",
        birthDate: null,
        isActive: options.isActive ?? true,
      },
    });
    const stored = db.tables.patients.get(created.id);
    if (stored === undefined) {
      throw new Error("The in-memory patient row was not stored.");
    }
    // `created_at` IS the registration instant the report dates the patient by, so
    // the fixture sets it and the report reads that column.
    stored.createdAt = options.createdAt;
    return { id: created.id };
  };

  const createEncounter: VeterinaryFixture["createEncounter"] = (owner, options) => {
    const created = db.prisma.clinicalEncounter.create({
      data: {
        tenantId: owner.id,
        patientId: options.patientId,
        status: options.status ?? "DRAFT",
        closedAt: options.closedAt ?? null,
        amendsEncounterId: options.amendsEncounterId ?? null,
      },
    });
    if (options.createdAt !== undefined) {
      const stored = db.tables.clinicalEncounters.get(created.id);
      if (stored === undefined) {
        throw new Error("The in-memory clinical encounter row was not stored.");
      }
      // Deliberately separate from `closedAt`: the report dates an encounter by its
      // CLOSE, so the draft-ness and the creation instant must be settable apart.
      stored.createdAt = options.createdAt;
    }
    return { id: created.id };
  };

  return { a, b, noPermission, createPatient, createEncounter };
}

/**
 * The range every assertion uses: 2026-06-10 through 2026-06-11 in Asunción
 * (`-03`), i.e. the half-open instant range
 * `[2026-06-10T03:00Z, 2026-06-12T03:00Z)`.
 */
const PERIOD_QUERY = "from=2026-06-10&to=2026-06-11";
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-12T03:00:00.000Z";

const EXPECTED_PERIOD_ECHO = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: FROM_INSTANT,
  toInstant: TO_INSTANT,
} as const;

describe("the veterinary reports (REP-006)", () => {
  let booted: BootedTestApp;
  let fixture: VeterinaryFixture;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedVeterinary(booted.db);

    // ---- Tenant A: the clinical history the reports count -------------------
    // Registered BEFORE the period, so `new-patients` must not count him. He is
    // still the patient behind the oldest consultation, which is the point: the
    // patient's registration date and the encounter's close date are different
    // facts.
    const patientBefore = fixture.createPatient(fixture.a, {
      name: "Toby viejo",
      createdAt: new Date("2026-06-05T12:00:00.000Z"),
    });
    // Registered INSIDE the period, on the local 10th.
    const patientInside = fixture.createPatient(fixture.a, {
      name: "Luna",
      createdAt: new Date("2026-06-10T04:00:00.000Z"),
    });
    // Registered INSIDE the period but on the UTC 11th at 02:00Z = 23:00 local on
    // the 10th: the row that proves the bucket is the LOCAL day.
    const patientLate = fixture.createPatient(fixture.a, {
      name: "Michi",
      createdAt: new Date("2026-06-11T02:00:00.000Z"),
    });
    // Registered inside the period and DEACTIVATED since: still new then.
    const patientDeactivated = fixture.createPatient(fixture.a, {
      name: "Rex",
      createdAt: new Date("2026-06-11T15:00:00.000Z"),
      isActive: false,
    });
    // Registered EXACTLY at the exclusive end of the period: the next period's
    // first registration, never this one's.
    fixture.createPatient(fixture.a, {
      name: "Nube",
      createdAt: new Date(TO_INSTANT),
    });

    // A consultation DRAFTED before the period and CLOSED inside it: `closedAt` is
    // the business instant, so it is this period's consultation.
    const consultationOld = fixture.createEncounter(fixture.a, {
      patientId: patientBefore.id,
      status: "CLOSED",
      closedAt: new Date("2026-06-10T14:00:00.000Z"),
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    // An AMENDMENT of that consultation: a NEW closed row that points at the
    // original. It must be counted as an amendment and never as a consultation.
    fixture.createEncounter(fixture.a, {
      patientId: patientBefore.id,
      status: "CLOSED",
      closedAt: new Date("2026-06-11T16:00:00.000Z"),
      amendsEncounterId: consultationOld.id,
    });
    // CLOSED at 02:00Z on the UTC 11th = 23:00 local on the 10th.
    fixture.createEncounter(fixture.a, {
      patientId: patientInside.id,
      status: "CLOSED",
      closedAt: new Date("2026-06-11T02:00:00.000Z"),
    });
    // CLOSED at 01:00Z on the UTC 12th = 22:00 local on the 11th.
    fixture.createEncounter(fixture.a, {
      patientId: patientLate.id,
      status: "CLOSED",
      closedAt: new Date("2026-06-12T01:00:00.000Z"),
    });
    // A DRAFT whose CREATION instant is inside the period: never a consultation.
    fixture.createEncounter(fixture.a, {
      patientId: patientDeactivated.id,
      status: "DRAFT",
      createdAt: new Date("2026-06-10T15:00:00.000Z"),
    });
    // CLOSED OUTSIDE the narrow period: it belongs to 2026-06-13's report.
    fixture.createEncounter(fixture.a, {
      patientId: patientDeactivated.id,
      status: "CLOSED",
      closedAt: new Date("2026-06-13T14:00:00.000Z"),
    });

    // ---- Tenant B: the rows A must never see --------------------------------
    const patientForeign = fixture.createPatient(fixture.b, {
      name: "Michi ajeno",
      createdAt: new Date("2026-06-10T14:00:00.000Z"),
    });
    fixture.createEncounter(fixture.b, {
      patientId: patientForeign.id,
      status: "CLOSED",
      closedAt: new Date("2026-06-10T15:00:00.000Z"),
    });
  });

  afterAll(async () => {
    await booted.close();
  });

  describe("GET /reports/consultations", () => {
    it("reports the period's consultations with amendments counted SEPARATELY", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/consultations?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as ConsultationsResponse;
      expect(body).toEqual({
        report: "consultations",
        period: EXPECTED_PERIOD_ECHO,
        // Three consultations closed in the period; the amendment is the fourth
        // CLOSED row and it is NOT one of them.
        consultationCount: 3,
        amendmentCount: 1,
        rows: [
          // Two consultations closed on the local 10th — including the one closed
          // at 02:00Z on the UTC 11th, which is 23:00 local on the 10th.
          { bucketDate: "2026-06-10", consultationCount: 2 },
          // One closed at 01:00Z on the UTC 12th, which is 22:00 local on the 11th.
          { bucketDate: "2026-06-11", consultationCount: 1 },
        ],
      });
    });

    it("excludes a DRAFT created inside the period and an encounter closed outside it", async () => {
      // The wide period contains every CLOSED non-amendment encounter of tenant A —
      // four of them — plus one DRAFT whose `createdAt` is INSIDE the period. If the
      // report cut on `createdAt` or forgot the status predicate, the count would be
      // five.
      const wide = await supertest(booted.app.getHttpServer())
        .get("/reports/consultations?from=2026-06-01&to=2026-06-30")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const wideBody = wide.body as ConsultationsResponse;
      expect(wideBody.consultationCount).toBe(4);
      expect(wideBody.amendmentCount).toBe(1);

      // And the encounter closed OUTSIDE the narrow period is not hidden from the
      // report — it is in the period it belongs to. Two consecutive periods
      // partition the activity instead of one of them silently losing a row.
      const nextDay = await supertest(booted.app.getHttpServer())
        .get("/reports/consultations?from=2026-06-13&to=2026-06-13")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const nextDayBody = nextDay.body as ConsultationsResponse;
      expect(nextDayBody.consultationCount).toBe(1);
      expect(nextDayBody.rows).toEqual([{ bucketDate: "2026-06-13", consultationCount: 1 }]);
    });

    it("never carries clinical free text or patient identity", async () => {
      // The read selects three columns and the response publishes two counts, so
      // nothing CONFIDENTIAL (Patient.name) or RESTRICTED (internalNotes) can cross
      // this boundary — asserted on the wire, not merely in the type.
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/consultations?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const serialized = JSON.stringify(response.body);
      for (const forbidden of [
        "internalNotes",
        "diagnosis",
        "anamnesis",
        "treatmentPlan",
        "reasonForVisit",
        "clientSummary",
        "patientId",
        "patientName",
        "Rex",
        "Michi",
        "currency",
      ]) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }
    });

    it("refuses a malformed period with the same stable messages as every report", async () => {
      const cases: readonly { label: string; query: string; message: string }[] = [
        { label: "no period", query: "", message: REPORT_PERIOD_MISSING_MESSAGE },
        {
          label: "malformed date",
          query: "from=2026-02-30&to=2026-03-01",
          message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
        },
        {
          label: "unknown key",
          query: `${PERIOD_QUERY}&tenantId=11111111-1111-4111-8111-111111111111`,
          message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
        },
      ];

      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/consultations?${scenario.query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("VALIDATION_FAILED");
        expect((response.body as ErrorDto).error.message, scenario.label).toBe(scenario.message);
      }
    });

    it("refuses without reports.read, before any row is read", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/consultations?${PERIOD_QUERY}`)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);

      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body)).not.toContain("consultationCount");
    });

    it("requires authentication at all", async () => {
      await supertest(booted.app.getHttpServer())
        .get(`/reports/consultations?${PERIOD_QUERY}`)
        .expect(401);
    });
  });

  describe("GET /reports/new-patients", () => {
    it("reports the patients registered in the period, deactivated ones included", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/new-patients?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as NewPatientsResponse;
      expect(body).toEqual({
        report: "new-patients",
        period: EXPECTED_PERIOD_ECHO,
        // Three registrations in the period. One of them (`Rex`) has been
        // deactivated since and still counts: it WAS new then, and deactivation is
        // soft — the fact is not retracted.
        newPatientCount: 3,
        rows: [
          // 04:00Z on the 10th and 02:00Z on the 11th (23:00 local on the 10th).
          { bucketDate: "2026-06-10", count: 2 },
          { bucketDate: "2026-06-11", count: 1 },
        ],
      });
      // The CONFIDENTIAL identity the read never selects: a headcount needs no name.
      expect(JSON.stringify(body)).not.toContain("Rex");
      expect(JSON.stringify(body)).not.toContain("Michi");
      expect(Object.keys(body)).not.toContain("currency");
    });

    it("excludes a patient registered outside the period, including at the exclusive end", async () => {
      // Tenant A also holds a patient registered BEFORE the period and one registered
      // EXACTLY at `toInstant` (the first instant of the day after `toDate`, which is
      // the exclusive end of a half-open range). Neither appears above; the second is
      // the boundary assertion, and it appears in the NEXT period's report.
      const boundary = await supertest(booted.app.getHttpServer())
        .get("/reports/new-patients?from=2026-06-12&to=2026-06-12")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const boundaryBody = boundary.body as NewPatientsResponse;
      expect(boundaryBody.newPatientCount).toBe(1);
      expect(boundaryBody.rows).toEqual([{ bucketDate: "2026-06-12", count: 1 }]);

      // A period older than every registration is an empty ANSWER, not an error.
      const empty = await supertest(booted.app.getHttpServer())
        .get("/reports/new-patients?from=2026-05-01&to=2026-05-02")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      expect(empty.body).toEqual({
        report: "new-patients",
        period: {
          preset: null,
          fromDate: "2026-05-01",
          toDate: "2026-05-02",
          timeZone: "America/Asuncion",
          fromInstant: "2026-05-01T03:00:00.000Z",
          toInstant: "2026-05-03T03:00:00.000Z",
        },
        newPatientCount: 0,
        rows: [],
      });
    });

    it("refuses a malformed period with the same stable messages as every report", async () => {
      const cases: readonly { label: string; query: string; message: string }[] = [
        { label: "no period", query: "", message: REPORT_PERIOD_MISSING_MESSAGE },
        {
          label: "malformed date",
          query: "from=2026-13-01&to=2026-13-02",
          message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
        },
        {
          label: "unknown key",
          query: `${PERIOD_QUERY}&patientId=11111111-1111-4111-8111-111111111111`,
          message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
        },
      ];

      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/new-patients?${scenario.query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("VALIDATION_FAILED");
        expect((response.body as ErrorDto).error.message, scenario.label).toBe(scenario.message);
      }
    });

    it("refuses without reports.read, before any row is read", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/new-patients?${PERIOD_QUERY}`)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);

      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body)).not.toContain("newPatientCount");
    });

    it("requires authentication at all", async () => {
      await supertest(booted.app.getHttpServer())
        .get(`/reports/new-patients?${PERIOD_QUERY}`)
        .expect(401);
    });
  });

  describe("tenant isolation", () => {
    it("never counts another tenant's consultations", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/reports/consultations?${PERIOD_QUERY}`)
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);

      const foreignBody = foreign.body as ConsultationsResponse;
      // Tenant B closed exactly one consultation in the period and amended nothing.
      expect(foreignBody.consultationCount).toBe(1);
      expect(foreignBody.amendmentCount).toBe(0);
      expect(foreignBody.rows).toEqual([{ bucketDate: "2026-06-10", consultationCount: 1 }]);

      const local = await supertest(booted.app.getHttpServer())
        .get(`/reports/consultations?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      // A's own figures are untouched by B's rows: three and one, not four and one.
      const localBody = local.body as ConsultationsResponse;
      expect(localBody.consultationCount).toBe(3);
      expect(localBody.amendmentCount).toBe(1);
    });

    it("never counts another tenant's patients", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/reports/new-patients?${PERIOD_QUERY}`)
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);

      const foreignBody = foreign.body as NewPatientsResponse;
      expect(foreignBody.newPatientCount).toBe(1);

      const local = await supertest(booted.app.getHttpServer())
        .get(`/reports/new-patients?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const localBody = local.body as NewPatientsResponse;
      // Three, not four: B's registration never crosses.
      expect(localBody.newPatientCount).toBe(3);
    });
  });
});
