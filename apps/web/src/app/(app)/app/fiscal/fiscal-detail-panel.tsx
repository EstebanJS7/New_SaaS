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
  /** [[UX-037]]: false when the caller is known to lack `fiscal.invoice.issue`. */
  readonly canCancel?: boolean;
}
function CommandOutcome({ outcome }: { readonly outcome: FiscalCommandOutcome }): JSX.Element {
  return (
    <div
      role="status"
      data-testid={`fiscal-${outcome.kind}`}
      className="rounded-lg border border-border bg-muted p-4 text-sm"
    >
      <p className="font-medium text-foreground">
        {outcome.kind === "issued" ? "Documento fiscal emitido" : "Documento fiscal cancelado"}
      </p>
      <p className="text-muted-foreground">
        {`El documento fiscal quedó en estado «${FISCAL_STATUS_LABELS[outcome.document.status as keyof typeof FISCAL_STATUS_LABELS]}».`}
      </p>
    </div>
  );
}
function valueOrPlaceholder(value: string | null): string {
  return value ?? "No informado";
}
export function FiscalDetailPanel({
  document,
  isLoading,
  loadError,
  onCancel,
  isCancelling,
  cancelError,
  outcome,
  canCancel = true,
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
        <CardTitle>Detalle del documento fiscal</CardTitle>
        <CardDescription>
          Los datos del documento fiscal tal como los devuelve el servidor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p data-testid="fiscal-detail-loading" className="text-sm text-muted-foreground">
            Cargando documento fiscal…
          </p>
        ) : loadError !== null ? (
          <FiscalErrorAlert error={loadError} testId="fiscal-detail-error" />
        ) : document === null ? (
          <p data-testid="fiscal-no-selection" className="text-sm text-muted-foreground">
            Seleccioná un documento fiscal de la lista para ver su detalle.
          </p>
        ) : (
          <>
            {outcome !== null && <CommandOutcome outcome={outcome} />}
            <dl className="space-y-2 text-sm">
              {(
                [
                  [
                    "status",
                    "Estado",
                    FISCAL_STATUS_LABELS[document.status as keyof typeof FISCAL_STATUS_LABELS],
                  ],
                  ["provider", "Proveedor", document.provider],
                  ["attempt-count", "Intentos", String(document.attemptCount)],
                  ["external-id", "Identificador externo", valueOrPlaceholder(document.externalId)],
                  ["cdc", "CDC", valueOrPlaceholder(document.cdc)],
                  [
                    "last-error-code",
                    "Último código de error",
                    valueOrPlaceholder(document.lastErrorCode),
                  ],
                  ["created-at", "Creado el", formatTimestamp(document.createdAt)],
                  ["updated-at", "Actualizado el", formatTimestamp(document.updatedAt)],
                  ...(document.cancelledAt === null
                    ? []
                    : [
                        [
                          "cancelled-at",
                          "Cancelado el",
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
            {canCancel && document.status !== "SENDING" && document.status !== "CANCELLED" && (
              <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <label htmlFor="fiscal-cancel-reason" className="text-sm font-medium">
                    Motivo de la cancelación
                  </label>
                  <textarea
                    id="fiscal-cancel-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={isCancelling}
                    placeholder="Por qué se cancela el documento fiscal"
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
                  {isCancelling ? "Cancelando documento fiscal…" : "Cancelar documento fiscal"}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
