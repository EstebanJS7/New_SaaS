import { Inject, Injectable } from "@nestjs/common";
import { PrismaService, type AuditAppendTx, type RoleCode } from "@newsaas/database";
import { DomainError, type EventDispatcher } from "@newsaas/shared";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";
import {
  assertEffectiveManageHolderExists,
  lockActiveMembershipRows,
  type ManageHoldershipTx,
} from "../rbac/manage-holdership.js";
import { MEMBERSHIP_NOT_FOUND_MESSAGE } from "./tenant-membership.repository.js";
import { resolveAssignableBranchIds } from "../branches/branch-assignment.js";

/**
 * Staff onboarding inside a clinic ([[ONB-001]]): invite, re-send the activation
 * link, suspend and reactivate.
 *
 * An INVITATION is not a new aggregate. It is a `UserProfile` (created when the
 * address is new) plus an ACTIVE `TenantMembership`, and the profile simply has no
 * credential yet. "Pending activation" is therefore a derived fact — membership
 * active, credential absent — and it ends the moment the person chooses a password
 * through the activation link, which is the recovery machinery of DAT-007 with a
 * longer-lived token (see `buildActivationMessage` in the worker).
 *
 * A profile that does not have a credential cannot log in, so an active membership
 * awaiting activation grants nothing until then.
 */

/** Published after an invitation commits; the recovery scheduler turns it into a message. */
export const STAFF_ACTIVATION_REQUESTED = "StaffActivationRequested";

export const ALREADY_MEMBER_MESSAGE = "Esa persona ya forma parte de esta clínica.";
export const ALREADY_ACTIVE_MESSAGE = "La cuenta ya está activa: no necesita una invitación.";
export const SUSPENDED_INVITATION_MESSAGE =
  "El acceso está suspendido: reactivalo antes de reenviar la invitación.";
export const SELF_SUSPEND_MESSAGE = "No podés suspender tu propio acceso.";

export interface InviteStaffInput {
  readonly email: string;
  readonly displayName: string;
  readonly roleCode: RoleCode;
  /**
   * MB-001 (DEC-094 §6): where the person will work. Omitted means every active
   * branch, which is what a single-branch clinic wants without asking.
   */
  readonly branchIds?: readonly string[];
}

export interface StaffInvitationResult {
  readonly membershipId: string;
  readonly userProfileId: string;
  /** True when the person must still choose a password; an activation link was scheduled. */
  readonly activationPending: boolean;
}

export interface MembershipStatusResult {
  readonly membershipId: string;
  readonly status: "ACTIVE" | "SUSPENDED";
}

