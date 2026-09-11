import { randomUUID } from "node:crypto";
import type {
  BreedRow,
  CustomerRow,
  IsolationDatabase,
  PatientGuardianRow,
  PatientRow,
  SpeciesRow,
  TenantRow,
} from "./in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
  type SeededRbacRole,
} from "./rbac-fixture.js";

/**
 * Canonical `patients.*` keys the probing/foreign tenants hold. `customers.*`
 * is added so the same actors can exercise Core Customer cross-tenant commands
 * (a Patient guardian link resolves a Core Customer).
 */
const PATIENT_KEYS = [
  "patients.read",
  "patients.create",
  "patients.update",
  "patients.deactivate",
  "patients.guardian.manage",
  "customers.read",
  "customers.create",
  "customers.update",
  "customers.deactivate",
] as const;

export interface PatientHttpTenant {
  tenant: TenantRow;
  role: SeededRbacRole;
  actor: RbacActor;
  customer: CustomerRow;
}

/** Active Patient + its primary guardian, both owned by the same tenant. */
export interface PatientFactoryResult {
  patient: PatientRow;
  guardian: PatientGuardianRow;
  customer: CustomerRow;
}

export interface PatientHttpFixture {
  /** Probing tenant: entitled, holds every patient/customer key. */
  a: PatientHttpTenant;
  /** Foreign tenant: entitled, owns the resources A must not see. */
  b: PatientHttpTenant;
  /** Entitlement-negative tenant: permissioned but WITHOUT `veterinary`. */
  c: PatientHttpTenant;
  species: SpeciesRow;
  breed: BreedRow;
  /** Fresh active Patient + primary guardian in tenant A (call per test). */
  createPatientA(overrides?: { isActive?: boolean }): PatientFactoryResult;
  /** Fresh active Patient + primary guardian in tenant B (foreign owner). */
  createPatientB(overrides?: { isActive?: boolean }): PatientFactoryResult;
  /** Raw guardian link (secondary by default) in the given tenant. */
  createGuardian(
    owner: PatientHttpTenant,
    patientId: string,
    customerId: string,
    options?: { isPrimary?: boolean; isActive?: boolean; position?: number }
  ): PatientGuardianRow;
}

/**
 * Independent EPIC-05 HTTP fixture (WU3.1). Seeds, per boot, three isolated
 * tenants (A probe / B foreign / C entitlement-negative), fresh roles + keys,
 * explicit `veterinary` grants for A and B, the global Species/Breed taxonomy,
 * and one Customer per tenant. Factories mint FRESH resources so no integration
 * suite ever reuses an id produced by a previous `it`.
 */
export function seedPatientHttp(db: IsolationDatabase): PatientHttpFixture {
  const suffix = randomUUID().slice(0, 8);

  const species = db.prisma.species.create({ data: { code: `dog-${suffix}`, name: "Dog" } });
  const breed = db.prisma.breed.create({
    data: { speciesId: species.id, code: `mixed-${suffix}`, name: "Mixed Breed" },
  });
  const veterinaryFeature = db.prisma.featureCode.create({ data: { code: "veterinary" } });

  function seedTenant(letter: string, entitled: boolean): PatientHttpTenant {
    const label = letter.toUpperCase();
    const tenant = db.prisma.tenant.create({
      data: { slug: `patients-${letter}-${suffix}`, name: `Patients ${label}`, status: "ACTIVE" },
    });
    const role = seedRoleWithKeys(
      db,
      `PATIENTS_${label}_${suffix}`,
      `Patients ${label} (fixture)`,
      [...PATIENT_KEYS]
    );
    const actor = seedRbacActor(db, {
      email: `patients-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    const customer = db.prisma.customer.create({
      data: {
        tenantId: tenant.id,
        kind: "INDIVIDUAL",
        displayName: `Customer ${label}`,
        legalName: null,
        taxId: null,
        firstName: "Patient",
        lastName: "Owner",
        documentNumber: null,
        isActive: true,
      },
    });
    if (entitled) {
      db.prisma.tenantEntitlement.create({
        data: { tenantId: tenant.id, featureCodeId: veterinaryFeature.id },
      });
    }
    return { tenant, role, actor, customer };
  }

  const a = seedTenant("a", true);
  const b = seedTenant("b", true);
  const c = seedTenant("c", false);

  function createPatient(
    owner: PatientHttpTenant,
    overrides: { isActive?: boolean } = {}
  ): PatientFactoryResult {
    const patient = db.prisma.patient.create({
      data: {
        tenantId: owner.tenant.id,
        name: `Patient ${owner.tenant.slug}`,
        speciesId: species.id,
        breedId: breed.id,
        sex: "UNKNOWN",
        birthDate: null,
        isActive: overrides.isActive ?? true,
      },
    });
    const guardian = db.prisma.patientGuardian.create({
      data: {
        tenantId: owner.tenant.id,
        patientId: patient.id,
        customerId: owner.customer.id,
        isPrimary: true,
        isActive: true,
        position: 0,
      },
    });
    return { patient, guardian, customer: owner.customer };
  }

  return {
    a,
    b,
    c,
    species,
    breed,
    createPatientA: (overrides) => createPatient(a, overrides),
    createPatientB: (overrides) => createPatient(b, overrides),
    createGuardian: (owner, patientId, customerId, options = {}) =>
      db.prisma.patientGuardian.create({
        data: {
          tenantId: owner.tenant.id,
          patientId,
          customerId,
          isPrimary: options.isPrimary ?? false,
          isActive: options.isActive ?? true,
          position: options.position ?? 0,
        },
      }),
  };
}
