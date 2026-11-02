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
import type { CashSession, CloseCashSessionInput } from "./cash-api";
import {
  cashDifferenceLabel,
  cashDifferenceOutcome,
  cashInputClassName,
  formatCashAmount,
  formatSignedWireAmount,
  shortId,
} from "./cash-display";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { normalizeCashAmountInput } from "./cash-validation";
import { userFacingCashError } from "./cash-api";
import { CashErrorAlert } from "./cash-outcome";
import { cashCountedAmountError } from "./cash-validation";

interface ClosePanelProps {
  readonly commandsBlocked?: boolean;
  /** The selected session, or `null` before one is chosen. */
  readonly session: CashSession | null;
  readonly onClose: (input: CloseCashSessionInput) => Promise<void>;
  readonly isClosing: boolean;
  readonly closeError: Error | null;
}

interface CloseOutcomeProps {
  /** A `CLOSED` session carrying the three close-result amounts the API wrote. */
  readonly session: CashSession;
}

/**
 * The close outcome (EPIC-13 CASH-004, DEC-031/DEC-036).
 *
 * Shows the three amounts the close command returned: the server-computed
 * expected amount, the operator's counted amount and the difference between
 * them. The difference is rendered with its SIGN made explicit, because
 * `countedAmount - expectedAmount` is NEGATIVE when the drawer is short — a
 * short drawer is a normal close outcome and is deliberately never styled or
 * phrased as an error. `CLOSED` is terminal: there is no reopen control here.
 */
export function CloseOutcome({ session }: CloseOutcomeProps): JSX.Element {
  const { expectedAmount, countedAmount, differenceAmount } = session;
  const outcome = differenceAmount === null ? null : cashDifferenceOutcome(differenceAmount);

  return (
    <div data-testid="close-outcome" data-outcome={outcome ?? "UNKNOWN"} className="space-y-3">
      <div>
        <p className="font-medium text-foreground">Sesión cerrada</p>
        <p className="text-sm text-muted-foreground">
          {`Importes confirmados al cerrar la sesión #${shortId(session.id)}. Para operar nuevamente, abrí otra sesión.`}
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
          <dt className="text-muted-foreground">Importe esperado</dt>
          <dd data-testid="close-expected" className="text-right font-medium text-foreground">
            {expectedAmount === null ? "No informado" : formatCashAmount(expectedAmount)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
          <dt className="text-muted-foreground">Importe contado</dt>
          <dd data-testid="close-counted" className="text-right font-medium text-foreground">
            {countedAmount === null ? "No informado" : formatCashAmount(countedAmount)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Diferencia</dt>
          <dd data-testid="close-difference" className="text-right font-medium text-foreground">
            {differenceAmount === null ? "No informado" : formatSignedWireAmount(differenceAmount)}
          </dd>
        </div>
      </dl>

      {differenceAmount !== null && (
        <p data-testid="close-difference-note" className="text-sm text-muted-foreground">
          {cashDifferenceLabel(differenceAmount)}
        </p>
      )}
    </div>
  );
}

/**
 * The close panel (EPIC-13 CASH-004).
 *
 * Closes the selected `OPEN` session against the operator's physical count and
 * then shows what the close returned. The expected amount, the difference and
 * the resulting `CLOSED` status are all computed server-side and are never sent:
 * the panel submits the counted amount alone.
 *
 * A second close, or a close of a session that is no longer `OPEN`, is the
 * stable `409` — the terminal state is a real condition of the tenant, not a
 * retryable failure, and the panel says so instead of inviting a retry.
 */
export function ClosePanel({
  commandsBlocked = false,
  session,
  onClose,
  isClosing,
  closeError,
}: ClosePanelProps): JSX.Element {
  const [countedAmount, setCountedAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const [review, setReview] = useState<CloseCashSessionInput | null>(null);
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (commandsBlocked || isClosing || review !== null || session?.status !== "OPEN") return;
    const error = cashCountedAmountError(countedAmount);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    const amount = normalizeCashAmountInput(countedAmount);
    if (amount === null) return;
    setLocalError(null);
    setReview({ countedAmount: amount });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cerrar sesión</CardTitle>
        <CardDescription>
          El cierre compara el efectivo contado con el esperado. Una sesión cerrada no se puede
          reabrir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {session === null ? (
          <p data-testid="close-no-session" className="text-sm text-muted-foreground">
            Seleccioná una sesión para cerrarla.
          </p>
        ) : session.status === "CLOSED" ? (
          <CloseOutcome session={session} />
        ) : (
          <>
            {closeError !== null && <CashErrorAlert error={closeError} testId="close-error" />}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-2">
                <label htmlFor="cash-close-counted-amount" className="text-sm font-medium">
                  Importe contado
                </label>
                <input
                  id="cash-close-counted-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={countedAmount}
                  onChange={(event) => setCountedAmount(event.target.value)}
                  disabled={isClosing || commandsBlocked}
                  placeholder="0,00"
                  className={cashInputClassName}
                />
                <p className="text-xs text-muted-foreground">
                  Efectivo contado en la caja, con hasta dos decimales. Usá coma decimal y punto
                  para los miles. El servidor calcula el esperado y la diferencia.
                </p>
              </div>

              {localError !== null && (
                <p
                  role="alert"
                  data-testid="close-validation-error"
                  className="text-sm text-destructive"
                >
                  {localError}
                </p>
              )}

              <Button type="submit" disabled={isClosing || commandsBlocked}>
                {isClosing ? "Cerrando sesión…" : "Cerrar sesión"}
              </Button>
            </form>
          </>
        )}
      </CardContent>
      <ConfirmActionDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
        title="Revisar cierre"
        description="La sesión quedará cerrada y no podrá reabrirse. El servidor calculará el importe esperado y la diferencia."
        confirmLabel="Confirmar cierre"
        cancelLabel="Volver"
        pending={isClosing}
        confirmDisabled={commandsBlocked || session?.status !== "OPEN"}
        errorMessage={closeError ? userFacingCashError(closeError) : undefined}
        onConfirm={async () => {
          if (commandsBlocked || !review || isClosing || session?.status !== "OPEN") return;
          await onClose(review);
          setCountedAmount("");
        }}
      >
        {review && (
          <p className="text-sm">
            Sesión #{shortId(session?.id ?? "")} · Contado: {formatCashAmount(review.countedAmount)}
          </p>
        )}
      </ConfirmActionDialog>
    </Card>
  );
}
