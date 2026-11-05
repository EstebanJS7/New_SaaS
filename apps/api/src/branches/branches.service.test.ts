import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "@newsaas/database";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import { BRANCH_SELECTION_INVALID_MESSAGE } from "./branch-assignment.js";
import {
  BRANCH_ALREADY_INACTIVE_MESSAGE,
  BRANCH_ESTABLISHMENT_NOT_FOUND_MESSAGE,
  BRANCH_ISSUANCE_POINT_TAKEN_MESSAGE,
  BRANCH_LAST_ACTIVE_MESSAGE,
  BRANCH_MULTI_NOT_ENTITLED_MESSAGE,
  BRANCH_NAME_TAKEN_MESSAGE,
  BRANCH_NOT_FOUND_MESSAGE,
  BranchesService,
  MEMBERSHIP_BRANCHES_ASSIGNED_ACTION,
  assignmentDropsAppointmentsMessage,
  branchHasUpcomingAppointmentsMessage,
} from "./branches.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const MAIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NORTH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface BranchFixture {
  id: string;
  name: string;
  isActive: boolean;
}

interface Options {
  branches?: BranchFixture[];
  entitled?: boolean;
  upcoming?: number;
  member?: boolean;
  assigned?: string[];
  /** MB-002: issuance points other branches already use. */
  points?: Record<string, { establishment: string; point: string }>;
}

function setup(options: Options = {}) {
  const branches: BranchFixture[] = options.branches ?? [
    { id: MAIN, name: "Casa central", isActive: true },
  ];
  const assigned = new Set(options.assigned ?? [MAIN]);
  const calls: string[] = [];
  const audits: { action: string; targetId: string; metadata?: unknown }[] = [];

  const view = (id: string) => {
    const branch = branches.find((candidate) => candidate.id === id);
    return branch
      ? {
          ...branch,
          address: null,
          phone: null,
          createdAt: new Date("2026-11-01T00:00:00Z"),
          _count: { memberships: 1 },
        }
      : null;
  };

  const tx = {
    $queryRaw: vi.fn(() => {
      calls.push("lock");
      return Promise.resolve(
        branches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          is_active: branch.isActive,
          fiscal_establishment_id: options.points?.[branch.id]?.establishment ?? null,
          expedition_point: options.points?.[branch.id]?.point ?? null,
        }))
      );
    }),
    branch: {
      create: vi.fn((args: { data: { name: string } }) => {
        calls.push("create");
        branches.push({ id: "new-branch", name: args.data.name, isActive: true });
        return Promise.resolve(view("new-branch"));
      }),
      updateMany: vi.fn((args: { where: { id: string }; data: Partial<BranchFixture> }) => {
        calls.push("update");
        const branch = branches.find((candidate) => candidate.id === args.where.id);
        if (branch) Object.assign(branch, args.data);
        return Promise.resolve({ count: branch ? 1 : 0 });
      }),
      findFirst: vi.fn((args: { where: { id: string } }) => Promise.resolve(view(args.where.id))),
      findMany: vi.fn((args: { where: { id?: { in: string[] } } }) =>
        Promise.resolve(
          branches
            .filter((branch) => branch.isActive)
            .filter((branch) => args.where.id?.in.includes(branch.id) ?? true)
            .map((branch) => ({ id: branch.id }))
        )
      ),
    },
    appointment: { count: vi.fn(() => Promise.resolve(options.upcoming ?? 0)) },
    fiscalEstablishment: {
      findFirst: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve(args.where.id === "est-1" ? { id: "est-1" } : null)
      ),
    },
    tenantMembership: {
      findFirst: vi.fn(() => Promise.resolve(options.member === false ? null : { id: MEMBER })),
    },
    membershipBranch: {
      findMany: vi.fn(() =>
        Promise.resolve(
          [...assigned].map((branchId) => ({
            branchId,
            branch: {
              isActive: branches.find((branch) => branch.id === branchId)?.isActive ?? false,
            },
          }))
        )
      ),
      deleteMany: vi.fn((args: { where: { branchId: { in: string[] } } }) => {
        calls.push("unassign");
        for (const id of args.where.branchId.in) assigned.delete(id);
        return Promise.resolve({ count: args.where.branchId.in.length });
      }),
      createMany: vi.fn((args: { data: { branchId: string }[] }) => {
        calls.push("assign");
        for (const row of args.data) assigned.add(row.branchId);
        return Promise.resolve({ count: args.data.length });
      }),
    },
  };

  const prisma = {
    branch: { findMany: vi.fn(() => Promise.resolve(branches.map((b) => view(b.id)))) },
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  const context = {
    requireTenantId: () => TENANT,
    requireUserProfileId: () => ACTOR,
  } as unknown as RequestContextService;
  const entitlements = {
    has: vi.fn(() => Promise.resolve(options.entitled ?? false)),
  } as unknown as EntitlementsService;
  const audit = {
    append: vi.fn((entry: { action: string; targetId: string; metadata?: unknown }) => {
      calls.push("audit");
      audits.push(entry);
      return Promise.resolve();
    }),
  } as unknown as AuditWriter;

  const service = new BranchesService(prisma, context, entitlements, audit);
  return { service, tx, calls, audits, branches, assigned };
}

