"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * MB-002 (DEC-094 §5, §9): the active branches the signed-in person works at,
 * from `GET /api/memberships/me/branches`. The counter and the cash screen
 * use it to ask "which branch?" only when there is more than one; with one
 * branch they send nothing and the API uses it.
 *
 * A failed read is treated as "no choice to offer": the API still decides, and
 * answers in Spanish when a branch is missing or ambiguous.
 */

export interface WorkingBranch {
  readonly id: string;
  readonly name: string;
}

export const WORKING_BRANCHES_QUERY_KEY = ["branches", "mine"] as const;

export async function fetchWorkingBranches(): Promise<WorkingBranch[]> {
  const response = await fetch("/api/memberships/me/branches", { cache: "no-store" });
  if (!response.ok) throw new Error(`La solicitud falló (${response.status}).`);
  const body = (await response.json()) as { branches?: WorkingBranch[] };
  return Array.isArray(body.branches) ? body.branches : [];
}

export function useWorkingBranches(): {
  readonly branches: readonly WorkingBranch[];
  /** True when the person must say where: two or more working branches. */
  readonly mustChoose: boolean;
} {
  const query = useQuery({
    queryKey: WORKING_BRANCHES_QUERY_KEY,
    queryFn: fetchWorkingBranches,
    retry: false,
    staleTime: 60_000,
  });
  const branches = query.data ?? [];
  return { branches, mustChoose: branches.length > 1 };
}
