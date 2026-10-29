"use client";

import type { JSX } from "react";
import { useRef, useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  formatEsPyDecimalInput,
  formatStaffMoney,
  normalizeEsPyDecimalInput,
} from "@/lib/es-py-format";
import {
  PAYMENT_METHODS,
  isWirePaymentAmount,
  type PaymentMethod,
  type SalePaymentInput,
} from "./sales-api";
import { PAYMENT_METHOD_LABELS } from "./sales-display";
import { addWireDecimals, paymentsSumExactly } from "./wire-decimal";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** One locally entered payment; both values stay strings until submit. */
interface PaymentDraft {
  readonly key: string;
  readonly method: PaymentMethod;
  readonly amount: string;
}

interface PaymentCaptureProps {
  /** The sale total the API computed, as an exact fixed-scale decimal string. */
  readonly total: string;
  /** The sale's currency, rendered as its own field and never converted. */
  readonly currency: string;
  readonly onSubmit: (payments: SalePaymentInput[]) => void | Promise<unknown>;
  readonly isPending: boolean;
  readonly errorMessage?: string;
  readonly disabled?: boolean;
}

/**
 * The payment capture (EPIC-12 POS-004, DEC-029).
 *
 * It accepts one or several payments across the six PRD §19 methods, shows the
 * exact sum of what was entered against the sale total, and refuses to submit a
 * set that does not sum exactly. The sum and the comparison are exact decimal
 * arithmetic over the wire strings ({@link addWireDecimals},
 * {@link paymentsSumExactly}) — no money literal is ever parsed into a
 * JavaScript number.
 *
 * There is deliberately no tendered amount, no change and no customer credit
 * field: the sale is settled when the payments sum exactly, and the API enforces
 * the same rule authoritatively. The first payment starts at the total so a
 * single-method sale is one keystroke, and it stays editable.
 */
