import { describe, expect, it } from "vitest";
import type { Prisma } from "@newsaas/database";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  REPORT_HORIZON_DEFAULT_DAYS,
  REPORT_HORIZON_INTEGER_MESSAGE,
  REPORT_HORIZON_RANGE_MESSAGE,
} from "./report.horizon.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import {
  REPORT_DUE_DEWORMING_ROW_LIMIT,
  REPORT_DUE_DEWORMING_ROW_LIMIT_EXCEEDED_MESSAGE,
  REPORT_DUE_VACCINATION_ROW_LIMIT,
  REPORT_DUE_VACCINATION_ROW_LIMIT_EXCEEDED_MESSAGE,
  ReportRepository,
  reportDueInstantMissingMessage,
  type ReportingReadPrisma,
  type ReportDueDewormingReadRow,
  type ReportDueVaccinationReadRow,
  type ReportPatientNameRow,
  type ReportPatientReadRow,
} from "./reporting.repository.js";
import {
  REPORT_READ_FORBIDDEN_MESSAGE,
  ReportingService,
  reportDuePatientMissingMessage,
  reportDueRowBeyondHorizonMessage,
} from "./reporting.service.js";
import {
  REPORT_DUE_QUERY_INVALID_MESSAGE,
  reportDueQuerySchema,
  type DewormingDueResponse,
  type DewormingDueRowDto,
  type VaccineDueRowDto,
  type VaccinesDueResponse,
} from "./reporting.dto.js";

/**
 * The two DUE reports of [[REP-006]] part 2 at the SERVICE boundary: the
 * overdue/upcoming split against a pinned clock, the horizon and its bounds, the
 * empty answers, every refusal and the data-classification shape.
 *
 * The pattern is the landed suites: the REAL repository over stub delegates, so
 * the query each report builds (predicate, `select`, order, `take`) is the
 * shipped one and is asserted as an ARGUMENT.
 *
 * WHAT A STUB CANNOT PROVE, and where it is proven instead: a stub returns
 * whatever it is given, so it cannot show that a row with a NULL due date or one
 * past the horizon is ABSENT from the payload — that is the query's job, and the
 * query is asserted here. The row-level truth (a null-due row absent, an
 * out-of-horizon row absent, tenant isolation) is proven in
 * `reporting.veterinary.integration.test.ts`, where the in-memory boundary
 * actually APPLIES the predicates.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

/**
 * The pinned clock: 2026-06-10 09:00 in Asunción (`-03`), so `asOfDate` is
 * `2026-06-10`. Chosen so a due instant later in the UTC day but earlier in the
 * tenant day — and the reverse — can be told apart from the pivot.
 */
const NOW = new Date("2026-06-10T12:00:00.000Z");
const AS_OF_DATE = "2026-06-10";

/** Default horizon (30 days) resolved from `AS_OF_DATE`: last day 2026-07-10. */
const DEFAULT_HORIZON_END_DATE = "2026-07-10";

/**
 * EXCLUSIVE bound of the default horizon: the first instant of the day AFTER
 * 2026-07-10 in Asunción. This is the number that INCLUDES a due date on the last
 * horizon day and EXCLUDES one that falls on 2026-07-11.
 */
const DEFAULT_HORIZON_END_INSTANT = "2026-07-11T03:00:00.000Z";

const PATIENT_TOBY = "patient-toby";
const PATIENT_LUNA = "patient-luna";

const VACCINE_RABIES = "Antirrábica";
const PRODUCT_ANTIPARASITIC = "Antiparasitario";

interface Harness {
  service: ReportingService;
  /** Every `clinicalVaccination.findMany` arg the repository built, in call order. */
  vaccinationQueries: Prisma.ClinicalVaccinationFindManyArgs[];
  /** Every `clinicalDeworming.findMany` arg the repository built, in call order. */
  dewormingQueries: Prisma.ClinicalDewormingFindManyArgs[];
  /** Every `patient.findMany` arg the repository built, in call order. */
  patientQueries: Prisma.PatientFindManyArgs[];
}

/**
 * The real repository over stub clinical delegates, a stub permission resolver
 * and a pinned clock.
 *
 * The settings stub THROWS: a due report is dates, names and counts, so no
 * response carries a `currency` and a `sales` settings read here would resolve a
 * currency for an answer that must not contain one.
 */
