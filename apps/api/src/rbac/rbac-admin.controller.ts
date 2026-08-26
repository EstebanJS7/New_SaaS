import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import type {
  PermissionCatalogEntryDto,
  RolePermissionsReplacedDto,
  RoleWithPermissionsDto,
} from "./rbac-admin.service.js";
import { RbacAdminService } from "./rbac-admin.service.js";
import { RequirePermissions } from "./require-permissions.decorator.js";

/**
 * Body contract for the replace-set command. Keys are shape-validated here
 * (string array with sane bounds) and catalog-validated in the service —
 * the service is the authority, this only rejects structurally broken input
 * before it reaches domain logic.
 */
const replacePermissionsBody = z.object({
  keys: z.array(z.string().min(1).max(128)).max(256),
});

/**
 * Audited RBAC administration surface (EPIC-02 design D3, spec:
 * rbac-administration, architecture per DEC-003).
 *
 * Exactly three commands exist: two reads and ONE tenant-override mutation.
 * There is deliberately NO route creating, editing or deleting Role records or
 * Permission catalog entries — the route-contract probe's surface fence fails
 * the build if one ever appears. Roles are GLOBAL reference data addressed by
 * code; the PUT re-targets the CALLER'S TENANT override layer only
 * (DEC-003): scope comes from the server-resolved ALS context, never from
 * request input, so a cross-tenant write is structurally inexpressible. Every
 * route still requires an authenticated member holding
 * `users.membership.manage`.
 */
@Controller("rbac")
export class RbacAdminController {
  constructor(private readonly rbacAdmin: RbacAdminService) {}

  /** Six fixed PRD §9 roles with their TENANT-EFFECTIVE permission-key sets. */
  @Get("roles")
  @RequirePermissions("users.membership.manage")
  async listRoles(): Promise<{ roles: RoleWithPermissionsDto[] }> {
    return { roles: await this.rbacAdmin.listRoles() };
  }

  /** Immutable seed-owned permission catalog. */
  @Get("permissions")
  @RequirePermissions("users.membership.manage")
  async listPermissions(): Promise<{ permissions: PermissionCatalogEntryDto[] }> {
    return { permissions: await this.rbacAdmin.listPermissions() };
  }

  /**
   * Full REPLACE of the CALLER'S TENANT effective permission-key set for one
   * seeded role (audited diff, DEC-003 override materialization). Anything
   * outside the six seeded codes ⇒ NOT_FOUND (spec: only seeded role codes
   * are addressable); unknown catalog key ⇒ VALIDATION_FAILED with stored
   * state untouched; removing the tenant's last manager-holder key ⇒ 409.
   */
  @Put("roles/:code/permissions")
  @RequirePermissions("users.membership.manage")
  async replaceRolePermissions(
    @Param("code") code: string,
    @Body() body: unknown
  ): Promise<RolePermissionsReplacedDto> {
    const parsedBody = replacePermissionsBody.safeParse(body);
    if (!parsedBody.success) {
      throw parsedBody.error; // Global filter => VALIDATION_FAILED envelope.
    }
    return this.rbacAdmin.replaceRolePermissions(code, parsedBody.data.keys);
  }
}
