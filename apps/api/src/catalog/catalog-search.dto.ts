import { z } from "zod";
import { CATALOG_ITEM_KINDS } from "./catalog.zod.js";
import type { CatalogItemKindDto } from "./catalog.dto.js";
export const CATALOG_PAGE_SIZE = 20;
export const catalogSearchBody = z
  .object({
    q: z
      .string()
      .trim()
      .max(80)
      .refine((q) => q.length === 0 || q.length >= 2)
      .default(""),
    page: z.number().int().min(1).max(10000).default(1),
    status: z.enum(["active", "inactive", "all"]).default("active"),
    kind: z.enum(["all", ...CATALOG_ITEM_KINDS]).default("all"),
    sort: z.enum(["name", "recent"]).default("name"),
  })
  .strict();
export type CatalogSearchInput = z.infer<typeof catalogSearchBody>;
/** INTERNAL configuration only; no stock, fiscal documents or personal data. */
export interface CatalogSearchRow {
  id: string;
  name: string;
  kind: CatalogItemKindDto;
  isActive: boolean;
  taxRateName: string;
  referencePriceAmount: string | null;
  referencePriceCurrency: string | null;
}
export interface CatalogSearchResponse {
  items: CatalogSearchRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
