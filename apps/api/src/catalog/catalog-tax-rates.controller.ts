import { Controller, Get } from "@nestjs/common";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { CATALOG_PERMISSIONS } from "./catalog.permissions.js";
import { CatalogService } from "./catalog.service.js";
import type { TaxRateResponse } from "./catalog.dto.js";

/**
 * GLOBAL tax-rate read surface (EPIC-09 WU2, PRD §15).
 *
 * The three seeded rates (`EXEMPT`, `IVA_5`, `IVA_10`) are platform reference
 * data: every entitled tenant reads the same rows and there is deliberately NO
 * mutation route. Because the path carries a static segment under `/catalog`,
 * this controller is registered BEFORE {@link CatalogController} so
 * `/catalog/tax-rates` can never be matched as `/catalog/:id`.
 */
@Controller("catalog/tax-rates")
export class CatalogTaxRatesController {
  constructor(private readonly catalog: CatalogService) {}

  /** Lists the global seeded rates in stable `code` order. */
  @Get()
  @RequirePermissions(CATALOG_PERMISSIONS.read)
  async list(): Promise<TaxRateResponse[]> {
    return this.catalog.listTaxRates();
  }
}
