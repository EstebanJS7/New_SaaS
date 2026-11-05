import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "@newsaas/database";
import { DomainError, type EventDispatcher } from "@newsaas/shared";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import {
  ALREADY_ACTIVE_MESSAGE,
  ALREADY_MEMBER_MESSAGE,
  SELF_SUSPEND_MESSAGE,
  STAFF_ACTIVATION_REQUESTED,
  SUSPENDED_INVITATION_MESSAGE,
  StaffInvitationService,
} from "./staff-invitation.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP = "44444444-4444-4444-8444-444444444444";
const ROLE = "55555555-5555-4555-8555-555555555555";

interface Options {
  existingProfile?: { id: string; credential: unknown } | null;
  existingMembership?: { id: string } | null;
  membership?: unknown;
  /** Roles of the OTHER active memberships, for the last-manager guard. */
  holderGrants?: boolean;
}

function setup(options: Options = {}) {
  const published: { type: string; event: unknown }[] = [];
  const audits: { action: string; metadata?: unknown }[] = [];

  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    userProfile: {
      findUnique: vi.fn(() =>
        Promise.resolve(options.existingProfile === undefined ? null : options.existingProfile)
      ),
      create: vi.fn(() => Promise.resolve({ id: PROFILE, credential: null })),
    },
    tenantMembership: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          options.existingMembership === undefined ? null : options.existingMembership
        )
      ),
      create: vi.fn(() => Promise.resolve({ id: MEMBERSHIP })),
      findFirst: vi.fn(() => Promise.resolve(options.membership ?? null)),
      findMany: vi.fn(() =>
        Promise.resolve(options.holderGrants === false ? [] : [{ id: "other", roleId: ROLE }])
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    rolePermission: {
      findMany: vi.fn(() => Promise.resolve([{ permission: { key: "users.membership.manage" } }])),
    },
    tenantRolePermissionOverride: { findMany: vi.fn(() => Promise.resolve([])) },
    branch: {
      findMany: vi.fn((args: { where: { id?: { in: string[] } } }) =>
        Promise.resolve(
          (args.where.id?.in ?? [BRANCH_A, BRANCH_B])
            .filter((id) => id === BRANCH_A || id === BRANCH_B)
            .map((id) => ({ id }))
        )
      ),
    },
    membershipBranch: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
  };

  const prisma = {
    role: { findUnique: vi.fn(() => Promise.resolve({ id: ROLE, code: "VETERINARIAN" })) },
    tenantMembership: { findFirst: tx.tenantMembership.findFirst },
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;

  const audit = {
    append: vi.fn((input: { action: string; metadata?: unknown }) => {
      audits.push(input);
      return Promise.resolve();
    }),
  } as unknown as AuditWriter;

  const context = {
    requireTenantId: () => TENANT,
    requireUserProfileId: () => ACTOR,
  } as unknown as RequestContextService;

  const events = {
    publish: (type: string, event: unknown) => published.push({ type, event }),
    subscribe: () => undefined,
  } as unknown as EventDispatcher;

  const service = new StaffInvitationService(prisma, audit, context, events);
  return { service, tx, published, audits };
}

const BRANCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const input = {
  email: "  Nueva@Clinica.COM.py ",
  displayName: " Ana ",
  roleCode: "VETERINARIAN" as const,
};

