import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { saleSearchBody, type SaleSearchResponse } from "./sale-search.dto.js";
import { SaleSearchService } from "./sale-search.service.js";

@Controller("sales/search")
export class SaleSearchController {
  constructor(private readonly sales: SaleSearchService) {}
  /** Read-only POST: confidential search text never enters request URLs. */
  @Post()
  @HttpCode(200)
  @RequirePermissions("sales.read")
  async search(@Body() body: unknown): Promise<SaleSearchResponse> {
    const parsed = saleSearchBody.safeParse(body);
    if (!parsed.success) throw new DomainError("VALIDATION_FAILED", "Invalid sale search input.");
    return this.sales.search(parsed.data);
  }
}
