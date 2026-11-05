import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { INVENTORY_PERMISSIONS } from "./inventory.permissions.js";
import { InventoryService } from "./inventory.service.js";
import {
  createStockAdjustmentBody,
  createStockTransferBody,
  stockBalanceListQuery,
  stockMovementListQuery,
} from "./inventory.zod.js";
import type {
  StockBalanceResponse,
  StockBranchResponse,
  StockMovementResponse,
  StockTransferResponse,
} from "./inventory.dto.js";

/**
 * Private tenant-scoped inventory stock surface (EPIC-10 W2).
 *
 * Routes are unprefixed (`/inventory/stock`, not `/api/v1/inventory/stock`)
 * per DEC-002. Every route declares the granular `inventory.stock.*`
 * permission it needs and the service re-asserts it as defense in depth.
 * Input is Zod-validated and responses are allowlisted INTERNAL DTOs — no
 * Prisma model crosses the boundary.
 *
 * Mutations are command-shaped: the ONLY write is the signed adjustment
 * command `POST /inventory/stock/adjustments`. There is deliberately NO update,
 * no PATCH and no delete route anywhere on this boundary — a confirmed
 * movement is immutable and a correction is a compensating movement reserved
 * for a later slice.
 */
@Controller("inventory/stock")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** Lists the caller tenant's stock balances with their item identity. */
  @Get()
  @RequirePermissions(INVENTORY_PERMISSIONS.read)
  async listBalances(@Query() query: unknown): Promise<StockBalanceResponse[]> {
    // MB-003: one row per (item, branch); `?branchId=` narrows to one branch.
    const filters = parseInput(stockBalanceListQuery, query, "Invalid stock balance filters.");
    return this.inventory.listBalances(filters);
  }

  /**
   * MB-003: the clinic's active branches (id and name only), so the stock
   * screen can filter and offer a transfer destination without
   * `branches.manage`.
   */
  @Get("branches")
  @RequirePermissions(INVENTORY_PERMISSIONS.read)
  async listBranches(): Promise<StockBranchResponse[]> {
    return this.inventory.listStockBranches();
  }

  /**
   * Lists the caller tenant's immutable movement ledger. The optional
   * `catalogItemId` filter is resolved in-tenant, so an unknown or foreign id
   * is the shared `404` rather than an empty list.
   */
  @Get("movements")
  @RequirePermissions(INVENTORY_PERMISSIONS.read)
  async listMovements(@Query() query: unknown): Promise<StockMovementResponse[]> {
    const filters = parseInput(stockMovementListQuery, query, "Invalid stock movement filters.");
    return this.inventory.listMovements(filters);
  }

  /**
   * Applies a signed stock adjustment: a positive quantity is an input, a
   * negative one an output. The movement, its balance update and its audit row
   * co-commit; the negative-stock policy is a fixed `BLOCK`.
   */
  @Post("adjustments")
  @RequirePermissions(INVENTORY_PERMISSIONS.adjust)
  async adjust(@Body() body: unknown): Promise<StockMovementResponse> {
    const input = parseInput(createStockAdjustmentBody, body, "Invalid stock adjustment body.");
    return this.inventory.adjust(input);
  }
}

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
/**
 * MB-003 (DEC-094 §10): stock transfers between branches. Its own controller
 * path under the same prefix keeps the single-verb shape the adjustment has.
 */
@Controller("inventory/stock/transfers")
export class StockTransfersController {
  constructor(private readonly inventory: InventoryService) {}

  @Post()
  @RequirePermissions(INVENTORY_PERMISSIONS.transfer)
  async transfer(@Body() body: unknown): Promise<StockTransferResponse> {
    const input = parseInput(createStockTransferBody, body, "Invalid stock transfer body.");
    return this.inventory.transfer(input);
  }
}

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
