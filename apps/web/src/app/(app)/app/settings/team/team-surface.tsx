"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@newsaas/ui/components/ui/badge";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { Input } from "@newsaas/ui/components/ui/input";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import {
  changeRole,
  inviteStaff,
  isTeamPermissionDenied,
  listStaff,
  reactivateMember,
  resendActivation,
  suspendMember,
  teamErrorMessage,
  type InvitationResult,
  type StaffMember,
} from "./team-api";
import {
  DEFAULT_INVITE_ROLE,
  MEMBER_STATE_LABEL,
  ROLE_OPTIONS,
  looksLikeEmail,
  memberState,
  roleLabel,
} from "./team-display";
import {
  assignMemberBranches,
  branchesErrorMessage,
  listBranches,
  type Branch,
} from "../branches/branches-api";

/**
 * The clinic's staff ([[ONB-001]]): who works here, in what role, and whether they have
 * activated their account; invite, re-send an invitation, change a role, suspend and
 * reactivate. Success is shown only after the API answers, every command that changes
 * someone's access asks first, and the backend stays the authority for permissions.
 */

const TEAM_QUERY_KEY = ["team", "directory"] as const;
const TEAM_BRANCHES_QUERY_KEY = ["branches", "list"] as const;

type PendingAction =
  | { readonly kind: "suspend"; readonly member: StaffMember }
  | { readonly kind: "reactivate"; readonly member: StaffMember }
  | { readonly kind: "role"; readonly member: StaffMember; readonly roleCode: string };

