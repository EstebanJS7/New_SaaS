import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import type { StaffDirectoryEntry, TenantMembershipView } from "./tenant-membership.repository.js";
import { TenantMembershipRepository } from "./tenant-membership.repository.js";
import {
  MembershipRoleAssignmentService,
  ROLE_CODE_SCHEMA_ENUM,
} from "./membership-role-assignment.service.js";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  StaffInvitationService,
  type MembershipStatusResult,
  type StaffInvitationResult,
} from "./staff-invitation.service.js";

/** Route-param contract: only a well-formed UUID names a membership resource. */
const membershipIdParam = z.string().uuid();

/** Body contract: roleCode MUST be one of the six seeded codes. */
const assignRoleBody = z.object({ roleCode: z.enum(ROLE_CODE_SCHEMA_ENUM) });

/** ONB-001: an invitation names a person, an address and the role they start with. */
const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(120),
  roleCode: z.enum(ROLE_CODE_SCHEMA_ENUM),
  /** MB-001: optional; omitted means every active branch (DEC-094 §6). */
  branchIds: z.array(z.string().uuid()).max(100).optional(),
});

function parseMembershipId(id: string): string {
  const parsed = membershipIdParam.safeParse(id);
  if (!parsed.success) throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
  return parsed.data;
}

/**
 * Membership aggregate surface (design D5 + EPIC-02 design D1/D4).
 *
 * Every data access flows through the tenant-scoped repository — the
 * controller carries no tenant logic of its own and reads no identity or
 * tenant material from the request.
 *
 * Route contract (EPIC-02 deny-by-default): both listing/detail reads declare
 * `users.membership.manage` explicitly; `/me/permissions` is EMPTY-declared
 * (authenticated-only). Role mutation ships as the audited command in this
 * controller (`POST :id/role`, EPIC-02 task 2.4); Branch/CustomerPortalAccess
 * stay route-less by design (fenced by cross-tenant-isolation.e2e-spec.ts).
 */
@Controller("memberships")
export class MembershipsController {
  constructor(
    private readonly memberships: TenantMembershipRepository,
    private readonly permissionResolver: PermissionResolver,
    private readonly roleAssignment: MembershipRoleAssignmentService,
    private readonly invitations: StaffInvitationService
  ) {}

  /** Lists the caller's active-tenant memberships — implicit scope only. */
  @Get()
  @RequirePermissions("users.membership.manage")
  async list(): Promise<{ memberships: TenantMembershipView[] }> {
    return { memberships: await this.memberships.listForActiveTenant() };
  }

  /**
   * Effective permission keys of the ACTIVE membership's role (design D4).
   * Deliberately NOT an `/auth/me` extension: `/auth/*` is reachable without a
   * membership, while effective permissions require tenant context. The EMPTY
   * declaration counts as declared under the deny-by-default contract; the
   * guard skips key resolution for it, so this handler performs THE one
   * resolution of the request.
   */
  /** ONB-001: the clinic's staff with name, address, role and activation state. */
  @Get("directory")
  @RequirePermissions("users.membership.manage")
  async directory(): Promise<{ members: StaffDirectoryEntry[] }> {
    return { members: await this.memberships.listDirectoryForActiveTenant() };
  }

  @Post("invitations")
  @RequirePermissions("users.membership.manage")
  async invite(@Body() body: unknown): Promise<{ invitation: StaffInvitationResult }> {
    const parsed = inviteBody.safeParse(body);
    if (!parsed.success) throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    return { invitation: await this.invitations.invite(parsed.data) };
  }

  @Post(":id/activation")
  @RequirePermissions("users.membership.manage")
  async resendActivation(@Param("id") id: string): Promise<{ invitation: StaffInvitationResult }> {
    return { invitation: await this.invitations.resendActivation(parseMembershipId(id)) };
  }

  @Post(":id/suspend")
  @RequirePermissions("users.membership.manage")
  async suspend(@Param("id") id: string): Promise<{ membership: MembershipStatusResult }> {
    return { membership: await this.invitations.suspend(parseMembershipId(id)) };
  }

  @Post(":id/reactivate")
  @RequirePermissions("users.membership.manage")
  async reactivate(@Param("id") id: string): Promise<{ membership: MembershipStatusResult }> {
    return { membership: await this.invitations.reactivate(parseMembershipId(id)) };
  }

  @Get("me/permissions")
  @RequirePermissions()
  async myPermissions(): Promise<{ permissions: string[] }> {
    const resolved = await this.permissionResolver.resolveForActiveRequest();
    return { permissions: [...resolved].sort() };
  }

  /**
   * Fetches one membership. A foreign-tenant UUID and a nonexistent UUID are
   * indistinguishable here: both fall through the repository's scoped lookup
   * into the same NOT_FOUND envelope.
   */
  @Get(":id")
  @RequirePermissions("users.membership.manage")
  async detail(@Param("id") id: string): Promise<{ membership: TenantMembershipView }> {
    const parsed = membershipIdParam.safeParse(id);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }
    return { membership: await this.memberships.findByIdInActiveTenant(parsed.data) };
  }

  /**
   * Audited role-assignment command (EPIC-02 design D3, task 2.4): replaces
   * the membership's SINGLE role. Tenant scoping and the last-administrator
   * rule live in the repository/service layer — a foreign UUID degrades to
   * the same NOT_FOUND as an unknown one, and demoting the last
   * administrator is rejected with CONFLICT inside the transaction.
   */
  @Post(":id/role")
  @RequirePermissions("users.membership.manage")
  async assignRole(
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<{ assignment: { membershipId: string; roleCode: string } }> {
    const parsedId = membershipIdParam.safeParse(id);
    if (!parsedId.success) {
      throw parsedId.error; // Global filter => VALIDATION_FAILED envelope.
    }
    const parsedBody = assignRoleBody.safeParse(body);
    if (!parsedBody.success) {
      throw parsedBody.error; // Global filter => VALIDATION_FAILED envelope.
    }
    const assignment = await this.roleAssignment.assign(parsedId.data, parsedBody.data.roleCode);
    return { assignment };
  }
}
