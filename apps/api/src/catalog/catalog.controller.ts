import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { CATALOG_PERMISSIONS } from "./catalog.permissions.js";
import { CatalogService } from "./catalog.service.js";
import {
  catalogItemIdParam,
  catalogItemListQuery,
  createCatalogItemBody,
  updateCatalogItemBody,
} from "./catalog.zod.js";
import type { CatalogItemResponse } from "./catalog.dto.js";

/**
 * Private tenant-scoped catalog item surface (EPIC-09 WU2).
 *
 * Routes are unprefixed (`/catalog`, not `/api/v1/catalog`) per DEC-002. Every
 * route declares the granular `catalog.*` permission it needs and the service
 * re-asserts it as defense in depth. Input is Zod-validated and responses are
 * allowlisted INTERNAL DTOs — no Prisma model crosses the boundary.
 *
 * The GLOBAL rate list lives on its own controller/route (`/catalog/tax-rates`)
 * and is registered BEFORE this one so the static segment can never be captured
 * as an item `:id`.
 *
 * Mutations are command-shaped: create and update are ordinary writes, and
 * removal is the explicit `POST /catalog/:id/deactivate` transition (the
 * purchases/sales/cash command convention). There is deliberately NO
 * `PATCH status=` and NO delete route anywhere: a catalog item is deactivated,
 * never deleted, matching the database trigger that rejects DELETE.
 */
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Lists the caller tenant's items; `kind`/`isActive` filters are optional. */
  @Get()
  @RequirePermissions(CATALOG_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<CatalogItemResponse[]> {
    const filters = parseInput(catalogItemListQuery, query, "Invalid catalog filters.");
    return this.catalog.listItems(filters);
  }

  /**
   * Creates an item. `taxRateId` is required and must resolve to one of the
   * three GLOBAL seeded rates; the mutation and its audit row co-commit.
   */
  @Post()
  @RequirePermissions(CATALOG_PERMISSIONS.create)
  async create(@Body() body: unknown): Promise<CatalogItemResponse> {
    const input = parseInput(createCatalogItemBody, body, "Invalid catalog item create body.");
    return this.catalog.create(input);
  }

  /**
   * Gets one item by UUID; a cross-tenant id returns the same `404` as absent.
   */
  @Get(":id")
  @RequirePermissions(CATALOG_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<CatalogItemResponse> {
    const { id } = parseInput(catalogItemIdParam, params, "Invalid catalog item id.");
    return this.catalog.getItem(id);
  }

  /**
   * Updates an item. Every field is optional; an omitted `taxRateId` leaves the
   * selected rate unchanged and an omitted reference-price field leaves the
   * pair untouched. A foreign or unknown id returns the same `404` as absent.
   */
  @Put(":id")
  @RequirePermissions(CATALOG_PERMISSIONS.update)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<CatalogItemResponse> {
    const { id } = parseInput(catalogItemIdParam, params, "Invalid catalog item id.");
    const input = parseInput(updateCatalogItemBody, body, "Invalid catalog item update body.");
    return this.catalog.update(id, input);
  }

  /**
   * Idempotently soft-deactivates an item; no hard delete exists, and a repeat
   * deactivation still co-commits exactly one audit row.
   */
  @Post(":id/deactivate")
  @RequirePermissions(CATALOG_PERMISSIONS.deactivate)
  async deactivate(@Param() params: unknown): Promise<CatalogItemResponse> {
    const { id } = parseInput(catalogItemIdParam, params, "Invalid catalog item id.");
    return this.catalog.deactivate(id);
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
