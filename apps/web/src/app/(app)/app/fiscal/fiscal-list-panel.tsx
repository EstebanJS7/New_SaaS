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
import {
  FISCAL_DOCUMENT_STATUSES,
  type FiscalDocument,
  type FiscalDocumentStatus,
} from "./fiscal-api";
import {
  FISCAL_STATUS_LABELS,
  fiscalInputClassName,
  formatTimestamp,
  shortId,
} from "./fiscal-display";
import { FiscalErrorAlert } from "./fiscal-outcome";

export type FiscalStatusFilter = FiscalDocumentStatus | "ALL";
interface FiscalListPanelProps {
  readonly documents: readonly FiscalDocument[];
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  readonly statusFilter: FiscalStatusFilter;
  readonly onStatusFilterChange: (value: FiscalStatusFilter) => void;
  readonly selectedDocumentId: string | null;
  readonly onSelectDocument: (document: FiscalDocument) => void;
}
export function FiscalListPanel({
  documents,
  isLoading,
  loadError,
  statusFilter,
  onStatusFilterChange,
  selectedDocumentId,
  onSelectDocument,
}: FiscalListPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiscal documents</CardTitle>
        <CardDescription>The tenant&apos;s fiscal documents, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="fiscal-status-filter" className="text-sm font-medium">
            Status filter
          </label>
          <select
            id="fiscal-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as FiscalStatusFilter)}
            className={fiscalInputClassName}
          >
            <option value="ALL">All statuses</option>
            {FISCAL_DOCUMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {FISCAL_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        {isLoading ? (
          <p data-testid="fiscal-list-loading" className="text-sm text-muted-foreground">
            Loading fiscal documents...
          </p>
        ) : loadError !== null ? (
          <FiscalErrorAlert error={loadError} testId="fiscal-list-error" />
        ) : documents.length === 0 ? (
          <p data-testid="fiscal-list-empty" className="text-sm text-muted-foreground">
            No fiscal documents match this filter.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((document) => {
              const selected = document.id === selectedDocumentId;
              return (
                <li
                  key={document.id}
                  data-testid="fiscal-list-item"
                  data-selected={selected}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{`${FISCAL_STATUS_LABELS[document.status as FiscalDocumentStatus]} fiscal document #${shortId(document.id)}`}</p>
                    <p className="text-xs text-muted-foreground">{`Invoice #${shortId(document.invoiceId)} · ${document.attemptCount} attempts · ${formatTimestamp(document.createdAt)}`}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    onClick={() => onSelectDocument(document)}
                  >
                    {selected ? "Selected" : "Select document"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
