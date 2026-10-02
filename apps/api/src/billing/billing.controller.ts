import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { InvoiceResponse } from "./billing.dto.js";
import { BILLING_PERMISSIONS } from "./billing.permissions.js";
import { BillingService } from "./billing.service.js";
import { createInvoiceBody, invoiceIdParam, invoiceListQuery } from "./billing.zod.js";

/**
 * Private tenant-scoped invoice surface (EPIC-14 BILL-002).
 *
 * Routes are unprefixed (`/invoices`, not `/api/v1/invoices`) per DEC-002. The
 * route declares the granular `billing.*` permission it needs, and the service
 * re-asserts the `billing` entitlement first and the permission second as
 * defense in depth. Input is Zod-validated and the response is an allowlisted
 * INTERNAL DTO — no Prisma model crosses the boundary.
 *
 * This work unit ships the creation command plus its two reads: the list with an
 * optional `status` filter and the id read with the document's snapshot lines.
 * BILL-003 W2 adds the explicit `POST /invoices/:id/confirm` transition behind
 * `billing.confirm`; `billing.cancel` stays BILL-003 W3 and is never referenced
 * by a route here. There is no `PATCH`, no `PUT` and no delete route anywhere:
 * the invoice is immutable from creation and its lifecycle belongs to BILL-003
 * (DEC-038/DEC-039/DEC-041/DEC-043).
 */
@Controller("invoices")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * Lists the caller tenant's invoices with their lines, newest first. The
   * optional `status` filter has NO implicit default and there is no pagination
   * (the shipped sales/cash list precedent). An unknown query key or a
   * non-enum status is the stable `400 VALIDATION_FAILED`.
   */
  @Get()
  @RequirePermissions(BILLING_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<InvoiceResponse[]> {
    const filters = parseInput(invoiceListQuery, query, "Invalid invoice filters.");
    return this.billing.listInvoices(filters);
  }

  /**
   * Gets one invoice of the caller tenant with its lines by UUID; a cross-tenant
   * id returns the same `404` as absent, with the same body. A non-UUID id is
   * the stable `400 VALIDATION_FAILED`.
   */
  @Get(":id")
  @RequirePermissions(BILLING_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<InvoiceResponse> {
    const { id } = parseInput(invoiceIdParam, params, "Invalid invoice id.");
    return this.billing.getInvoice(id);
  }

  /**
   * Creates one `DRAFT` invoice from one `COMPLETED` in-tenant sale; the invoice
   * write and its audit row co-commit. The body accepts the sale reference and
   * nothing else — the currency, the customer, the snapshot lines and the totals
   * are all derived server-side from the sale's frozen rows.
   */
  @Post()
  @RequirePermissions(BILLING_PERMISSIONS.create)
  async create(@Body() body: unknown): Promise<InvoiceResponse> {
    const input = parseInput(createInvoiceBody, body, "Invalid invoice create body.");
    return this.billing.create(input);
  }

  /**
   * Confirms one `DRAFT` in-tenant invoice, allocating its number inside the
   * same transaction as the `CONFIRMED` write. The request carries NO body and
   * requires NO `Idempotency-Key`: the transition is payload-free and guarded by
   * its own state, so a retried call returns `200` with the same representation
   * (DEC-041) and the `@HttpCode(200)` keeps the fresh and replay cases
   * identical. A `CANCELLED` invoice is the stable `409`. A non-UUID id is the
   * stable `400 VALIDATION_FAILED`.
   */
  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermissions(BILLING_PERMISSIONS.confirm)
  async confirm(@Param() params: unknown): Promise<InvoiceResponse> {
    const { id } = parseInput(invoiceIdParam, params, "Invalid invoice id.");
    return this.billing.confirmInvoice(id);
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
