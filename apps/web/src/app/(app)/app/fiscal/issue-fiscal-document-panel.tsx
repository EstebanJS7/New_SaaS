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
import type { CreateFiscalDocumentInput, FiscalDocument } from "./fiscal-api";
import { FISCAL_STATUS_LABELS, fiscalInputClassName, shortId } from "./fiscal-display";
import { FiscalErrorAlert } from "./fiscal-outcome";
import { fiscalInvoiceIdError } from "./fiscal-validation";

interface IssueFiscalDocumentPanelProps {
  readonly onIssue: (input: CreateFiscalDocumentInput) => Promise<void>;
  readonly isIssuing: boolean;
  readonly issueError: Error | null;
  readonly issued: FiscalDocument | null;
}
export function IssueFiscalDocumentPanel({
  onIssue,
  isIssuing,
  issueError,
  issued,
}: IssueFiscalDocumentPanelProps): JSX.Element {
  const [invoiceId, setInvoiceId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  async function submitIssue(): Promise<void> {
    const error = fiscalInvoiceIdError(invoiceId);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    try {
      await onIssue({ invoiceId: invoiceId.trim() });
      setInvoiceId("");
    } catch {
      /* Render the API refusal below and retain the entered id. */
    }
  }
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitIssue();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Emitir documento fiscal</CardTitle>
        <CardDescription>
          Emití el documento fiscal de una factura confirmada a partir de su identificador.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issued !== null && (
          <div
            role="status"
            data-testid="fiscal-issued"
            className="rounded-lg border border-border bg-muted p-4 text-sm"
          >
            <p className="font-medium text-foreground">Documento fiscal emitido</p>
            <p className="text-muted-foreground">{`Se emitió el documento fiscal #${shortId(issued.id)} con estado «${FISCAL_STATUS_LABELS[issued.status as keyof typeof FISCAL_STATUS_LABELS]}».`}</p>
          </div>
        )}
        {issueError !== null && <FiscalErrorAlert error={issueError} testId="fiscal-issue-error" />}
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="fiscal-invoice-id" className="text-sm font-medium">
              Identificador de la factura
            </label>
            <input
              id="fiscal-invoice-id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
              disabled={isIssuing}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={fiscalInputClassName}
            />
            <p className="text-xs text-muted-foreground">
              El UUID de una factura confirmada de esta organización.
            </p>
          </div>
          {localError !== null && (
            <p
              role="alert"
              data-testid="fiscal-invoice-id-error"
              className="text-sm text-destructive"
            >
              {localError}
            </p>
          )}
          <Button type="submit" disabled={isIssuing}>
            {isIssuing ? "Emitiendo documento fiscal…" : "Emitir documento fiscal"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
