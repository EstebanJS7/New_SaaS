import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { TENANT_TIMEZONE } from "../scheduling/appointment-invariants.js";
import {
  assertHolderOwnedPatient,
  holderPatientIds,
  portalResourceNotFound,
} from "./portal-holder-scope.js";
import type {
  PortalAppointment,
  PortalAppointmentListResponse,
  PortalAppointmentStatusDto,
  PortalAppointmentSummary,
  PortalClinicalSummary,
  PortalEncounterStatusDto,
  PortalPatientSexDto,
  PortalPetDetail,
  PortalPetSummary,
  PortalVaccination,
} from "./portal-read.dto.js";

/** Tenant-scoped Patient row as the portal read boundary consumes it. */
interface PortalPatientRow {
  readonly id: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
  readonly sex: PortalPatientSexDto;
  readonly birthDate: Date | null;
  readonly isActive: boolean;
}

/**
 * GLOBAL Species reference row with its breeds nested. Species/Breed carry NO
 * tenant column (Decision #2211), so this read is deliberately not tenant-scoped.
 */
interface PortalSpeciesRefRow {
  readonly id: string;
  readonly name: string;
  readonly breeds: readonly PortalBreedRefRow[];
}

/** GLOBAL Breed reference row; belongs to exactly one global Species. */
interface PortalBreedRefRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Names resolved for the pets of ONE read, keyed by the pet's own ids. The maps
 * can only answer for a species/breed the batch actually references.
 */
interface PortalPetNames {
  readonly speciesNames: ReadonlyMap<string, string>;
  readonly breedNames: ReadonlyMap<string, string>;
}

/** Active guardian link row; only the anchor id is consumed. */
interface PortalGuardianLinkRow {
  readonly patientId: string;
}

/** Clinical encounter row; `clientSummary` is the only exposed content field. */
interface PortalEncounterRow {
  readonly id: string;
  readonly status: PortalEncounterStatusDto;
  readonly clientSummary: string | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
}

/** Encounter guaranteed to carry a client-safe summary (post-filter). */
interface PortalEncounterWithSummary extends PortalEncounterRow {
  readonly clientSummary: string;
}

/** Vaccination row as the portal read boundary consumes it. */
interface PortalVaccinationRow {
  readonly id: string;
  readonly vaccine: string;
  readonly administeredAt: Date;
}

/** Appointment row; provenance/internal linkage is deliberately absent. */
interface PortalAppointmentRow {
  readonly id: string;
  readonly patientId: string;
  readonly status: PortalAppointmentStatusDto;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly version: number;
}

/**
 * Structural Prisma surface consumed by the portal read boundary. Declared
 * explicitly (design pattern shared with `PortalAccessService`) so the service
 * is unit-testable and the in-memory boundary fake can satisfy it without the
 * real client.
 */
interface PortalReadPrisma {
  patientGuardian: {
    findMany: (args: {
      where: { tenantId: string; customerId: string; isActive: boolean };
      select?: unknown;
    }) => Promise<PortalGuardianLinkRow[]>;
    findFirst: (args: {
      where: { tenantId: string; patientId: string; customerId: string; isActive: boolean };
      select?: unknown;
    }) => Promise<PortalGuardianLinkRow | null>;
  };
  patient: {
    findMany: (args: {
      where: { tenantId: string; id: { in: string[] } };
    }) => Promise<PortalPatientRow[]>;
    findFirst: (args: {
      where: { id: string; tenantId: string };
    }) => Promise<PortalPatientRow | null>;
  };
  species: {
    findMany: (args: {
      where: { id: { in: string[] } };
      include: { breeds: true };
    }) => Promise<PortalSpeciesRefRow[]>;
  };
  clinicalEncounter: {
    findMany: (args: {
      where: { tenantId: string; patientId: string };
      select?: unknown;
    }) => Promise<PortalEncounterRow[]>;
  };
  clinicalVaccination: {
    findMany: (args: {
      where: { tenantId: string; patientId: string };
    }) => Promise<PortalVaccinationRow[]>;
  };
  appointment: {
    findMany: (args: {
      where: { tenantId: string; patientId: { in: string[] } };
    }) => Promise<PortalAppointmentRow[]>;
    findFirst: (args: {
      where: { id: string; tenantId: string; patientId: { in: string[] } };
    }) => Promise<PortalAppointmentRow | null>;
  };
}

/** ISO-8601 rendering for every `Date` that crosses the portal boundary. */
function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * Builds the allowlisted pet summary; never spreads the source row.
 *
 * Throws `INTERNAL` when a referenced species/breed name cannot be resolved:
 * the FK is RESTRICT over GLOBAL tables, so an unresolvable reference is an
 * integrity breach, and a blank or a raw id would hide it. Same choice as the
 * appointment read makes for an unresolvable `patientName`.
 */
