import { z } from "zod";

export const PATIENT_SEARCH_LIMIT = 20;
export const PATIENT_IDENTITY_LIMIT = 50;

export const patientLookupBody = z.union([
  z.object({ q: z.string().trim().min(2).max(80) }).strict(),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(PATIENT_IDENTITY_LIMIT) }).strict(),
]);

export type PatientLookupInput = z.infer<typeof patientLookupBody>;

/** CONFIDENTIAL identity only; no clinical, contact or fiscal data. */
export interface PatientIdentityResponse {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly speciesName: string;
  readonly primaryGuardianName: string | null;
}
