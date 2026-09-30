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
import { CashErrorAlert } from "./cash-outcome";
import { cashOpeningAmountError } from "./cash-validation";

/** The session list filter: one lifecycle value, or every status. */
export type CashSessionFilter = CashSessionStatus | "ALL";

interface SessionPanelProps {
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

  const canOpen = registers.length > 0;

  async function submitOpen(): Promise<void> {
    if (registerId.length === 0) {
      setLocalError("Select the register to open the session for.");
      return;
    }
    const amountError = cashOpeningAmountError(openingAmount);
    if (amountError !== null) {
      setLocalError(amountError);
      return;
    }
    setLocalError(null);
    try {
      await onOpen({ registerId, openingAmount: openingAmount.trim() });
      setOpeningAmount("");
    } catch {
      // The refusal is rendered from `openError`; the entered values are kept so
      // the operator can correct them without retyping the whole form.
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitOpen();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          A session is the accounting window of one register. Only one session may be open per
          register at a time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="cash-session-status-filter" className="text-sm font-medium">
            Status filter
          </label>
          <select
            id="cash-session-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as CashSessionFilter)}
            className={cashInputClassName}
          >
            <option value="ALL">All statuses</option>
            {CASH_SESSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CASH_SESSION_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p data-testid="sessions-loading" className="text-sm text-muted-foreground">
            Loading cash sessions...
          </p>
        ) : loadError !== null ? (
          <CashErrorAlert error={loadError} testId="sessions-error" />
        ) : sessions.length === 0 ? (
          <p data-testid="sessions-empty" className="text-sm text-muted-foreground">
            No sessions match this filter.
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
                      {`${CASH_SESSION_STATUS_LABELS[session.status]} session · register #${shortId(session.registerId)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`Opening ${formatCashAmount(session.openingAmount)} · opened ${formatDate(session.openedAt)}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    onClick={() => onSelectSession(session)}
                  >
                    {selected ? "Selected" : "Select session"}
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
            <p className="font-medium text-foreground">Session opened</p>
            <p className="text-muted-foreground">
              {`The API opened a session for register #${shortId(opened.registerId)} with an opening amount of ${formatCashAmount(opened.openingAmount)}. It is selected for movements and close.`}
            </p>
          </div>
        )}

        {openError !== null && <CashErrorAlert error={openError} testId="session-open-error" />}

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="cash-session-register" className="text-sm font-medium">
              Register
            </label>
            <select
              id="cash-session-register"
              value={registerId}
              onChange={(event) => setRegisterId(event.target.value)}
              disabled={isOpening || !canOpen}
              className={cashInputClassName}
            >
              <option value="">Select a register</option>
              {registers.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="cash-session-opening-amount" className="text-sm font-medium">
              Opening amount
            </label>
            <input
              id="cash-session-opening-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              disabled={isOpening || !canOpen}
              placeholder="0.00"
              className={cashInputClassName}
            />
            <p className="text-xs text-muted-foreground">
              The opening float of the drawer, as an exact decimal with at most 2 decimals. The API
              stores it and computes the expected amount from the ledger.
            </p>
          </div>

          {!canOpen && (
            <p data-testid="session-no-registers" className="text-sm text-muted-foreground">
              {registersLoading
                ? "Loading registers..."
                : "Create a register before opening a session."}
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

          <Button type="submit" disabled={isOpening || !canOpen}>
            {isOpening ? "Opening session..." : "Open session"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
