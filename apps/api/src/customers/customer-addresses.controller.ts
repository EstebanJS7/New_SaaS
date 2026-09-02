import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { CustomerAddressResponse } from "./customer-address.dto.js";
import {
  createCustomerAddressBody,
  customerAddressIdParam,
  customerAddressParentParam,
  updateCustomerAddressBody,
} from "./customer-address.zod.js";
import { CustomersService } from "./customers.service.js";

/**
 * Tenant-scoped CustomerAddress management surface, nested under a Customer.
 *
 * All routes resolve the tenant exclusively server-side from the active
 * request context. Reads require `customers.read`; mutations require
 * `customers.address.manage`.
 */
@Controller("customers/:customerId/addresses")
export class CustomerAddressesController {
  constructor(private readonly customers: CustomersService) {}

  /** Lists active Addresses for a Customer; cross-tenant access returns 404. */
  @Get()
  @RequirePermissions("customers.read")
  async list(@Param() params: unknown): Promise<CustomerAddressResponse[]> {
    const parsed = customerAddressParentParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    return this.customers.listAddresses(parsed.data.customerId);
  }

  /** Gets a single Address by UUID; cross-tenant access returns 404. */
  @Get(":id")
  @RequirePermissions("customers.read")
  async get(@Param() params: unknown): Promise<CustomerAddressResponse> {
    const parsed = customerAddressIdParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid address route parameters.");
    }
    return this.customers.getAddress(parsed.data.id, parsed.data.customerId);
  }

  /** Creates a new Address and co-commits an audit row. */
  @Post()
  @RequirePermissions("customers.address.manage")
  async create(@Param() params: unknown, @Body() body: unknown): Promise<CustomerAddressResponse> {
    const parsedParams = customerAddressParentParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    const parsedBody = createCustomerAddressBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid address create body.");
    }
    return this.customers.createAddress(parsedParams.data.customerId, parsedBody.data);
  }

  /** Updates an Address; cross-tenant or mismatched customer returns 404. */
  @Put(":id")
  @RequirePermissions("customers.address.manage")
  async update(@Param() params: unknown, @Body() body: unknown): Promise<CustomerAddressResponse> {
    const parsedParams = customerAddressIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid address route parameters.");
    }
    const parsedBody = updateCustomerAddressBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid address update body.");
    }
    return this.customers.updateAddress(
      parsedParams.data.id,
      parsedParams.data.customerId,
      parsedBody.data
    );
  }

  /** Idempotently deactivates an Address; no hard delete is performed. */
  @Post(":id/deactivate")
  @RequirePermissions("customers.address.manage")
  async deactivate(@Param() params: unknown): Promise<CustomerAddressResponse> {
    const parsedParams = customerAddressIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid address route parameters.");
    }
    return this.customers.deactivateAddress(parsedParams.data.id, parsedParams.data.customerId);
  }
}
