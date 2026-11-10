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
  branchesErrorMessage,
  createBranch,
  deactivateBranch,
  isBranchesPermissionDenied,
  loadBranchSettings,
  reactivateBranch,
  updateBranch,
  type Branch,
  type BranchInput,
  type FiscalEstablishmentOption,
} from "./branches-api";
import { useCan, type CapabilityRequirement } from "@/lib/capabilities";

/**
 * MB-001 (DEC-094): the clinic's branches — add, edit, deactivate and
 * reactivate. Staff assignment lives on the Personal screen, next to the
 * person. Success is shown only after the API answers; the plan limit, the
 * last-active rule and pending turnos are the API's to refuse.
 */

export const BRANCHES_QUERY_KEY = ["branches", "list"] as const;

/**
 * What the branches screen needs ([[UX-037]]): every route it uses in
 * `apps/api/src/branches/branches.controller.ts` (list, create, edit,
 * deactivate, reactivate) requires `branches.manage`.
 */
export const BRANCH_ACTIONS = {
  manage: { permission: "branches.manage" },
} as const satisfies Record<string, CapabilityRequirement>;

type Editing = { readonly kind: "new" } | { readonly kind: "edit"; readonly branch: Branch };
interface Toggle {
  readonly kind: "deactivate" | "reactivate";
  readonly branch: Branch;
}

export function BranchesSurface(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toggle, setToggle] = useState<Toggle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // UX-037: a caller known to lack the permission sees the no-access state unread.
  const canManage = useCan(BRANCH_ACTIONS.manage);

  const settings = useQuery({
    queryKey: [...BRANCHES_QUERY_KEY, "settings"],
    queryFn: loadBranchSettings,
    retry: false,
    enabled: canManage,
  });
  const branches = {
    ...settings,
    data: settings.data?.branches,
  };
  const establishments = settings.data?.establishments ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["branches"] });

  const command = useMutation({
    mutationFn: (pending: Toggle) =>
      pending.kind === "deactivate"
        ? deactivateBranch(pending.branch.id)
        : reactivateBranch(pending.branch.id),
    onSuccess: (branch, pending) => {
      setNotice(
        pending.kind === "deactivate"
          ? `${branch.name} quedó desactivada: no admite turnos nuevos.`
          : `${branch.name} está activa de nuevo.`
      );
      setToggle(null);
      void refresh();
    },
  });

  const permissionDenied = !canManage || isBranchesPermissionDenied(branches.error);
  const activeCount = branches.data?.filter((branch) => branch.isActive).length ?? 0;

  return (
    <div className="space-y-6" data-testid="branches-surface">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Configuración / Sucursales</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sucursales</h1>
          <p className="text-sm text-muted-foreground">
            Los lugares donde atiende la clínica. Quién trabaja en cada una se elige en Personal.
          </p>
        </div>
        {permissionDenied ? null : (
          <Button
            type="button"
            onClick={() => {
              setNotice(null);
              setEditing((current) => (current?.kind === "new" ? null : { kind: "new" }));
            }}
            aria-expanded={editing?.kind === "new"}
          >
            <Icon name={editing?.kind === "new" ? "close" : "plus"} />
            {editing?.kind === "new" ? "Cerrar" : "Agregar sucursal"}
          </Button>
        )}
      </div>

      {notice === null ? null : (
        <p
          role="status"
          data-testid="branches-notice"
          className="rounded-lg border border-status-success/20 bg-status-success/10 p-4 text-sm"
        >
          {notice}
        </p>
      )}

      {editing?.kind === "new" ? (
        <BranchForm
          title="Nueva sucursal"
          submitLabel="Agregar sucursal"
          onCancel={() => setEditing(null)}
          onSave={(input) => createBranch(input)}
          onSaved={(branch) => {
            setEditing(null);
            setNotice(`${branch.name} quedó agregada. Asigná quién trabaja ahí desde Personal.`);
            void refresh();
          }}
        />
      ) : null}

      {branches.isLoading ? <ListSkeleton label="Cargando sucursales…" rows={2} /> : null}

      {permissionDenied ? (
        <EmptyState
          icon="shield"
          title="No tenés permiso para ver las sucursales"
          description="Pedile a quien administra la clínica que las gestione."
        />
      ) : branches.error ? (
        <ErrorState
          message="No se pudo cargar la lista de sucursales."
          onRetry={() => void branches.refetch()}
        />
      ) : null}

      {branches.data && branches.data.length > 0 ? (
        <ul className="space-y-3" aria-label="Sucursales de la clínica">
          {branches.data.map((branch) =>
            editing?.kind === "edit" && editing.branch.id === branch.id ? (
              <li key={branch.id}>
                <BranchForm
                  title={`Editar ${branch.name}`}
                  submitLabel="Guardar cambios"
                  initial={branch}
                  establishments={establishments}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => updateBranch(branch.id, input)}
                  onSaved={(saved) => {
                    setEditing(null);
                    setNotice(`Se guardaron los cambios de ${saved.name}.`);
                    void refresh();
                  }}
                />
              </li>
            ) : (
              <BranchRow
                key={branch.id}
                branch={branch}
                establishments={establishments}
                canDeactivate={branch.isActive && activeCount > 1}
                onEdit={() => {
                  setNotice(null);
                  setEditing({ kind: "edit", branch });
                }}
                onToggle={() => {
                  command.reset();
                  setNotice(null);
                  setToggle({ kind: branch.isActive ? "deactivate" : "reactivate", branch });
                }}
              />
            )
          )}
        </ul>
      ) : branches.data ? (
        <EmptyState
          icon="building"
          title="Todavía no hay sucursales"
          description="Agregá el lugar donde atiende la clínica."
        />
      ) : null}

      <ConfirmActionDialog
        open={toggle !== null}
        onOpenChange={(open) => {
          if (!open) setToggle(null);
        }}
        title={
          toggle === null
            ? ""
            : toggle.kind === "deactivate"
              ? `¿Desactivar ${toggle.branch.name}?`
              : `¿Reactivar ${toggle.branch.name}?`
        }
        description={
          toggle?.kind === "deactivate"
            ? "No va a admitir turnos nuevos. Lo ya registrado se conserva y podés reactivarla cuando quieras."
            : "Vuelve a admitir turnos. Si tu plan incluye una sola sucursal activa, primero desactivá la otra."
        }
        confirmLabel={toggle?.kind === "deactivate" ? "Desactivar" : "Reactivar"}
        confirmVariant={toggle?.kind === "deactivate" ? "destructive" : "default"}
        pending={command.isPending}
        errorMessage={
          command.error
            ? branchesErrorMessage(command.error, "No se pudo completar el cambio.")
            : undefined
        }
        // Rejects on failure on purpose: the dialog stays open and shows `errorMessage`.
        onConfirm={() => (toggle === null ? undefined : command.mutateAsync(toggle))}
      />
    </div>
  );
}

