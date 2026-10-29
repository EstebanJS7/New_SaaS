import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  CUSTOMER_PAGE_SIZE,
  type CustomerSearchInput,
  type CustomerSearchResponse,
} from "./customer-search.dto.js";

@Injectable()
export class CustomerSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly permissions: PermissionResolver
  ) {}

  async search(input: CustomerSearchInput): Promise<CustomerSearchResponse> {
    const tenantId = this.context.requireTenantId();
    const keys = await this.permissions.resolveForActiveRequest();
    if (!keys.has("customers.read"))
      throw new DomainError("FORBIDDEN", "Customer read permission is required.");
    // Customers is an ungated Core directory. Do not copy Veterinary/Sales entitlement gates.
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(input.status !== "all" && { isActive: input.status === "active" }),
      ...(input.kind !== "all" && { kind: input.kind }),
      ...(input.q && {
        OR: [
          { displayName: { contains: input.q, mode: "insensitive" } },
          { legalName: { contains: input.q, mode: "insensitive" } },
          { documentNumber: { contains: input.q, mode: "insensitive" } },
          { taxId: { contains: input.q, mode: "insensitive" } },
        ],
      }),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.customer.count({ where });
        const totalPages = Math.ceil(total / CUSTOMER_PAGE_SIZE);
        const page = Math.min(input.page, Math.max(1, totalPages));
        const items = await tx.customer.findMany({
          where,
          take: CUSTOMER_PAGE_SIZE,
          skip: (page - 1) * CUSTOMER_PAGE_SIZE,
          orderBy:
            input.sort === "recent"
              ? [{ createdAt: "desc" }, { id: "asc" }]
              : [{ displayName: "asc" }, { id: "asc" }],
          select: {
            id: true,
            displayName: true,
            kind: true,
            isActive: true,
            firstName: true,
            lastName: true,
            legalName: true,
          },
        });
        return { items, page, pageSize: CUSTOMER_PAGE_SIZE, total, totalPages };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }
}