function toPetSummary(row: PortalPatientRow, names: PortalPetNames): PortalPetSummary {
  const speciesName = names.speciesNames.get(row.speciesId);
  if (speciesName === undefined) {
    throw new DomainError("INTERNAL", "Pet references a species that cannot be resolved.");
  }
  let breedName: string | null = null;
  if (row.breedId !== null) {
    const resolvedBreedName = names.breedNames.get(row.breedId);
    if (resolvedBreedName === undefined) {
      throw new DomainError("INTERNAL", "Pet references a breed that cannot be resolved.");
    }
    breedName = resolvedBreedName;
  }
  return {
    id: row.id,
    name: row.name,
    speciesId: row.speciesId,
    speciesName,
    breedId: row.breedId,
    breedName,
    sex: row.sex,
    birthDate: row.birthDate ? toIso(row.birthDate) : null,
    isActive: row.isActive,
  };
}

/** Narrows to encounters that carry a client-safe summary. */
function hasClientSummary(row: PortalEncounterRow): row is PortalEncounterWithSummary {
  return row.clientSummary !== null;
}

function toClinicalSummary(row: PortalEncounterWithSummary): PortalClinicalSummary {
  return {
    id: row.id,
    status: row.status,
    clientSummary: row.clientSummary,
    closedAt: row.closedAt ? toIso(row.closedAt) : null,
  };
}

function toVaccination(row: PortalVaccinationRow): PortalVaccination {
  return {
    id: row.id,
    vaccine: row.vaccine,
    administeredAt: toIso(row.administeredAt),
  };
}

function toAppointment(row: PortalAppointmentRow): PortalAppointment {
  return {
    id: row.id,
    patientId: row.patientId,
    status: row.status,
    startAt: toIso(row.startAt),
    endAt: toIso(row.endAt),
    version: row.version,
  };
}

/** Builds the list projection with its already-resolved patient name. */
function toAppointmentSummary(
  row: PortalAppointmentRow,
  patientName: string
): PortalAppointmentSummary {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName,
    status: row.status,
    startAt: toIso(row.startAt),
    endAt: toIso(row.endAt),
    version: row.version,
  };
}

/**
 * Holder-scoped portal READ boundary (EPIC-08 WU3).
 *
 * - Tenant AND Customer come exclusively from the authenticated portal context
 *   (`RequestContextService`), which the PortalAuthGuard populates from the
 *   session's own access row. A `tenantId`/`customerId` from the request is
 *   never read here.
 * - "Own pets" is the guardian chain: an active `patient_guardian` link row for
 *   the authenticated customer. A resource that is not reachable through that
 *   chain — another Customer in the same tenant, a cross-tenant row, or an
 *   unknown UUID — throws the SAME `NOT_FOUND`, so the outcomes are
 *   byte-equivalent.
 * - Only allowlisted projections leave this boundary. `internalNotes` and the
 *   staff clinical free text are never selected nor mapped; no CONFIDENTIAL
 *   payload is logged.
 */
