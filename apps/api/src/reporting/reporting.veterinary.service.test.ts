import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  REPORT_CLOSED_ENCOUNTER_ROW_LIMIT,
  REPORT_CLOSED_ENCOUNTER_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_NEW_PATIENT_ROW_LIMIT,
  REPORT_NEW_PATIENT_ROW_LIMIT_EXCEEDED_MESSAGE,
  ReportRepository,
  reportClosedEncounterMissingClosedAtMessage,
  type ReportingReadPrisma,
  type ReportClosedEncounterReadRow,
  type ReportPatientCreatedRow,
} from "./reporting.repository.js";
import { REPORT_READ_FORBIDDEN_MESSAGE, ReportingService } from "./reporting.service.js";
import type {
  ConsultationDayRowDto,
  ConsultationsResponse,
  NewPatientDayRowDto,
  NewPatientsResponse,
} from "./reporting.dto.js";

/**
 * The two period-shaped veterinary reports of [[REP-006]] at the SERVICE
 * boundary: the amendment-versus-consultation rule, the local-day buckets, the
 * soft-deactivation fact, every empty answer and every refusal.
 *
 * The pattern is the landed suites: the REAL repository over stub delegates, so
 * the query the report builds (predicate, order, `take`, `select`) is the shipped
 * one and is asserted as an ARGUMENT.
 *
 * WHAT A STUB CANNOT PROVE, and where it is proven instead: a stub returns
 * whatever it is given, so it cannot show that a `DRAFT` or an encounter closed
 * outside the period is ABSENT from the payload — that is the query's job, and
 * the query is asserted here. The row-level truth (a draft inside the period, an
 * encounter created outside and closed inside, a deactivated patient, tenant
 * isolation) is proven in `reporting.veterinary.integration.test.ts`, where the
 * in-memory boundary actually APPLIES the predicates.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Asunción is `-03`, so 2026-06-10 00:00 local is 2026-06-10T03:00:00Z. */
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-12T03:00:00.000Z";

/** Two local days, so a bucket and a UTC day can be told apart. */
const TWO_DAY_PERIOD = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: FROM_INSTANT,
  toInstant: TO_INSTANT,
} as const;

const PERIOD_QUERY = { from: "2026-06-10", to: "2026-06-11" } as const;

const CONSULTATION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONSULTATION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONSULTATION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AMENDMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNCLOSED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

interface Harness {
  service: ReportingService;
  /** Every `clinicalEncounter.findMany` arg the repository built, in call order. */
  encounterQueries: Prisma.ClinicalEncounterFindManyArgs[];
  /** Every `patient.findMany` arg the repository built, in call order. */
  patientQueries: Prisma.PatientFindManyArgs[];
}

/**
 * The real repository over stub veterinary delegates, a stub permission resolver
 * and a pinned clock.
 *
 * The settings stub THROWS: both reports are COUNTS, so neither response carries
 * a `currency` and a `sales` settings read here would be a currency resolved for
 * an answer that must not contain one.
 */
