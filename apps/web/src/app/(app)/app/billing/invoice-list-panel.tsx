"use client";

import type { JSX } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { INVOICE_STATUSES, type Invoice, type InvoiceStatus } from "./billing-api";
import {
  INVOICE_STATUS_LABELS,
  billingInputClassName,
  formatInvoiceAmount,
  formatTimestamp,
  invoiceNumberLabel,
  shortId,
} from "./billing-display";
import { BillingErrorAlert } from "./billing-outcome";

/** The invoice list filter: one lifecycle value, or every status. */
export type InvoiceStatusFilter = InvoiceStatus | "ALL";

interface InvoiceListPanelProps {
  /** The caller tenant's invoices, newest first, as the API returned them. */
  readonly invoices: readonly Invoice[];
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  /** The applied status filter; the API applies it and has no implicit default. */
  readonly statusFilter: InvoiceStatusFilter;
  readonly onStatusFilterChange: (value: InvoiceStatusFilter) => void;
  readonly selectedInvoiceId: string | null;
  readonly onSelectInvoice: (invoice: Invoice) => void;
}

/**
 * The invoice list panel (EPIC-14 BILL-004).
 *
 * Lists the tenant's invoices under an explicit status filter and selects one
 * for inspection. The filter is the API's own `status` query and has NO implicit
 * default, so "All statuses" really asks for all of them. The list is rendered
 * in the order the API returned it (newest first); it is never re-sorted here.
 *
 * A refused read is rendered by outcome — a `403 FORBIDDEN` says the operator
 * lacks the permission and a `404` says the invoice was not found — instead of
 * being shown as an empty list, because "no rows" and "not allowed" are
 * different answers. Selecting an invoice only chooses an id: the surface reads
 * that invoice's snapshot through the API, so a foreign id cannot be shown as
 * data.
 */
export function InvoiceListPanel({
  invoices,
  isLoading,
  loadError,
  statusFilter,
  onStatusFilterChange,
  selectedInvoiceId,
  onSelectInvoice,
}: InvoiceListPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          The tenant&apos;s invoices, newest first. A draft has no allocated number yet; the number
          is written only by confirmation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="billing-status-filter" className="text-sm font-medium">
            Status filter
          </label>
          <select
            id="billing-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as InvoiceStatusFilter)}
            className={billingInputClassName}
          >
            <option value="ALL">All statuses</option>
            {INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {INVOICE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p data-testid="invoices-loading" className="text-sm text-muted-foreground">
            Loading invoices...
          </p>
        ) : loadError !== null ? (
          <BillingErrorAlert error={loadError} testId="invoices-error" />
        ) : invoices.length === 0 ? (
          <p data-testid="invoices-empty" className="text-sm text-muted-foreground">
            No invoices match this filter.
          </p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((invoice) => {
              const selected = invoice.id === selectedInvoiceId;
              return (
                <li
                  key={invoice.id}
                  data-testid="invoice-list-item"
                  data-selected={selected}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {`${INVOICE_STATUS_LABELS[invoice.status]} invoice ${invoiceNumberLabel(invoice.series, invoice.number)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`#${shortId(invoice.id)} · sale #${shortId(invoice.saleId)} · ${formatTimestamp(invoice.createdAt)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-right text-sm text-foreground">
                      {formatInvoiceAmount(invoice.total)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selected}
                      onClick={() => onSelectInvoice(invoice)}
                    >
                      {selected ? "Selected" : "Select invoice"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
