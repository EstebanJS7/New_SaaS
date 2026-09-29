"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { CompletionOutcomeAlert } from "../completion-outcome";
import { PaymentCapture } from "../payment-capture";
import {
  classifySaleCompletionError,
  completeSale,
  formatWireAmount,
  getSale,
  isSaleNotEntitled,
  isSaleNotFound,
  isSalePermissionDenied,
  userFacingSaleError,
  type CompleteSaleResult,
  type SalePaymentInput,
} from "../sales-api";
import {
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  formatAmount,
  formatDate,
  shortId,
  useCatalogItemNames,
  useCustomerNames,
} from "../sales-display";

function DetailRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

/**
 * The draft detail route (EPIC-12 POS-004).
 *
 * It reopens a sale by id and shows its lines, its payments when the completion
 * command produced them, and the honest status: `DRAFT`, `COMPLETED` or
 * `CANCELLED` straight from the API, never inferred locally. The sale read
 * deliberately exposes no payments, so a reopened draft states plainly that none
 * are recorded; the payments of a sale completed from this page come from the
 * completion response itself.
 *
 * A `DRAFT` can be completed from here through the same payment capture and the
 * same exact-sum guard as the counter, which is what makes a draft that was left
 * behind by a failed checkout recoverable. No control edits or deletes a
 * settled sale, and there is no refund or reversal affordance (TD-018).
 *
 * Permission and entitlement branches are UX only; the backend enforces every
 * gate and answers the same shared `404` for a foreign id as for an unknown one.
 */
export function SaleDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const saleId = params.id;
  const queryClient = useQueryClient();
  const catalogNames = useCatalogItemNames();
  const customerNames = useCustomerNames();
  const [completed, setCompleted] = useState<CompleteSaleResult | null>(null);

  const query = useQuery({
    queryKey: ["sales", "detail", saleId],
    queryFn: () => getSale(saleId),
    retry: false,
  });

  const completeMutation = useMutation({
    mutationFn: (payments: SalePaymentInput[]) => completeSale(saleId, { payments }),
    retry: false,
    onSuccess: (result) => {
      setCompleted(result);
      void queryClient.invalidateQueries({ queryKey: ["sales", "detail", saleId] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <p data-testid="sale-loading" className="text-sm text-muted-foreground">
          Loading sale...
        </p>
      </div>
    );
  }

  if (query.error) {
    const permissionDenied = isSalePermissionDenied(query.error);
    const entitlementDenied = isSaleNotEntitled(query.error);
    const notFound = isSaleNotFound(query.error);
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {permissionDenied && <p className="font-medium">Permission denied</p>}
        {entitlementDenied && <p className="font-medium">Sales are not enabled for this tenant</p>}
        {notFound && <p className="font-medium">Not found</p>}
        <p>{userFacingSaleError(query.error)}</p>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <p data-testid="sale-not-found" className="text-sm text-muted-foreground">
          Sale not found.
        </p>
      </div>
    );
  }

  const sale = completed?.sale ?? query.data;
  const completionFailure =
    completeMutation.error === null ? null : classifySaleCompletionError(completeMutation.error);
  const isDraft = sale.status === "DRAFT";
  const payments = completed?.sale.payments ?? [];

  function handleComplete(submitted: SalePaymentInput[]): void {
    completeMutation.mutate(submitted);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CompletionOutcomeAlert completed={completed} />

      <Card>
        <CardHeader>
          <CardTitle>{`Sale #${shortId(sale.id)}`}</CardTitle>
          <CardDescription>
            {`${SALE_STATUS_LABELS[sale.status]} sale. Status is read from the API and never inferred here.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <DetailRow label="Status" value={SALE_STATUS_LABELS[sale.status]} />
          <DetailRow
            label="Customer"
            value={
              sale.customerId === null
                ? "Walk-in (no customer)"
                : customerNames.nameFor(sale.customerId)
            }
          />
          <DetailRow label="Total" value={formatAmount(sale.total, sale.currency)} />
          <DetailRow label="Reference" value={`#${shortId(sale.id)}`} />
          <DetailRow label="Created" value={formatDate(sale.createdAt)} />
          <DetailRow label="Updated" value={formatDate(sale.updatedAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>
            {`${sale.lines.length} ${sale.lines.length === 1 ? "line" : "lines"}. Amounts are the API's exact decimal strings; no total is derived here.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {sale.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-foreground">
                  {catalogNames.nameFor(line.catalogItemId)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Qty ${line.quantity} · unit ${formatWireAmount(line.unitPrice)} · ${line.rateCode}`}
                </p>
              </div>
              <div className="shrink-0 text-right text-foreground">
                <p>{formatWireAmount(line.lineTotal)}</p>
                <p className="text-xs text-muted-foreground">
                  {`base ${formatWireAmount(line.taxableBase)} · tax ${formatWireAmount(line.taxAmount)}`}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>
            Payments are written only by the completion command; the sale read does not include
            them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {payments.length === 0 ? (
            <p data-testid="no-payments" className="text-muted-foreground">
              No payments are recorded for this sale.
            </p>
          ) : (
            <ul className="space-y-2">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="text-foreground">{PAYMENT_METHOD_LABELS[payment.method]}</span>
                  <span className="font-medium text-foreground" data-testid="payment-amount">
                    {formatAmount(payment.amount, sale.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isDraft && completed === null && (
        <Card>
          <CardHeader>
            <CardTitle>Complete this draft</CardTitle>
            <CardDescription>
              {`Enter payments that sum exactly to ${formatAmount(sale.total, sale.currency)}. A refused completion persists nothing and leaves this draft open.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CompletionOutcomeAlert failure={completionFailure} />
            <PaymentCapture
              total={sale.total}
              currency={sale.currency}
              onSubmit={handleComplete}
              isPending={completeMutation.isPending}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
