import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { catalogSearchBody, type CatalogSearchResponse } from "./catalog-search.dto.js";
import { CatalogSearchService } from "./catalog-search.service.js";
@Controller("catalog/search")
export class CatalogSearchController {
  constructor(private readonly catalog: CatalogSearchService) {}
  /** Read-only POST: free text stays out of request URLs and logs. */
  @Post()
  @HttpCode(200)
  @RequirePermissions("catalog.read")
  async search(@Body() body: unknown): Promise<CatalogSearchResponse> {
    const parsed = catalogSearchBody.safeParse(body);
    if (!parsed.success)
      throw new DomainError("VALIDATION_FAILED", "Invalid catalog search input.");
    return this.catalog.search(parsed.data);
  }
}
