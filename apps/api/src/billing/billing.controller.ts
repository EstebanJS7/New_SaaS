import { Body, Controller, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { InvoiceResponse } from "./billing.dto.js";
import { BILLING_PERMISSIONS } from "./billing.permissions.js";
import { BillingService } from "./billing.service.js";
import { createInvoiceBody } from "./billing.zod.js";

/**
 * Private tenant-scoped invoice surface (EPIC-14 BILL-002).
 *
 * Routes are unprefixed (`/invoices`, not `/api/v1/invoices`) per DEC-002. The
 * route declares the granular `billing.create` permission it needs, and the
 * service re-asserts the `billing` entitlement first and the permission second
 * as defense in depth. Input is Zod-validated and the response is an allowlisted
 * INTERNAL DTO — no Prisma model crosses the boundary.
 *
 * This work unit ships EXACTLY ONE route. The two `GET` reads are W3's and are
 * deliberately absent, as are any placeholder handlers; `billing.confirm` and
 * `billing.cancel` are BILL-003's keys and are never referenced by a route here.
 * There is no `PATCH` and no delete route anywhere: the invoice is immutable
 * from creation (DEC-038/DEC-043).
 */
@Controller("invoices")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

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
