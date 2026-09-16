import { Body, Controller, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import {
  portalAccessCustomerParamSchema,
  provisionPortalAccessBodySchema,
  type PortalAccessResponse,
} from "./portal-access.dto.js";
import { PortalAccessService } from "./portal-access.service.js";
import { PORTAL_ACCESS_PERMISSION } from "./portal.constants.js";

/**
 * Staff-operated portal-access administration (EPIC-08 D7).
 *
 * Deliberately lives OFF the `/portal/*` surface: these commands are DECLARED
 * staff routes (`@RequirePermissions(PORTAL_ACCESS_PERMISSION)` + active
 * membership), so the portal surface fence stays exact and a portal session can
 * never reach them. `tenantId` is never read from the path or body — the
 * service resolves it from the authenticated staff membership, and a Customer
 * owned by another tenant is a byte-equivalent 404.
 */
@Controller("customers/:customerId/portal-access")
export class PortalAccessController {
  constructor(private readonly portalAccess: PortalAccessService) {}

  /** Provisions the Customer's single active portal holder. */
  @Post()
  @RequirePermissions(PORTAL_ACCESS_PERMISSION)
  async provision(@Param() params: unknown, @Body() body: unknown): Promise<PortalAccessResponse> {
    const parsedParams = portalAccessCustomerParamSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    const parsedBody = provisionPortalAccessBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid portal access body.");
    }
    return this.portalAccess.provision(parsedParams.data.customerId, parsedBody.data);
  }

  /** Revokes the Customer's active portal holder and its live sessions. */
  @Post("revoke")
  @RequirePermissions(PORTAL_ACCESS_PERMISSION)
  async revoke(@Param() params: unknown): Promise<PortalAccessResponse> {
    const parsedParams = portalAccessCustomerParamSchema.safeParse(params);
    if (!parsedParams.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid customer id.");
    }
    return this.portalAccess.revoke(parsedParams.data.customerId);
  }
}
