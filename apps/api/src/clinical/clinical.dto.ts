/**
 * Allowlisted clinical encounter response contracts (EPIC-06 WU2A). Prisma
 * models are NEVER returned from the service; every field that leaves the
 * boundary is listed here explicitly.
 *
 * Data classification: all clinical content is CONFIDENTIAL. `internalNotes`
 * is staff-only and MUST NOT reach a client-safe projection or the Portal —
 * use {@link toClientSafeEncounter} for the client-safe view. Logs and audit
 * metadata carry stable IDs and field names only, never clinical free text.
 */

/** Current contract version of the ClinicalEncounter DTO. */
export const CLINICAL_DTO_SCHEMA_VERSION = 1;

export type ClinicalEncounterStatusDto = "DRAFT" | "CLOSED";

/** ISO-8601 rendering for every `Date` that crosses the clinical boundary. */
export function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * Staff encounter response. Includes `internalNotes` because staff are the
 * authorized audience; the client-safe projection strips it.
 */
export interface ClinicalEncounterResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly status: ClinicalEncounterStatusDto;
  readonly version: number;
  readonly reasonForVisit: string | null;
  readonly anamnesis: string | null;
  readonly diagnosis: string | null;
  readonly treatmentPlan: string | null;
  readonly internalNotes: string | null;
  readonly clientSummary: string | null;
  readonly amendsEncounterId: string | null;
  readonly amendmentReason: string | null;
  readonly closedAt: string | null;
  readonly closedByUserProfileId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Client-safe encounter view. Structurally the staff response minus
 * `internalNotes`; `toClientSafeEncounter` is the ONLY sanctioned way to
 * produce it.
 */
export type ClientSafeClinicalEncounter = Omit<ClinicalEncounterResponse, "internalNotes">;

/** Strips staff-only `internalNotes`; a new object, never the input mutated. */
export function toClientSafeEncounter(
  encounter: ClinicalEncounterResponse
): ClientSafeClinicalEncounter {
  const { internalNotes: _internalNotes, ...clientSafe } = encounter;
  return clientSafe;
}
