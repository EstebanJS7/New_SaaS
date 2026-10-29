import { z } from "zod";

export const CUSTOMER_PAGE_SIZE = 20;
export const customerSearchBody = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .refine((q) => q.length === 0 || q.length >= 2)
      .default(""),
    page: z.number().int().min(1).max(10000).default(1),
    status: z.enum(["active", "inactive", "all"]).default("active"),
    kind: z.enum(["all", "INDIVIDUAL", "COMPANY"]).default("all"),
    sort: z.enum(["name", "recent"]).default("name"),
  })
  .strict();
export type CustomerSearchInput = z.infer<typeof customerSearchBody>;
/** CONFIDENTIAL identity only; documents, tax IDs and contact values stay out. */
export interface CustomerSearchRow {
  id: string;
  displayName: string;
  kind: "INDIVIDUAL" | "COMPANY";
  isActive: boolean;
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
}
export interface CustomerSearchResponse {
  items: CustomerSearchRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
