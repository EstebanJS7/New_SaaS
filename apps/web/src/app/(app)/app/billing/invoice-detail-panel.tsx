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
import type { Invoice } from "./billing-api";
import {
  INVOICE_STATUS_LABELS,
  billingTextareaClassName,
  formatInvoiceAmount,
  formatQuantity,
  formatTimestamp,
  invoiceNumberLabel,
} from "./billing-display";
import { BillingErrorAlert } from "./billing-outcome";
import { invoiceCancelReasonError } from "./billing-validation";

/**
 * The outcome of the last invoice command the surface issued, as the surface
 * observed it.
 *
 * The billing API answers a fresh transition and an identical replay with the
 * same `200` representation (`billing-api.ts` documents why no replay
 * discriminant exists), so this type records WHICH command ran and the invoice
 * the API returned — it never claims that a fresh transition happened when the
 * API cannot say. The panel therefore describes the returned state, which is
 * the only thing the API actually asserted.
 */
export type InvoiceCommandOutcome =
  | { readonly kind: "confirmed"; readonly invoice: Invoice }
  | { readonly kind: "cancelled"; readonly invoice: Invoice };

interface InvoiceDetailPanelProps {
  /** The selected invoice read from the API, or `null` before a selection resolves. */
  readonly invoice: Invoice | null;
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  readonly onConfirm: () => Promise<void>;
  readonly isConfirming: boolean;
  readonly confirmError: Error | null;
  readonly onCancel: (reason: string) => Promise<void>;
  readonly isCancelling: boolean;
  readonly cancelError: Error | null;
  /** The last command's returned representation, present only after a success. */
  readonly outcome: InvoiceCommandOutcome | null;
}