describe("BranchesService.create (MB-001)", () => {
  it("creates the first active branch without multi_branch", async () => {
    const { service, calls } = setup({ branches: [] });
    const branch = await service.create({ name: "Casa central" });
    expect(branch).toMatchObject({ name: "Casa central", isActive: true, staffCount: 1 });
    expect(calls).toEqual(["lock", "create", "audit"]);
  });

  it("refuses a second active branch without multi_branch (DEC-094 §3)", async () => {
    const { service, tx } = setup();
    await expect(service.create({ name: "Sucursal Norte" })).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
      message: BRANCH_MULTI_NOT_ENTITLED_MESSAGE,
    });
    expect(tx.branch.create).not.toHaveBeenCalled();
  });

  it("creates a second branch with multi_branch and audits ids only", async () => {
    const { service, audits } = setup({ entitled: true });
    await service.create({ name: "Sucursal Norte", address: "Av. España 1234", phone: null });
    expect(audits[0]).toMatchObject({ action: "branch.created", targetId: "new-branch" });
    expect(JSON.stringify(audits[0])).not.toContain("España");
  });

  it("refuses a name already used, ignoring case", async () => {
    const { service, tx } = setup({ entitled: true });
    await expect(service.create({ name: "CASA CENTRAL" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: BRANCH_NAME_TAKEN_MESSAGE,
    });
    expect(tx.branch.create).not.toHaveBeenCalled();
  });
});

