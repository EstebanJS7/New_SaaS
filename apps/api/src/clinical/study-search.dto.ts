import { z } from "zod";

export const STUDY_PAGE_SIZE = 20;
export const studySearchBody = z
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
export type StudySearchInput = z.infer<typeof studySearchBody>;
/** CONFIDENTIAL staff-only projection; result is fetched only on opening detail. */
export interface StudySummary {
  id: string;
  studyType: string;
  performedAt: string;
}
export interface StudyDetail extends StudySummary {
  result: string;
}
export interface StudySearchResponse {
  items: StudySummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