export function TeamSurface(): JSX.Element {
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);

  const directory = useQuery({ queryKey: TEAM_QUERY_KEY, queryFn: listStaff, retry: false });
  // MB-001: the branch picker. Without `branches.manage` (or with one branch)
  // the screen simply shows no branch controls; the API decides either way.
  const branchList = useQuery({
    queryKey: TEAM_BRANCHES_QUERY_KEY,
    queryFn: listBranches,
    retry: false,
  });
  const branches = branchList.data ?? [];
  const showBranches = branches.length > 1;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["branches"] });
    return queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
  };

  const resend = useMutation({
    mutationFn: (member: StaffMember) => resendActivation(member.membershipId),
    onSuccess: (_result, member) => {
      setNotice(`Se envió una nueva invitación a ${member.email}.`);
      void refresh();
    },
  });

  const command = useMutation({
    mutationFn: async (pending: PendingAction) => {
      if (pending.kind === "suspend") await suspendMember(pending.member.membershipId);
      else if (pending.kind === "reactivate") await reactivateMember(pending.member.membershipId);
      else await changeRole(pending.member.membershipId, pending.roleCode);
    },
    onSuccess: (_result, pending) => {
      const name = pending.member.displayName;
      setNotice(
        pending.kind === "suspend"
          ? `${name} ya no puede ingresar a esta clínica.`
          : pending.kind === "reactivate"
            ? `${name} puede volver a ingresar.`
            : `${name} ahora tiene el rol ${roleLabel(pending.roleCode)}.`
      );
      setAction(null);
      void refresh();
    },
  });

  function openAction(next: PendingAction): void {
    command.reset();
    setAction(next);
  }

  const permissionDenied = isTeamPermissionDenied(directory.error);

  return (
    <div className="space-y-6" data-testid="team-surface">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Configuración / Personal</p>
          <h1 className="text-2xl font-semibold tracking-tight">Personal</h1>
          <p className="text-sm text-muted-foreground">
            Quién trabaja en la clínica, con qué rol, y quién todavía no activó su cuenta.
          </p>
        </div>
        {permissionDenied ? null : (
          <Button
            type="button"
            onClick={() => {
              setNotice(null);
              setInviteOpen((open) => !open);
            }}
            aria-expanded={inviteOpen}
          >
            <Icon name={inviteOpen ? "close" : "plus"} />
            {inviteOpen ? "Cerrar" : "Invitar persona"}
          </Button>
        )}
      </div>

      {notice === null ? null : (
        <p
          role="status"
          data-testid="team-notice"
          className="rounded-lg border border-status-success/20 bg-status-success/10 p-4 text-sm"
        >
          {notice}
        </p>
      )}

      {inviteOpen ? (
        <InviteForm
          branches={showBranches ? branches.filter((branch) => branch.isActive) : []}
          onInvited={(result, email, name) => {
            setInviteOpen(false);
            setNotice(
              result.activationPending
                ? `Invitación enviada a ${email}. Tiene 72 horas para activar su cuenta.`
                : `${name} ya tenía una cuenta: desde ahora puede ingresar a esta clínica.`
            );
            void refresh();
          }}
        />
      ) : null}

      {directory.isLoading ? <ListSkeleton label="Cargando personal…" rows={3} /> : null}

      {permissionDenied ? (
        <EmptyState
          icon="shield"
          title="No tenés permiso para ver el personal"
          description="Pedile a quien administra la clínica que gestione las invitaciones y los roles."
        />
      ) : directory.error ? (
        <ErrorState
          message="No se pudo cargar la lista del personal."
          onRetry={() => void directory.refetch()}
        />
      ) : null}

      {directory.data && directory.data.length > 0 ? (
        <ul className="space-y-3" aria-label="Personal de la clínica">
          {directory.data.map((member) => (
            <MemberRow
              key={member.membershipId}
              member={member}
              branches={showBranches ? branches : []}
              onBranchesSaved={(names) => {
                setNotice(`${member.displayName} trabaja en: ${names.join(", ")}.`);
                void refresh();
              }}
              resendPending={
                resend.isPending && resend.variables?.membershipId === member.membershipId
              }
              resendError={
                resend.error && resend.variables?.membershipId === member.membershipId
                  ? teamErrorMessage(resend.error, "No se pudo reenviar la invitación.")
                  : null
              }
              onResend={() => {
                setNotice(null);
                resend.mutate(member);
              }}
              onSuspend={() => openAction({ kind: "suspend", member })}
              onReactivate={() => openAction({ kind: "reactivate", member })}
              onRoleChange={(roleCode) => openAction({ kind: "role", member, roleCode })}
            />
          ))}
        </ul>
      ) : directory.data ? (
        <EmptyState
          icon="users"
          title="Todavía no hay personal"
          description="Invitá a las personas que trabajan en la clínica."
        />
      ) : null}

      <ConfirmActionDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={dialogTitle(action)}
        description={dialogDescription(action)}
        confirmLabel={
          action?.kind === "suspend"
            ? "Suspender acceso"
            : action?.kind === "reactivate"
              ? "Reactivar acceso"
              : "Cambiar rol"
        }
        confirmVariant={action?.kind === "suspend" ? "destructive" : "default"}
        pending={command.isPending}
        errorMessage={
          command.error
            ? teamErrorMessage(command.error, "No se pudo completar el cambio.")
            : undefined
        }
        // Rejects on failure on purpose: the dialog stays open and shows `errorMessage`.
        onConfirm={() => (action === null ? undefined : command.mutateAsync(action))}
      />
    </div>
  );
}

function dialogTitle(action: PendingAction | null): string {
  if (action === null) return "";
  if (action.kind === "suspend") return `¿Suspender a ${action.member.displayName}?`;
  if (action.kind === "reactivate") return `¿Reactivar a ${action.member.displayName}?`;
  return `¿Cambiar el rol de ${action.member.displayName}?`;
}

function dialogDescription(action: PendingAction | null): string {
  if (action === null) return "";
  if (action.kind === "suspend") {
    return "No va a poder ingresar a esta clínica hasta que lo reactives. Sus registros se conservan.";
  }
  if (action.kind === "reactivate") {
    return "Vuelve a poder ingresar con su rol actual.";
  }
  return `Pasa de ${roleLabel(action.member.roleCode)} a ${roleLabel(action.roleCode)}. Sus permisos cambian desde el próximo pedido que haga.`;
}

