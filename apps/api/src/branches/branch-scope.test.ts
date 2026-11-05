import { describe, expect, it, vi } from "vitest";
import {
  CHOOSE_BRANCH_MESSAGE,
  NOT_WORKING_AT_BRANCH_MESSAGE,
  NO_WORKING_BRANCH_MESSAGE,
  resolveWorkingBranch,
  type BranchScopeClient,
} from "./branch-scope.js";

const CALLER = { tenantId: "t-1", userProfileId: "u-1" };

function client(options: { member?: boolean; assigned: string[]; active: string[] }) {
  return {
    tenantMembership: {
      findFirst: vi.fn(() => Promise.resolve(options.member === false ? null : { id: "m-1" })),
    },
    membershipBranch: {
      findMany: vi.fn(() => Promise.resolve(options.assigned.map((branchId) => ({ branchId })))),
    },
    branch: {
      findMany: vi.fn((args: { where: { id?: { in: string[] } } }) =>
        Promise.resolve(
          (args.where.id?.in ?? options.active)
            .filter((id) => options.active.includes(id))
            .map((id) => ({ id, name: id }))
        )
      ),
    },
  } satisfies BranchScopeClient;
}

describe("resolveWorkingBranch (MB-002)", () => {
  it("defaults to the only active branch the caller works at", async () => {
    await expect(
      resolveWorkingBranch(client({ assigned: ["a", "old"], active: ["a"] }), CALLER)
    ).resolves.toBe("a");
  });

  it("asks which when the caller works at several", async () => {
    await expect(
      resolveWorkingBranch(client({ assigned: ["a", "b"], active: ["a", "b"] }), CALLER)
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: CHOOSE_BRANCH_MESSAGE });
  });

  it("accepts a requested branch only where the caller works and it is active", async () => {
    const scope = client({ assigned: ["a", "old"], active: ["a", "x"] });
    await expect(resolveWorkingBranch(scope, CALLER, "a")).resolves.toBe("a");
    for (const requested of ["old", "x", "foreign"]) {
      await expect(resolveWorkingBranch(scope, CALLER, requested)).rejects.toMatchObject({
        message: NOT_WORKING_AT_BRANCH_MESSAGE,
      });
    }
  });

  it("refuses a caller with no active branch, or with no membership", async () => {
    await expect(
      resolveWorkingBranch(client({ assigned: ["old"], active: [] }), CALLER)
    ).rejects.toMatchObject({ code: "CONFLICT", message: NO_WORKING_BRANCH_MESSAGE });
    await expect(
      resolveWorkingBranch(client({ member: false, assigned: [], active: [] }), CALLER)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
