"use client";

/**
 * Client for the branch settings surface (MB-001, DEC-094) through the
 * allowlisted `/api/branches` proxy. The API decides `branches.manage`, the
 * `multi_branch` plan rule and every conflict; this module only carries them.
 */

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
  /** MB-002: the branch's own issuance point, or null for the profile's default. */
  readonly fiscalEstablishmentId?: string | null;
  readonly expeditionPoint?: string | null;
  readonly staffCount: number;
  readonly createdAt: string;
}

/** MB-002: an establishment a branch can issue from. */
export interface FiscalEstablishmentOption {
  readonly id: string;
  readonly code: string;
  readonly addressLine: string;
}

export interface BranchInput {
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  /** MB-002: only on edit; both set, or both null to use the profile's point. */
  readonly fiscalEstablishmentId?: string | null;
  readonly expeditionPoint?: string | null;
}

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class BranchesApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "BranchesApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<BranchesApiError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new BranchesApiError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `La solicitud falló (${response.status}).`,
    response.status
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/branches${path}`, { cache: "no-store", ...init });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

function send<T>(method: "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export async function listBranches(): Promise<Branch[]> {
  return (await loadBranchSettings()).branches;
}

/** MB-002: the branches and the fiscal establishments they can issue from. */
export async function loadBranchSettings(): Promise<{
  branches: Branch[];
  establishments: FiscalEstablishmentOption[];
}> {
  const body = await request<{ branches: Branch[]; establishments?: FiscalEstablishmentOption[] }>(
    ""
  );
  return { branches: body.branches, establishments: body.establishments ?? [] };
}

export async function createBranch(input: BranchInput): Promise<Branch> {
  const body = await send<{ branch: Branch }>("POST", "", input);
  return body.branch;
}

export async function updateBranch(id: string, input: BranchInput): Promise<Branch> {
  const body = await send<{ branch: Branch }>("PUT", `/${id}`, input);
  return body.branch;
}

export async function deactivateBranch(id: string): Promise<Branch> {
  const body = await send<{ branch: Branch }>("POST", `/${id}/deactivate`);
  return body.branch;
}

export async function reactivateBranch(id: string): Promise<Branch> {
  const body = await send<{ branch: Branch }>("POST", `/${id}/reactivate`);
  return body.branch;
}

/** Replaces where a staff member works (the memberships proxy's one PUT). */
export async function assignMemberBranches(
  membershipId: string,
  branchIds: readonly string[]
): Promise<readonly string[]> {
  const response = await fetch(`/api/memberships/${membershipId}/branches`, {
    method: "PUT",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branchIds }),
  });
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as { assignment: { branchIds: string[] } };
  return body.assignment.branchIds;
}

export function isBranchesPermissionDenied(error: unknown): boolean {
  return error instanceof BranchesApiError && error.code === "FORBIDDEN";
}

/**
 * The API answers CONFLICT and FEATURE_NOT_ENTITLED with a Spanish sentence a
 * person can act on (name taken, last active branch, pending turnos, plan
 * limit), shown as is. Validation and permission errors get a fixed sentence.
 */
export function branchesErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof BranchesApiError)) return fallback;
  switch (error.code) {
    case "CONFLICT":
    case "FEATURE_NOT_ENTITLED":
      return error.message;
    case "VALIDATION_FAILED":
      return /[áéíóúñ¿]|sucursal/i.test(error.message)
        ? error.message
        : "Revisá los datos: algún campo no es válido.";
    case "FORBIDDEN":
      return "No tenés permiso para gestionar sucursales.";
    case "NOT_FOUND":
      return "Ya no figura en la clínica. Actualizá la lista.";
    default:
      return fallback;
  }
}
