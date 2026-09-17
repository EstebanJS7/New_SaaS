import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import {
  assertHolderOwnedPatient,
  holderPatientIds,
  portalResourceNotFound,
} from "./portal-holder-scope.js";
import type {
  PortalAppointment,
  PortalAppointmentStatusDto,
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

/** Builds the allowlisted pet summary; never spreads the source row. */
function toPetSummary(row: PortalPatientRow): PortalPetSummary {
  return {
    id: row.id,
    name: row.name,
    speciesId: row.speciesId,
    breedId: row.breedId,
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
    return rows.map(toPetSummary).sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Pet detail: allowlisted identity + clinical summary + vaccinations. */
  async getPet(id: string): Promise<PortalPetDetail> {
    const { tenantId, customerId } = this.requirePortalScope();
    await assertHolderOwnedPatient(this.prisma, tenantId, customerId, id);

    const patient = await this.prisma.patient.findFirst({ where: { id, tenantId } });
    if (!patient) {
      throw portalResourceNotFound();
    }

    const [encounters, vaccinations] = await Promise.all([
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
      ...toPetSummary(patient),
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

  /** Lists appointments for holder-owned pets, earliest-start first. */
  async listAppointments(): Promise<PortalAppointment[]> {
    const { tenantId, customerId } = this.requirePortalScope();
    const patientIds = await holderPatientIds(this.prisma, tenantId, customerId);
    if (patientIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.appointment.findMany({
      where: { tenantId, patientId: { in: patientIds } },
    });
    return rows.map(toAppointment).sort((left, right) => left.startAt.localeCompare(right.startAt));
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