function harness(
  options: {
    encounters?: ReportClosedEncounterReadRow[];
    patients?: ReportPatientCreatedRow[];
    permissions?: readonly string[];
    now?: Date;
  } = {}
): Harness {
  const encounterQueries: Prisma.ClinicalEncounterFindManyArgs[] = [];
  const patientQueries: Prisma.PatientFindManyArgs[] = [];

  const prisma: ReportingReadPrisma = {
    // Every OTHER report's reads are unreachable from here and vice versa: each
    // stub THROWS instead of answering `[]`, so a case that reached one fails
    // loudly rather than silently aggregating an empty set.
    sale: {
      findMany: () => {
        throw new Error("The veterinary reports must not read sales.");
      },
    },
    catalogItem: {
      findMany: () => {
        throw new Error("The veterinary reports must not read catalog items.");
      },
      findFirst: () => {
        throw new Error("The veterinary reports must not read catalog items.");
      },
    },
    cashSession: {
      findMany: () => {
        throw new Error("The veterinary reports must not read cash sessions.");
      },
    },
    cashMovement: {
      findMany: () => {
        throw new Error("The veterinary reports must not read cash movements.");
      },
    },
    purchase: {
      findMany: () => {
        throw new Error("The veterinary reports must not read purchases.");
      },
    },
    supplier: {
      findMany: () => {
        throw new Error("The veterinary reports must not read suppliers.");
      },
    },
    stockBalance: {
      findMany: () => {
        throw new Error("The veterinary reports must not read stock balances.");
      },
    },
    stockMovement: {
      findMany: () => {
        throw new Error("The veterinary reports must not read stock movements.");
      },
    },
    clinicalEncounter: {
      findMany: (args) => {
        encounterQueries.push(args);
        return Promise.resolve(options.encounters ?? []);
      },
    },
    // The two DUE reads are unreachable from the period-shaped reports: each stub
    // THROWS instead of answering `[]`, so a case that reached one fails loudly
    // rather than silently aggregating an empty set.
    clinicalVaccination: {
      findMany: () => {
        throw new Error("The period-shaped veterinary reports must not read vaccinations.");
      },
    },
    clinicalDeworming: {
      findMany: () => {
        throw new Error("The period-shaped veterinary reports must not read deworming records.");
      },
    },
    patient: {
      findMany: (args) => {
        patientQueries.push(args);
        return Promise.resolve(options.patients ?? []);
      },
    },
  };

  const requestContext = {
    requireTenantId: () => TENANT,
  } as unknown as RequestContextService;
  const permissionResolver = {
    resolveForActiveRequest: () => Promise.resolve(new Set(options.permissions ?? [])),
  } as unknown as PermissionResolver;
  const settings = {
    get: () => {
      throw new Error("A count-only report must not resolve a currency.");
    },
  } as unknown as TenantSettingsService;

  const repository = new ReportRepository(prisma, requestContext);
  const now = options.now ?? new Date("2026-06-10T12:00:00.000Z");
  const service = new ReportingService(repository, settings, permissionResolver, () => now);
  return { service, encounterQueries, patientQueries };
}

const READ_PERMISSION = [REPORTING_PERMISSIONS.read];

/** One CLOSED encounter as the minimal projection returns it. */
function closedEncounter(options: {
  id: string;
  closedAt: Date | string | null;
  /** Non-NULL marks an AMENDMENT: a new closed row correcting an earlier one. */
  amendsEncounterId?: string | null;
}): ReportClosedEncounterReadRow {
  return {
    id: options.id,
    closedAt: options.closedAt === null ? null : new Date(options.closedAt),
    amendsEncounterId: options.amendsEncounterId ?? null,
  };
}

/** One registered patient as the minimal projection returns it. */
function createdPatient(options: {
  id: string;
  createdAt: Date | string;
}): ReportPatientCreatedRow {
  return { id: options.id, createdAt: new Date(options.createdAt) };
}

