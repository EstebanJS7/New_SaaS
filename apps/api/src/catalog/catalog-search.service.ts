import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  CATALOG_PAGE_SIZE,
  type CatalogSearchInput,
  type CatalogSearchResponse,
} from "./catalog-search.dto.js";

@Injectable()
export class CatalogSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly permissions: PermissionResolver
  ) {}
  async search(input: CatalogSearchInput): Promise<CatalogSearchResponse> {
    const tenantId = this.context.requireTenantId();
    const keys = await this.permissions.resolveForActiveRequest();
    if (!keys.has("catalog.read"))
      throw new DomainError("FORBIDDEN", "The required catalog permission is missing.");
    const where: Prisma.CatalogItemWhereInput = {
      tenantId,
      ...(input.status !== "all" && { isActive: input.status === "active" }),
      ...(input.kind !== "all" && { kind: input.kind }),
      ...(input.q && { name: { contains: input.q, mode: "insensitive" } }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.catalogItem.count({ where });
        const totalPages = Math.ceil(total / CATALOG_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const rows = await tx.catalogItem.findMany({
          where,
          take: CATALOG_PAGE_SIZE,
          skip: (page - 1) * CATALOG_PAGE_SIZE,
          orderBy:
            input.sort === "recent"
              ? [{ createdAt: "desc" }, { id: "asc" }]
              : [{ name: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            kind: true,
            isActive: true,
            taxRate: { select: { name: true } },
            referencePriceAmount: true,
            referencePriceCurrency: true,
          },
        });
        return {
          items: rows.map((row) => ({
            id: row.id,
            name: row.name,
            kind: row.kind,
            isActive: row.isActive,
            taxRateName: row.taxRate.name,
            // Stored NUMERIC(14,2): fixed-scale serialization only, no arithmetic.
            referencePriceAmount: row.referencePriceAmount?.toFixed(2) ?? null,
            referencePriceCurrency: row.referencePriceCurrency,
          })),
          page,
          pageSize: CATALOG_PAGE_SIZE,
          total,
          totalPages,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }
}
