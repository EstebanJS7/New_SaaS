import { z } from "zod";
import { Prisma } from "@newsaas/database";

export const WEIGHT_PAGE_SIZE = 20;
const decimalShape = /^\d{1,7}(\.\d{1,3})?$/;
const bound = z
  .string()
  .trim()
  .regex(decimalShape)
  .pipe(z.string().refine((value) => new Prisma.Decimal(value).greaterThan(0)));
export const weightSearchBody = z
  .object({
    page: z.number().int().min(1).max(10000).default(1),
    period: z.enum(["all", "last30"]).default("all"),
    sort: z.enum(["recent", "oldest"]).default("recent"),
    minQuantity: bound.optional(),
    maxQuantity: bound.optional(),
    unit: z.enum(["all", "KG", "unspecified"]).optional(),
  })
  .strict()
  .superRefine(({ minQuantity, maxQuantity, unit }, context) => {
    if (unit === "all" && (minQuantity !== undefined || maxQuantity !== undefined))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unit"],
        message: "Select one unit for a weight range.",
      });
    if (
      minQuantity !== undefined &&
      maxQuantity !== undefined &&
      decimalShape.test(minQuantity) &&
      decimalShape.test(maxQuantity) &&
      new Prisma.Decimal(minQuantity).greaterThan(maxQuantity)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minQuantity"],
        message: "Minimum must not exceed maximum.",
      });
    }
  });
export type WeightSearchInput = z.infer<typeof weightSearchBody>;
/** CONFIDENTIAL; exact stored decimal, no inferred unit or clinical interpretation. */
export interface WeightSummary {
  id: string;
  quantity: string;
  unit: "KG" | null;
  measuredAt: string;
}
export type WeightDetail = WeightSummary;
export interface WeightSearchResponse {
  items: WeightSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