describe("ReportingService · the consultations report ([[REP-006]])", () => {
  it("counts an amendment as an amendment and NEVER as a second consultation", async () => {
    // THE RULE OF THE REPORT. The amendment is a NEW CLOSED row that points at the
    // original through `amendsEncounterId`; the original is never mutated
    // (`Clinical.md`). Counting both would report the practice as busier than it
    // was, so the correction is separated instead of being added.
    const { service } = harness({
      permissions: READ_PERMISSION,
      encounters: [
        closedEncounter({ id: CONSULTATION_A, closedAt: "2026-06-10T14:00:00.000Z" }),
        closedEncounter({
          id: AMENDMENT,
          closedAt: "2026-06-10T15:00:00.000Z",
          amendsEncounterId: CONSULTATION_A,
        }),
      ],
    });

    const response = await service.consultations(PERIOD_QUERY);

    expect(response.consultationCount).toBe(1);
    expect(response.amendmentCount).toBe(1);
    // The bucket series is CONSULTATIONS: the amendment contributes nothing to
    // `2026-06-10` on top of the consultation it corrects.
    expect(response.rows).toEqual([{ bucketDate: "2026-06-10", consultationCount: 1 }]);
  });

  it("keeps amendments out of the buckets even when they are the only rows of the day", async () => {
    // An amendment closed on a day with no consultation would, if it leaked into
    // the series, invent a bucket carrying zero consultations — a row that claims
    // a day of activity the report did not measure.
    const { service } = harness({
      permissions: READ_PERMISSION,
      encounters: [
        closedEncounter({
          id: AMENDMENT,
          closedAt: "2026-06-11T14:00:00.000Z",
          amendsEncounterId: CONSULTATION_A,
        }),
      ],
    });

    const response = await service.consultations(PERIOD_QUERY);

    expect(response.consultationCount).toBe(0);
    expect(response.amendmentCount).toBe(1);
    expect(response.rows).toEqual([]);
  });

  it("buckets by the LOCAL day of closedAt: 02:00Z is the PREVIOUS local day", async () => {
    // Asunción is `-03`, so 2026-06-11T02:00Z is 2026-06-10 23:00 local. A report
    // that bucketed in UTC would file this consultation under the 11th, and a
    // practice reading its own night shift would see it on the wrong day. This is
    // the assertion that proves `tenantCalendarDate` is used and not a second
    // conversion.
    const { service } = harness({
      permissions: READ_PERMISSION,
      encounters: [
        closedEncounter({ id: CONSULTATION_A, closedAt: "2026-06-11T02:00:00.000Z" }),
        closedEncounter({ id: CONSULTATION_B, closedAt: "2026-06-11T03:00:00.000Z" }),
        closedEncounter({ id: CONSULTATION_C, closedAt: "2026-06-12T02:30:00.000Z" }),
      ],
    });

    const response = await service.consultations(PERIOD_QUERY);

    expect(response.rows).toEqual([
      { bucketDate: "2026-06-10", consultationCount: 1 },
      { bucketDate: "2026-06-11", consultationCount: 2 },
    ]);
    expect(response.consultationCount).toBe(3);
  });

  it("orders the buckets ascending however the read returns them", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      // Scrambled on purpose: the row order is the response contract's, not the
      // read's and not a map's insertion order.
      encounters: [
        closedEncounter({ id: CONSULTATION_C, closedAt: "2026-06-11T20:00:00.000Z" }),
        closedEncounter({ id: CONSULTATION_A, closedAt: "2026-06-10T14:00:00.000Z" }),
      ],
    });

    const response = await service.consultations(PERIOD_QUERY);

    expect(response.rows.map((row) => row.bucketDate)).toEqual(["2026-06-10", "2026-06-11"]);
  });

  it("reads ONLY closed encounters, by closedAt, tenant-scoped and half-open", async () => {
    // `status: CLOSED` is the predicate and not a later filter, so a DRAFT inside
    // the period is excluded at the query; `closedAt` is the period predicate and
    // `createdAt` is deliberately absent from the `where`, so an encounter drafted
    // in March and closed in April is APRIL's consultation. The stub cannot drop a
    // row, so the row-level proof of both lives in the in-memory integration suite.
    const { service, encounterQueries } = harness({ permissions: READ_PERMISSION });

    await service.consultations(PERIOD_QUERY);

    expect(encounterQueries).toHaveLength(1);
    expect(encounterQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        status: "CLOSED",
        closedAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      orderBy: [{ closedAt: "asc" }, { id: "asc" }],
    });
    // The predicate is EXACTLY these three keys: no `createdAt`, no `updatedAt`,
    // no patient filter — the report reads the TENANT's consultations.
    expect(Object.keys(encounterQueries[0]?.where ?? {}).sort()).toEqual([
      "closedAt",
      "status",
      "tenantId",
    ]);
    // One row past the cap, so an over-limit period is REFUSED rather than cut.
    expect(encounterQueries[0]?.take).toBe(REPORT_CLOSED_ENCOUNTER_ROW_LIMIT + 1);
  });

  it("selects the three columns it needs and NO clinical free text", async () => {
    // The `select` is the data-classification boundary (PRD §41), so it is pinned
    // here as well as in the response: a read that loaded `internalNotes` (RESTRICTED)
    // or the diagnosis narrative would have to change this assertion first.
    const { service, encounterQueries } = harness({ permissions: READ_PERMISSION });

    await service.consultations(PERIOD_QUERY);

    expect(encounterQueries[0]?.select).toEqual({
      id: true,
      closedAt: true,
      amendsEncounterId: true,
    });
  });

  it("returns an empty answer for an empty period, not an error", async () => {
    const { service } = harness({ permissions: READ_PERMISSION });

    const response = await service.consultations(PERIOD_QUERY);

    expect(response).toEqual({
      report: "consultations",
      period: TWO_DAY_PERIOD,
      consultationCount: 0,
      amendmentCount: 0,
      rows: [],
    });
  });

  it("refuses LOUDLY when a CLOSED row carries no close instant, naming the id", async () => {
    // Unreachable by construction: the close command writes `closed_at` in the same
    // transition that sets `CLOSED`, and a closed encounter is immutable. It is
    // asserted rather than papered over because the alternatives are both wrong —
    // inventing a day, or silently dropping a consultation the practice closed.
    const { service } = harness({
      permissions: READ_PERMISSION,
      encounters: [
        closedEncounter({ id: CONSULTATION_A, closedAt: "2026-06-10T14:00:00.000Z" }),
        closedEncounter({ id: UNCLOSED, closedAt: null }),
      ],
    });

    const refusal = service.consultations(PERIOD_QUERY);
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportClosedEncounterMissingClosedAtMessage(UNCLOSED),
    });
    await expect(refusal).rejects.toThrow(UNCLOSED);
  });

  it("refuses a period over the cap instead of reporting a truncated activity count", async () => {
    const encounters = Array.from(
      { length: REPORT_CLOSED_ENCOUNTER_ROW_LIMIT + 1 },
      (_unused, index) => closedEncounter({ id: `encounter-${index}`, closedAt: FROM_INSTANT })
    );
    const { service } = harness({ permissions: READ_PERMISSION, encounters });

    await expect(service.consultations(PERIOD_QUERY)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_CLOSED_ENCOUNTER_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, encounterQueries, patientQueries } = harness({
      permissions: ["sales.read"],
    });

    await expect(service.consultations({ preset: "today" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(encounterQueries).toEqual([]);
    expect(patientQueries).toEqual([]);
  });

  it("carries counts (not decimals), no currency and exactly the declared keys", async () => {
    // The response type is pinned KEY BY KEY: a `currency`, a `patientId` or a
    // clinical free-text field added to `ConsultationsResponse` fails to compile
    // here before it can fail a review.
    const everyResponseKey: Record<keyof ConsultationsResponse, true> = {
      report: true,
      period: true,
      consultationCount: true,
      amendmentCount: true,
      rows: true,
    };
    const everyRowKey: Record<keyof ConsultationDayRowDto, true> = {
      bucketDate: true,
      consultationCount: true,
    };

    const { service } = harness({
      permissions: READ_PERMISSION,
      encounters: [
        closedEncounter({ id: CONSULTATION_A, closedAt: "2026-06-10T14:00:00.000Z" }),
        closedEncounter({
          id: AMENDMENT,
          closedAt: "2026-06-10T15:00:00.000Z",
          amendsEncounterId: CONSULTATION_A,
        }),
      ],
    });

    const response = await service.consultations(PERIOD_QUERY);

    expect(Object.keys(response).sort()).toEqual(Object.keys(everyResponseKey).sort());
    expect(Object.keys(response.rows[0] ?? {}).sort()).toEqual(Object.keys(everyRowKey).sort());
    // Counts, never decimal strings: nothing here is money or a quantity.
    expect(typeof response.consultationCount).toBe("number");
    expect(typeof response.amendmentCount).toBe("number");
    expect(typeof response.rows[0]?.consultationCount).toBe("number");
    expect(JSON.stringify(response)).not.toContain("currency");

    // The clinical free-text fields the report must never touch, plus the patient
    // identity it must never carry. Asserted on the SERIALIZED response, so a
    // future field named after one of them cannot slip through.
    for (const forbidden of [
      "internalNotes",
      "diagnosis",
      "anamnesis",
      "treatmentPlan",
      "reasonForVisit",
      "clientSummary",
      "patientId",
      "patientName",
    ]) {
      expect(JSON.stringify(response), forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(response)).not.toContain(AMENDMENT);
  });
});

describe("ReportingService · the new-patients report ([[REP-006]])", () => {
  it("counts a patient that was deactivated AFTER it was registered", async () => {
    // Soft deactivation does not unfact the registration (`Patients.md`: there is
    // no hard delete). The read projection has no `isActive` column at all, so a
    // deactivated patient is not merely included here — it is not distinguishable
    // from an active one, which is exactly right for a report about the past.
    const { service, patientQueries } = harness({
      permissions: READ_PERMISSION,
      patients: [
        createdPatient({ id: "patient-1", createdAt: "2026-06-10T14:00:00.000Z" }),
        createdPatient({ id: "patient-2", createdAt: "2026-06-11T16:00:00.000Z" }),
      ],
    });

    const response = await service.newPatients(PERIOD_QUERY);

    expect(response.newPatientCount).toBe(2);
    expect(response.rows).toEqual([
      { bucketDate: "2026-06-10", count: 1 },
      { bucketDate: "2026-06-11", count: 1 },
    ]);
    // No `isActive` predicate anywhere: a filter on it would be the bug.
    expect(Object.keys(patientQueries[0]?.where ?? {}).sort()).toEqual(["createdAt", "tenantId"]);
  });

  it("buckets by the LOCAL day of createdAt, half-open, tenant-scoped and capped", async () => {
    const { service, patientQueries } = harness({
      permissions: READ_PERMISSION,
      patients: [
        // 02:00Z on the 11th is 23:00 local on the 10th.
        createdPatient({ id: "patient-1", createdAt: "2026-06-11T02:00:00.000Z" }),
      ],
    });

    const response = await service.newPatients(PERIOD_QUERY);

    expect(response.rows).toEqual([{ bucketDate: "2026-06-10", count: 1 }]);
    expect(patientQueries).toHaveLength(1);
    expect(patientQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        createdAt: { gte: new Date(FROM_INSTANT), lt: new Date(TO_INSTANT) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(patientQueries[0]?.take).toBe(REPORT_NEW_PATIENT_ROW_LIMIT + 1);
    // The projection is id + instant: `Patient.name` and `birthDate` are
    // CONFIDENTIAL and a headcount needs neither.
    expect(patientQueries[0]?.select).toEqual({ id: true, createdAt: true });
  });

  it("orders the buckets ascending however the read returns them", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: [
        createdPatient({ id: "patient-b", createdAt: "2026-06-11T20:00:00.000Z" }),
        createdPatient({ id: "patient-a", createdAt: "2026-06-10T14:00:00.000Z" }),
        createdPatient({ id: "patient-c", createdAt: "2026-06-11T18:00:00.000Z" }),
      ],
    });

    const response = await service.newPatients(PERIOD_QUERY);

    expect(response.rows).toEqual([
      { bucketDate: "2026-06-10", count: 1 },
      { bucketDate: "2026-06-11", count: 2 },
    ]);
  });

  it("returns an empty answer for an empty period, not an error", async () => {
    const { service } = harness({ permissions: READ_PERMISSION });

    const response = await service.newPatients(PERIOD_QUERY);

    expect(response).toEqual({
      report: "new-patients",
      period: TWO_DAY_PERIOD,
      newPatientCount: 0,
      rows: [],
    });
  });

  it("refuses a period over the cap instead of reporting a truncated headcount", async () => {
    const patients = Array.from({ length: REPORT_NEW_PATIENT_ROW_LIMIT + 1 }, (_unused, index) =>
      createdPatient({ id: `patient-${index}`, createdAt: FROM_INSTANT })
    );
    const { service } = harness({ permissions: READ_PERMISSION, patients });

    await expect(service.newPatients(PERIOD_QUERY)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_NEW_PATIENT_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, encounterQueries, patientQueries } = harness({
      permissions: ["patients.read"],
    });

    await expect(service.newPatients(PERIOD_QUERY)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(encounterQueries).toEqual([]);
    expect(patientQueries).toEqual([]);
  });

  it("carries counts (not decimals), no currency and exactly the declared keys", async () => {
    const everyResponseKey: Record<keyof NewPatientsResponse, true> = {
      report: true,
      period: true,
      newPatientCount: true,
      rows: true,
    };
    const everyRowKey: Record<keyof NewPatientDayRowDto, true> = {
      bucketDate: true,
      count: true,
    };

    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: [createdPatient({ id: "patient-1", createdAt: "2026-06-10T14:00:00.000Z" })],
    });

    const response = await service.newPatients(PERIOD_QUERY);

    expect(Object.keys(response).sort()).toEqual(Object.keys(everyResponseKey).sort());
    expect(Object.keys(response.rows[0] ?? {}).sort()).toEqual(Object.keys(everyRowKey).sort());
    expect(typeof response.newPatientCount).toBe("number");
    expect(typeof response.rows[0]?.count).toBe("number");
    expect(JSON.stringify(response)).not.toContain("currency");

    // No patient identity and no clinical field: the report is a headcount.
    for (const forbidden of ["patientId", "patientName", "name", "birthDate", "speciesId"]) {
      expect(JSON.stringify(response), forbidden).not.toContain(forbidden);
    }
  });
});
