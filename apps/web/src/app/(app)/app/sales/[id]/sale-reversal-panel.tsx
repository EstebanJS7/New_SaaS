"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  CREDIT_NOTE_STATUS_LABELS,
  SALE_REVERSAL_REASON_MAX,
  SALE_REVERSAL_REASON_MIN,
  getSaleReversal,
  reverseSale,
  userFacingReversalError,
  type Sale,
  type SaleReversal,
} from "../sales-api";
import { PAYMENT_METHOD_LABELS, formatAmount, formatDate } from "../sales-display";

/**
 * Reversal of a completed sale ([[SAL-REV-001]]). A COMPLETED sale offers "Anular venta":
 * a confirmation that states what will happen and asks for the reason. A CANCELLED sale
 * that was reversed shows when, why, and what was refunded. A cancelled DRAFT has no
 * reversal and shows nothing here.
 *
 * One idempotency key per attempt, kept across retries of that attempt: if the answer
 * of a reversal is lost, re-sending replays it instead of being refused as "already
 * reversed". A new attempt (after closing the dialog) gets a new key.
 */
export function SaleReversalPanel({ sale }: { readonly sale: Sale }): JSX.Element | null {
  if (sale.status === "COMPLETED") return <ReverseSaleCard sale={sale} />;
  if (sale.status === "CANCELLED") return <ReversalRecord sale={sale} />;
  return null;
}

function newAttemptKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ReverseSaleCard({ sale }: { readonly sale: Sale }): JSX.Element {
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [attemptKey, setAttemptKey] = useState(newAttemptKey);

  const mutation = useMutation({
    mutationFn: () => reverseSale(sale.id, reason.trim(), { idempotencyKey: attemptKey }),
    retry: false,
    onSuccess: (reversal) => {
      queryClient.setQueryData(["sales", "reversal", sale.id], reversal);
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
    },
  });

  const trimmed = reason.trim();
  const reasonValid =
    trimmed.length >= SALE_REVERSAL_REASON_MIN && trimmed.length <= SALE_REVERSAL_REASON_MAX;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anular esta venta</CardTitle>
        <CardDescription>
          Para corregir un cobro: se devuelve todo al stock y se registra la devolución de cada
          pago. Si la venta tiene una factura electrónica aprobada, se emite una nota de crédito por
          el total. Después podés cobrar de nuevo de forma correcta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            mutation.reset();
            setAttemptKey(newAttemptKey());
            setOpen(true);
          }}
        >
          Anular venta
        </Button>
      </CardContent>
      <ConfirmActionDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setReason("");
        }}
        title="¿Anular esta venta?"
        description={`La venta de ${formatAmount(sale.total, sale.currency)} queda anulada: los artículos vuelven al stock, el efectivo sale de la caja abierta y los demás pagos quedan registrados como devueltos. Si tiene factura electrónica aprobada, se emite una nota de crédito electrónica por el total y se envía a SIFEN. No se puede deshacer.`}
        confirmLabel="Anular venta"
        pendingLabel="Anulando…"
        confirmDisabled={!reasonValid}
        pending={mutation.isPending}
        errorMessage={mutation.error ? userFacingReversalError(mutation.error) : undefined}
        // Rejects on failure on purpose: the dialog stays open with the message.
        onConfirm={() => mutation.mutateAsync()}
      >
        <div className="space-y-1 pt-2">
          <label htmlFor={reasonId} className="text-sm font-medium">
            Motivo
          </label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={SALE_REVERSAL_REASON_MAX}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-describedby={`${reasonId}-hint`}
          />
          <p id={`${reasonId}-hint`} className="text-xs text-muted-foreground">
            Obligatorio. Queda registrado junto con quién anuló y cuándo.
          </p>
        </div>
      </ConfirmActionDialog>
    </Card>
  );
}

function ReversalRecord({ sale }: { readonly sale: Sale }): JSX.Element | null {
  const query = useQuery({
    queryKey: ["sales", "reversal", sale.id],
    queryFn: () => getSaleReversal(sale.id),
    retry: false,
  });

  if (query.isLoading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando la anulación…
      </p>
    );
  }
  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        No se pudo leer el detalle de la anulación.
      </p>
    );
  }
  const reversal: SaleReversal | null | undefined = query.data;
  if (!reversal) return null;

  return (
    <Card data-testid="sale-reversal-record">
      <CardHeader>
        <CardTitle>Venta anulada</CardTitle>
        <CardDescription>{`Anulada el ${formatDate(reversal.reversedAt)}.`}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-muted-foreground">Motivo</p>
          <p className="whitespace-pre-wrap text-foreground">{reversal.reason}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Devoluciones registradas</p>
          <ul className="mt-1 space-y-1">
            {reversal.refunds.map((refund) => (
              <li key={refund.paymentId} className="flex justify-between gap-4">
                <span>
                  {PAYMENT_METHOD_LABELS[refund.method]}
                  {refund.method === "CASH" ? " (salió de la caja abierta)" : ""}
                </span>
                <span className="font-medium">{formatAmount(refund.amount, sale.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
        {reversal.creditNote ? (
          <div data-testid="sale-credit-note">
            <p className="text-muted-foreground">Nota de crédito electrónica</p>
            <p className="text-foreground">{`N° ${reversal.creditNote.number}`}</p>
            <p className="text-xs text-muted-foreground">
              {reversal.creditNote.fiscalStatus
                ? (CREDIT_NOTE_STATUS_LABELS[reversal.creditNote.fiscalStatus] ??
                  reversal.creditNote.fiscalStatus)
                : "Sin documento electrónico"}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
