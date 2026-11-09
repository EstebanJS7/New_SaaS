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
import type { CreateInvoiceInput, Invoice } from "./billing-api";
import {
  INVOICE_STATUS_LABELS,
  billingInputClassName,
  formatInvoiceAmount,
  invoiceNumberLabel,
  shortId,
} from "./billing-display";
import { BillingErrorAlert } from "./billing-outcome";
import { invoiceSaleIdError } from "./billing-validation";

interface CreateInvoicePanelProps {
  readonly onCreate: (input: CreateInvoiceInput) => Promise<void>;
  readonly isCreating: boolean;
  readonly createError: Error | null;
  /** The draft the API just created, present only after a confirmed create. */
  readonly created: Invoice | null;
}

/**
 * The create-invoice panel (EPIC-14 BILL-004).
 *
 * Creates one `DRAFT` invoice from one completed sale. The sale id is the whole
 * payload: the currency, the customer, the snapshot lines, the totals, the
 * series and the number are all derived server-side from that sale, so this
 * panel sends nothing else and the proxy would refuse it if it tried
 * (DEC-038/DEC-039). The id is checked against the API's own UUID shape before
 * the request leaves the browser, and the API stays the only validator.
 *
 * The epic does not define a sale picker — there is no invoice link in the
 * shipped POS surface — so the entry point is the completed sale's id, which the
 * operator already has from the POS. The stable `409` outcomes (the sale is not
 * completed, the tenant requires a customer, or the sale already holds an
 * invoice) are rendered as their own outcomes rather than as retryable failures
 * of the same intent.
 */
export function CreateInvoicePanel({
  onCreate,
  isCreating,
  createError,
  created,
}: CreateInvoicePanelProps): JSX.Element {
  const [saleId, setSaleId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submitCreate(): Promise<void> {
    const error = invoiceSaleIdError(saleId);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    try {
      await onCreate({ saleId: saleId.trim() });
      setSaleId("");
    } catch {
      // The refusal is rendered from `createError`; the entered id is kept so the
      // operator can correct it instead of retyping it.
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitCreate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crear factura</CardTitle>
        <CardDescription>
          El borrador se crea a partir de una venta completada. El servidor copia o asigna sus
          líneas, totales, moneda, serie y número; nada de eso se carga acá.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {created !== null && (
          <div
            role="status"
            data-testid="invoice-created"
            className="rounded-lg border border-border bg-muted p-4 text-sm"
          >
            <p className="font-medium text-foreground">Borrador de factura creado</p>
            <p className="text-muted-foreground">
              {`Se creó la factura #${shortId(created.id)} en estado ${INVOICE_STATUS_LABELS[created.status].toLowerCase()} para esta venta, por un total de ${formatInvoiceAmount(created.total, created.currency)}. Número: ${invoiceNumberLabel(created.series, created.number).toLowerCase()}; se asigna al confirmarla.`}
            </p>
          </div>
        )}

        {createError !== null && (
          <BillingErrorAlert error={createError} testId="invoice-create-error" />
        )}

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="billing-sale-id" className="text-sm font-medium">
              Identificador de la venta completada
            </label>
            <input
              id="billing-sale-id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={saleId}
              onChange={(event) => setSaleId(event.target.value)}
              disabled={isCreating}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={billingInputClassName}
            />
            <p className="text-xs text-muted-foreground">
              El UUID de una venta completada de esta organización. Se rechaza una venta que no esté
              completada, una que según la política de la organización necesita cliente y una que ya
              tiene factura.
            </p>
          </div>

          {localError !== null && (
            <p
              role="alert"
              data-testid="invoice-sale-id-error"
              className="text-sm text-destructive"
            >
              {localError}
            </p>
          )}

          <Button type="submit" disabled={isCreating}>
            {isCreating ? "Creando factura…" : "Crear factura"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