export function PaymentCapture({
  total,
  currency,
  onSubmit,
  isPending,
  errorMessage,
  disabled = false,
}: PaymentCaptureProps): JSX.Element {
  const nextKeyRef = useRef(1);
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { key: "payment-0", method: "CASH", amount: formatEsPyDecimalInput(total) },
  ]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const normalizedAmounts = payments.map((payment) => normalizeEsPyDecimalInput(payment.amount));
  const exactAmounts = normalizedAmounts.filter(
    (amount): amount is string => amount !== null && isWirePaymentAmount(amount)
  );
  const everyAmountValid = payments.length > 0 && exactAmounts.length === payments.length;
  const exact = everyAmountValid && paymentsSumExactly(exactAmounts, total);
  const sum = everyAmountValid ? addWireDecimals(exactAmounts) : null;
  const isLocked = disabled || isPending;

  function setPayment(key: string, patch: Partial<Omit<PaymentDraft, "key">>): void {
    setPayments((previous) =>
      previous.map((payment) => (payment.key === key ? { ...payment, ...patch } : payment))
    );
  }

  function addPayment(): void {
    const key = `payment-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    setPayments((previous) => [...previous, { key, method: "CARD", amount: "" }]);
  }

  function removePayment(key: string): void {
    setPayments((previous) =>
      previous.length > 1 ? previous.filter((payment) => payment.key !== key) : previous
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!exact || isLocked) {
      return;
    }
    setReviewOpen(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        {payments.map((payment, index) => (
          <div
            key={payment.key}
            className="grid gap-3 rounded-lg border border-input p-3 sm:grid-cols-2"
          >
            <div className="space-y-2">
              <label htmlFor={`${payment.key}-method`} className="text-sm font-medium">
                {`Medio de pago ${index + 1}`}
              </label>
              <select
                id={`${payment.key}-method`}
                value={payment.method}
                onChange={(event) =>
                  setPayment(payment.key, { method: event.target.value as PaymentMethod })
                }
                disabled={isLocked}
                className={inputClassName}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${payment.key}-amount`} className="text-sm font-medium">
                {`Importe del pago ${index + 1}`}
              </label>
              <input
                id={`${payment.key}-amount`}
                type="text"
                inputMode="decimal"
                value={payment.amount}
                onChange={(event) => setPayment(payment.key, { amount: event.target.value })}
                disabled={isLocked}
                placeholder="0"
                aria-invalid={
                  normalizeEsPyDecimalInput(payment.amount) === null ||
                  !isWirePaymentAmount(normalizeEsPyDecimalInput(payment.amount) ?? "")
                }
                aria-describedby={
                  normalizeEsPyDecimalInput(payment.amount) === null ||
                  !isWirePaymentAmount(normalizeEsPyDecimalInput(payment.amount) ?? "")
                    ? `${payment.key}-amount-hint payment-exact-sum-help`
                    : "payment-exact-sum-help"
                }
                className={inputClassName}
              />
              {(normalizeEsPyDecimalInput(payment.amount) === null ||
                !isWirePaymentAmount(normalizeEsPyDecimalInput(payment.amount) ?? "")) && (
                <p id={`${payment.key}-amount-hint`} className="text-xs text-destructive">
                  Ingresá un importe positivo con hasta dos decimales. Usá coma para los decimales y
                  punto para los miles.
                </p>
              )}
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removePayment(payment.key)}
                disabled={isLocked || payments.length === 1}
              >
                Quitar pago
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addPayment} disabled={isLocked}>
          Agregar medio de pago
        </Button>
        <p className="text-sm text-muted-foreground" aria-label="Total de la venta">
          {`Total de la venta: ${formatStaffMoney(total, currency)}`}
        </p>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={exact ? "text-sm text-foreground" : "text-sm text-destructive"}
        data-testid="payment-sum"
      >
        {`Suma de pagos: ${sum === null ? "no disponible" : formatStaffMoney(sum, currency)}.`}
      </p>

      <p
        id="payment-exact-sum-help"
        className={exact ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
      >
        Los importes deben sumar exactamente el total de la venta. No se calcula vuelto ni se acepta
        saldo a crédito.
      </p>

      <Button type="submit" disabled={!exact || isLocked}>
        {isPending ? "Confirmando venta…" : "Revisar venta"}
      </Button>
      <ConfirmActionDialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!open && !isPending) setReviewOpen(false);
        }}
        title="Revisar y confirmar venta"
        description="Verificá el total calculado por el sistema y cómo se distribuye el pago. La venta solo se completa si el servidor confirma la operación."
        confirmLabel="Confirmar venta"
        confirmVariant="default"
        pending={isPending}
        confirmDisabled={disabled || !exact}
        pendingLabel="Confirmando venta…"
        errorMessage={errorMessage}
        onConfirm={async () => {
          if (isLocked) throw new Error("Consultá el estado de la venta antes de continuar.");
          if (!exact) throw new Error("Los pagos ya no coinciden con el total.");
          await onSubmit(
            payments.map((payment) => ({
              method: payment.method,
              amount: normalizeEsPyDecimalInput(payment.amount) ?? payment.amount.trim(),
            }))
          );
        }}
      >
        <div className="mt-4 space-y-3">
          <dl className="space-y-3 rounded-lg border border-border p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Total de la venta</dt>
              <dd className="font-semibold tabular-nums">{formatStaffMoney(total, currency)}</dd>
            </div>
            {payments.map((payment, index) => (
              <div key={payment.key} className="flex items-center justify-between gap-4">
                <dt>
                  {PAYMENT_METHOD_LABELS[payment.method]} · pago {index + 1}
                </dt>
                <dd className="tabular-nums">
                  {formatStaffMoney(
                    normalizeEsPyDecimalInput(payment.amount) ?? payment.amount.trim(),
                    currency
                  )}
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 border-t border-border pt-3 font-medium">
              <dt>Suma de pagos</dt>
              <dd className="tabular-nums">
                {sum === null ? "No disponible" : formatStaffMoney(sum, currency)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            El importe debe coincidir exactamente. No se calcula vuelto ni se registra crédito.
          </p>
        </div>
      </ConfirmActionDialog>
    </form>
  );
}