function MemberRow({
  member,
  branches,
  onBranchesSaved,
  resendPending,
  resendError,
  onResend,
  onSuspend,
  onReactivate,
  onRoleChange,
}: {
  member: StaffMember;
  /** Every branch of the clinic, or none when branch controls are hidden. */
  branches: readonly Branch[];
  onBranchesSaved: (names: string[]) => void;
  resendPending: boolean;
  resendError: string | null;
  onResend: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRoleChange: (roleCode: string) => void;
}): JSX.Element {
  const state = memberState(member);
  const roleId = useId();
  const [editingBranches, setEditingBranches] = useState(false);
  const workplaces = branches
    .filter((branch) => member.branchIds.includes(branch.id))
    .map((branch) => (branch.isActive ? branch.name : `${branch.name} (desactivada)`));
  return (
    <li className="record-row flex-wrap" data-testid="team-member">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-secondary text-xs font-semibold text-secondary-foreground"
          >
            {member.displayName.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate font-semibold text-foreground">{member.displayName}</span>
          <Badge
            variant={
              state === "active" ? "success" : state === "suspended" ? "destructive" : "outline"
            }
          >
            {MEMBER_STATE_LABEL[state]}
          </Badge>
        </div>
        <p className="truncate text-sm text-muted-foreground">{member.email}</p>
        {branches.length > 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="member-branches">
            {workplaces.length > 0
              ? `Trabaja en: ${workplaces.join(", ")}`
              : "Sin sucursal asignada"}
          </p>
        ) : null}
        {resendError ? (
          <p role="alert" className="text-xs text-destructive">
            {resendError}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor={roleId} className="sr-only">
          {`Rol de ${member.displayName}`}
        </label>
        <select
          id={roleId}
          className="min-h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={member.roleCode}
          disabled={state === "suspended"}
          onChange={(event) => {
            if (event.target.value !== member.roleCode) onRoleChange(event.target.value);
          }}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
        {state === "pending" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={resendPending}
            onClick={onResend}
          >
            Reenviar invitación
          </Button>
        ) : null}
        {branches.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editingBranches}
            onClick={() => setEditingBranches((open) => !open)}
          >
            Sucursales
          </Button>
        ) : null}
        {state === "suspended" ? (
          <Button type="button" variant="outline" size="sm" onClick={onReactivate}>
            Reactivar
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onSuspend}>
            Suspender
          </Button>
        )}
      </div>
      {editingBranches ? (
        <MemberBranchesEditor
          member={member}
          branches={branches.filter((branch) => branch.isActive)}
          onCancel={() => setEditingBranches(false)}
          onSaved={(names) => {
            setEditingBranches(false);
            onBranchesSaved(names);
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * MB-001: where one person works. Only active branches are offered; an
 * assignment to a deactivated branch is history and the API keeps it.
 */
function MemberBranchesEditor({
  member,
  branches,
  onCancel,
  onSaved,
}: {
  member: StaffMember;
  branches: readonly Branch[];
  onCancel: () => void;
  onSaved: (names: string[]) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>(
    branches.filter((branch) => member.branchIds.includes(branch.id)).map((branch) => branch.id)
  );
  const save = useMutation({
    mutationFn: () => assignMemberBranches(member.membershipId, selected),
    onSuccess: () =>
      onSaved(
        branches.filter((branch) => selected.includes(branch.id)).map((branch) => branch.name)
      ),
  });
  const empty = selected.length === 0;
  return (
    <div className="w-full space-y-3 border-t border-border pt-3">
      <BranchCheckboxes
        legend={`Sucursales de ${member.displayName}`}
        branches={branches}
        selected={selected}
        onChange={setSelected}
      />
      {empty ? <p className="text-xs text-destructive">Elegí al menos una sucursal.</p> : null}
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {branchesErrorMessage(save.error, "No se pudieron guardar las sucursales.")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={empty}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar sucursales
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function BranchCheckboxes({
  legend,
  branches,
  selected,
  onChange,
}: {
  legend: string;
  branches: readonly Branch[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
}): JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {branches.map((branch) => (
          <label key={branch.id} className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.includes(branch.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, branch.id]
                    : selected.filter((id) => id !== branch.id)
                )
              }
            />
            {branch.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InviteForm({
  branches,
  onInvited,
}: {
  /** MB-001: active branches to choose from; empty hides the choice (every branch). */
  branches: readonly Branch[];
  onInvited: (result: InvitationResult, email: string, name: string) => void;
}): JSX.Element {
  const [branchIds, setBranchIds] = useState<readonly string[]>(
    branches.map((branch) => branch.id)
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [roleCode, setRoleCode] = useState<string>(DEFAULT_INVITE_ROLE);
  const [touched, setTouched] = useState(false);
  const ids = { name: useId(), email: useId(), role: useId(), problem: useId() };

  const invite = useMutation({
    mutationFn: () =>
      inviteStaff({
        email: email.trim(),
        displayName: displayName.trim(),
        roleCode,
        ...(branches.length > 0 ? { branchIds } : {}),
      }),
    onSuccess: (result) => onInvited(result, email.trim(), displayName.trim()),
  });

  const nameMissing = touched && displayName.trim().length === 0;
  const emailInvalid = touched && !looksLikeEmail(email);
  const noBranch = branches.length > 0 && branchIds.length === 0;

  return (
    <section
      aria-labelledby={`${ids.name}-title`}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div>
        <h2 id={`${ids.name}-title`} className="text-base font-semibold">
          Invitar a una persona
        </h2>
        <p className="text-sm text-muted-foreground">
          Le llega un correo con un enlace para elegir su contraseña. Vale 72 horas.
        </p>
      </div>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-3"
        aria-busy={invite.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (displayName.trim().length === 0 || !looksLikeEmail(email) || noBranch) return;
          invite.mutate();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.name} className="text-sm font-medium">
            Nombre
          </label>
          <Input
            id={ids.name}
            value={displayName}
            maxLength={120}
            autoComplete="off"
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? `${ids.name}-error` : undefined}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          {nameMissing ? (
            <p id={`${ids.name}-error`} className="text-xs text-destructive">
              Escribí el nombre.
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.email} className="text-sm font-medium">
            Email
          </label>
          <Input
            id={ids.email}
            type="email"
            value={email}
            maxLength={254}
            autoComplete="off"
            aria-invalid={emailInvalid}
            aria-describedby={emailInvalid ? `${ids.email}-error` : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailInvalid ? (
            <p id={`${ids.email}-error`} className="text-xs text-destructive">
              Escribí un email válido.
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.role} className="text-sm font-medium">
            Rol
          </label>
          <select
            id={ids.role}
            className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={roleCode}
            onChange={(event) => setRoleCode(event.target.value)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {branches.length > 0 ? (
          <div className="space-y-1 sm:col-span-3">
            <BranchCheckboxes
              legend="Sucursales donde trabaja"
              branches={branches}
              selected={branchIds}
              onChange={setBranchIds}
            />
            {noBranch ? (
              <p className="text-xs text-destructive">Elegí al menos una sucursal.</p>
            ) : null}
          </div>
        ) : null}
        {invite.error ? (
          <p id={ids.problem} role="alert" className="text-sm text-destructive sm:col-span-3">
            {teamErrorMessage(invite.error, "No se pudo enviar la invitación. Intentá nuevamente.")}
          </p>
        ) : null}
        <div className="sm:col-span-3">
          <Button type="submit" loading={invite.isPending}>
            Enviar invitación
          </Button>
        </div>
      </form>
    </section>
  );
}
