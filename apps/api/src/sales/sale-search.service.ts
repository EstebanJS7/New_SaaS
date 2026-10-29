import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  SALE_PAGE_SIZE,
  type SaleSearchInput,
  type SaleSearchResponse,
} from "./sale-search.dto.js";

@Injectable()
export class SaleSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionResolver
  ) {}

  async search(input: SaleSearchInput): Promise<SaleSearchResponse> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "sales")))
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Sales features are not enabled for this tenant."
      );
    const keys = await this.permissions.resolveForActiveRequest();
    if (!keys.has("sales.read"))
      throw new DomainError("FORBIDDEN", "Sale read permission is required.");
    const canReadCustomers = keys.has("customers.read");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.q);
    const matches: Prisma.SaleWhereInput[] = [
      ...(uuid ? [{ id: input.q }] : []),
      ...(canReadCustomers
        ? [
            {
              customer: {
                tenantId,
                displayName: { contains: input.q, mode: "insensitive" as const },
              },
            },
          ]
        : []),
    ];
    const where: Prisma.SaleWhereInput = {
      tenantId,
      ...(input.status !== "all" && { status: input.status }),
      // An unsearchable term must match nothing, never fall back to all sales.
      ...(input.q && (matches.length ? { OR: matches } : { id: { in: [] } })),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.sale.count({ where });
        const totalPages = Math.ceil(total / SALE_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const rows = await tx.sale.findMany({
          where,
          take: SALE_PAGE_SIZE,
          skip: (page - 1) * SALE_PAGE_SIZE,
          orderBy: [{ createdAt: input.sort === "recent" ? "desc" : "asc" }, { id: "asc" }],
          select: { id: true, status: true, createdAt: true, customerId: true },
        });
        const customers =
          canReadCustomers && rows.length
            ? await tx.customer.findMany({
                where: {
                  tenantId,
                  id: { in: rows.flatMap((row) => (row.customerId ? [row.customerId] : [])) },
                },
                select: { id: true, displayName: true },
              })
            : [];
        const names = new Map(customers.map((row) => [row.id, row.displayName]));
        return {
          items: rows.map((row) => ({
            id: row.id,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            hasCustomer: row.customerId !== null,
            customerName: row.customerId ? (names.get(row.customerId) ?? null) : null,
          })),
          page,
          pageSize: SALE_PAGE_SIZE,
          total,
          totalPages,
          canReadCustomers,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }
}
