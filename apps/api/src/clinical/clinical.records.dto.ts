/**
 * Allowlisted specialized clinical record response contracts (EPIC-06 WU2B).
 * Prisma models are NEVER returned from the service; every field that leaves
 * the boundary is listed here explicitly.
 *
 * Data classification: all clinical content is CONFIDENTIAL. Logs and audit
 * metadata carry stable IDs and field names only, never clinical free text.
 */

export interface ClinicalTreatmentResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly description: string;
  readonly administeredAt: string;
  readonly context: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClinicalVaccinationResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly vaccine: string;
  readonly administeredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClinicalDewormingResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly product: string;
  readonly administeredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClinicalStudyResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly studyType: string;
  readonly performedAt: string;
  readonly result: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClinicalWeightResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  /** Exact positive decimal rendered as a string (never a JS float). */
  readonly quantity: string;
  readonly measuredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
