import { Controller, Get, Param } from "@nestjs/common";
import { z } from "zod";
import type { TenantMembershipView } from "./tenant-membership.repository.js";
import { TenantMembershipRepository } from "./tenant-membership.repository.js";

/** Route-param contract: only a well-formed UUID names a membership resource. */
const membershipIdParam = z.string().uuid();

/**
 * Demonstration aggregate read surface (design D5 / tasks 5.1): the ONLY
 * shipped private-aggregate routes in this epic. Every data access flows
 * through the tenant-scoped repository — the controller carries no tenant
 * logic of its own and reads no identity or tenant material from the request.
 *
 * Deliberately read-only: mutation of memberships is an ops/seed concern in
 * this epic, and Branch/CustomerPortalAccess/Role stay route-less by design
 * (fenced by cross-tenant-isolation.e2e-spec.ts).
 */
@Controller("memberships")
export class MembershipsController {
  constructor(private readonly memberships: TenantMembershipRepository) {}

  /** Lists the caller's active-tenant memberships — implicit scope only. */
  @Get()
  async list(): Promise<{ memberships: TenantMembershipView[] }> {
    return { memberships: await this.memberships.listForActiveTenant() };
  }

  /**
   * Fetches one membership. A foreign-tenant UUID and a nonexistent UUID are
   * indistinguishable here: both fall through the repository's scoped lookup
   * into the same NOT_FOUND envelope.
   */
  @Get(":id")
  async detail(@Param("id") id: string): Promise<{ membership: TenantMembershipView }> {
    const parsed = membershipIdParam.safeParse(id);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }
    return { membership: await this.memberships.findByIdInActiveTenant(parsed.data) };
  }
}
