import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { TENANT_TIME_ZONE } from "@newsaas/shared";
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
  shiftCalendarDays,
  startOfTenantDay,
  tenantCalendarDate,
} from "./report.period.js";
import { REPORT_HORIZON_INTEGER_MESSAGE, REPORT_HORIZON_RANGE_MESSAGE } from "./report.horizon.js";
import {
  REPORT_DUE_QUERY_INVALID_MESSAGE,
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  type ConsultationsResponse,
  type DewormingDueResponse,
  type NewPatientsResponse,
  type VaccinesDueResponse,
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
 * The Story's second half — the two DUE reports, `vaccines-due` and
 * `deworming-due` — lives in the same suite because it needs the same fixture and
 * the same boot: it reads the staff-entered `nextDueAt` of [[DEC-065]] against
 * today in the tenant zone, and the `clinicalDeworming` delegate it requires
 * exists in the in-memory boundary for it.
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
  createVaccination(
    owner: ReportTenant,
    options: {
      patientId: string;
      vaccine?: string;
      administeredAt?: Date;
      /** `null` mirrors "no due date was recorded" (DEC-065). */
      nextDueAt?: Date | null;
    }
  ): { id: string };
  createDeworming(
    owner: ReportTenant,
    options: {
      patientId: string;
      product?: string;
      administeredAt?: Date;
      nextDueAt?: Date | null;
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

  const createVaccination: VeterinaryFixture["createVaccination"] = (owner, options) => {
    const created = db.prisma.clinicalVaccination.create({
      data: {
        tenantId: owner.id,
        patientId: options.patientId,
        vaccine: options.vaccine ?? "Antirrábica",
        administeredAt: options.administeredAt ?? new Date("2025-06-01T12:00:00.000Z"),
        // `undefined` keeps the column NULL, which is the state the report must
        // omit rather than guess a due date for (DEC-065).
        nextDueAt: options.nextDueAt ?? null,
      },
    });
    return { id: created.id };
  };

  const createDeworming: VeterinaryFixture["createDeworming"] = (owner, options) => {
    const created = db.prisma.clinicalDeworming.create({
      data: {
        tenantId: owner.id,
        patientId: options.patientId,
        product: options.product ?? "Antiparasitario",
        administeredAt: options.administeredAt ?? new Date("2025-06-01T12:00:00.000Z"),
        nextDueAt: options.nextDueAt ?? null,
      },
    });
    return { id: created.id };
  };

  return { a, b, noPermission, createPatient, createEncounter, createVaccination, createDeworming };
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

/**
 * The due reports pivot on TODAY in the tenant zone, which is the live clock — an
 * assertion about "today" cannot be written, but the ROWS can be seeded relative
 * to it, which is what makes the reachable cases reachable on any run:
 *
 * - `ANCIENT_DUE_AT` is five years in the past: overdue forever, and the proof
 *   that the read has no lower bound.
 * - `UPCOMING_DUE_AT` is three days out: inside a 30-day default horizon and
 *   inside a 7-day one on any run.
 * - `BEYOND_HORIZON_DUE_AT` is four hundred days out: outside the bounded horizon
 *   on any run, so its absence is a predicate's work and not a coincidence.
 */
const TENANT_TODAY = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);
const UPCOMING_DUE_AT = startOfTenantDay(shiftCalendarDays(TENANT_TODAY, 3), TENANT_TIME_ZONE);
const BEYOND_HORIZON_DUE_AT = startOfTenantDay(
  shiftCalendarDays(TENANT_TODAY, 400),
  TENANT_TIME_ZONE
);
const ANCIENT_DUE_AT = new Date("2020-01-05T12:00:00.000Z");

/** The ids and names the due assertions read, captured while the rows are seeded. */
interface DueFixture {
  vaccinationOverduePatientId: string;
  vaccinationUpcomingPatientId: string;
  dewormingOverduePatientId: string;
  dewormingUpcomingPatientId: string;
}

describe("the veterinary reports (REP-006)", () => {
  let booted: BootedTestApp;
  let fixture: VeterinaryFixture;
  let due: DueFixture;

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

    // ---- The DUE rows ([[REP-006]] part 2) ---------------------------------
    // Every patient here already exists, so the period reports' figures above are
    // untouched: a vaccination record is not a registration and not a
    // consultation.
    //
    // The UPCOMING row is seeded BEFORE the overdue one on purpose: the report's
    // order is `nextDueAt` ascending, so the response must contradict the order
    // these rows were created in — otherwise the ordering assertion below would
    // be satisfied by insertion order and prove nothing.
    fixture.createVaccination(fixture.a, {
      patientId: patientInside.id,
      vaccine: "Séxtuple",
      nextDueAt: UPCOMING_DUE_AT,
    });
    fixture.createVaccination(fixture.a, {
      patientId: patientBefore.id,
      vaccine: "Antirrábica",
      administeredAt: new Date("2019-12-01T12:00:00.000Z"),
      nextDueAt: ANCIENT_DUE_AT,
    });
    // NO due date recorded: in neither the overdue nor the upcoming set.
    fixture.createVaccination(fixture.a, { patientId: patientInside.id, vaccine: "Tos ferina" });
    // Due FOUR HUNDRED days out: past the default horizon, and past the 7-day one.
    fixture.createVaccination(fixture.a, {
      patientId: patientBefore.id,
      vaccine: "Leptospira",
      nextDueAt: BEYOND_HORIZON_DUE_AT,
    });

    fixture.createDeworming(fixture.a, {
      patientId: patientLate.id,
      product: "Praziquantel",
      nextDueAt: UPCOMING_DUE_AT,
    });
    fixture.createDeworming(fixture.a, {
      patientId: patientInside.id,
      product: "Antiparasitario",
      administeredAt: new Date("2019-12-01T12:00:00.000Z"),
      nextDueAt: ANCIENT_DUE_AT,
    });
    // NO due date recorded.
    fixture.createDeworming(fixture.a, { patientId: patientInside.id, product: "Ivermectina" });
    // Due four hundred days out.
    fixture.createDeworming(fixture.a, {
      patientId: patientBefore.id,
      product: "Febendazol",
      nextDueAt: BEYOND_HORIZON_DUE_AT,
    });

    // Tenant B holds one of each, so a leak would be visible in both reports.
    fixture.createVaccination(fixture.b, {
      patientId: patientForeign.id,
      vaccine: "Antirrábica ajena",
      nextDueAt: ANCIENT_DUE_AT,
    });
    fixture.createDeworming(fixture.b, {
      patientId: patientForeign.id,
      product: "Antiparasitario ajeno",
      nextDueAt: ANCIENT_DUE_AT,
    });

    due = {
      vaccinationOverduePatientId: patientBefore.id,
      vaccinationUpcomingPatientId: patientInside.id,
      dewormingOverduePatientId: patientInside.id,
      dewormingUpcomingPatientId: patientLate.id,
    };
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

  describe("GET /reports/vaccines-due", () => {
    it("reports A's call list: overdue first, then upcoming, with the horizon echoed", async () => {
      // The pivot is TODAY in the tenant zone and the clock is live, so the date is
      // sampled on both sides of the request: the assertion is "one of the two days
      // around this request", which is exact without racing midnight.
      const before = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/vaccines-due")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      const after = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);

      const body = response.body as VaccinesDueResponse;
      expect([before, after]).toContain(body.asOfDate);
      expect(body.timeZone).toBe(TENANT_TIME_ZONE);
      // Omitted by the caller, so the echoed 30 is the DEFAULT it actually got.
      expect(body.horizonDays).toBe(30);
      expect(body.report).toBe("vaccines-due");
      // The five-year-old booster is the OVERDUE row and the three-days-out one is
      // UPCOMING: no lower bound, one bounded forward window, and overdue first.
      expect(body.overdueCount).toBe(1);
      expect(body.upcomingCount).toBe(1);
      expect(body.rows).toEqual([
        {
          patientId: due.vaccinationOverduePatientId,
          patientName: "Toby viejo",
          vaccine: "Antirrábica",
          administeredAt: "2019-12-01T12:00:00.000Z",
          nextDueAt: ANCIENT_DUE_AT.toISOString(),
          status: "overdue",
        },
        {
          patientId: due.vaccinationUpcomingPatientId,
          patientName: "Luna",
          vaccine: "Séxtuple",
          administeredAt: "2025-06-01T12:00:00.000Z",
          nextDueAt: UPCOMING_DUE_AT.toISOString(),
          status: "upcoming",
        },
      ]);
    });

    it("omits a NULL due date and a due date past the horizon, and honours an explicit one", async () => {
      // THE ROW-LEVEL PREDICATE PROOF: the fixture holds four of A's vaccinations
      // and the response has two. `?horizonDays=7` still contains the +3 day row
      // and still excludes the +400 day one, so the horizon really is applied and
      // the bounded window is not a coincidence of the seed dates.
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/vaccines-due?horizonDays=7")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as VaccinesDueResponse;
      expect(body.horizonDays).toBe(7);
      expect(body.overdueCount + body.upcomingCount).toBe(body.rows.length);
      expect(body.rows.map((row) => row.vaccine)).toEqual(["Antirrábica", "Séxtuple"]);
      // The recorded-nowhere due date and the far-future one are absent by NAME.
      expect(body.rows.map((row) => row.vaccine)).not.toContain("Tos ferina");
      expect(body.rows.map((row) => row.vaccine)).not.toContain("Leptospira");
    });

    it("refuses a malformed horizonDays and any period key", async () => {
      const cases: readonly { label: string; query: string; message: string }[] = [
        {
          label: "non-integer",
          query: "horizonDays=1.5",
          message: REPORT_HORIZON_INTEGER_MESSAGE,
        },
        {
          label: "not-a-number",
          query: "horizonDays=treinta",
          message: REPORT_HORIZON_INTEGER_MESSAGE,
        },
        { label: "zero", query: "horizonDays=0", message: REPORT_HORIZON_RANGE_MESSAGE },
        { label: "negative", query: "horizonDays=-5", message: REPORT_HORIZON_RANGE_MESSAGE },
        { label: "too long", query: "horizonDays=366", message: REPORT_HORIZON_RANGE_MESSAGE },
        // A due report has no period: `from` is REFUSED, never silently ignored.
        {
          label: "period key",
          query: "from=2026-06-01&to=2026-06-30",
          message: REPORT_DUE_QUERY_INVALID_MESSAGE,
        },
        {
          label: "unknown key",
          query: "horizonDays=7&tenantId=11111111-1111-4111-8111-111111111111",
          message: REPORT_DUE_QUERY_INVALID_MESSAGE,
        },
      ];

      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/vaccines-due?${scenario.query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("VALIDATION_FAILED");
        expect((response.body as ErrorDto).error.message, scenario.label).toBe(scenario.message);
      }
    });

    it("refuses without reports.read, before any row is read", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/vaccines-due")
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);

      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body)).not.toContain("overdueCount");
    });

    it("requires authentication at all", async () => {
      await supertest(booted.app.getHttpServer()).get("/reports/vaccines-due").expect(401);
    });
  });

  describe("GET /reports/deworming-due", () => {
    it("reports A's deworming call list with `product` and the horizon echoed", async () => {
      const before = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/deworming-due")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);
      const after = tenantCalendarDate(new Date(), TENANT_TIME_ZONE);

      const body = response.body as DewormingDueResponse;
      expect([before, after]).toContain(body.asOfDate);
      expect(body.timeZone).toBe(TENANT_TIME_ZONE);
      expect(body.horizonDays).toBe(30);
      expect(body.report).toBe("deworming-due");
      expect(body.overdueCount).toBe(1);
      expect(body.upcomingCount).toBe(1);
      expect(body.rows).toEqual([
        {
          patientId: due.dewormingOverduePatientId,
          patientName: "Luna",
          product: "Antiparasitario",
          administeredAt: "2019-12-01T12:00:00.000Z",
          nextDueAt: ANCIENT_DUE_AT.toISOString(),
          status: "overdue",
        },
        {
          patientId: due.dewormingUpcomingPatientId,
          patientName: "Michi",
          product: "Praziquantel",
          administeredAt: "2025-06-01T12:00:00.000Z",
          nextDueAt: UPCOMING_DUE_AT.toISOString(),
          status: "upcoming",
        },
      ]);
    });

    it("omits a NULL due date and a due date past the horizon", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/deworming-due?horizonDays=7")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as DewormingDueResponse;
      expect(body.rows.map((row) => row.product)).toEqual(["Antiparasitario", "Praziquantel"]);
      expect(body.rows.map((row) => row.product)).not.toContain("Ivermectina");
      expect(body.rows.map((row) => row.product)).not.toContain("Febendazol");
    });

    it("refuses a malformed horizonDays and any period key", async () => {
      const cases: readonly { label: string; query: string; message: string }[] = [
        {
          label: "non-integer",
          query: "horizonDays=2.5",
          message: REPORT_HORIZON_INTEGER_MESSAGE,
        },
        { label: "zero", query: "horizonDays=0", message: REPORT_HORIZON_RANGE_MESSAGE },
        { label: "too long", query: "horizonDays=366", message: REPORT_HORIZON_RANGE_MESSAGE },
        {
          label: "period key",
          query: "preset=today",
          message: REPORT_DUE_QUERY_INVALID_MESSAGE,
        },
      ];

      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/deworming-due?${scenario.query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("VALIDATION_FAILED");
        expect((response.body as ErrorDto).error.message, scenario.label).toBe(scenario.message);
      }
    });

    it("refuses without reports.read, before any row is read", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/deworming-due")
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);

      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body)).not.toContain("overdueCount");
    });

    it("requires authentication at all", async () => {
      await supertest(booted.app.getHttpServer()).get("/reports/deworming-due").expect(401);
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

    it("never reports another tenant's due vaccinations or patients", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get("/reports/vaccines-due")
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);

      const foreignBody = foreign.body as VaccinesDueResponse;
      // B's own row, named with B's own patient — and none of A's.
      expect(foreignBody.rows.map((row) => [row.vaccine, row.patientName, row.status])).toEqual([
        ["Antirrábica ajena", "Michi ajeno", "overdue"],
      ]);

      const local = await supertest(booted.app.getHttpServer())
        .get("/reports/vaccines-due")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const localBody = local.body as VaccinesDueResponse;
      // Two rows, not three: B's vaccination never crosses, and A's patients are
      // named from A's own patient table.
      expect(localBody.overdueCount).toBe(1);
      expect(localBody.upcomingCount).toBe(1);
      expect(JSON.stringify(localBody)).not.toContain("ajena");
    });

    it("never reports another tenant's due deworming records or patients", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get("/reports/deworming-due")
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);

      const foreignBody = foreign.body as DewormingDueResponse;
      expect(foreignBody.rows.map((row) => [row.product, row.patientName, row.status])).toEqual([
        ["Antiparasitario ajeno", "Michi ajeno", "overdue"],
      ]);

      const local = await supertest(booted.app.getHttpServer())
        .get("/reports/deworming-due")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const localBody = local.body as DewormingDueResponse;
      expect(localBody.overdueCount).toBe(1);
      expect(localBody.upcomingCount).toBe(1);
      expect(JSON.stringify(localBody)).not.toContain("ajena");
    });
  });
});
