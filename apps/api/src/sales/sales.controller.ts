import { Body, Controller, Get, Headers, Param, Post, Put, Query, Res } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { FastifyReply } from "fastify";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { CompletedSaleResponse, SaleResponse } from "./sales.dto.js";
import { SALES_PERMISSIONS } from "./sales.permissions.js";
import { SalesService } from "./sales.service.js";
import {
  completeSaleBody,
  createSaleBody,
  saleIdempotencyKey,
  saleIdParam,
  saleListQuery,
  updateSaleBody,
} from "./sales.zod.js";

/**
 * Private tenant-scoped sale draft surface (EPIC-12 POS-001).
 *
 * Routes are unprefixed (`/sales`, not `/api/v1/sales`) per DEC-002. Every route
 * declares the granular `sales.*` permission it needs, and the service
 * re-asserts the `sales` entitlement first and the permission second as defense
 * in depth. Input is Zod-validated and responses are allowlisted INTERNAL DTOs —
 * no Prisma model crosses the boundary.
 *
 * The surface is EXACTLY six routes: two reads, the draft create, the draft
 * update (which reconciles the whole line set by `catalogItemId`), the explicit
 * `POST /sales/:id/cancel` transition and the explicit
 * `POST /sales/:id/complete` command. There is deliberately NO `PATCH` (status
 * is server-owned) and NO delete route anywhere: a draft drops a line through
 * the update command and a settled sale is immutable (DEC-023).
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

  /**
   * Completes a `DRAFT` sale: the explicit `DRAFT` → `COMPLETED` command that
   * validates, freezes, records payments and writes the stock and cash effects
   * atomically (POS-003). The body is the strict payment set and the optional
   * `Idempotency-Key` header is length-bounded before the service runs.
   *
   * The HTTP status is DYNAMIC (`@HttpCode` is static): a fresh completion is
   * `201` and an identical idempotency replay is `200`, with the SAME completed
   * sale body in both cases (DEC-024, resolution 3 of 2026-09-29).
   */
  @Post(":id/complete")
  @RequirePermissions(SALES_PERMISSIONS.complete)
  async complete(
    @Param() params: unknown,
    @Body() body: unknown,
    @Headers() headers: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<CompletedSaleResponse> {
    const { id } = parseInput(saleIdParam, params, "Invalid sale id.");
    const input = parseInput(completeSaleBody, body, "Invalid sale completion body.");
    const idempotencyKey = readIdempotencyKey(headers);
    const result = await this.sales.complete(id, input, idempotencyKey);
    reply.status(result.replay ? 200 : 201);
    return result.sale;
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

/**
 * Reads and length-bounds the optional `Idempotency-Key` header (DEC-024).
 * Fastify lower-cases incoming header names, so the lookup is on
 * `idempotency-key`; an absent header yields `undefined`, and a present value
 * that is not a 1..255 character string is the stable `400 VALIDATION_FAILED`
 * before the service runs.
 */
function readIdempotencyKey(headers: unknown): string | undefined {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }
  const value = (headers as Record<string, unknown>)["idempotency-key"];
  if (value === undefined) {
    return undefined;
  }
  return parseInput(saleIdempotencyKey, value, "Invalid Idempotency-Key header.");
}
