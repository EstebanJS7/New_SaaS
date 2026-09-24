import { z } from "zod";

/**
 * Allowlisted portal READ response contracts (EPIC-08 WU3).
 *
 * Every field that crosses the portal boundary is listed here explicitly; a
 * Prisma model is NEVER returned. The projection is deliberately stricter than
 * the staff DTOs: no `tenantId` echo, no `internalNotes`, no reason/anamnesis/
 * diagnosis/treatmentPlan, no appointment provenance, and no subdomains the
 * epic defers (treatments, deworming, studies, weights, invoices, documents).
 *
 * Data classification: pet, clinical and appointment content is CONFIDENTIAL.
 * Responses are built by explicit mappers; logs carry stable IDs only and never
 * a CONFIDENTIAL payload.
 */

/** Current contract version of the portal read DTOs. */
export const PORTAL_READ_DTO_SCHEMA_VERSION = 1;

/**
 * Path-param contract shared by every holder-owned portal read. The id is
 * always a UUID; a holder-supplied `tenantId`/`customerId` is never accepted
 * because identity is resolved server-side from the portal session.
 */
export const portalResourceIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export type PortalResourceIdParam = z.infer<typeof portalResourceIdParamSchema>;

export type PortalPatientSexDto = "MALE" | "FEMALE" | "UNKNOWN";

export type PortalEncounterStatusDto = "DRAFT" | "CLOSED";

export type PortalAppointmentStatusDto =
  "SCHEDULED" | "CONFIRMED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/**
 * Holder-owned pet identity — species/breed as stable ids AND resolved names,
 * no tenant echo.
 *
 * `speciesName`/`breedName` are RESOLVED SERVER-SIDE from the GLOBAL Species/
 * Breed reference tables (no tenant column), the same way the appointment list
 * resolves `patientName`. They carry ONLY the names of this pet's own species
 * and breed: the catalog is never returned as a list, and a species or breed the
 * holder's pets do not have is never emitted. `breedName` mirrors the nullable
 * `breedId` — a pet with no breed has no name either.
 */
export interface PortalPetSummary {
  readonly id: string;
  readonly name: string;
  readonly speciesId: string;
  readonly speciesName: string;
  readonly breedId: string | null;
  readonly breedName: string | null;
  readonly sex: PortalPatientSexDto;
  readonly birthDate: string | null;
  readonly isActive: boolean;
}

/**
 * Client-safe clinical summary. ONLY `clientSummary` is exposed — the staff
 * free-text fields (`reasonForVisit`, `anamnesis`, `diagnosis`,
 * `treatmentPlan`) and `internalNotes` never appear here.
 */
export interface PortalClinicalSummary {
  readonly id: string;
  readonly status: PortalEncounterStatusDto;
  readonly clientSummary: string;
  readonly closedAt: string | null;
}

/** Vaccination history entry (vaccine + administration date). */
export interface PortalVaccination {
  readonly id: string;
  readonly vaccine: string;
  readonly administeredAt: string;
}

/** Pet detail: allowlisted identity plus the clinical summary + vaccinations. */
export interface PortalPetDetail extends PortalPetSummary {
  readonly clinical: {
    readonly encounters: readonly PortalClinicalSummary[];
    readonly vaccinations: readonly PortalVaccination[];
  };
}

/** Holder-owned appointment; no tenant, provenance or internal linkage. */
export interface PortalAppointment {
  readonly id: string;
  readonly patientId: string;
  readonly status: PortalAppointmentStatusDto;
  readonly startAt: string;
  readonly endAt: string;
  /**
   * Optimistic-concurrency guard the holder echoes back when rescheduling
   * (DEC-007 A2d). It is the row's own version, never a tenant/provenance
   * identifier, so exposing it leaks nothing the holder cannot already infer
   * from the mutation contract.
   */
  readonly version: number;
}

/**
 * Holder-owned appointment as the LIST returns it: the allowlisted appointment
 * plus the pet name RESOLVED SERVER-SIDE.
 *
 * `patientName` exists so the client never has to read the pets collection and
 * join in memory just to label a row. It is the ONLY patient field exposed — no
 * species, no breed, no owner link. The single-appointment read keeps the lean
 * `PortalAppointment` shape because it renders no name-labelled list.
 */
export interface PortalAppointmentSummary extends PortalAppointment {
  readonly patientName: string;
}

/**
 * Appointment list envelope: the interval data travels WITH the zone that names
 * its day, exactly like the availability and booking-request reads. Each
 * `startAt`/`endAt` stays a UTC instant; `timeZone` is what lets the client
 * render the clinic-local day without a second availability probe.
 */
export interface PortalAppointmentListResponse {
  readonly timeZone: string;
  readonly appointments: readonly PortalAppointmentSummary[];
}
