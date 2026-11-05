import { DomainError } from "@newsaas/shared";

/**
 * MB-002 (DEC-094 §5, §9): the branch a caller operates in.
 *
 * A cashier opens a drawer and charges only where they work, and a register or
 * a sale is created in an ACTIVE branch. Resolution reads the caller's own
 * ACTIVE membership, its assignments and the tenant's active branches — three
 * plain reads, so every caller (real client, transaction, test boundary) can
 * provide them.
 */

export const NOT_WORKING_AT_BRANCH_MESSAGE =
  "No trabajás en esa sucursal o está desactivada: elegí otra o pedí que te asignen.";
export const NO_WORKING_BRANCH_MESSAGE =
  "No tenés una sucursal activa asignada: pedí que te asignen una en Configuración › Personal.";
export const CHOOSE_BRANCH_MESSAGE = "Trabajás en más de una sucursal: elegí en cuál.";

export interface BranchScopeClient {
  tenantMembership: {
    findFirst(args: {
      where: { tenantId: string; userProfileId: string; status: "ACTIVE" };
      orderBy?: { createdAt?: "asc" | "desc"; id?: "asc" | "desc" }[];
    }): Promise<{ id: string } | null>;
  };
  membershipBranch: {
    findMany(args: {
      where: { tenantId: string; membershipId: string };
      select: { branchId: true };
    }): Promise<{ branchId: string }[]>;
  };
  branch: {
    findMany(args: {
      where: { tenantId: string; isActive?: true; id?: { in: string[] } };
      select: { id: true; name: true };
      orderBy?: { name: "asc" };
    }): Promise<{ id: string; name: string }[]>;
  };
}

export interface CallerScope {
  readonly tenantId: string;
  readonly userProfileId: string;
}

/** The ACTIVE branches the caller works at, by name. */
export async function listWorkingBranches(
  client: BranchScopeClient,
  caller: CallerScope
): Promise<{ id: string; name: string }[]> {
  const membership = await client.tenantMembership.findFirst({
    where: { tenantId: caller.tenantId, userProfileId: caller.userProfileId, status: "ACTIVE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!membership) return [];
  const assignments = await client.membershipBranch.findMany({
    where: { tenantId: caller.tenantId, membershipId: membership.id },
    select: { branchId: true },
  });
  if (assignments.length === 0) return [];
  return client.branch.findMany({
    where: {
      tenantId: caller.tenantId,
      isActive: true,
      id: { in: assignments.map((assignment) => assignment.branchId) },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * The branch a new register or sale goes to: the requested one when the
 * caller works there and it is active, or — with nothing requested — the only
 * active branch the caller works at. A foreign, unknown, inactive or
 * unassigned id is the same 400, so nothing about other clinics leaks.
 */
export async function resolveWorkingBranch(
  client: BranchScopeClient,
  caller: CallerScope,
  requested?: string | null
): Promise<string> {
  const branches = await listWorkingBranches(client, caller);
  if (requested !== undefined && requested !== null) {
    if (!branches.some((branch) => branch.id === requested)) {
      throw new DomainError("VALIDATION_FAILED", NOT_WORKING_AT_BRANCH_MESSAGE);
    }
    return requested;
  }
  const [only, ...others] = branches;
  if (only === undefined) throw new DomainError("CONFLICT", NO_WORKING_BRANCH_MESSAGE);
  if (others.length > 0) throw new DomainError("VALIDATION_FAILED", CHOOSE_BRANCH_MESSAGE);
  return only.id;
}

/** Refuses a caller who does not work at `branchId`, or a branch that is inactive. */
export async function assertWorksAtBranch(
  client: BranchScopeClient,
  caller: CallerScope,
  branchId: string
): Promise<void> {
  await resolveWorkingBranch(client, caller, branchId);
}
