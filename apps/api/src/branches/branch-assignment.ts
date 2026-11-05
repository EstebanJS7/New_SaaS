import { DomainError } from "@newsaas/shared";

/**
 * MB-001 (DEC-094 §5–6): which branches a membership may be assigned to.
 *
 * Shared by the staff invitation (no choice → every active branch) and by the
 * assignment command (an explicit, non-empty choice). Only ACTIVE branches of
 * the caller's tenant are assignable: a foreign or unknown id is reported the
 * same way as an inactive one, so the response never confirms that an id exists
 * in another clinic.
 */

export const BRANCH_SELECTION_EMPTY_MESSAGE = "Elegí al menos una sucursal.";
export const BRANCH_SELECTION_INVALID_MESSAGE =
  "Alguna de las sucursales elegidas no existe o está inactiva.";
export const NO_ACTIVE_BRANCH_MESSAGE =
  "La clínica no tiene sucursales activas: activá una en Configuración › Sucursales.";

export interface BranchAssignmentTx {
  branch: {
    findMany(args: {
      where: { tenantId: string; isActive: true; id?: { in: string[] } };
      select: { id: true };
      orderBy?: { createdAt: "asc" };
    }): Promise<{ id: string }[]>;
  };
}

export async function resolveAssignableBranchIds(
  tx: BranchAssignmentTx,
  tenantId: string,
  requested?: readonly string[]
): Promise<string[]> {
  if (requested === undefined) {
    const active = await tx.branch.findMany({
      where: { tenantId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (active.length === 0) throw new DomainError("CONFLICT", NO_ACTIVE_BRANCH_MESSAGE);
    return active.map((branch) => branch.id);
  }

  const unique = [...new Set(requested)];
  if (unique.length === 0) {
    throw new DomainError("VALIDATION_FAILED", BRANCH_SELECTION_EMPTY_MESSAGE);
  }
  const found = await tx.branch.findMany({
    where: { tenantId, isActive: true, id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new DomainError("VALIDATION_FAILED", BRANCH_SELECTION_INVALID_MESSAGE);
  }
  return unique;
}
