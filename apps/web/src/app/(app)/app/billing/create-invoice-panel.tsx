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
        <CardTitle>Create invoice</CardTitle>
        <CardDescription>
          A draft is created from one completed sale. Its lines, totals, currency, series and number
          are copied or allocated by the API, never typed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {created !== null && (
          <div
            role="status"
            data-testid="invoice-created"
            className="rounded-lg border border-border bg-muted p-4 text-sm"
          >
            <p className="font-medium text-foreground">Draft invoice created</p>
            <p className="text-muted-foreground">
              {`The API created a ${INVOICE_STATUS_LABELS[created.status].toLowerCase()} invoice #${shortId(created.id)} for this sale, totalling ${formatInvoiceAmount(created.total)}. It has ${invoiceNumberLabel(created.series, created.number).toLowerCase()} until it is confirmed.`}
            </p>
          </div>
        )}

        {createError !== null && (
          <BillingErrorAlert error={createError} testId="invoice-create-error" />
        )}

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="billing-sale-id" className="text-sm font-medium">
              Completed sale id
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
              The UUID of a completed sale of this tenant. The API refuses a sale that is not
              completed, one the tenant&apos;s policy requires a customer for, and one that already
              holds an invoice.
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
            {isCreating ? "Creating invoice..." : "Create invoice"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
