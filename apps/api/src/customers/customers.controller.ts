import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { createCustomerBody, customerIdParam, updateCustomerBody } from "./customer.zod.js";
import { CustomersService } from "./customers.service.js";
import type { CustomerResponse } from "./customer.dto.js";

/**
 * Private tenant-scoped Customer management surface.
 *
 * All routes resolve the tenant exclusively server-side from the active
 * request context. Mutations are gated by the approved granular customer
 * permissions; reads require `customers.read`.
 */
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** Lists active Customers for the current tenant. */
  @Get()
  @RequirePermissions("customers.read")
  async list(): Promise<CustomerResponse[]> {
    return this.customers.list();
  }

  /** Gets a single Customer by UUID; cross-tenant access returns 404. */
  @Get(":id")
  @RequirePermissions("customers.read")
  async get(@Param() params: unknown): Promise<CustomerResponse> {
    const parsed = customerIdParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    return this.customers.get(parsed.data.id);
  }

  /** Creates a new Customer and co-commits an audit row. */
  @Post()
  @RequirePermissions("customers.create")
  async create(@Body() body: unknown): Promise<CustomerResponse> {
    const parsed = createCustomerBody.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer create body.");
    }
    return this.customers.create(parsed.data);
  }

  /** Updates a Customer; kind-mismatched fields are rejected. */
  @Put(":id")
  @RequirePermissions("customers.update")
  async update(@Param() params: unknown, @Body() body: unknown): Promise<CustomerResponse> {
    const parsedParams = customerIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    const parsedBody = updateCustomerBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer update body.");
    }
    return this.customers.update(parsedParams.data.id, parsedBody.data);
  }

  /** Idempotently deactivates a Customer; no hard delete is performed. */
  @Post(":id/deactivate")
  @RequirePermissions("customers.deactivate")
  async deactivate(@Param() params: unknown): Promise<CustomerResponse> {
    const parsedParams = customerIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    return this.customers.deactivate(parsedParams.data.id);
  }
}
