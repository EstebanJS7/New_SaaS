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
        <CardTitle>Issue fiscal document</CardTitle>
        <CardDescription>
          Issue a fiscal document for a confirmed invoice using its id.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issued !== null && (
          <div
            role="status"
            data-testid="fiscal-issued"
            className="rounded-lg border border-border bg-muted p-4 text-sm"
          >
            <p className="font-medium text-foreground">Fiscal document issued</p>
            <p className="text-muted-foreground">{`The API returned ${FISCAL_STATUS_LABELS[issued.status as keyof typeof FISCAL_STATUS_LABELS].toLowerCase()} fiscal document #${shortId(issued.id)}.`}</p>
          </div>
        )}
        {issueError !== null && <FiscalErrorAlert error={issueError} testId="fiscal-issue-error" />}
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <label htmlFor="fiscal-invoice-id" className="text-sm font-medium">
              Invoice id
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
              The UUID of a confirmed invoice belonging to this tenant.
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
            {isIssuing ? "Issuing fiscal document..." : "Issue fiscal document"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