function BranchRow({
  branch,
  establishments,
  canDeactivate,
  onEdit,
  onToggle,
}: {
  branch: Branch;
  establishments: readonly FiscalEstablishmentOption[];
  canDeactivate: boolean;
  onEdit: () => void;
  onToggle: () => void;
}): JSX.Element {
  const details = [branch.address, branch.phone].filter((value): value is string => !!value);
  const establishment = establishments.find(
    (candidate) => candidate.id === branch.fiscalEstablishmentId
  );
  return (
    <li className="record-row" data-testid="branch-row">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className="truncate font-semibold text-foreground">{branch.name}</span>
          <Badge variant={branch.isActive ? "success" : "outline"}>
            {branch.isActive ? "Activa" : "Desactivada"}
          </Badge>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {details.length > 0 ? details.join(" · ") : "Sin dirección ni teléfono"}
        </p>
        {establishment && branch.expeditionPoint ? (
          <p className="text-xs text-muted-foreground" data-testid="branch-issuance-point">
            {`Factura con ${establishment.code}-${branch.expeditionPoint}`}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {branch.staffCount === 1
            ? "1 persona asignada"
            : `${branch.staffCount} personas asignadas`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          Editar
        </Button>
        {branch.isActive ? (
          canDeactivate ? (
            <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
              Desactivar
            </Button>
          ) : null
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onToggle}>
            Reactivar
          </Button>
        )}
      </div>
    </li>
  );
}

function BranchForm({
  title,
  submitLabel,
  initial,
  establishments = [],
  onCancel,
  onSave,
  onSaved,
}: {
  title: string;
  submitLabel: string;
  initial?: Branch;
  /** MB-002: offered only when editing and the clinic has establishments. */
  establishments?: readonly FiscalEstablishmentOption[];
  onCancel: () => void;
  onSave: (input: BranchInput) => Promise<Branch>;
  onSaved: (branch: Branch) => void;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [establishmentId, setEstablishmentId] = useState(initial?.fiscalEstablishmentId ?? "");
  const [point, setPoint] = useState(initial?.expeditionPoint ?? "");
  const [touched, setTouched] = useState(false);
  const ids = {
    title: useId(),
    name: useId(),
    address: useId(),
    phone: useId(),
    establishment: useId(),
    point: useId(),
  };
  const offersIssuancePoint = initial !== undefined && establishments.length > 0;
  const pointInvalid = touched && establishmentId !== "" && !/^[0-9]{3}$/.test(point.trim());

  const save = useMutation({
    mutationFn: () =>
      onSave({
        name: name.trim(),
        address: address.trim().length > 0 ? address.trim() : null,
        phone: phone.trim().length > 0 ? phone.trim() : null,
        ...(offersIssuancePoint
          ? establishmentId === ""
            ? { fiscalEstablishmentId: null, expeditionPoint: null }
            : { fiscalEstablishmentId: establishmentId, expeditionPoint: point.trim() }
          : {}),
      }),
    onSuccess: onSaved,
  });

  const nameMissing = touched && name.trim().length === 0;

  return (
    <section
      aria-labelledby={ids.title}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <h2 id={ids.title} className="text-base font-semibold">
        {title}
      </h2>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-3"
        aria-busy={save.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (name.trim().length === 0) return;
          if (establishmentId !== "" && !/^[0-9]{3}$/.test(point.trim())) return;
          save.mutate();
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.name} className="text-sm font-medium">
            Nombre
          </label>
          <Input
            id={ids.name}
            value={name}
            maxLength={120}
            autoComplete="off"
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? `${ids.name}-error` : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {nameMissing ? (
            <p id={`${ids.name}-error`} className="text-xs text-destructive">
              Escribí el nombre.
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.address} className="text-sm font-medium">
            Dirección <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <Input
            id={ids.address}
            value={address}
            maxLength={255}
            autoComplete="off"
            onChange={(event) => setAddress(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.phone} className="text-sm font-medium">
            Teléfono <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <Input
            id={ids.phone}
            type="tel"
            value={phone}
            maxLength={30}
            autoComplete="off"
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        {offersIssuancePoint ? (
          <>
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor={ids.establishment} className="text-sm font-medium">
                Establecimiento fiscal
              </label>
              <select
                id={ids.establishment}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={establishmentId}
                onChange={(event) => setEstablishmentId(event.target.value)}
              >
                <option value="">El punto por defecto del perfil fiscal</option>
                {establishments.map((establishment) => (
                  <option key={establishment.id} value={establishment.id}>
                    {`${establishment.code} · ${establishment.addressLine}`}
                  </option>
                ))}
              </select>
            </div>
            {establishmentId !== "" ? (
              <div className="space-y-1">
                <label htmlFor={ids.point} className="text-sm font-medium">
                  Punto de expedición
                </label>
                <Input
                  id={ids.point}
                  value={point}
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="001"
                  aria-invalid={pointInvalid}
                  onChange={(event) => setPoint(event.target.value)}
                />
                {pointInvalid ? (
                  <p className="text-xs text-destructive">Tres dígitos, por ejemplo 001.</p>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Las facturas y notas de crédito de las ventas de esta sucursal se numeran con este
              establecimiento y punto. Necesitan un timbrado activo cargado para ese punto.
            </p>
          </>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-3">
            {branchesErrorMessage(
              save.error,
              "No se pudo guardar la sucursal. Intentá nuevamente."
            )}
          </p>
        ) : null}
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" loading={save.isPending}>
            {submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}
