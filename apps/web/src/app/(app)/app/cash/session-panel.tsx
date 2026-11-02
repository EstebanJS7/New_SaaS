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
  CASH_SESSION_STATUSES,
  type CashRegister,
  type CashSession,
  type CashSessionStatus,
  type OpenCashSessionInput,
} from "./cash-api";
import {
  CASH_SESSION_STATUS_LABELS,
  cashInputClassName,
  formatCashAmount,
  formatDate,
  shortId,
} from "./cash-display";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { normalizeCashAmountInput } from "./cash-validation";
import { userFacingCashError } from "./cash-api";
import { CashErrorAlert } from "./cash-outcome";
import { cashOpeningAmountError } from "./cash-validation";

/** The session list filter: one lifecycle value, or every status. */
export type CashSessionFilter = CashSessionStatus | "ALL";

interface SessionPanelProps {
  readonly commandsBlocked?: boolean;
  /** The caller tenant's sessions, newest first, as the API returned them. */
  readonly sessions: readonly CashSession[];
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  /** The applied status filter; the API applies it and has no open-only default. */
  readonly statusFilter: CashSessionFilter;
  readonly onStatusFilterChange: (value: CashSessionFilter) => void;
  /** The registers a session can be opened against. */
  readonly registers: readonly CashRegister[];
  readonly registersLoading: boolean;
  readonly onOpen: (input: OpenCashSessionInput) => Promise<void>;
  readonly isOpening: boolean;
  readonly openError: Error | null;
  /** The session the API just opened, present only after a confirmed open. */
  readonly opened: CashSession | null;
  readonly selectedSessionId: string | null;
  readonly onSelectSession: (session: CashSession) => void;
}

/**
 * The session panel (EPIC-13 CASH-004).
 *
 * Lists the tenant's sessions under an explicit status filter and opens one for
 * a chosen register with the required opening float. The filter is the API's own
 * `status` query and has NO implicit open-only default, so "All statuses" really
 * asks for all of them.
 *
 * A register may hold at most one `OPEN` session (the database's partial unique
 * index), so a second open is the stable `409` — a real state of the tenant, not
 * a malformed request, and the way out is the close command rather than a retry.
 * The panel sends only the register and the opening amount: the opener, the
 * status and the tenant are all server-resolved.
 */
export function SessionPanel({
  commandsBlocked = false,
  sessions,
  isLoading,
  loadError,
  statusFilter,
  onStatusFilterChange,
  registers,
  registersLoading,
  onOpen,
  isOpening,
  openError,
  opened,
  selectedSessionId,
  onSelectSession,
}: SessionPanelProps): JSX.Element {
  const [registerId, setRegisterId] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const [review, setReview] = useState<OpenCashSessionInput | null>(null);

  const canOpen = registers.length > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (commandsBlocked || isOpening || review !== null) return;
    if (registerId.length === 0) {
      setLocalError("Elegí la caja para abrir la sesión.");
      return;
    }
    const error = cashOpeningAmountError(openingAmount);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    const amount = normalizeCashAmountInput(openingAmount);
    if (amount === null) return;
    setLocalError(null);
    setReview({ registerId, openingAmount: amount });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sesiones</CardTitle>
        <CardDescription>
          Una sesión reúne las operaciones de una caja. Solo puede haber una sesión abierta por
          caja.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="cash-session-status-filter" className="text-sm font-medium">
            Filtrar por estado
          </label>
          <select
            id="cash-session-status-filter"
            disabled={commandsBlocked}
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as CashSessionFilter)}
            className={cashInputClassName}
          >
            <option value="ALL">Todos los estados</option>
            {CASH_SESSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CASH_SESSION_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p data-testid="sessions-loading" className="text-sm text-muted-foreground">
            Cargando sesiones…
          </p>
        ) : loadError !== null ? (
          <CashErrorAlert error={loadError} testId="sessions-error" />
        ) : sessions.length === 0 ? (
          <p data-testid="sessions-empty" className="text-sm text-muted-foreground">
            No hay sesiones para este filtro.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => {
              const selected = session.id === selectedSessionId;
              return (
                <li
                  key={session.id}
                  data-selected={selected}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {`Sesión ${CASH_SESSION_STATUS_LABELS[session.status].toLowerCase()} · caja #${shortId(session.registerId)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`Inicial ${formatCashAmount(session.openingAmount)} · apertura ${formatDate(session.openedAt)}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    disabled={commandsBlocked}
                    onClick={() => onSelectSession(session)}
                  >
                    {selected ? "Seleccionada" : "Seleccionar sesión"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {opened !== null && (
          <div
            role="status"
            data-testid="session-opened"
            className="rounded-lg border border-border bg-muted p-4 text-sm"
          >
            <p className="font-medium text-foreground">Sesión abierta</p>
            <p className="text-muted-foreground">
              {`Sesión abierta para la caja #${shortId(opened.registerId)}, con importe inicial de ${formatCashAmount(opened.openingAmount)}. Quedó seleccionada para operar.`}
            </p>
          </div>
        )}

        {openError !== null && <CashErrorAlert error={openError} testId="session-open-error" />}

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="cash-session-register" className="text-sm font-medium">
              Caja
            </label>
            <select
              id="cash-session-register"
              value={registerId}
              onChange={(event) => setRegisterId(event.target.value)}
              disabled={isOpening || commandsBlocked || !canOpen}
              className={cashInputClassName}
            >
              <option value="">Elegí una caja</option>
              {registers.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="cash-session-opening-amount" className="text-sm font-medium">
              Importe inicial
            </label>
            <input
              id="cash-session-opening-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              disabled={isOpening || commandsBlocked || !canOpen}
              placeholder="0,00"
              className={cashInputClassName}
            />
            <p className="text-xs text-muted-foreground">
              Efectivo inicial de la caja. Usá coma para hasta dos decimales y punto para agrupar
              miles. El importe esperado se calcula a partir de los movimientos.
            </p>
          </div>

          {!canOpen && (
            <p data-testid="session-no-registers" className="text-sm text-muted-foreground">
              {registersLoading ? "Cargando cajas…" : "Creá una caja antes de abrir una sesión."}
            </p>
          )}

          {localError !== null && (
            <p
              role="alert"
              data-testid="session-open-validation-error"
              className="text-sm text-destructive"
            >
              {localError}
            </p>
          )}

          <Button type="submit" disabled={isOpening || commandsBlocked || !canOpen}>
            {isOpening ? "Abriendo sesión…" : "Abrir sesión"}
          </Button>
        </form>
      </CardContent>
      <ConfirmActionDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
        title="Revisar apertura"
        description="Se abrirá una sesión con el efectivo inicial indicado. Solo puede haber una sesión abierta por caja."
        confirmLabel="Confirmar apertura"
        cancelLabel="Volver"
        pending={isOpening}
        confirmDisabled={commandsBlocked}
        errorMessage={openError ? userFacingCashError(openError) : undefined}
        onConfirm={async () => {
          if (commandsBlocked || !review || isOpening) return;
          await onOpen(review);
          setOpeningAmount("");
        }}
      >
        {review && (
          <p className="break-words text-sm">
            {registers.find((row) => row.id === review.registerId)?.name ??
              `Caja #${shortId(review.registerId)}`}{" "}
            · Inicial: {formatCashAmount(review.openingAmount)}
          </p>
        )}
      </ConfirmActionDialog>
    </Card>
  );
}
