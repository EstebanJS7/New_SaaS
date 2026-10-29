import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { customerSearchBody, type CustomerSearchResponse } from "./customer-search.dto.js";
import { CustomerSearchService } from "./customer-search.service.js";

@Controller("customers/search")
export class CustomerSearchController {
  constructor(private readonly customers: CustomerSearchService) {}
  /** Read-only POST keeps confidential names/documents out of request URLs. */
  @Post()
  @HttpCode(200)
  @RequirePermissions("customers.read")
  async search(@Body() body: unknown): Promise<CustomerSearchResponse> {
    const parsed = customerSearchBody.safeParse(body);
    if (!parsed.success)
      throw new DomainError("VALIDATION_FAILED", "Invalid customer search input.");
    return this.customers.search(parsed.data);
  }
}
