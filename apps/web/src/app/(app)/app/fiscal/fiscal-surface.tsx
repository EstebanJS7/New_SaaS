"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelFiscalDocument,
  getFiscalDocument,
  isFiscalNotEntitled,
  issueFiscalDocument,
  listFiscalDocuments,
  type CreateFiscalDocumentInput,
  type FiscalDocument,
} from "./fiscal-api";
import { FiscalDetailPanel, type FiscalCommandOutcome } from "./fiscal-detail-panel";
import { FiscalListPanel, type FiscalStatusFilter } from "./fiscal-list-panel";
import { IssueFiscalDocumentPanel } from "./issue-fiscal-document-panel";

/** Staff workspace: reads and explicit commands are owned here; panels are presentational. */
export function FiscalSurface(): JSX.Element {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<FiscalStatusFilter>("ALL");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FiscalCommandOutcome | null>(null);

  const documentsQuery = useQuery({
    queryKey: ["fiscal", "documents", statusFilter],
    queryFn: () => listFiscalDocuments(statusFilter === "ALL" ? {} : { status: statusFilter }),
    retry: false,
  });
  const detailQuery = useQuery({
    queryKey: ["fiscal", "document", selectedDocumentId ?? "none"],
    queryFn: () =>
      selectedDocumentId === null
        ? Promise.resolve<FiscalDocument | null>(null)
        : getFiscalDocument(selectedDocumentId),
    retry: false,
    enabled: selectedDocumentId !== null,
  });

  function cacheDocument(document: FiscalDocument): void {
    queryClient.setQueryData<FiscalDocument>(["fiscal", "document", document.id], document);
    queryClient.setQueryData<FiscalDocument[]>(["fiscal", "documents", statusFilter], (current) =>
      current?.map((item) => (item.id === document.id ? document : item))
    );
    void queryClient.invalidateQueries({ queryKey: ["fiscal", "documents"] });
    void queryClient.invalidateQueries({ queryKey: ["fiscal", "document", document.id] });
  }
  const issueMutation = useMutation({
    mutationFn: issueFiscalDocument,
    retry: false,
    onSuccess: (document) => {
      setOutcome({ kind: "issued", document });
      selectDocument(document.id);
      cacheDocument(document);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      cancelFiscalDocument(input.id, { reason: input.reason }),
    retry: false,
    onSuccess: (document) => {
      setOutcome({ kind: "cancelled", document });
      cacheDocument(document);
    },
  });
  const cancelDocumentId = cancelMutation.variables?.id ?? null;
  const selectedOutcome = outcome?.document.id === selectedDocumentId ? outcome : null;

  function selectDocument(id: string | null): void {
    setSelectedDocumentId(id);
    if (!issueMutation.isPending) issueMutation.reset();
    if (!cancelMutation.isPending) cancelMutation.reset();
  }

  const readError = documentsQuery.error ?? detailQuery.error;
  if (readError !== null && isFiscalNotEntitled(readError)) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Fiscal</h1>
        </header>
        <div
          role="alert"
          data-testid="fiscal-entitlement-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Fiscal features are not enabled for this tenant</p>
          <p>The tenant does not have the fiscal capability, so the workspace is not available.</p>
        </div>
      </div>
    );
  }
  const permissionDenied =
    readError !== null && "code" in readError && readError.code === "FORBIDDEN";

  return (
    <div data-testid="fiscal-workspace" className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Fiscal</h1>
        <p className="text-sm text-muted-foreground">
          Fiscal documents, provider outcomes and cancellation.
        </p>
      </header>
      {documentsQuery.isLoading && (
        <p data-testid="fiscal-loading" className="text-sm text-muted-foreground">
          Loading fiscal documents...
        </p>
      )}
      {documentsQuery.data?.length === 0 && !documentsQuery.isLoading && readError === null && (
        <p data-testid="fiscal-empty" className="text-sm text-muted-foreground">
          No fiscal documents match this filter.
        </p>
      )}
      {readError !== null && (
        <div data-testid={permissionDenied ? "fiscal-permission-denied" : "fiscal-error"}>
          <FiscalListPanel
            documents={[]}
            isLoading={false}
            loadError={readError}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={(document) => selectDocument(document.id)}
          />
        </div>
      )}
      {readError === null && (
        <>
          <FiscalListPanel
            documents={documentsQuery.data ?? []}
            isLoading={false}
            loadError={null}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={(document) => selectDocument(document.id)}
          />
          <FiscalDetailPanel
            key={selectedDocumentId ?? "no-document"}
            document={detailQuery.data ?? null}
            isLoading={detailQuery.isLoading}
            loadError={detailQuery.error}
            onCancel={async (reason) => {
              if (selectedDocumentId !== null)
                await cancelMutation.mutateAsync({ id: selectedDocumentId, reason });
            }}
            isCancelling={cancelDocumentId === selectedDocumentId && cancelMutation.isPending}
            cancelError={cancelDocumentId === selectedDocumentId ? cancelMutation.error : null}
            outcome={selectedOutcome}
          />
          <IssueFiscalDocumentPanel
            onIssue={async (input: CreateFiscalDocumentInput) => {
              await issueMutation.mutateAsync(input);
            }}
            isIssuing={issueMutation.isPending}
            issueError={issueMutation.error}
            issued={issueMutation.data ?? null}
          />
        </>
      )}
    </div>
  );
}
