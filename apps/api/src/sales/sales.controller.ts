import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { SaleResponse } from "./sales.dto.js";
import { SALES_PERMISSIONS } from "./sales.permissions.js";
import { SalesService } from "./sales.service.js";
import { createSaleBody, saleIdParam, saleListQuery, updateSaleBody } from "./sales.zod.js";

/**
 * Private tenant-scoped sale draft surface (EPIC-12 POS-001).
 *
 * Routes are unprefixed (`/sales`, not `/api/v1/sales`) per DEC-002. Every route
 * declares the granular `sales.*` permission it needs, and the service
 * re-asserts the `sales` entitlement first and the permission second as defense
 * in depth. Input is Zod-validated and responses are allowlisted INTERNAL DTOs —
 * no Prisma model crosses the boundary.
 *
 * The surface is EXACTLY five routes: two reads, the draft create, the draft
 * update (which reconciles the whole line set by `catalogItemId`) and the
 * explicit `POST /sales/:id/cancel` transition. There is deliberately NO `PATCH`
 * (status is server-owned) and NO delete route anywhere: a draft drops a line
 * through the update command and a settled sale is immutable (DEC-023).
 * Completion and payment are POS-003 and have no route here.
 */
@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /**
   * Lists the caller tenant's sales with their lines, newest first. The optional
   * `status` filter has NO implicit default.
   */
  @Get()
  @RequirePermissions(SALES_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<SaleResponse[]> {
    const filters = parseInput(saleListQuery, query, "Invalid sale filters.");
    return this.sales.listSales(filters);
  }

  /** Creates a `DRAFT` sale; the mutation and its audit row co-commit. */
  @Post()
  @RequirePermissions(SALES_PERMISSIONS.create)
  async create(@Body() body: unknown): Promise<SaleResponse> {
    const input = parseInput(createSaleBody, body, "Invalid sale create body.");
    return this.sales.create(input);
  }

  /** Gets one sale by UUID; a cross-tenant id returns the same `404` as absent. */
  @Get(":id")
  @RequirePermissions(SALES_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<SaleResponse> {
    const { id } = parseInput(saleIdParam, params, "Invalid sale id.");
    return this.sales.getSale(id);
  }

  /**
   * Updates a `DRAFT` sale: `customerId` may change (or be cleared) and `lines`
   * is the authoritative line set, reconciled by `catalogItemId`. A foreign or
   * unknown id returns the same `404` as absent; any status other than `DRAFT`
   * is a stable `409`.
   */
  @Put(":id")
  @RequirePermissions(SALES_PERMISSIONS.update)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<SaleResponse> {
    const { id } = parseInput(saleIdParam, params, "Invalid sale id.");
    const input = parseInput(updateSaleBody, body, "Invalid sale update body.");
    return this.sales.update(id, input);
  }

  /**
   * Cancels a `DRAFT` sale. `CANCELLED` is reachable only from `DRAFT`; a
   * `COMPLETED` or already-`CANCELLED` sale is a stable `409` and nothing is
   * persisted. Cancellation never deletes the sale or its lines.
   */
  @Post(":id/cancel")
  @RequirePermissions(SALES_PERMISSIONS.cancel)
  async cancel(@Param() params: unknown): Promise<SaleResponse> {
    const { id } = parseInput(saleIdParam, params, "Invalid sale id.");
    return this.sales.cancel(id);
  }
}

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
function parseInput<T>(
  schema: { safeParse: (value: unknown) => SafeParseReturnType<unknown, T> },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", message);
  }
  return parsed.data;
}
