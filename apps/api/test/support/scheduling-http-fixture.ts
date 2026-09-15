import { randomUUID } from "node:crypto";
import type { AppointmentRow, BranchRow, IsolationDatabase } from "./in-memory-database.js";
import {
  seedPatientHttp,
  type PatientHttpFixture,
  type PatientHttpTenant,
} from "./patient-http-fixture.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
  type SeededRbacRole,
} from "./rbac-fixture.js";

/**
 * Scheduling HTTP fixture (EPIC-07 WU3).
 *
 * Reuses the EPIC-05 three-tenant boundary (A probe / B foreign / C
 * permissioned-but-ungranted) and layers the scheduling anchors the WU3 routes
 * need: one Branch per probing tenant, an assignable `VETERINARIAN` membership,
 * and the granular `scheduling.appointment.*` keys granted to each actor.
 *
 * The base in-memory boundary already models `branch` and `appointment`
 * delegates; this fixture only SEEDS through them, so the REAL guard chain,
 * controller and service run end-to-end without a live PostgreSQL.
 */

/** Granular scheduling keys every probing tenant holds. */
export const SCHEDULING_KEYS = [
  "scheduling.appointment.read",
  "scheduling.appointment.manage",
  "scheduling.appointment.transition",
  "scheduling.settings.manage",
] as const;

/** A tenant's scheduling anchors: actor role, branch, professional, patient. */
export interface SchedulingTenant {
  tenant: PatientHttpTenant["tenant"];
  role: SeededRbacRole;
  actor: RbacActor;
  branch: BranchRow;
  /** Fresh in-tenant Patient usable as the appointment anchor. */
  patientId: string;
  /** Assignable professional (role code exactly `VETERINARIAN`). */
  professionalMembershipId: string;
}

export interface SchedulingHttpFixture {
  patient: PatientHttpFixture;
  /** Probing tenant: entitled boundary, holds every scheduling key. */
  a: SchedulingTenant;
  /** Foreign tenant: owns the resources A must never see. */
  b: SchedulingTenant;
  /** Seeds an appointment row directly (setup for cross-tenant / overlap cases). */
  createAppointment(
    owner: SchedulingTenant,
    overrides?: Partial<Omit<AppointmentRow, "id" | "createdAt" | "updatedAt">>
  ): AppointmentRow;
}

/** Seeds the scheduling boundary; call BEFORE `bootTestApp({ db })`. */
export function seedSchedulingHttp(db: IsolationDatabase): SchedulingHttpFixture {
  const patient = seedPatientHttp(db);
  // One shared role whose code is exactly `VETERINARIAN` — the service rejects
  // any other role code, so the fixture must mint the real catalog code.
  const vetRole = seedRoleWithKeys(db, "VETERINARIAN", "Veterinarian (fixture)", []);

  function extend(
    owner: PatientHttpTenant,
    seededPatientId: string,
    label: string
  ): SchedulingTenant {
    for (const key of SCHEDULING_KEYS) {
      owner.role.grant(key);
    }
    const branch = db.prisma.branch.create({
      data: { tenantId: owner.tenant.id, name: `Scheduling Branch ${label}` },
    });
    const professional = seedRbacActor(db, {
      email: `vet-${label}-${randomUUID().slice(0, 8)}@isolation.test`,
      tenantId: owner.tenant.id,
      roleId: vetRole.role.id,
    });
    if (!professional.membership) {
      throw new Error("scheduling fixture: professional membership was not seeded");
    }
    return {
      tenant: owner.tenant,
      role: owner.role,
      actor: owner.actor,
      branch,
      patientId: seededPatientId,
      professionalMembershipId: professional.membership.id,
    };
  }

  const a = extend(patient.a, patient.createPatientA().patient.id, "A");
  const b = extend(patient.b, patient.createPatientB().patient.id, "B");

  return {
    patient,
    a,
    b,
    createAppointment: (owner, overrides = {}) =>
      db.prisma.appointment.create({
        data: {
          tenantId: owner.tenant.id,
          branchId: owner.branch.id,
          patientId: owner.patientId,
          professionalMembershipId: owner.professionalMembershipId,
          status: "SCHEDULED",
          version: 1,
          startAt: new Date("2026-03-02T13:00:00.000Z"),
          endAt: new Date("2026-03-02T13:30:00.000Z"),
          ...overrides,
        },
      }),
  };
}
