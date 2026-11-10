/** Allowlisted public issue-command representation; provider snapshots are CONFIDENTIAL and deliberately never returned. */
export interface FiscalDocumentResponse {
  readonly id: string;
  readonly invoiceId: string;
  /** NCE-001: set when the document is a credit note crediting `invoiceId`. */
  readonly creditNoteId: string | null;
  readonly provider: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly externalId: string | null;
  readonly cdc: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
  /** FISC-021: a KuDE is stored for this document; the storage key itself is never returned. */
  readonly hasKude: boolean;
}
