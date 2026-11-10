"use client";

import type { JSX } from "react";
import { useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  CASH_REGISTER_NAME_MAX_LENGTH,
  type CashRegister,
  type CreateCashRegisterInput,
} from "./cash-api";
import { cashInputClassName, formatDate, shortId } from "./cash-display";
import { CashErrorAlert } from "./cash-outcome";
import { cashRegisterNameError } from "./cash-validation";

interface RegisterPanelProps {
  readonly commandsBlocked?: boolean;
  /** The caller tenant's registers, newest first, as the API returned them. */
  readonly registers: readonly CashRegister[];
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  readonly onCreate: (input: CreateCashRegisterInput) => Promise<void>;
  readonly isCreating: boolean;
  readonly createError: Error | null;
  /** The register the API just created, present only after a confirmed create. */
  readonly created: CashRegister | null;
  /**
   * MB-002: the branches the person works at. With two or more, the form asks
   * where the new drawer goes; with one or none, it sends no branch and the API
   * uses the only one (or explains what is missing).
   */
  readonly branches?: readonly { readonly id: string; readonly name: string }[];
  /** [[UX-037]]: false when the caller is known to lack the command's permission. */
  readonly canCreate?: boolean;
}

/**
 * The register panel (EPIC-13 CASH-004).
 *
 * Lists the tenant's drawers and creates one by name — plus, for a person who
 * works at several branches, the branch it goes to (MB-002). The tenant is
 * server-resolved and `isActive` is server-owned, so this panel sends nothing
 * else and the proxy would refuse it if it did. A duplicate name is the stable `409` produced by
 * the tenant-unique index, rendered as its own outcome rather than a retryable
 * failure of the same intent.
 */
export function RegisterPanel({
  commandsBlocked = false,
  registers,
  isLoading,
  loadError,
  onCreate,
  isCreating,
  createError,
  created,
  branches = [],
  canCreate = true,
}: RegisterPanelProps): JSX.Element {
  const [name, setName] = useState("");
  const mustChooseBranch = branches.length > 1;
  const [branchId, setBranchId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitRegister(): Promise<void> {
    if (commandsBlocked || isCreating) return;
    const error = cashRegisterNameError(name);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    if (mustChooseBranch && branchId === "") {
      setLocalError("Elegí la sucursal de la caja.");
      return;
    }
    setLocalError(null);
    try {
      await onCreate(mustChooseBranch ? { name: name.trim(), branchId } : { name: name.trim() });
      setName("");
    } catch {
      // The refusal is rendered from `createError`; the entered name is kept so
      // the operator can correct it instead of retyping it.
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitRegister();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cajas</CardTitle>
        <CardDescription>
          Cada caja tiene sus propias sesiones. El importe esperado se obtiene de los movimientos y
          no se edita directamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p data-testid="registers-loading" className="text-sm text-muted-foreground">
            Cargando cajas…
          </p>
        ) : loadError !== null ? (
          <CashErrorAlert error={loadError} testId="registers-error" />
        ) : registers.length === 0 ? (
          <p data-testid="registers-empty" className="text-sm text-muted-foreground">
            Todavía no hay cajas. Creá una para abrir una sesión.
          </p>
        ) : (
          <ul className="space-y-2">
            {registers.map((register) => (
              <li
                key={register.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{register.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      register.branchName ?? null,
                      `#${shortId(register.id)}`,
                      `creada ${formatDate(register.createdAt)}`,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {register.isActive ? "Activa" : "Inactiva"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {created !== null && (
          <div
            role="status"
            data-testid="register-created"
            className="rounded-lg border border-border bg-muted p-4 text-sm"
          >
            <p className="font-medium text-foreground">Caja creada</p>
            <p className="text-muted-foreground">
              {`La caja "${created.name}" fue creada. Ya podés abrir una sesión.`}
            </p>
          </div>
        )}

        {createError !== null && (
          <CashErrorAlert error={createError} testId="register-create-error" />
        )}

        {canCreate && (
          <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
            <div className="space-y-2">
              <label htmlFor="cash-register-name" className="text-sm font-medium">
                Nombre de la caja
              </label>
              <input
                id="cash-register-name"
                type="text"
                autoComplete="off"
                value={name}
                maxLength={CASH_REGISTER_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                disabled={isCreating || commandsBlocked}
                placeholder="Recepción"
                className={cashInputClassName}
              />
            </div>

            {mustChooseBranch && (
              <div className="space-y-2">
                <label htmlFor="cash-register-branch" className="text-sm font-medium">
                  Sucursal
                </label>
                <select
                  id="cash-register-branch"
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  disabled={isCreating || commandsBlocked}
                  className={cashInputClassName}
                >
                  <option value="">Elegí la sucursal</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {localError !== null && (
              <p
                role="alert"
                data-testid="register-name-error"
                className="text-sm text-destructive"
              >
                {localError}
              </p>
            )}

            <Button type="submit" disabled={isCreating || commandsBlocked}>
              {isCreating ? "Creando caja…" : "Crear caja"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
