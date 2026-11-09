import { Controller, Get } from "@nestjs/common";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { CATALOG_PERMISSIONS } from "./catalog.permissions.js";
import { CatalogService } from "./catalog.service.js";
import type { UnitOfMeasureResponse } from "./catalog.dto.js";

/**
 * SIFEN unit-of-measure read surface (FISC-020 T9, DEC-097).
 *
 * The list is the protocol's own `tcUniMed`/`tdDesUniMed` table from
 * `@newsaas/fiscal`, not tenant data, so there is NO mutation route. It lets the
 * staff catalog form offer exactly the codes the item write contract accepts.
 * Like `/catalog/tax-rates`, this static segment is registered BEFORE
 * `CatalogController` so it can never be matched as `/catalog/:id`.
 */
@Controller("catalog/units-of-measure")
export class CatalogUnitsOfMeasureController {
  constructor(private readonly catalog: CatalogService) {}

  /** Lists every published unit in the artifact's own order. */
  @Get()
  @RequirePermissions(CATALOG_PERMISSIONS.read)
  async list(): Promise<UnitOfMeasureResponse[]> {
    return this.catalog.listUnitsOfMeasure();
  }
}
