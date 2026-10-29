import { z } from "zod";
import type { SaleStatusDto } from "./sales.dto.js";

export const SALE_PAGE_SIZE = 20;
export const saleSearchBody = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .refine((q) => q.length === 0 || q.length >= 2)
      .default(""),
    page: z.number().int().min(1).max(10000).default(1),
    status: z.enum(["all", "DRAFT", "COMPLETED", "CANCELLED"]).default("all"),
    sort: z.enum(["recent", "oldest"]).default("recent"),
  })
  .strict();
export type SaleSearchInput = z.infer<typeof saleSearchBody>;
export interface SaleSearchResponse {
  items: {
    id: string;
    status: SaleStatusDto;
    createdAt: string;
    customerName: string | null;
    hasCustomer: boolean;
  }[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  canReadCustomers: boolean;
}