/** Renders one command outcome from the representation the API returned. */
function CommandOutcome({ outcome }: { readonly outcome: InvoiceCommandOutcome }): JSX.Element {
  if (outcome.kind === "confirmed") {
    return (
      <div
        role="status"
        data-testid="invoice-confirmed"
        className="rounded-lg border border-border bg-muted p-4 text-sm"
      >
        <p className="font-medium text-foreground">Invoice confirmed</p>
        <p className="text-muted-foreground">
          {`The API returned this invoice as confirmed, numbered ${invoiceNumberLabel(outcome.invoice.series, outcome.invoice.number)}. Confirmation is state-guarded, so a repeat returns this same representation: no second number is allocated and no second confirmation is claimed.`}
        </p>
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="invoice-cancelled"
      className="rounded-lg border border-border bg-muted p-4 text-sm"
    >
      <p className="font-medium text-foreground">Invoice cancelled</p>
      <p className="text-muted-foreground">
        {outcome.invoice.cancelReason === null
          ? "The API returned this invoice as cancelled. Cancelled is terminal: the invoice is never reopened, edited or deleted, and cancelling reverses no money."
          : `The API returned this invoice as cancelled with the reason "${outcome.invoice.cancelReason}". Cancelled is terminal: the invoice is never reopened, edited or deleted, and cancelling reverses no money.`}
      </p>
    </div>
  );
}

/**
 * The invoice detail panel (EPIC-14 BILL-004).
 *
 * Shows one invoice exactly as the API projects it: the immutable snapshot
 * lines (description, quantity, unit price, line total), the allocated series
 * and number (a draft has none), the status, the confirmation and cancellation
 * timestamps and the cancellation reason when one exists. Every money value is
 * the server-computed exact-decimal string rendered as returned — this panel
 * never sums, converts or recomputes anything (DEC-038).
 *
 * The two actions are the API's own transitions and nothing else: confirm is
 * offered only while the invoice is a `DRAFT`, cancel requires a reason and is
 * offered while the invoice is cancellable, and both are disabled while their
 * command is in flight. There is deliberately no edit or reopen affordance
 * (DEC-038/DEC-043), no print or export control (DEC-044/DEC-045), no payment
 * affordance (DEC-044) and NO fiscal state, because the invoice carries none
 * (DEC-042).
 */
export function InvoiceDetailPanel({
  invoice,
  isLoading,
  loadError,
  onConfirm,
  isConfirming,
  confirmError,
  onCancel,
  isCancelling,
  cancelError,
  outcome,
}: InvoiceDetailPanelProps): JSX.Element {
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitCancel(): Promise<void> {
    const error = invoiceCancelReasonError(reason);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    try {
      await onCancel(reason.trim());
      setReason("");
    } catch {
      // The refusal is rendered from `cancelError`; the reason is kept so the
      // operator can correct it instead of retyping it.
    }
  }

  async function submitConfirm(): Promise<void> {
    try {
      await onConfirm();
    } catch {
      // The refusal is rendered from `confirmError`; catching here keeps the
      // rejected mutation from surfacing as an unhandled rejection.
    }
  }

  function handleCancel(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitCancel();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice detail</CardTitle>
        <CardDescription>
          The frozen snapshot of one invoice. It is an internal document: it carries no fiscal state
          and no fiscal action exists for it in this epic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p data-testid="invoice-loading" className="text-sm text-muted-foreground">
            Loading invoice...
          </p>
        ) : loadError !== null ? (
          <BillingErrorAlert error={loadError} testId="invoice-error" />
        ) : invoice === null ? (
          <p data-testid="invoice-no-selection" className="text-sm text-muted-foreground">
            Select an invoice above to inspect its lines and totals.
          </p>
        ) : (
          <>
            {outcome !== null && <CommandOutcome outcome={outcome} />}

            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd data-testid="invoice-status" className="font-medium text-foreground">
                  {INVOICE_STATUS_LABELS[invoice.status]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Series and number</dt>
                <dd data-testid="invoice-number" className="font-medium text-foreground">
                  {invoiceNumberLabel(invoice.series, invoice.number)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Currency</dt>
                <dd data-testid="invoice-currency" className="font-medium text-foreground">
                  {invoice.currency}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Confirmed at</dt>
                <dd data-testid="invoice-confirmed-at" className="font-medium text-foreground">
                  {invoice.confirmedAt === null
                    ? "Not confirmed"
                    : formatTimestamp(invoice.confirmedAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-border pb-2">
                <dt className="text-muted-foreground">Cancelled at</dt>
                <dd data-testid="invoice-cancelled-at" className="font-medium text-foreground">
                  {invoice.cancelledAt === null
                    ? "Not cancelled"
                    : formatTimestamp(invoice.cancelledAt)}
                </dd>
              </div>
              {invoice.cancelReason !== null && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Cancellation reason</dt>
                  <dd
                    data-testid="invoice-cancel-reason"
                    className="text-right font-medium text-foreground"
                  >
                    {invoice.cancelReason}
                  </dd>
                </div>
              )}
            </dl>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Lines</p>
              {invoice.lines.length === 0 ? (
                <p data-testid="invoice-lines-empty" className="text-sm text-muted-foreground">
                  This invoice has no lines.
                </p>
              ) : (
                <ul className="space-y-2">
                  {invoice.lines.map((line) => (
                    <li
                      key={line.id}
                      data-testid="invoice-line"
                      className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {line.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {`Qty ${formatQuantity(line.quantity)} · unit ${formatInvoiceAmount(line.unitPrice)}`}
                        </p>
                      </div>
                      <span
                        data-testid="invoice-line-total"
                        className="shrink-0 text-right text-sm text-foreground"
                      >
                        {formatInvoiceAmount(line.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Total</dt>
                <dd data-testid="invoice-total" className="text-right font-medium text-foreground">
                  {formatInvoiceAmount(invoice.total)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Tax total</dt>
                <dd
                  data-testid="invoice-tax-total"
                  className="text-right font-medium text-foreground"
                >
                  {formatInvoiceAmount(invoice.taxTotal)}
                </dd>
              </div>
            </dl>

            <p data-testid="invoice-no-fiscal-state" className="text-xs text-muted-foreground">
              This invoice is not a fiscal document and carries no fiscal status. Totals are the
              server-computed values, displayed exactly as the API returned them.
            </p>

            {invoice.status === "DRAFT" && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Confirming allocates the invoice number. It is a one-way command: a confirmed
                  invoice is never returned to draft.
                </p>
                {confirmError !== null && (
                  <BillingErrorAlert error={confirmError} testId="invoice-confirm-error" />
                )}
                <Button type="button" disabled={isConfirming} onClick={() => void submitConfirm()}>
                  {isConfirming ? "Confirming invoice..." : "Confirm invoice"}
                </Button>
              </div>
            )}

            {invoice.status === "CANCELLED" ? (
              <p
                data-testid="invoice-cancelled-terminal"
                className="border-t border-border pt-4 text-sm text-muted-foreground"
              >
                This invoice is cancelled. Cancelled is terminal: there is no reopen and no edit,
                and a replacement draft must be created from a new sale.
              </p>
            ) : (
              <form onSubmit={handleCancel} className="space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <label htmlFor="billing-cancel-reason" className="text-sm font-medium">
                    Cancellation reason
                  </label>
                  <textarea
                    id="billing-cancel-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={isCancelling}
                    placeholder="Why the invoice is being cancelled"
                    className={billingTextareaClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required. The API stores the reason on the invoice and cancels no money.
                  </p>
                </div>

                {localError !== null && (
                  <p
                    role="alert"
                    data-testid="invoice-cancel-validation-error"
                    className="text-sm text-destructive"
                  >
                    {localError}
                  </p>
                )}

                {cancelError !== null && (
                  <BillingErrorAlert error={cancelError} testId="invoice-cancel-error" />
                )}

                <Button type="submit" variant="outline" disabled={isCancelling}>
                  {isCancelling ? "Cancelling invoice..." : "Cancel invoice"}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
