/** Allowlisted public issue-command representation; provider snapshots are CONFIDENTIAL and deliberately never returned. */
export interface FiscalDocumentResponse {
  readonly id: string;
  readonly invoiceId: string;
  readonly provider: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly externalId: string | null;
  readonly cdc: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
}
