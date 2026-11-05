"use client";

/**
 * Client for the team surface ([[ONB-001]]): the clinic's staff directory and the
 * invitation, re-send, suspend, reactivate and role commands, through the allowlisted
 * `/api/memberships` proxy. The API is the authority for permissions and tenant scope.
 */

export type MembershipStatus = "ACTIVE" | "SUSPENDED";

export interface StaffMember {
  readonly membershipId: string;
  readonly userProfileId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleCode: string;
  readonly status: MembershipStatus;
  readonly activationPending: boolean;
  readonly createdAt: string;
  /** MB-001: the branches this person works at. */
  readonly branchIds: readonly string[];
}

export interface InvitationInput {
  readonly email: string;
  readonly displayName: string;
  readonly roleCode: string;
  /** MB-001: omitted means every active branch (DEC-094 §6). */
  readonly branchIds?: readonly string[];
}

export interface InvitationResult {
  readonly membershipId: string;
  readonly userProfileId: string;
  readonly activationPending: boolean;
}

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class TeamApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "TeamApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseError(response: Response): Promise<TeamApiError> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
  return new TeamApiError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `La solicitud falló (${response.status}).`,
    response.status
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/memberships${path}`, { cache: "no-store", ...init });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export async function listStaff(): Promise<StaffMember[]> {
  const body = await request<{ members: StaffMember[] }>("/directory");
  return body.members;
}

export async function inviteStaff(input: InvitationInput): Promise<InvitationResult> {
  const body = await post<{ invitation: InvitationResult }>("/invitations", input);
  return body.invitation;
}

export async function resendActivation(membershipId: string): Promise<InvitationResult> {
  const body = await post<{ invitation: InvitationResult }>(`/${membershipId}/activation`);
  return body.invitation;
}

export async function suspendMember(membershipId: string): Promise<void> {
  await post(`/${membershipId}/suspend`);
}

export async function reactivateMember(membershipId: string): Promise<void> {
  await post(`/${membershipId}/reactivate`);
}

export async function changeRole(membershipId: string, roleCode: string): Promise<void> {
  await post(`/${membershipId}/role`, { roleCode });
}

export function isTeamPermissionDenied(error: unknown): boolean {
  return error instanceof TeamApiError && error.code === "FORBIDDEN";
}

/**
 * The message a person can act on. The invitation commands answer CONFLICT with their
 * own Spanish sentence (already a member, already active, own access), which is shown
 * as is; the shared last-manager guard answers in English and is translated here.
 * Anything else gets a generic sentence, so no internal message reaches the screen.
 */
export function teamErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof TeamApiError)) return fallback;
  switch (error.code) {
    case "CONFLICT":
      return /last effective holder/i.test(error.message)
        ? "No se puede: la clínica debe conservar al menos una persona que gestione el personal."
        : error.message;
    case "VALIDATION_FAILED":
      // MB-001's branch choice answers in Spanish; anything else is a generic sentence.
      return /sucursal/i.test(error.message)
        ? error.message
        : "Revisá los datos: algún campo no es válido.";
    case "FORBIDDEN":
      return "No tenés permiso para gestionar el personal.";
    case "NOT_FOUND":
      return "Esa persona ya no figura en la clínica. Actualizá la lista.";
    default:
      return fallback;
  }
}
