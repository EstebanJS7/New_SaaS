/**
 * Presentation for the team surface ([[ONB-001]]). The role codes are the API's fixed
 * catalog (reference seed); the labels are es-PY and live only here.
 */

export const ROLE_OPTIONS = [
  { code: "OWNER", label: "Propietario" },
  { code: "ADMIN", label: "Administración" },
  { code: "VETERINARIAN", label: "Veterinaria" },
  { code: "RECEPTIONIST", label: "Recepción" },
  { code: "CASHIER", label: "Caja" },
  { code: "INVENTORY_MANAGER", label: "Inventario" },
] as const;

export type RoleCode = (typeof ROLE_OPTIONS)[number]["code"];

/** The role an invitation starts with unless the inviter picks another. */
export const DEFAULT_INVITE_ROLE: RoleCode = "VETERINARIAN";

export function roleLabel(code: string): string {
  return ROLE_OPTIONS.find((option) => option.code === code)?.label ?? code;
}

export type MemberState = "active" | "pending" | "suspended";

export function memberState(member: {
  readonly status: string;
  readonly activationPending: boolean;
}): MemberState {
  if (member.status === "SUSPENDED") return "suspended";
  return member.activationPending ? "pending" : "active";
}

export const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  active: "Activo",
  pending: "Invitación pendiente",
  suspended: "Suspendido",
};

/** A loose shape check before sending; the API validates for real. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
