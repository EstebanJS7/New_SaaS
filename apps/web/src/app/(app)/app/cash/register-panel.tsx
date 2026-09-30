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
  /** The caller tenant's registers, newest first, as the API returned them. */
  readonly registers: readonly CashRegister[];
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  readonly onCreate: (input: CreateCashRegisterInput) => Promise<void>;
  readonly isCreating: boolean;
  readonly createError: Error | null;
  /** The register the API just created, present only after a confirmed create. */
  readonly created: CashRegister | null;
}

/**
 * The register panel (EPIC-13 CASH-004).
 *
 * Lists the tenant's drawers and creates one by name. The name is the only field
 * — the tenant is server-resolved, `isActive` is server-owned and there is no
 * Branch dimension (DEC-020) — so this panel sends nothing else and the proxy
 * would refuse it if it did. A duplicate name is the stable `409` produced by
 * the tenant-unique index, rendered as its own outcome rather than a retryable
 * failure of the same intent.
 */
export function RegisterPanel({
  registers,
  isLoading,
  loadError,
  onCreate,
  isCreating,
  createError,
  created,
}: RegisterPanelProps): JSX.Element {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitRegister(): Promise<void> {
    const error = cashRegisterNameError(name);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    try {
      await onCreate({ name: name.trim() });
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
        <CardTitle>Registers</CardTitle>
        <CardDescription>
          A register is the drawer a session is opened against. Its expected amount is derived from
          the movement ledger and is never edited here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p data-testid="registers-loading" className="text-sm text-muted-foreground">
            Loading cash registers...
          </p>
        ) : loadError !== null ? (
          <CashErrorAlert error={loadError} testId="registers-error" />
        ) : registers.length === 0 ? (
          <p data-testid="registers-empty" className="text-sm text-muted-foreground">
            No cash registers yet. Create one to open a session against it.
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
                    {`#${shortId(register.id)} · created ${formatDate(register.createdAt)}`}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {register.isActive ? "Active" : "Inactive"}
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
            <p className="font-medium text-foreground">Register created</p>
            <p className="text-muted-foreground">
              {`"${created.name}" now exists for this tenant. It can be used to open a session.`}
            </p>
          </div>
        )}

        {createError !== null && (
          <CashErrorAlert error={createError} testId="register-create-error" />
        )}

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="cash-register-name" className="text-sm font-medium">
              Register name
            </label>
            <input
              id="cash-register-name"
              type="text"
              autoComplete="off"
              value={name}
              maxLength={CASH_REGISTER_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              disabled={isCreating}
              placeholder="Front desk"
              className={cashInputClassName}
            />
          </div>

          {localError !== null && (
            <p role="alert" data-testid="register-name-error" className="text-sm text-destructive">
              {localError}
            </p>
          )}

          <Button type="submit" disabled={isCreating}>
            {isCreating ? "Creating register..." : "Create register"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