describe("StaffInvitationService.invite (ONB-001)", () => {
  it("creates the profile and an ACTIVE membership, audits, and asks for an activation link", async () => {
    const { service, tx, published, audits } = setup();
    const result = await service.invite(input);

    expect(tx.userProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { email: "nueva@clinica.com.py", displayName: "Ana", status: "active" },
      })
    );
    expect(tx.tenantMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId: TENANT, userProfileId: PROFILE, roleId: ROLE, status: "ACTIVE" },
      })
    );
    expect(result).toEqual({
      membershipId: MEMBERSHIP,
      userProfileId: PROFILE,
      activationPending: true,
    });
    expect(audits[0]).toMatchObject({
      action: "users.membership.invited",
      metadata: {
        roleCode: "VETERINARIAN",
        branchIds: [BRANCH_A, BRANCH_B],
        newProfile: true,
        activationPending: true,
      },
    });
    // DEC-094 §6: no choice means every active branch.
    expect(tx.membershipBranch.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: TENANT, membershipId: MEMBERSHIP, branchId: BRANCH_A },
        { tenantId: TENANT, membershipId: MEMBERSHIP, branchId: BRANCH_B },
      ],
    });
    // The audit carries no address and no name.
    expect(JSON.stringify(audits[0])).not.toContain("clinica.com.py");
    expect(published).toEqual([
      {
        type: STAFF_ACTIVATION_REQUESTED,
        event: { tenantId: null, aggregateId: PROFILE, payload: {} },
      },
    ]);
  });

  it("assigns only the chosen branches", async () => {
    const { service, tx } = setup();
    await service.invite({ ...input, branchIds: [BRANCH_B] });
    expect(tx.membershipBranch.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: TENANT, membershipId: MEMBERSHIP, branchId: BRANCH_B }],
    });
  });

  it("refuses a branch that is not an active branch of this clinic, and writes nothing", async () => {
    const { service, tx, published } = setup();
    await expect(
      service.invite({ ...input, branchIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(tx.membershipBranch.createMany).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });

  it("reuses an existing profile that already has a password, and sends no link", async () => {
    const { service, tx, published } = setup({
      existingProfile: { id: PROFILE, credential: { userProfileId: PROFILE } },
    });
    const result = await service.invite(input);

    expect(tx.userProfile.create).not.toHaveBeenCalled();
    expect(result.activationPending).toBe(false);
    expect(published).toEqual([]);
  });

  it("refuses a person who is already a member of this clinic", async () => {
    const { service, tx, published } = setup({
      existingProfile: { id: PROFILE, credential: null },
      existingMembership: { id: MEMBERSHIP },
    });
    await expect(service.invite(input)).rejects.toMatchObject({
      code: "CONFLICT",
      message: ALREADY_MEMBER_MESSAGE,
    });
    expect(tx.tenantMembership.create).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });
});

describe("StaffInvitationService.resendActivation", () => {
  const pending = {
    id: MEMBERSHIP,
    status: "ACTIVE",
    userProfileId: PROFILE,
    userProfile: { credential: null },
  };

  it("schedules a new link for a pending member", async () => {
    const { service, published, audits } = setup({ membership: pending });
    await service.resendActivation(MEMBERSHIP);
    expect(published).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "users.membership.activation_resent" });
  });

  it("refuses an account that is already active", async () => {
    const { service, published } = setup({
      membership: { ...pending, userProfile: { credential: { userProfileId: PROFILE } } },
    });
    await expect(service.resendActivation(MEMBERSHIP)).rejects.toMatchObject({
      message: ALREADY_ACTIVE_MESSAGE,
    });
    expect(published).toEqual([]);
  });

  it("refuses a suspended membership", async () => {
    const { service } = setup({ membership: { ...pending, status: "SUSPENDED" } });
    await expect(service.resendActivation(MEMBERSHIP)).rejects.toMatchObject({
      message: SUSPENDED_INVITATION_MESSAGE,
    });
  });

  it("answers NOT_FOUND for a membership of another clinic", async () => {
    const { service } = setup({ membership: null });
    await expect(service.resendActivation(MEMBERSHIP)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("StaffInvitationService.suspend / reactivate", () => {
  const active = { id: MEMBERSHIP, status: "ACTIVE", userProfileId: PROFILE };

  it("suspends under the row lock and audits", async () => {
    const { service, tx, audits } = setup({ membership: active });
    await expect(service.suspend(MEMBERSHIP)).resolves.toEqual({
      membershipId: MEMBERSHIP,
      status: "SUSPENDED",
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.tenantMembership.update).toHaveBeenCalledWith({
      where: { id: MEMBERSHIP },
      data: { status: "SUSPENDED" },
    });
    expect(audits[0]).toMatchObject({ action: "users.membership.suspended" });
  });

  it("refuses to suspend the actor's own access", async () => {
    const { service, tx } = setup({ membership: { ...active, userProfileId: ACTOR } });
    await expect(service.suspend(MEMBERSHIP)).rejects.toMatchObject({
      message: SELF_SUSPEND_MESSAGE,
    });
    expect(tx.tenantMembership.update).not.toHaveBeenCalled();
  });

  it("refuses a suspension that would leave nobody able to manage members", async () => {
    const { service, tx } = setup({ membership: active, holderGrants: false });
    await expect(service.suspend(MEMBERSHIP)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.tenantMembership.update).not.toHaveBeenCalled();
  });

  it("is a no-op on an already suspended membership", async () => {
    const { service, tx, audits } = setup({ membership: { ...active, status: "SUSPENDED" } });
    await service.suspend(MEMBERSHIP);
    expect(tx.tenantMembership.update).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
  });

  it("reactivates a suspended membership and audits", async () => {
    const { service, tx, audits } = setup({ membership: { ...active, status: "SUSPENDED" } });
    await expect(service.reactivate(MEMBERSHIP)).resolves.toEqual({
      membershipId: MEMBERSHIP,
      status: "ACTIVE",
    });
    expect(tx.tenantMembership.update).toHaveBeenCalledWith({
      where: { id: MEMBERSHIP },
      data: { status: "ACTIVE" },
    });
    expect(audits[0]).toMatchObject({ action: "users.membership.reactivated" });
  });
});