describe("BranchesService.update", () => {
  it("renames and records which fields changed", async () => {
    const { service, audits } = setup();
    const branch = await service.update(MAIN, { name: "Central" });
    expect(branch.name).toBe("Central");
    expect(audits[0]).toMatchObject({ action: "branch.updated", metadata: { fields: ["name"] } });
  });

  it("keeps its own name when only the case changes", async () => {
    const { service } = setup();
    await expect(service.update(MAIN, { name: "CASA CENTRAL" })).resolves.toMatchObject({
      name: "CASA CENTRAL",
    });
  });

  it("answers NOT_FOUND for a branch of another clinic", async () => {
    const { service } = setup();
    await expect(service.update(OLD, { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: BRANCH_NOT_FOUND_MESSAGE,
    });
  });
});

describe("BranchesService.update — issuance point (MB-002)", () => {
  it("links the branch to an establishment and point of this clinic", async () => {
    const { service, tx, audits } = setup();
    await service.update(MAIN, { fiscalEstablishmentId: "est-1", expeditionPoint: "002" });
    expect(tx.branch.updateMany).toHaveBeenCalledWith({
      where: { id: MAIN, tenantId: TENANT },
      data: { fiscalEstablishmentId: "est-1", expeditionPoint: "002" },
    });
    expect(audits[0]).toMatchObject({
      metadata: { fields: ["expeditionPoint", "fiscalEstablishmentId"] },
    });
  });

  it("goes back to the profile's point with null", async () => {
    const { service, tx } = setup();
    await service.update(MAIN, { fiscalEstablishmentId: null, expeditionPoint: null });
    expect(tx.branch.updateMany).toHaveBeenCalledWith({
      where: { id: MAIN, tenantId: TENANT },
      data: { fiscalEstablishmentId: null, expeditionPoint: null },
    });
  });

  it("refuses an establishment of another clinic, and a point another branch uses", async () => {
    const branches = [
      { id: MAIN, name: "Casa central", isActive: true },
      { id: NORTH, name: "Norte", isActive: true },
    ];
    await expect(
      setup({ branches }).service.update(NORTH, {
        fiscalEstablishmentId: "est-foreign",
        expeditionPoint: "001",
      })
    ).rejects.toMatchObject({ message: BRANCH_ESTABLISHMENT_NOT_FOUND_MESSAGE });
    await expect(
      setup({
        branches,
        points: { [MAIN]: { establishment: "est-1", point: "001" } },
      }).service.update(NORTH, { fiscalEstablishmentId: "est-1", expeditionPoint: "001" })
    ).rejects.toMatchObject({ code: "CONFLICT", message: BRANCH_ISSUANCE_POINT_TAKEN_MESSAGE });
  });
});

describe("BranchesService.deactivate / reactivate", () => {
  const two = (): BranchFixture[] => [
    { id: MAIN, name: "Casa central", isActive: true },
    { id: NORTH, name: "Norte", isActive: true },
  ];

  it("refuses the last active branch", async () => {
    const { service, tx } = setup();
    await expect(service.deactivate(MAIN)).rejects.toMatchObject({
      code: "CONFLICT",
      message: BRANCH_LAST_ACTIVE_MESSAGE,
    });
    expect(tx.branch.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a branch with turnos still to happen", async () => {
    const { service, tx } = setup({ branches: two(), upcoming: 3 });
    await expect(service.deactivate(NORTH)).rejects.toMatchObject({
      code: "CONFLICT",
      message: branchHasUpcomingAppointmentsMessage(3),
    });
    expect(tx.branch.updateMany).not.toHaveBeenCalled();
  });

  it("deactivates and audits", async () => {
    const { service, audits } = setup({ branches: two() });
    const branch = await service.deactivate(NORTH);
    expect(branch.isActive).toBe(false);
    expect(audits[0]).toMatchObject({ action: "branch.deactivated", targetId: NORTH });
  });

  it("refuses to deactivate twice", async () => {
    const { service } = setup({
      branches: [...two(), { id: OLD, name: "Vieja", isActive: false }],
    });
    await expect(service.deactivate(OLD)).rejects.toMatchObject({
      message: BRANCH_ALREADY_INACTIVE_MESSAGE,
    });
  });

  it("reactivation needs multi_branch when another branch is active", async () => {
    const branches = [
      { id: MAIN, name: "Casa central", isActive: true },
      { id: OLD, name: "Vieja", isActive: false },
    ];
    await expect(setup({ branches }).service.reactivate(OLD)).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
    });
    const entitled = setup({ branches, entitled: true });
    await expect(entitled.service.reactivate(OLD)).resolves.toMatchObject({ isActive: true });
  });
});

describe("BranchesService.assignMembershipBranches", () => {
  const two = (): BranchFixture[] => [
    { id: MAIN, name: "Casa central", isActive: true },
    { id: NORTH, name: "Norte", isActive: true },
  ];

  it("adds and removes to match the chosen set, and audits the difference", async () => {
    const { service, audits } = setup({ branches: two(), assigned: [MAIN] });
    const result = await service.assignMembershipBranches(MEMBER, [NORTH]);
    expect(result).toEqual({ membershipId: MEMBER, branchIds: [NORTH] });
    expect(audits[0]).toMatchObject({
      action: MEMBERSHIP_BRANCHES_ASSIGNED_ACTION,
      targetId: MEMBER,
      metadata: { added: [NORTH], removed: [MAIN] },
    });
  });

  it("keeps an inactive branch as history instead of removing it", async () => {
    const { service, tx } = setup({
      branches: [...two(), { id: OLD, name: "Vieja", isActive: false }],
      assigned: [MAIN, OLD],
    });
    await service.assignMembershipBranches(MEMBER, [MAIN]);
    expect(tx.membershipBranch.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to take away a branch where the person still has turnos", async () => {
    const { service, tx } = setup({ branches: two(), assigned: [MAIN, NORTH], upcoming: 1 });
    await expect(service.assignMembershipBranches(MEMBER, [MAIN])).rejects.toMatchObject({
      code: "CONFLICT",
      message: assignmentDropsAppointmentsMessage(1),
    });
    expect(tx.membershipBranch.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses an empty, unknown or inactive choice", async () => {
    const { service } = setup({
      branches: [...two(), { id: OLD, name: "Vieja", isActive: false }],
    });
    await expect(service.assignMembershipBranches(MEMBER, [])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(service.assignMembershipBranches(MEMBER, [OLD])).rejects.toMatchObject({
      message: BRANCH_SELECTION_INVALID_MESSAGE,
    });
  });

  it("answers NOT_FOUND for a membership of another clinic", async () => {
    const { service } = setup({ member: false });
    await expect(service.assignMembershipBranches(MEMBER, [MAIN])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
