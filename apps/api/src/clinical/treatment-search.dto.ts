import { z } from "zod";

export const TREATMENT_PAGE_SIZE = 20;
export const treatmentSearchBody = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .refine((q) => q.length === 0 || q.length >= 2)
      .default(""),
    page: z.number().int().min(1).max(10000).default(1),
    period: z.enum(["all", "last30"]).default("all"),
    sort: z.enum(["recent", "oldest"]).default("recent"),
  })
  .strict();
export type TreatmentSearchInput = z.infer<typeof treatmentSearchBody>;
/** CONFIDENTIAL staff-only projection; context is fetched only on opening detail. */
export interface TreatmentSummary {
  id: string;
  description: string;
  administeredAt: string;
}
export interface TreatmentDetail extends TreatmentSummary {
  version: number;
  context: string | null;
}
export interface TreatmentSearchResponse {
  items: TreatmentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
