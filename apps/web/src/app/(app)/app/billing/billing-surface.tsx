"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelInvoice,
  confirmInvoice,
  createInvoice,
  getInvoice,
  isBillingNotEntitled,
  listInvoices,
  type CreateInvoiceInput,
  type Invoice,
} from "./billing-api";
import { CreateInvoicePanel } from "./create-invoice-panel";
import { InvoiceDetailPanel, type InvoiceCommandOutcome } from "./invoice-detail-panel";
import { InvoiceListPanel, type InvoiceStatusFilter } from "./invoice-list-panel";

/**
 * The staff Billing workspace (EPIC-14 BILL-004, DEC-045).
 *
 * Composition: one surface owns the reads and the three explicit commands, and
 * the panels below it are presentational. Every call goes through the Billing
 * client in this directory, which talks to the authenticated web proxy — the
 * browser never sends a tenant id, and no check here is an authorization
 * authority. The surface reflects the API's outcomes; it never invents one.
 *
 * The surface's shape follows the API's own surface: the status-filtered list,
 * the selected invoice's immutable snapshot, the create-from-a-completed-sale
 * command and the two lifecycle commands. There is no edit, no reopen, no
 * delete, no print and no export anywhere (DEC-038/DEC-043/DEC-044/DEC-045), no
 * money arithmetic — every amount is the server-computed string rendered as
 * returned (DEC-038) — and no fiscal state, because the invoice carries none
 * (DEC-042).
 *
 * The selected invoice is read again by id through {@link getInvoice} instead of
 * being copied out of the list, so a foreign or unknown id is the shared `404`
 * and renders as an error state rather than as data.
 *
 * The only UX gate is the `billing` capability: a `403 FEATURE_NOT_ENTITLED`
 * from any read hides the workspace instead of offering actions that can only
 * fail. A `403 FORBIDDEN` is rendered in place of the data it refused — it is not
 * a capability problem and the backend remains the authority either way.
 */
export function BillingSurface(): JSX.Element {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("ALL");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvoiceCommandOutcome | null>(null);

  const invoicesQuery = useQuery({
    queryKey: ["billing", "invoices", statusFilter],
    queryFn: () => listInvoices(statusFilter === "ALL" ? {} : { status: statusFilter }),
    retry: false,
  });

  const detailQuery = useQuery({
    queryKey: ["billing", "invoice", selectedInvoiceId ?? "none"],
    queryFn: () =>
      selectedInvoiceId === null
        ? Promise.resolve<Invoice | null>(null)
        : getInvoice(selectedInvoiceId),
    retry: false,
    enabled: selectedInvoiceId !== null,
  });

  /**
   * Writes the representation the API returned into both caches: the detail the
   * panel shows and the matching row of the current list. The list is then
   * invalidated so the server stays the authority for every other row.
   */
  function cacheInvoice(invoice: Invoice): void {
    queryClient.setQueryData<Invoice>(["billing", "invoice", invoice.id], invoice);
    queryClient.setQueryData<Invoice[]>(["billing", "invoices", statusFilter], (current) =>
      current === undefined
        ? current
        : current.map((item) => (item.id === invoice.id ? invoice : item))
    );
    void queryClient.invalidateQueries({ queryKey: ["billing", "invoices"] });
  }

  const createMutation = useMutation({
    mutationFn: createInvoice,
    retry: false,
    onSuccess: (invoice) => {
      // The draft the API just created is the one the operator now inspects.
      setOutcome(null);
      selectInvoice(invoice.id);
      cacheInvoice(invoice);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmInvoice,
    retry: false,
    onSuccess: (invoice) => {
      // Show what the API returned: the confirmed representation carries the
      // allocated number and the confirmation timestamp.
      setOutcome({ kind: "confirmed", invoice });
      cacheInvoice(invoice);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      cancelInvoice(input.id, { reason: input.reason }),
    retry: false,
    onSuccess: (invoice) => {
      setOutcome({ kind: "cancelled", invoice });
      cacheInvoice(invoice);
    },
  });

  /**
   * The invoice each command's state belongs to. `variables` is the input of the
   * most recent call, so it names the invoice its pending state, its error and
   * its returned representation were produced for; comparing it with the current
   * selection keeps one invoice's command from rendering on another. A late
   * result for the invoice the operator left stays bound to that invoice instead
   * of following the selection.
   */
  const confirmInvoiceId = confirmMutation.variables ?? null;
  const cancelInvoiceId = cancelMutation.variables?.id ?? null;
  const selectedOutcome =
    outcome !== null && outcome.invoice.id === selectedInvoiceId ? outcome : null;

  /**
   * Moves the selection to one invoice. A command that already settled drops its
   * state here, so a refusal cannot follow the operator to another invoice or
   * resurface on its own; a command still in flight keeps its state, so its own
   * invoice still shows the pending label and keeps its action disabled.
   */
  function selectInvoice(id: string | null): void {
    setSelectedInvoiceId(id);
    if (!confirmMutation.isPending) {
      confirmMutation.reset();
    }
    if (!cancelMutation.isPending) {
      cancelMutation.reset();
    }
  }

  const readError = invoicesQuery.error ?? detailQuery.error;

  if (readError !== null && isBillingNotEntitled(readError)) {
    // UX gate only: the backend answers the same `403 FEATURE_NOT_ENTITLED` for
    // every billing call, so the workspace hides itself instead of offering
    // actions that can only fail.
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Invoices, their snapshot lines and their lifecycle commands.
          </p>
        </div>
        <div
          role="alert"
          data-testid="billing-entitlement-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Billing features are not enabled for this tenant</p>
          <p>
            The tenant does not have the billing capability, so the workspace is not available. The
            API enforces this gate; this message is only what the browser shows.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Invoices over completed sales. Every amount is the server-computed value shown as
          returned; the API is the authority for every action and the browser only reflects its
          outcomes.
        </p>
      </div>

      <InvoiceListPanel
        invoices={invoicesQuery.data ?? []}
        isLoading={invoicesQuery.isLoading}
        loadError={invoicesQuery.error}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        selectedInvoiceId={selectedInvoiceId}
        onSelectInvoice={(invoice) => selectInvoice(invoice.id)}
      />

      <InvoiceDetailPanel
        // Remount per invoice: the cancel draft, the validation and mutation
        // errors and the last command outcome all belong to ONE invoice, so
        // switching the selection must not carry them over.
        key={selectedInvoiceId ?? "no-invoice"}
        invoice={detailQuery.data ?? null}
        isLoading={detailQuery.isLoading}
        loadError={detailQuery.error}
        onConfirm={async () => {
          if (selectedInvoiceId === null) {
            return;
          }
          await confirmMutation.mutateAsync(selectedInvoiceId);
        }}
        isConfirming={confirmInvoiceId === selectedInvoiceId && confirmMutation.isPending}
        confirmError={confirmInvoiceId === selectedInvoiceId ? confirmMutation.error : null}
        onCancel={async (reason) => {
          if (selectedInvoiceId === null) {
            return;
          }
          await cancelMutation.mutateAsync({ id: selectedInvoiceId, reason });
        }}
        isCancelling={cancelInvoiceId === selectedInvoiceId && cancelMutation.isPending}
        cancelError={cancelInvoiceId === selectedInvoiceId ? cancelMutation.error : null}
        outcome={selectedOutcome}
      />

      <CreateInvoicePanel
        onCreate={async (input: CreateInvoiceInput) => {
          await createMutation.mutateAsync(input);
        }}
        isCreating={createMutation.isPending}
        createError={createMutation.error}
        created={createMutation.data ?? null}
      />
    </div>
  );
}
