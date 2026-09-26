import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { PurchaseResponse } from "./purchases.dto.js";
import { PURCHASES_PERMISSIONS } from "./purchases.permissions.js";
import { PurchasesService } from "./purchases.service.js";
import {
  createPurchaseBody,
  purchaseIdParam,
  purchaseListQuery,
  updatePurchaseBody,
} from "./purchases.zod.js";

/**
 * Private tenant-scoped purchase draft surface (EPIC-11 PUR-001).
 *
 * Routes are unprefixed (`/purchases`, not `/api/v1/purchases`) per DEC-002.
 * Every route declares the granular `purchases.*` permission it needs and the
 * service re-asserts it as defense in depth. Input is Zod-validated and
 * responses are allowlisted INTERNAL DTOs — no Prisma model crosses the
 * boundary.
 *
 * The surface is EXACTLY five routes: two reads, the draft create, the draft
 * update (which reconciles the whole line set by `catalogItemId`) and the
 * explicit `POST /purchases/:id/cancel` transition. There is deliberately NO
 * `PATCH` (status is server-owned) and NO delete route anywhere: a draft drops
 * a line through the update command and a confirmed purchase is immutable
 * (DEC-015/DEC-019). No receive route exists here — that is PUR-002.
 */
@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  /**
   * Lists the caller tenant's purchases with their lines, newest first. The
   * optional `status` filter has NO implicit default.
   */
  @Get()
  @RequirePermissions(PURCHASES_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<PurchaseResponse[]> {
    const filters = parseInput(purchaseListQuery, query, "Invalid purchase filters.");
    return this.purchases.listPurchases(filters);
  }

  /** Creates a `DRAFT` purchase; the mutation and its audit row co-commit. */
  @Post()
  @RequirePermissions(PURCHASES_PERMISSIONS.create)
  async create(@Body() body: unknown): Promise<PurchaseResponse> {
    const input = parseInput(createPurchaseBody, body, "Invalid purchase create body.");
    return this.purchases.create(input);
  }

  /** Gets one purchase by UUID; a cross-tenant id returns the same `404` as absent. */
  @Get(":id")
  @RequirePermissions(PURCHASES_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<PurchaseResponse> {
    const { id } = parseInput(purchaseIdParam, params, "Invalid purchase id.");
    return this.purchases.getPurchase(id);
  }

  /**
   * Updates a `DRAFT` purchase: `supplierId` may change and `lines` is the
   * authoritative line set, reconciled by `catalogItemId`. A foreign or unknown
   * id returns the same `404` as absent; any status other than `DRAFT` is a
   * stable `409`.
   */
  @Put(":id")
  @RequirePermissions(PURCHASES_PERMISSIONS.update)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<PurchaseResponse> {
    const { id } = parseInput(purchaseIdParam, params, "Invalid purchase id.");
    const input = parseInput(updatePurchaseBody, body, "Invalid purchase update body.");
    return this.purchases.update(id, input);
  }

  /**
   * Cancels a `DRAFT` purchase. `CANCELLED` is reachable only from `DRAFT`; a
   * `RECEIVED` or already-`CANCELLED` purchase is a stable `409` and nothing is
   * persisted. Cancellation never deletes the purchase or its lines.
   */
  @Post(":id/cancel")
  @RequirePermissions(PURCHASES_PERMISSIONS.cancel)
  async cancel(@Param() params: unknown): Promise<PurchaseResponse> {
    const { id } = parseInput(purchaseIdParam, params, "Invalid purchase id.");
    return this.purchases.cancel(id);
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
