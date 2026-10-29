import { z } from "zod";

export const PATIENT_PAGE_SIZE = 20;
export const patientSearchBody = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .refine((q) => q.length === 0 || q.length >= 2)
      .default(""),
    page: z.number().int().min(1).max(10000).default(1),
    status: z.enum(["active", "inactive", "all"]).default("active"),
    sort: z.enum(["name", "recent"]).default("name"),
  })
  .strict();
export type PatientSearchInput = z.infer<typeof patientSearchBody>;
export interface PatientSearchRow {
  id: string;
  name: string;
  isActive: boolean;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  speciesName: string;
  breedName: string | null;
  primaryGuardianName: string | null;
}
export interface PatientSearchResponse {
  items: PatientSearchRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  canReadGuardians: boolean;
}
