import { z } from "zod";

/**
 * Allowlisted portal READ response contracts (EPIC-08 WU3).
 *
 * Every field that crosses the portal boundary is listed here explicitly; a
 * Prisma model is NEVER returned. The projection is deliberately stricter than
 * the staff DTOs: no `tenantId` echo, no `internalNotes`, no reason/anamnesis/
 * diagnosis/treatmentPlan, and no subdomains the epic defers (treatments,
 * deworming, studies, weights, invoices, documents).
 *
 * Data classification: pet and clinical content is CONFIDENTIAL. Responses are
 * built by explicit mappers; logs carry stable IDs only and never a
 * CONFIDENTIAL payload.
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

/** Holder-owned pet identity — species/breed as stable ids, no tenant echo. */
export interface PortalPetSummary {
  readonly id: string;
  readonly name: string;
  readonly speciesId: string;
  readonly breedId: string | null;
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
