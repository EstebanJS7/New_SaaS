import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { SUPPLIERS_PERMISSIONS } from "./suppliers.permissions.js";
import { SuppliersService } from "./suppliers.service.js";
import {
  createSupplierBody,
  supplierIdParam,
  supplierListQuery,
  updateSupplierBody,
} from "./suppliers.zod.js";
import type { SupplierResponse } from "./suppliers.dto.js";

/**
 * Private tenant-scoped supplier registry surface (EPIC-11 W2).
 *
 * Routes are unprefixed (`/suppliers`, not `/api/v1/suppliers`) per DEC-002.
 * Every route declares the granular `suppliers.*` permission it needs and the
 * service re-asserts it as defense in depth. Input is Zod-validated and
 * responses are allowlisted INTERNAL DTOs — no Prisma model crosses the
 * boundary.
 *
 * Mutations are command-shaped: create and update are ordinary writes, and
 * removal is the explicit `POST /suppliers/:id/deactivate` transition. There is
 * deliberately NO `PATCH`, no `PUT` that can set `isActive`, and NO delete route
 * anywhere: a supplier is deactivated, never deleted, so historical purchases
 * keep their reference (DEC-011).
 */
@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  /**
   * Lists the caller tenant's suppliers, name-ascending. `isActive` is an
   * optional filter with NO implicit active-only default.
   */
  @Get()
  @RequirePermissions(SUPPLIERS_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<SupplierResponse[]> {
    const filters = parseInput(supplierListQuery, query, "Invalid supplier filters.");
    return this.suppliers.listSuppliers(filters);
  }

  /** Creates a supplier; the mutation and its audit row co-commit. */
  @Post()
  @RequirePermissions(SUPPLIERS_PERMISSIONS.create)
  async create(@Body() body: unknown): Promise<SupplierResponse> {
    const input = parseInput(createSupplierBody, body, "Invalid supplier create body.");
    return this.suppliers.create(input);
  }

  /** Gets one supplier by UUID; a cross-tenant id returns the same `404` as absent. */
  @Get(":id")
  @RequirePermissions(SUPPLIERS_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<SupplierResponse> {
    const { id } = parseInput(supplierIdParam, params, "Invalid supplier id.");
    return this.suppliers.getSupplier(id);
  }

  /**
   * Updates a supplier. Every field is optional; an omitted key leaves the
   * stored value untouched and an explicit `null` clears an optional field.
   * A foreign or unknown id returns the same `404` as absent.
   */
  @Put(":id")
  @RequirePermissions(SUPPLIERS_PERMISSIONS.update)
  async update(@Param() params: unknown, @Body() body: unknown): Promise<SupplierResponse> {
    const { id } = parseInput(supplierIdParam, params, "Invalid supplier id.");
    const input = parseInput(updateSupplierBody, body, "Invalid supplier update body.");
    return this.suppliers.update(id, input);
  }

  /**
   * Idempotently soft-deactivates a supplier; no hard delete and no
   * reactivation exist, and a repeat deactivation still co-commits exactly one
   * audit row.
   */
  @Post(":id/deactivate")
  @RequirePermissions(SUPPLIERS_PERMISSIONS.deactivate)
  async deactivate(@Param() params: unknown): Promise<SupplierResponse> {
    const { id } = parseInput(supplierIdParam, params, "Invalid supplier id.");
    return this.suppliers.deactivate(id);
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