function harness(
  options: {
    vaccinations?: ReportDueVaccinationReadRow[];
    dewormings?: ReportDueDewormingReadRow[];
    patients?: ReportPatientReadRow[];
    permissions?: readonly string[];
    now?: Date;
  } = {}
): Harness {
  const vaccinationQueries: Prisma.ClinicalVaccinationFindManyArgs[] = [];
  const dewormingQueries: Prisma.ClinicalDewormingFindManyArgs[] = [];
  const patientQueries: Prisma.PatientFindManyArgs[] = [];

  const prisma: ReportingReadPrisma = {
    // Every OTHER report's reads are unreachable from here and vice versa: each
    // stub THROWS instead of answering `[]`, so a case that reached one fails
    // loudly rather than silently aggregating an empty set.
    sale: {
      findMany: () => {
        throw new Error("The due reports must not read sales.");
      },
    },
    catalogItem: {
      findMany: () => {
        throw new Error("The due reports must not read catalog items.");
      },
      findFirst: () => {
        throw new Error("The due reports must not read catalog items.");
      },
    },
    cashSession: {
      findMany: () => {
        throw new Error("The due reports must not read cash sessions.");
      },
    },
    cashMovement: {
      findMany: () => {
        throw new Error("The due reports must not read cash movements.");
      },
    },
    purchase: {
      findMany: () => {
        throw new Error("The due reports must not read purchases.");
      },
    },
    supplier: {
      findMany: () => {
        throw new Error("The due reports must not read suppliers.");
      },
    },
    stockBalance: {
      findMany: () => {
        throw new Error("The due reports must not read stock balances.");
      },
    },
    stockMovement: {
      findMany: () => {
        throw new Error("The due reports must not read stock movements.");
      },
    },
    clinicalEncounter: {
      findMany: () => {
        throw new Error("The due reports must not read clinical encounters.");
      },
    },
    clinicalVaccination: {
      findMany: (args) => {
        vaccinationQueries.push(args);
        return Promise.resolve(options.vaccinations ?? []);
      },
    },
    clinicalDeworming: {
      findMany: (args) => {
        dewormingQueries.push(args);
        return Promise.resolve(options.dewormings ?? []);
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
      throw new Error("A due report must not resolve a currency.");
    },
  } as unknown as TenantSettingsService;

  const repository = new ReportRepository(prisma, requestContext);
  const now = options.now ?? NOW;
  const service = new ReportingService(repository, settings, permissionResolver, () => now);
  return { service, vaccinationQueries, dewormingQueries, patientQueries };
}

const READ_PERMISSION = [REPORTING_PERMISSIONS.read];

/** One vaccination as the minimal projection returns it. */
function vaccination(options: {
  id: string;
  patientId?: string;
  vaccine?: string;
  administeredAt?: Date | string;
  /** `null` mirrors "no due date was recorded" ([[DEC-065]]). */
  nextDueAt: Date | string | null;
}): ReportDueVaccinationReadRow {
  return {
    id: options.id,
    patientId: options.patientId ?? PATIENT_TOBY,
    vaccine: options.vaccine ?? VACCINE_RABIES,
    administeredAt: new Date(options.administeredAt ?? "2025-06-01T12:00:00.000Z"),
    nextDueAt: options.nextDueAt === null ? null : new Date(options.nextDueAt),
  };
}

/** One deworming treatment as the minimal projection returns it. */
function deworming(options: {
  id: string;
  patientId?: string;
  product?: string;
  administeredAt?: Date | string;
  nextDueAt: Date | string | null;
}): ReportDueDewormingReadRow {
  return {
    id: options.id,
    patientId: options.patientId ?? PATIENT_TOBY,
    product: options.product ?? PRODUCT_ANTIPARASITIC,
    administeredAt: new Date(options.administeredAt ?? "2025-06-01T12:00:00.000Z"),
    nextDueAt: options.nextDueAt === null ? null : new Date(options.nextDueAt),
  };
}

/** One patient name as the batched read returns it. */
function patientName(options: { id: string; name: string }): ReportPatientNameRow {
  return { id: options.id, name: options.name };
}

const TWO_PATIENTS = [
  patientName({ id: PATIENT_TOBY, name: "Toby" }),
  patientName({ id: PATIENT_LUNA, name: "Luna" }),
];

describe("ReportingService · the vaccines-due report ([[REP-006]] part 2)", () => {
  it("splits the boundary triad: yesterday overdue, TODAY upcoming, horizon-end upcoming", async () => {
    // THE RULE OF THE REPORT, and the sentence [[DEC-065]] and the Story both
    // state: a record due TODAY is UPCOMING, not overdue. The third row pins the
    // other end of the window: a due date exactly on the last horizon day is
    // still inside it, because the read's bound is the start of the day AFTER.
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [
        // Local 2026-06-09 12:00 — yesterday.
        vaccination({ id: "vax-yesterday", nextDueAt: "2026-06-09T15:00:00.000Z" }),
        // Local 2026-06-10 12:00 — TODAY.
        vaccination({ id: "vax-today", nextDueAt: "2026-06-10T15:00:00.000Z" }),
        // Local 2026-07-10 12:00 — the last day of the 30-day horizon.
        vaccination({ id: "vax-horizon-end", nextDueAt: "2026-07-10T15:00:00.000Z" }),
      ],
    });

    const response = await service.vaccinesDue({});

    expect(response.asOfDate).toBe(AS_OF_DATE);
    expect(response.horizonDays).toBe(REPORT_HORIZON_DEFAULT_DAYS);
    expect(response.overdueCount).toBe(1);
    expect(response.upcomingCount).toBe(2);
    expect(response.rows).toEqual([
      {
        patientId: PATIENT_TOBY,
        patientName: "Toby",
        vaccine: VACCINE_RABIES,
        administeredAt: "2025-06-01T12:00:00.000Z",
        nextDueAt: "2026-06-09T15:00:00.000Z",
        status: "overdue",
      },
      {
        patientId: PATIENT_TOBY,
        patientName: "Toby",
        vaccine: VACCINE_RABIES,
        administeredAt: "2025-06-01T12:00:00.000Z",
        nextDueAt: "2026-06-10T15:00:00.000Z",
        status: "upcoming",
      },
      {
        patientId: PATIENT_TOBY,
        patientName: "Toby",
        vaccine: VACCINE_RABIES,
        administeredAt: "2025-06-01T12:00:00.000Z",
        nextDueAt: "2026-07-10T15:00:00.000Z",
        status: "upcoming",
      },
    ]);
  });

  it("compares CALENDAR DATES in the tenant zone, never instants and never UTC days", async () => {
    // Two rows that a wrong implementation gets wrong, one each way:
    //
    // - `2026-06-10T02:00Z` is 23:00 on the LOCAL 9th, so it is OVERDUE even
    //   though its UTC day is today. A UTC comparison would call it upcoming.
    // - `2026-06-10T11:00Z` is 08:00 on the LOCAL 10th — EARLIER than the pinned
    //   `now` (09:00 local) and still UPCOMING. A `nextDueAt < now` comparison
    //   would call it overdue.
    //
    // Together they are the assertion that the split is
    // `tenantCalendarDate(nextDueAt) < tenantCalendarDate(now)`, which is exactly
    // what [[DEC-065]] and [[DEC-063]] specify.
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [
        vaccination({ id: "vax-local-yesterday", nextDueAt: "2026-06-10T02:00:00.000Z" }),
        vaccination({ id: "vax-early-today", nextDueAt: "2026-06-10T11:00:00.000Z" }),
      ],
    });

    const response = await service.vaccinesDue({});

    expect(response.rows.map((row) => [row.nextDueAt, row.status])).toEqual([
      ["2026-06-10T02:00:00.000Z", "overdue"],
      ["2026-06-10T11:00:00.000Z", "upcoming"],
    ]);
  });

  it("bounds the read HALF-OPEN at the start of the day AFTER the horizon, with no lower bound", async () => {
    // ONE assertion covers both halves of the window:
    //
    // - the bound is the first instant of local 2026-07-11, NOT of 2026-07-10, so
    //   a due date exactly on the last horizon day is INCLUDED (proved above);
    // - a due date on local 2026-07-11 is `>=` the bound and therefore NOT
    //   returned — one day past the horizon is out;
    // - `nextDueAt` carries no `gte` at all: an overdue record is overdue however
    //   old, so the past is deliberately unbounded and the row cap keeps it
    //   honest.
    const { service, vaccinationQueries } = harness({ permissions: READ_PERMISSION });

    await service.vaccinesDue({});

    expect(vaccinationQueries).toHaveLength(1);
    expect(vaccinationQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        nextDueAt: { not: null, lt: new Date(DEFAULT_HORIZON_END_INSTANT) },
      },
      orderBy: [{ nextDueAt: "asc" }, { id: "asc" }],
    });
    // The predicate is EXACTLY these two keys — `not` and the exclusive `lt`.
    // A `gte` or an `equals` here would be a different question.
    expect(Object.keys(vaccinationQueries[0]?.where ?? {}).sort()).toEqual([
      "nextDueAt",
      "tenantId",
    ]);
    const dueFilter = vaccinationQueries[0]?.where?.nextDueAt as Record<string, unknown>;
    expect(Object.keys(dueFilter).sort()).toEqual(["lt", "not"]);
    expect(dueFilter.not).toBeNull();
    // A row due on the local 11th is past the bound; the 10th's noon is not.
    const oneDayPast = new Date("2026-07-11T15:00:00.000Z");
    const lastHorizonDayNoon = new Date("2026-07-10T15:00:00.000Z");
    expect(oneDayPast.getTime()).toBeGreaterThanOrEqual(
      new Date(DEFAULT_HORIZON_END_INSTANT).getTime()
    );
    expect(lastHorizonDayNoon.getTime()).toBeLessThan(
      new Date(DEFAULT_HORIZON_END_INSTANT).getTime()
    );
    // `horizonEndDate` is the LAST day of the window, echoed nowhere but used to
    // refuse a row that somehow escaped the bound.
    expect(DEFAULT_HORIZON_END_DATE).toBe("2026-07-10");
  });

  it("reads only the columns it needs and skips the patient read when nothing is due", async () => {
    // The `select` is the data-classification boundary (PRD §41), so it is pinned
    // here as well as in the response, and the batched name read is SKIPPED
    // entirely (`in: []` is a question with a known answer) — a practice with
    // nothing due performs exactly ONE query.
    const { service, vaccinationQueries, patientQueries } = harness({
      permissions: READ_PERMISSION,
    });

    const response = await service.vaccinesDue({});

    expect(vaccinationQueries[0]?.select).toEqual({
      id: true,
      patientId: true,
      vaccine: true,
      administeredAt: true,
      nextDueAt: true,
    });
    expect(vaccinationQueries[0]?.take).toBe(REPORT_DUE_VACCINATION_ROW_LIMIT + 1);
    expect(patientQueries).toEqual([]);
    expect(response).toEqual({
      report: "vaccines-due",
      asOfDate: AS_OF_DATE,
      timeZone: "America/Asuncion",
      horizonDays: REPORT_HORIZON_DEFAULT_DAYS,
      overdueCount: 0,
      upcomingCount: 0,
      rows: [],
    });
  });

  it("resolves patient names in ONE batched, tenant-predicated read", async () => {
    // Both rows name the same patient on purpose: the id set is DEDUPLICATED by
    // the caller and resolved in a single read (no N+1), and the second row of
    // the same animal must not become a second query.
    const { service, patientQueries } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [
        vaccination({ id: "vax-1", nextDueAt: "2026-06-09T15:00:00.000Z" }),
        vaccination({ id: "vax-2", nextDueAt: "2026-06-10T15:00:00.000Z" }),
        vaccination({
          id: "vax-3",
          patientId: PATIENT_LUNA,
          nextDueAt: "2026-06-11T15:00:00.000Z",
        }),
      ],
    });

    const response = await service.vaccinesDue({});

    const readsByPatient = patientQueries.filter(
      (query) => (query.where as { createdAt?: unknown }).createdAt === undefined
    );
    expect(readsByPatient).toHaveLength(1);
    expect(readsByPatient[0]).toMatchObject({
      where: { tenantId: TENANT, id: { in: [PATIENT_TOBY, PATIENT_LUNA] } },
      select: { id: true, name: true },
    });
    expect(response.rows.map((row) => row.patientName)).toEqual(["Toby", "Toby", "Luna"]);
  });

  it("echoes an explicit horizonDays and resolves it against the same calendar arithmetic", async () => {
    // A 7-day horizon from 2026-06-10 ends on 2026-06-17, so the exclusive bound
    // is the first instant of local 2026-06-18 — NOT `now + 7 * 86_400_000`, which
    // is what a second date implementation would produce.
    const { service, vaccinationQueries } = harness({ permissions: READ_PERMISSION });

    const response = await service.vaccinesDue({ horizonDays: "7" });

    expect(response.horizonDays).toBe(7);
    expect(vaccinationQueries[0]).toMatchObject({
      where: { nextDueAt: { not: null, lt: new Date("2026-06-18T03:00:00.000Z") } },
    });
  });

  it("refuses a non-integer horizon with its own message and reads nothing", async () => {
    const { service, vaccinationQueries, patientQueries } = harness({
      permissions: READ_PERMISSION,
    });

    for (const horizonDays of ["1.5", "abc", "", "1e3", "+30"]) {
      await expect(service.vaccinesDue({ horizonDays }), horizonDays).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        message: REPORT_HORIZON_INTEGER_MESSAGE,
      });
    }
    expect(vaccinationQueries).toEqual([]);
    expect(patientQueries).toEqual([]);
  });

  it("refuses a horizon outside 1..365 with its own message and never clamps it", async () => {
    // Each of these is a REAL integer outside the bound, so it must reach the
    // RANGE refusal and not the shape one. Clamping would answer a different
    // question than the caller asked.
    const { service, vaccinationQueries } = harness({ permissions: READ_PERMISSION });

    for (const horizonDays of ["0", "-3", "366", "1000"]) {
      await expect(service.vaccinesDue({ horizonDays }), horizonDays).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        message: REPORT_HORIZON_RANGE_MESSAGE,
      });
    }
    expect(vaccinationQueries).toEqual([]);
  });

  it("refuses an unknown query key at the schema, so ?from= is not silently ignored", () => {
    // The due reports take NO period. `.strict()` is what turns a period key into
    // a refusal instead of a filter that never applied — the same rule the
    // current-state `low-stock` route applies to every key.
    expect(reportDueQuerySchema.safeParse({ horizonDays: "7" }).success).toBe(true);
    expect(reportDueQuerySchema.safeParse({}).success).toBe(true);
    for (const query of [
      { from: "2026-06-01", to: "2026-06-30" },
      { preset: "today" },
      { horizonDays: "7", from: "2026-06-01" },
      { tenantId: TENANT },
      { horizonDays: 7 },
    ]) {
      expect(reportDueQuerySchema.safeParse(query), JSON.stringify(query)).toMatchObject({
        success: false,
      });
    }
    // The refusal a caller sees for every one of them is the route's single
    // stable shape message, not the parser's paraphrase.
    expect(REPORT_DUE_QUERY_INVALID_MESSAGE).toBe("Invalid report due query.");
  });

  it("refuses LOUDLY, naming the record, when a row past the horizon reaches the service", async () => {
    // Unreachable by construction: the read is bounded by `horizonEndInstant`. It
    // is asserted rather than labelled because calling such a row `upcoming`
    // would promise forward notice the caller never asked for, and dropping it
    // would hide a record the read matched.
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [
        vaccination({ id: "vax-past-horizon", nextDueAt: "2026-07-11T15:00:00.000Z" }),
      ],
    });

    const refusal = service.vaccinesDue({});
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportDueRowBeyondHorizonMessage("vax-past-horizon"),
    });
    await expect(refusal).rejects.toThrow("vax-past-horizon");
  });

  it("refuses LOUDLY, naming the patient, when the batched read does not return one", async () => {
    // `clinical_vaccination` carries a RESTRICT composite `(tenant_id,
    // patient_id)` foreign key, so this is unreachable; it refuses rather than
    // rendering a nameless row a practice cannot act on, and it names the id so
    // the anomaly is diagnosable.
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: [patientName({ id: PATIENT_LUNA, name: "Luna" })],
      vaccinations: [
        vaccination({
          id: "vax-orphan",
          patientId: PATIENT_TOBY,
          nextDueAt: "2026-06-12T15:00:00.000Z",
        }),
      ],
    });

    const refusal = service.vaccinesDue({});
    await expect(refusal).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportDuePatientMissingMessage(PATIENT_TOBY),
    });
    await expect(refusal).rejects.toThrow(PATIENT_TOBY);
  });

  it("refuses a NULL due date rather than inventing one, naming the record", async () => {
    // The read filters `not: null`, so a NULL cannot arrive. The alternative to
    // refusing would be to place the animal on a call list at a date nobody
    // entered ([[DEC-065]] — the system never projects a booster date).
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [vaccination({ id: "vax-null-due", nextDueAt: null })],
    });

    await expect(service.vaccinesDue({})).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportDueInstantMissingMessage("vax-null-due"),
    });
  });

  it("counts every row exactly once: overdue + upcoming equals rows.length", async () => {
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [
        vaccination({ id: "vax-1", nextDueAt: "2019-01-05T15:00:00.000Z" }),
        vaccination({ id: "vax-2", nextDueAt: "2026-06-09T15:00:00.000Z" }),
        vaccination({ id: "vax-3", nextDueAt: "2026-06-10T15:00:00.000Z" }),
        vaccination({ id: "vax-4", nextDueAt: "2026-07-10T15:00:00.000Z" }),
      ],
    });

    const response = await service.vaccinesDue({});

    expect(response.overdueCount).toBe(2);
    expect(response.upcomingCount).toBe(2);
    expect(response.overdueCount + response.upcomingCount).toBe(response.rows.length);
  });

  it("keeps a very OLD overdue row: there is no lower bound on the past", async () => {
    // A booster that came due five years ago is the most urgent row on the list,
    // not a row outside the report: "what is due" is a question about the whole
    // history, and the read carries no `gte` at all (asserted above).
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      vaccinations: [vaccination({ id: "vax-ancient", nextDueAt: "2021-03-04T15:00:00.000Z" })],
    });

    const response = await service.vaccinesDue({});

    expect(response.rows.map((row) => row.status)).toEqual(["overdue"]);
    expect(response.rows[0]?.nextDueAt).toBe("2021-03-04T15:00:00.000Z");
  });

  it("refuses a read over the cap instead of reporting a truncated call list", async () => {
    // A truncated due list is the worst possible failure here: it looks exactly
    // like a correct list, and the animals missing from it are the overdue ones
    // nobody will call. The extra row makes the report REFUSE.
    const vaccinations = Array.from(
      { length: REPORT_DUE_VACCINATION_ROW_LIMIT + 1 },
      (_unused, index) => vaccination({ id: `vax-${index}`, nextDueAt: "2026-06-12T15:00:00.000Z" })
    );
    const { service } = harness({ permissions: READ_PERMISSION, vaccinations });

    await expect(service.vaccinesDue({})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_DUE_VACCINATION_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, vaccinationQueries, patientQueries } = harness({
      permissions: ["vet.clinical.read"],
    });

    await expect(service.vaccinesDue({ horizonDays: "7" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(vaccinationQueries).toEqual([]);
    expect(patientQueries).toEqual([]);
  });

  it("carries dates, a name and counts — no currency, no period and no clinical free text", async () => {
    // The response type is pinned KEY BY KEY: a `currency`, a `period` echo or a
    // clinical free-text field added to `VaccinesDueResponse` fails to compile
    // here before it can fail a review.
    const everyResponseKey: Record<keyof VaccinesDueResponse, true> = {
      report: true,
      asOfDate: true,
      timeZone: true,
      horizonDays: true,
      overdueCount: true,
      upcomingCount: true,
      rows: true,
    };
    const everyRowKey: Record<keyof VaccineDueRowDto, true> = {
      patientId: true,
      patientName: true,
      vaccine: true,
      administeredAt: true,
      nextDueAt: true,
      status: true,
    };

    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: [patientName({ id: PATIENT_TOBY, name: "Toby" })],
      vaccinations: [
        vaccination({ id: "vax-1", nextDueAt: "2026-06-09T15:00:00.000Z" }),
        vaccination({ id: "vax-2", nextDueAt: "2026-06-12T15:00:00.000Z" }),
      ],
    });

    const response = await service.vaccinesDue({});
    const serialized = JSON.stringify(response);

    expect(Object.keys(response).sort()).toEqual(Object.keys(everyResponseKey).sort());
    expect(Object.keys(response.rows[0] ?? {}).sort()).toEqual(Object.keys(everyRowKey).sort());
    expect(typeof response.horizonDays).toBe("number");
    expect(typeof response.overdueCount).toBe("number");
    expect(typeof response.upcomingCount).toBe("number");
    expect(response.rows[0]?.status).toBe("overdue");

    // CONFIDENTIAL `Patient.name` is carried ON PURPOSE (staff must act on it);
    // everything else CONFIDENTIAL or RESTRICTED is not, and neither is a period
    // or a currency on a report that has neither.
    for (const forbidden of [
      "internalNotes",
      "diagnosis",
      "anamnesis",
      "treatmentPlan",
      "reasonForVisit",
      "clientSummary",
      "birthDate",
      "speciesId",
      "guardian",
      "currency",
      '"period"',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("ReportingService · the deworming-due report ([[REP-006]] part 2)", () => {
  it("splits the same boundary triad over clinical_deworming, with `product` as its field", async () => {
    // The same three rows as the vaccine suite, on the other table: the rule is
    // the Story's, not per-report, so the assertion is repeated here rather than
    // assumed to carry over.
    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      dewormings: [
        deworming({ id: "dew-yesterday", nextDueAt: "2026-06-09T15:00:00.000Z" }),
        deworming({ id: "dew-today", nextDueAt: "2026-06-10T15:00:00.000Z" }),
        deworming({ id: "dew-horizon-end", nextDueAt: "2026-07-10T15:00:00.000Z" }),
      ],
    });

    const response = await service.dewormingDue({});

    expect(response.asOfDate).toBe(AS_OF_DATE);
    expect(response.horizonDays).toBe(REPORT_HORIZON_DEFAULT_DAYS);
    expect(response.overdueCount).toBe(1);
    expect(response.upcomingCount).toBe(2);
    expect(response.rows.map((row) => [row.nextDueAt, row.status])).toEqual([
      ["2026-06-09T15:00:00.000Z", "overdue"],
      ["2026-06-10T15:00:00.000Z", "upcoming"],
      ["2026-07-10T15:00:00.000Z", "upcoming"],
    ]);
    expect(response.rows[0]).toMatchObject({
      patientId: PATIENT_TOBY,
      patientName: "Toby",
      product: PRODUCT_ANTIPARASITIC,
    });
  });

  it("reads its OWN table: the same half-open bound, no lower bound, its own select and cap", async () => {
    // The deworming report never touches `clinical_vaccination` and vice versa —
    // two tables, two reads, two caps.
    const { service, vaccinationQueries, dewormingQueries } = harness({
      permissions: READ_PERMISSION,
    });

    await service.dewormingDue({ horizonDays: "90" });

    expect(vaccinationQueries).toEqual([]);
    expect(dewormingQueries).toHaveLength(1);
    expect(dewormingQueries[0]).toMatchObject({
      where: {
        tenantId: TENANT,
        nextDueAt: { not: null, lt: new Date("2026-09-09T03:00:00.000Z") },
      },
      orderBy: [{ nextDueAt: "asc" }, { id: "asc" }],
    });
    expect(Object.keys(dewormingQueries[0]?.where ?? {}).sort()).toEqual(["nextDueAt", "tenantId"]);
    expect(dewormingQueries[0]?.select).toEqual({
      id: true,
      patientId: true,
      product: true,
      administeredAt: true,
      nextDueAt: true,
    });
    expect(dewormingQueries[0]?.take).toBe(REPORT_DUE_DEWORMING_ROW_LIMIT + 1);
  });

  it("returns an empty answer for a tenant with nothing due, and reads no patient", async () => {
    const { service, patientQueries } = harness({ permissions: READ_PERMISSION });

    const response = await service.dewormingDue({});

    expect(response).toEqual({
      report: "deworming-due",
      asOfDate: AS_OF_DATE,
      timeZone: "America/Asuncion",
      horizonDays: REPORT_HORIZON_DEFAULT_DAYS,
      overdueCount: 0,
      upcomingCount: 0,
      rows: [],
    });
    expect(patientQueries).toEqual([]);
  });

  it("refuses the same horizon conditions with the same two stable messages", async () => {
    const { service, dewormingQueries } = harness({ permissions: READ_PERMISSION });

    await expect(service.dewormingDue({ horizonDays: "2.5" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_HORIZON_INTEGER_MESSAGE,
    });
    await expect(service.dewormingDue({ horizonDays: "366" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_HORIZON_RANGE_MESSAGE,
    });
    expect(dewormingQueries).toEqual([]);
  });

  it("refuses a deworming read over its cap instead of truncating the list", async () => {
    const dewormings = Array.from(
      { length: REPORT_DUE_DEWORMING_ROW_LIMIT + 1 },
      (_unused, index) => deworming({ id: `dew-${index}`, nextDueAt: "2026-06-12T15:00:00.000Z" })
    );
    const { service } = harness({ permissions: READ_PERMISSION, dewormings });

    await expect(service.dewormingDue({})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: REPORT_DUE_DEWORMING_ROW_LIMIT_EXCEEDED_MESSAGE,
    });
  });

  it("refuses a row past the horizon and a patient the read did not return", async () => {
    const beyond = harness({
      permissions: READ_PERMISSION,
      patients: TWO_PATIENTS,
      dewormings: [deworming({ id: "dew-past", nextDueAt: "2026-07-11T15:00:00.000Z" })],
    });
    await expect(beyond.service.dewormingDue({})).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportDueRowBeyondHorizonMessage("dew-past"),
    });

    const orphan = harness({
      permissions: READ_PERMISSION,
      patients: [patientName({ id: PATIENT_LUNA, name: "Luna" })],
      dewormings: [
        deworming({
          id: "dew-orphan",
          patientId: PATIENT_TOBY,
          nextDueAt: "2026-06-12T15:00:00.000Z",
        }),
      ],
    });
    await expect(orphan.service.dewormingDue({})).rejects.toMatchObject({
      code: "INTERNAL",
      message: reportDuePatientMissingMessage(PATIENT_TOBY),
    });
  });

  it("refuses a missing reports.read BEFORE any query runs", async () => {
    const { service, dewormingQueries, patientQueries } = harness({ permissions: [] });

    await expect(service.dewormingDue({})).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: REPORT_READ_FORBIDDEN_MESSAGE,
    });
    expect(dewormingQueries).toEqual([]);
    expect(patientQueries).toEqual([]);
  });

  it("carries exactly the declared keys — no currency, no period, no clinical free text", async () => {
    const everyResponseKey: Record<keyof DewormingDueResponse, true> = {
      report: true,
      asOfDate: true,
      timeZone: true,
      horizonDays: true,
      overdueCount: true,
      upcomingCount: true,
      rows: true,
    };
    const everyRowKey: Record<keyof DewormingDueRowDto, true> = {
      patientId: true,
      patientName: true,
      product: true,
      administeredAt: true,
      nextDueAt: true,
      status: true,
    };

    const { service } = harness({
      permissions: READ_PERMISSION,
      patients: [patientName({ id: PATIENT_TOBY, name: "Toby" })],
      dewormings: [deworming({ id: "dew-1", nextDueAt: "2026-06-09T15:00:00.000Z" })],
    });

    const response = await service.dewormingDue({});
    const serialized = JSON.stringify(response);

    expect(Object.keys(response).sort()).toEqual(Object.keys(everyResponseKey).sort());
    expect(Object.keys(response.rows[0] ?? {}).sort()).toEqual(Object.keys(everyRowKey).sort());
    // The vaccine field name is NOT the deworming one: the two reports must never
    // be rendered with each other's column.
    expect(serialized).not.toContain("vaccine");

    for (const forbidden of [
      "internalNotes",
      "diagnosis",
      "anamnesis",
      "treatmentPlan",
      "reasonForVisit",
      "clientSummary",
      "birthDate",
      "speciesId",
      "guardian",
      "currency",
      '"period"',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
