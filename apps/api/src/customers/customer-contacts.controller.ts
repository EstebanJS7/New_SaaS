import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { CustomerContactResponse } from "./customer-contact.dto.js";
import {
  createCustomerContactBody,
  customerContactIdParam,
  customerContactParentParam,
  updateCustomerContactBody,
} from "./customer-contact.zod.js";
import { CustomersService } from "./customers.service.js";

/**
 * Tenant-scoped CustomerContact management surface, nested under a Customer.
 *
 * All routes resolve the tenant exclusively server-side from the active
 * request context. Reads require `customers.read`; mutations require
 * `customers.contact.manage`.
 */
@Controller("customers/:customerId/contacts")
export class CustomerContactsController {
  constructor(private readonly customers: CustomersService) {}

  /** Lists active Contacts for a Customer; cross-tenant access returns 404. */
  @Get()
  @RequirePermissions("customers.read")
  async list(@Param() params: unknown): Promise<CustomerContactResponse[]> {
    const parsed = customerContactParentParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    return this.customers.listContacts(parsed.data.customerId);
  }

  /** Gets a single Contact by UUID; cross-tenant access returns 404. */
  @Get(":id")
  @RequirePermissions("customers.read")
  async get(@Param() params: unknown): Promise<CustomerContactResponse> {
    const parsed = customerContactIdParam.safeParse(params);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid contact route parameters.");
    }
    return this.customers.getContact(parsed.data.id, parsed.data.customerId);
  }

  /** Creates a new Contact and co-commits an audit row. */
  @Post()
  @RequirePermissions("customers.contact.manage")
  async create(@Param() params: unknown, @Body() body: unknown): Promise<CustomerContactResponse> {
    const parsedParams = customerContactParentParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    const parsedBody = createCustomerContactBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid contact create body.");
    }
    return this.customers.createContact(parsedParams.data.customerId, parsedBody.data);
  }

  /** Updates a Contact; cross-tenant or mismatched customer returns 404. */
  @Put(":id")
  @RequirePermissions("customers.contact.manage")
  async update(@Param() params: unknown, @Body() body: unknown): Promise<CustomerContactResponse> {
    const parsedParams = customerContactIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid contact route parameters.");
    }
    const parsedBody = updateCustomerContactBody.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid contact update body.");
    }
    return this.customers.updateContact(
      parsedParams.data.id,
      parsedParams.data.customerId,
      parsedBody.data
    );
  }

  /** Idempotently deactivates a Contact; no hard delete is performed. */
  @Post(":id/deactivate")
  @RequirePermissions("customers.contact.manage")
  async deactivate(@Param() params: unknown): Promise<CustomerContactResponse> {
    const parsedParams = customerContactIdParam.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid contact route parameters.");
    }
    return this.customers.deactivateContact(parsedParams.data.id, parsedParams.data.customerId);
  }
}