@Injectable()
export class PortalReadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalReadPrisma,
    private readonly requestContext: RequestContextService
  ) {}

  /** Lists the holder's pets (active guardian link), name-ordered. */
  async listPets(): Promise<PortalPetSummary[]> {
    const { tenantId, customerId } = this.requirePortalScope();
    const patientIds = await holderPatientIds(this.prisma, tenantId, customerId);
    if (patientIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: patientIds } },
    });
    const names = await this.resolvePetNames(rows);
    return rows
      .map((row) => toPetSummary(row, names))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Pet detail: allowlisted identity + clinical summary + vaccinations. */
  async getPet(id: string): Promise<PortalPetDetail> {
    const { tenantId, customerId } = this.requirePortalScope();
    await assertHolderOwnedPatient(this.prisma, tenantId, customerId, id);

    const patient = await this.prisma.patient.findFirst({ where: { id, tenantId } });
    if (!patient) {
      throw portalResourceNotFound();
    }

    const [names, encounters, vaccinations] = await Promise.all([
      this.resolvePetNames([patient]),
      this.prisma.clinicalEncounter.findMany({
        where: { tenantId, patientId: patient.id },
        // Select only the client-safe columns: `internalNotes` and the staff
        // free text never leave the database for a portal read.
        select: {
          id: true,
          status: true,
          clientSummary: true,
          closedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.clinicalVaccination.findMany({
        where: { tenantId, patientId: patient.id },
      }),
    ]);

    return {
      ...toPetSummary(patient, names),
      clinical: {
        encounters: encounters
          .filter(hasClientSummary)
          .sort(byMostRecentFirst((row) => row.closedAt ?? row.createdAt))
          .map(toClinicalSummary),
        vaccinations: vaccinations
          .sort(byMostRecentFirst((row) => row.administeredAt))
          .map(toVaccination),
      },
    };
  }

  /**
   * Lists appointments for holder-owned pets, earliest-start first, inside the
   * envelope that also carries the clinic time zone and each pet name.
   *
   * The names are resolved in exactly ONE set-based, tenant-scoped query for
   * the involved patients (never one lookup per row). The tenant clause means a
   * foreign-tenant patient can never supply a name even if an appointment row
   * were crafted to reference one.
   */
  async listAppointments(): Promise<PortalAppointmentListResponse> {
    const { tenantId, customerId } = this.requirePortalScope();
    const patientIds = await holderPatientIds(this.prisma, tenantId, customerId);
    if (patientIds.length === 0) {
      return { timeZone: TENANT_TIMEZONE, appointments: [] };
    }
    const rows = await this.prisma.appointment.findMany({
      where: { tenantId, patientId: { in: patientIds } },
    });
    if (rows.length === 0) {
      return { timeZone: TENANT_TIMEZONE, appointments: [] };
    }

    const appointmentPatientIds = [...new Set(rows.map((row) => row.patientId))];
    const patients = await this.prisma.patient.findMany({
      where: { tenantId, id: { in: appointmentPatientIds } },
    });
    const patientNames = new Map(patients.map((patient) => [patient.id, patient.name]));

    const appointments = rows
      .map((row) => {
        const patientName = patientNames.get(row.patientId);
        if (patientName === undefined) {
          // A row without a resolvable in-tenant patient is an integrity
          // breach, not a client error: fail loudly instead of printing an id.
          throw new DomainError(
            "INTERNAL",
            "Appointment references a patient that cannot be resolved."
          );
        }
        return toAppointmentSummary(row, patientName);
      })
      .sort((left, right) => left.startAt.localeCompare(right.startAt));

    return { timeZone: TENANT_TIMEZONE, appointments };
  }

  /** One appointment, only when it belongs to a holder-owned pet. */
  async getAppointment(id: string): Promise<PortalAppointment> {
    const { tenantId, customerId } = this.requirePortalScope();
    const patientIds = await holderPatientIds(this.prisma, tenantId, customerId);
    if (patientIds.length === 0) {
      throw portalResourceNotFound();
    }
    const row = await this.prisma.appointment.findFirst({
      where: { id, tenantId, patientId: { in: patientIds } },
    });
    if (!row) {
      throw portalResourceNotFound();
    }
    return toAppointment(row);
  }

  /**
   * Resolves the species/breed NAMES for a batch of pets in exactly ONE
   * set-based read (`species.findMany` with `include.breeds`), never one lookup
   * per pet. The count is constant regardless of how many pets are involved.
   *
   * `Species`/`Breed` are GLOBAL reference tables with NO tenant column, so this
   * query is deliberately NOT tenant-filtered — a tenant predicate would be a
   * category error, and there is no cross-tenant read to guard. Scope is
   * enforced by construction instead: only the species ids the pets reference
   * are requested, and a breed name is read out of the nested breeds of one of
   * those species only. The catalog is therefore never returned as a list, and a
   * species/breed the holder's pets do not have can never reach the response.
   */
  private async resolvePetNames(rows: readonly PortalPatientRow[]): Promise<PortalPetNames> {
    const speciesIds = [...new Set(rows.map((row) => row.speciesId))];
    const breedIds = new Set(
      rows.map((row) => row.breedId).filter((id): id is string => id !== null)
    );
    if (speciesIds.length === 0) {
      return { speciesNames: new Map(), breedNames: new Map() };
    }

    const species = await this.prisma.species.findMany({
      where: { id: { in: speciesIds } },
      include: { breeds: true },
    });

    const involvedSpeciesIds = new Set(speciesIds);
    const speciesNames = new Map<string, string>();
    const breedNames = new Map<string, string>();
    for (const row of species) {
      // Defensive: a species the batch does not reference can never contribute.
      if (!involvedSpeciesIds.has(row.id)) {
        continue;
      }
      speciesNames.set(row.id, row.name);
      for (const breed of row.breeds) {
        if (breedIds.has(breed.id)) {
          breedNames.set(breed.id, breed.name);
        }
      }
    }
    return { speciesNames, breedNames };
  }

  /**
   * Portal context contract: the guard always sets tenant + holder Customer
   * together, so a partial context is a wiring breach surfaced as
   * UNAUTHENTICATED rather than a permissive read.
   */
  private requirePortalScope(): { tenantId: string; customerId: string } {
    return {
      tenantId: this.requestContext.requireTenantId(),
      customerId: this.requestContext.requirePortalCustomerId(),
    };
  }
}

/** Comparator factory: most recent first for a nullable/required date accessor. */
function byMostRecentFirst<T>(read: (row: T) => Date): (left: T, right: T) => number {
  return (left, right) => read(right).getTime() - read(left).getTime();
}