@Injectable()
export class StaffInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly requestContext: RequestContextService,
    @Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher
  ) {}

  async invite(input: InviteStaffInput): Promise<StaffInvitationResult> {
    const tenantId = this.requestContext.requireTenantId();
    const actorId = this.requestContext.requireUserProfileId();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();

    const role = await this.prisma.role.findUnique({ where: { code: input.roleCode } });
    if (!role) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Permission catalog is out of sync with the reference seed."
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userProfile.findUnique({
        where: { email },
        select: { id: true, credential: { select: { userProfileId: true } } },
      });
      const profile =
        existing ??
        (await tx.userProfile.create({
          data: { email, displayName, status: "active" },
          select: { id: true, credential: { select: { userProfileId: true } } },
        }));

      const already = await tx.tenantMembership.findUnique({
        where: { tenantId_userProfileId: { tenantId, userProfileId: profile.id } },
        select: { id: true },
      });
      if (already) throw new DomainError("CONFLICT", ALREADY_MEMBER_MESSAGE);

      const membership = await tx.tenantMembership.create({
        data: { tenantId, userProfileId: profile.id, roleId: role.id, status: "ACTIVE" },
        select: { id: true },
      });
      const branchIds = await resolveAssignableBranchIds(tx, tenantId, input.branchIds);
      await tx.membershipBranch.createMany({
        data: branchIds.map((branchId) => ({ tenantId, membershipId: membership.id, branchId })),
      });

      const activationPending = !profile.credential;
      await this.audit.append(
        {
          action: "users.membership.invited",
          tenantId,
          actorUserProfileId: actorId,
          targetType: "membership",
          targetId: membership.id,
          // No address and no name: the audit trail outlives the person's consent.
          metadata: {
            roleCode: input.roleCode,
            branchIds,
            newProfile: existing === null,
            activationPending,
          },
        },
        tx as unknown as AuditAppendTx
      );

      return { membershipId: membership.id, userProfileId: profile.id, activationPending };
    });

    if (result.activationPending) this.requestActivation(result.userProfileId);
    return result;
  }

  /** Schedules a fresh activation link for a member who has not chosen a password yet. */
  async resendActivation(membershipId: string): Promise<StaffInvitationResult> {
    const tenantId = this.requestContext.requireTenantId();
    const actorId = this.requestContext.requireUserProfileId();

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
      select: {
        id: true,
        status: true,
        userProfileId: true,
        userProfile: { select: { credential: { select: { userProfileId: true } } } },
      },
    });
    if (!membership) throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
    if (membership.userProfile.credential) {
      throw new DomainError("CONFLICT", ALREADY_ACTIVE_MESSAGE);
    }
    if (membership.status !== "ACTIVE") {
      throw new DomainError("CONFLICT", SUSPENDED_INVITATION_MESSAGE);
    }

    await this.audit.append({
      action: "users.membership.activation_resent",
      tenantId,
      actorUserProfileId: actorId,
      targetType: "membership",
      targetId: membership.id,
    });
    this.requestActivation(membership.userProfileId);
    return {
      membershipId: membership.id,
      userProfileId: membership.userProfileId,
      activationPending: true,
    };
  }

  /**
   * Suspends a member's access to THIS clinic. Refuses the actor's own membership and
   * any suspension that would leave nobody able to manage members — the same guard the
   * role assignment uses, under the same row locks.
   */
  async suspend(membershipId: string): Promise<MembershipStatusResult> {
    const tenantId = this.requestContext.requireTenantId();
    const actorId = this.requestContext.requireUserProfileId();

    await this.prisma.$transaction(async (tx) => {
      await lockActiveMembershipRows(tx, tenantId);

      const target = await tx.tenantMembership.findFirst({
        where: { id: membershipId, tenantId },
        select: { id: true, status: true, userProfileId: true },
      });
      if (!target) throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
      if (target.userProfileId === actorId) {
        throw new DomainError("CONFLICT", SELF_SUSPEND_MESSAGE);
      }
      if (target.status === "SUSPENDED") return;

      await assertEffectiveManageHolderExists(tx as unknown as ManageHoldershipTx, tenantId, {
        excludeMembershipIds: [target.id],
      });

      await tx.tenantMembership.update({
        where: { id: target.id },
        data: { status: "SUSPENDED" },
      });
      await this.audit.append(
        {
          action: "users.membership.suspended",
          tenantId,
          actorUserProfileId: actorId,
          targetType: "membership",
          targetId: target.id,
        },
        tx as unknown as AuditAppendTx
      );
    });

    return { membershipId, status: "SUSPENDED" };
  }

  async reactivate(membershipId: string): Promise<MembershipStatusResult> {
    const tenantId = this.requestContext.requireTenantId();
    const actorId = this.requestContext.requireUserProfileId();

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.tenantMembership.findFirst({
        where: { id: membershipId, tenantId },
        select: { id: true, status: true },
      });
      if (!target) throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);
      if (target.status === "ACTIVE") return;

      await tx.tenantMembership.update({
        where: { id: target.id },
        data: { status: "ACTIVE" },
      });
      await this.audit.append(
        {
          action: "users.membership.reactivated",
          tenantId,
          actorUserProfileId: actorId,
          targetType: "membership",
          targetId: target.id,
        },
        tx as unknown as AuditAppendTx
      );
    });

    return { membershipId, status: "ACTIVE" };
  }

  /**
   * Identity-scoped like a recovery request: the credential the link sets is global
   * to the profile, so the message belongs to the platform tenant, not to this clinic.
   */
  private requestActivation(userProfileId: string): void {
    this.events.publish(STAFF_ACTIVATION_REQUESTED, {
      tenantId: null,
      aggregateId: userProfileId,
      payload: {},
    });
  }
}
