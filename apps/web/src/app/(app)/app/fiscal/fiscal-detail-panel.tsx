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
import type { FiscalDocument } from "./fiscal-api";
import { FISCAL_STATUS_LABELS, fiscalTextareaClassName, formatTimestamp } from "./fiscal-display";
import { FiscalErrorAlert } from "./fiscal-outcome";
import { fiscalCancelReasonError } from "./fiscal-validation";

export type FiscalCommandOutcome =
  | { readonly kind: "issued"; readonly document: FiscalDocument }
  | { readonly kind: "cancelled"; readonly document: FiscalDocument };
interface FiscalDetailPanelProps {
  readonly document: FiscalDocument | null;
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  readonly onCancel: (reason: string) => Promise<void>;
  readonly isCancelling: boolean;
  readonly cancelError: Error | null;
  readonly outcome: FiscalCommandOutcome | null;
}
function CommandOutcome({ outcome }: { readonly outcome: FiscalCommandOutcome }): JSX.Element {
  return (
    <div
      role="status"
      data-testid={`fiscal-${outcome.kind}`}
      className="rounded-lg border border-border bg-muted p-4 text-sm"
    >
      <p className="font-medium text-foreground">Fiscal document {outcome.kind}</p>
      <p className="text-muted-foreground">
        The API returned this fiscal document as{" "}
        {FISCAL_STATUS_LABELS[outcome.document.status as keyof typeof FISCAL_STATUS_LABELS]}.
      </p>
    </div>
  );
}
function valueOrPlaceholder(value: string | null): string {
  return value ?? "Not provided";
}
export function FiscalDetailPanel({
  document,
  isLoading,
  loadError,
  onCancel,
  isCancelling,
  cancelError,
  outcome,
}: FiscalDetailPanelProps): JSX.Element {
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  async function submitCancel(): Promise<void> {
    const error = fiscalCancelReasonError(reason);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    try {
      await onCancel(reason.trim());
      setReason("");
    } catch {
      /* Render the API refusal below and retain the entered reason. */
    }
  }
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitCancel();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiscal document detail</CardTitle>
        <CardDescription>
          The allowlisted representation returned by the Fiscal API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p data-testid="fiscal-detail-loading" className="text-sm text-muted-foreground">
            Loading fiscal document...
          </p>
        ) : loadError !== null ? (
          <FiscalErrorAlert error={loadError} testId="fiscal-detail-error" />
        ) : document === null ? (
          <p data-testid="fiscal-no-selection" className="text-sm text-muted-foreground">
            Select a fiscal document above to inspect its details.
          </p>
        ) : (
          <>
            {outcome !== null && <CommandOutcome outcome={outcome} />}
            <dl className="space-y-2 text-sm">
              {(
                [
                  [
                    "status",
                    "Status",
                    FISCAL_STATUS_LABELS[document.status as keyof typeof FISCAL_STATUS_LABELS],
                  ],
                  ["provider", "Provider", document.provider],
                  ["attempt-count", "Attempt count", String(document.attemptCount)],
                  ["external-id", "External id", valueOrPlaceholder(document.externalId)],
                  ["cdc", "CDC", valueOrPlaceholder(document.cdc)],
                  [
                    "last-error-code",
                    "Last error code",
                    valueOrPlaceholder(document.lastErrorCode),
                  ],
                  ["created-at", "Created at", formatTimestamp(document.createdAt)],
                  ["updated-at", "Updated at", formatTimestamp(document.updatedAt)],
                  ...(document.cancelledAt === null
                    ? []
                    : [
                        [
                          "cancelled-at",
                          "Cancelled at",
                          formatTimestamp(document.cancelledAt),
                        ] as const,
                      ]),
                ] as const
              ).map(([id, label, value]) => (
                <div
                  key={id}
                  className="flex items-center justify-between gap-4 border-b border-border pb-2"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd
                    data-testid={`fiscal-${id}`}
                    className="text-right font-medium text-foreground"
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {document.status !== "SENDING" && document.status !== "CANCELLED" && (
              <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <label htmlFor="fiscal-cancel-reason" className="text-sm font-medium">
                    Cancellation reason
                  </label>
                  <textarea
                    id="fiscal-cancel-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={isCancelling}
                    placeholder="Why the fiscal document is being cancelled"
                    className={fiscalTextareaClassName}
                  />
                </div>
                {localError !== null && (
                  <p
                    role="alert"
                    data-testid="fiscal-cancel-validation-error"
                    className="text-sm text-destructive"
                  >
                    {localError}
                  </p>
                )}
                {cancelError !== null && (
                  <FiscalErrorAlert error={cancelError} testId="fiscal-cancel-error" />
                )}
                <Button type="submit" variant="outline" disabled={isCancelling}>
                  {isCancelling ? "Cancelling fiscal document..." : "Cancel fiscal document"}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
