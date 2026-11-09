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
        <CardTitle>Documentos fiscales</CardTitle>
        <CardDescription>
          Los documentos fiscales de la organización, del más reciente al más antiguo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="fiscal-status-filter" className="text-sm font-medium">
            Filtrar por estado
          </label>
          <select
            id="fiscal-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as FiscalStatusFilter)}
            className={fiscalInputClassName}
          >
            <option value="ALL">Todos los estados</option>
            {FISCAL_DOCUMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {FISCAL_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        {isLoading ? (
          <p data-testid="fiscal-list-loading" className="text-sm text-muted-foreground">
            Cargando documentos fiscales…
          </p>
        ) : loadError !== null ? (
          <FiscalErrorAlert error={loadError} testId="fiscal-list-error" />
        ) : documents.length === 0 ? (
          <p data-testid="fiscal-list-empty" className="text-sm text-muted-foreground">
            Ningún documento fiscal coincide con este filtro.
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
                    <p className="truncate text-sm font-medium text-foreground">{`Documento fiscal #${shortId(document.id)} · ${FISCAL_STATUS_LABELS[document.status as FiscalDocumentStatus]}`}</p>
                    <p className="text-xs text-muted-foreground">{`${document.creditNoteId ? `Nota de crédito #${shortId(document.creditNoteId)} · de la factura` : "Factura"} #${shortId(document.invoiceId)} · ${document.attemptCount === 1 ? "1 intento" : `${document.attemptCount} intentos`} · ${formatTimestamp(document.createdAt)}`}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    onClick={() => onSelectDocument(document)}
                  >
                    {selected ? "Seleccionado" : "Seleccionar documento"}
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
