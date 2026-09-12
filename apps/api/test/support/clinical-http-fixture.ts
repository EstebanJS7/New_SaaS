import { randomUUID } from "node:crypto";
import type { IsolationDatabase } from "./in-memory-database.js";
import { seedPatientHttp, type PatientHttpFixture } from "./patient-http-fixture.js";

/**
 * Clinical HTTP fixture (EPIC-06 WU3).
 *
 * Reuses the EPIC-05 three-tenant boundary (A probe / B foreign / C
 * entitlement-negative), grants the `vet.clinical.*` keys to each tenant's role
 * and attaches minimal in-memory clinical delegates to the Prisma boundary fake
 * so the REAL guard chain + controllers can be exercised end-to-end without a
 * live PostgreSQL.
 *
 * Scope discipline: only the delegates the WU3 routes touch are provided
 * (`clinicalEncounter` plus the five specialized kinds), with create / findFirst
 * / findMany / updateMany — no delete exists in the domain. Transactions and
 * rollback of clinical writes are NOT modelled here; the live-PG evidence gate
 * (WU5) owns transactional proof.
 */

/** Granular clinical permission keys every probing tenant holds. */
export const CLINICAL_KEYS = [
  "vet.clinical.read",
  "vet.clinical.create",
  "vet.clinical.update",
  "vet.clinical.close",
  "vet.clinical.amend",
] as const;

export const CLINICAL_MODELS = [
  "clinicalEncounter",
  "clinicalTreatment",
  "clinicalVaccination",
  "clinicalDeworming",
  "clinicalStudy",
  "clinicalWeight",
] as const;

export type ClinicalModel = (typeof CLINICAL_MODELS)[number];

export interface ClinicalRow {
  id: string;
  tenantId: string;
  patientId: string;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
}

interface ClinicalWhere {
  id?: string;
  tenantId?: string;
  patientId?: string;
  status?: string;
  version?: number;
  idempotencyKey?: string;
}

interface ClinicalStore {
  create: (args: { data: Record<string, unknown> }) => ClinicalRow;
  findFirst: (args: { where: ClinicalWhere }) => ClinicalRow | null;
  findMany: (args: {
    where: ClinicalWhere;
    orderBy?: { createdAt?: "asc" | "desc" };
  }) => ClinicalRow[];
  updateMany: (args: { where: ClinicalWhere; data: Record<string, unknown> }) => { count: number };
}

function matchesWhere(row: ClinicalRow, where: ClinicalWhere): boolean {
  return Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
}

function makeClinicalStore(table: Map<string, ClinicalRow>): ClinicalStore {
  return {
    create: ({ data }) => {
      const now = new Date();
      const row: ClinicalRow = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...data,
      } as ClinicalRow;
      table.set(row.id, row);
      return row;
    },
    findFirst: ({ where }) => [...table.values()].find((row) => matchesWhere(row, where)) ?? null,
    findMany: ({ where, orderBy }) => {
      const rows = [...table.values()].filter((row) => matchesWhere(row, where));
      if (orderBy?.createdAt === "desc") {
        rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      } else if (orderBy?.createdAt === "asc") {
        rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      }
      return rows;
    },
    updateMany: ({ where, data }) => {
      let count = 0;
      for (const row of table.values()) {
        if (!matchesWhere(row, where)) continue;
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "object" && value !== null && "increment" in value) {
            row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
          } else {
            row[key] = value;
          }
        }
        row.updatedAt = new Date();
        count += 1;
      }
      return { count };
    },
  };
}

export interface ClinicalHttpFixture {
  patient: PatientHttpFixture;
  /** Direct access to the in-memory clinical rows for persistence assertions. */
  tables: Record<ClinicalModel, Map<string, ClinicalRow>>;
}

/**
 * Attaches the clinical delegates and returns the fixture. Call BEFORE
 * `bootTestApp({ db })` so the booted app resolves the extended boundary.
 */
export function seedClinicalHttp(db: IsolationDatabase): ClinicalHttpFixture {
  const patient = seedPatientHttp(db);
  for (const tenant of [patient.a, patient.b, patient.c]) {
    for (const key of CLINICAL_KEYS) {
      tenant.role.grant(key);
    }
  }

  const tables = {} as Record<ClinicalModel, Map<string, ClinicalRow>>;
  const prismaRecord = db.prisma as unknown as Record<string, ClinicalStore>;
  for (const model of CLINICAL_MODELS) {
    const table = new Map<string, ClinicalRow>();
    tables[model] = table;
    prismaRecord[model] = makeClinicalStore(table);
  }

  return { patient, tables };
}
