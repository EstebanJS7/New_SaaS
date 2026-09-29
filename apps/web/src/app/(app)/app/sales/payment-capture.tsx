"use client";

import type { JSX } from "react";
import { useRef, useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  PAYMENT_METHODS,
  formatWireAmount,
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
  readonly onSubmit: (payments: SalePaymentInput[]) => void;
  readonly isPending: boolean;
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
  disabled = false,
}: PaymentCaptureProps): JSX.Element {
  const nextKeyRef = useRef(1);
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { key: "payment-0", method: "CASH", amount: total },
  ]);

  const amounts = payments.map((payment) => payment.amount);
  const everyAmountValid =
    payments.length > 0 && payments.every((payment) => isWirePaymentAmount(payment.amount.trim()));
  const exact = everyAmountValid && paymentsSumExactly(amounts, total);
  const sum = addWireDecimals(amounts);
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
    if (!exact) {
      return;
    }
    onSubmit(
      payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount.trim(),
      }))
    );
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
                {`Payment ${index + 1} method`}
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
                {`Payment ${index + 1} amount`}
              </label>
              <input
                id={`${payment.key}-amount`}
                type="text"
                inputMode="decimal"
                value={payment.amount}
                onChange={(event) => setPayment(payment.key, { amount: event.target.value })}
                disabled={isLocked}
                placeholder="0.00"
                className={inputClassName}
              />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removePayment(payment.key)}
                disabled={isLocked || payments.length === 1}
              >
                Remove payment
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addPayment} disabled={isLocked}>
          Add payment
        </Button>
        <p className="text-sm text-muted-foreground">
          {`Total ${formatWireAmount(total)} ${currency}`}
        </p>
      </div>

      <p
        className={exact ? "text-sm text-foreground" : "text-sm text-destructive"}
        data-testid="payment-sum"
      >
        {`Payments sum ${sum === null ? "unknown" : formatWireAmount(sum)} ${currency}.`}
      </p>

      {!exact && (
        <p className="text-xs text-destructive">
          The payments must sum exactly to the sale total before the sale can be completed.
        </p>
      )}

      <Button type="submit" disabled={!exact || isLocked}>
        {isPending ? "Completing..." : "Complete sale"}
      </Button>
    </form>
  );
}
