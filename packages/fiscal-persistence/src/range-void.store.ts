import type { Prisma } from "@newsaas/database";
import type { FiscalRangeVoidOutcome } from "@newsaas/fiscal";

/**
 * FISC-016 WU-D — the Prisma side of the range void's record.
 *
 * The aggregate is `fiscal_range_void`: one row per attempt to void a numbering
 * range's remaining numbers, written once and never edited. The migration's
 * triggers refuse every UPDATE and every DELETE, so this module has nothing to
 * update and nothing to delete — it inserts and it reads.
 *
 * **Why the tenant is an argument and never ambient.** `packages/fiscal` depends
 * on neither Prisma nor `@newsaas/database`, and this package has no request
 * context either: the API resolves the tenant from its authenticated request and
 * the caller passes it in the key, exactly as the range store does. Every
 * statement puts that key in its `where` clause, so **a foreign range id answers
 * nothing** rather than another tenant's row.
 *
 * **Why the client is structural, in Prisma's own argument types.** The reason
 * the range store records: a hand-written delegate interface does not fit
 * Prisma's generic `create`, while a delegate declared against Prisma's argument
 * types fits by construction, and a test can still pass a fake that records the
 * statements.
 *
 * **What is not here.** No mapping to a protocol field, no decision about the
 * voided interval and no status flip: all three are the caller's, and this module
 * stores what the caller decided (ADR-009's split, applied to the record).
 */

/** The range's own status vocabulary, as `fiscal_timbrado_range_status` declares it. */
export type FiscalTimbradoRangeStatus = "ACTIVE" | "EXHAUSTED" | "RETIRED";

/** One `fiscal_range_void` row, in the columns this module reads and writes. */
export interface FiscalRangeVoidRow {
  readonly id: string;
  readonly tenantId: string;
  readonly rangeId: string;
  readonly fromNumber: number;
  readonly toNumber: number;
  readonly reason: string;
  readonly outcome: FiscalRangeVoidOutcome;
  readonly reasonCode: string | null;
  readonly providerReason: string | null;
  readonly providerReference: string | null;
  /**
   * The range's status as the attempt left it: `RETIRED` when the operation
   * performed the flip, unchanged when the provider refused.
   */
  readonly rangeStatus: FiscalTimbradoRangeStatus;
  readonly createdAt: Date;
}

/** The delegate surface, in Prisma's own terms. */
export interface FiscalRangeVoidPrismaDelegate {
  create(args: Prisma.FiscalRangeVoidCreateArgs): Promise<FiscalRangeVoidRow>;
  findMany(args: Prisma.FiscalRangeVoidFindManyArgs): Promise<readonly FiscalRangeVoidRow[]>;
}

/** What the store needs from the client: just this one delegate. */
export interface FiscalRangeVoidPrismaClient {
  fiscalRangeVoid: FiscalRangeVoidPrismaDelegate;
}

/** The tenant every statement is scoped by, resolved by the caller. */
export interface FiscalRangeVoidKey {
  readonly tenantId: string;
}

/** Everything one void attempt records, with the caller's decisions already made. */
export interface RecordRangeVoidArgs {
  readonly key: FiscalRangeVoidKey;
  readonly rangeId: string;
  /** The range's counter when the void was attempted: the tail's first number. */
  readonly fromNumber: number;
  /** The range's authorised end: the tail's last number, inclusive. */
  readonly toNumber: number;
  /** The operator's reason, which is the text that travelled as the event's `mOtEve`. */
  readonly reason: string;
  readonly outcome: FiscalRangeVoidOutcome;
  readonly reasonCode: string | null;
  readonly providerReason: string | null;
  readonly providerReference: string | null;
  readonly rangeStatus: FiscalTimbradoRangeStatus;
}

export function createFiscalRangeVoidStore(client: FiscalRangeVoidPrismaClient): {
  /**
   * Writes the record of one attempt. Append-only: the statement is an INSERT,
   * and the migration's triggers make a later UPDATE or DELETE impossible rather
   * than merely discouraged.
   */
  recordVoid(args: RecordRangeVoidArgs): Promise<FiscalRangeVoidRow>;
  /**
   * One range's attempts, newest first, within the key's tenant.
   *
   * A range the tenant does not own — or one that does not exist — is the empty
   * list and never a row: the `where` clause carries the tenant.
   */
  readRangeVoids(args: {
    readonly key: FiscalRangeVoidKey;
    readonly rangeId: string;
  }): Promise<readonly FiscalRangeVoidRow[]>;
} {
  return {
    async recordVoid(args) {
      return client.fiscalRangeVoid.create({
        data: {
          tenantId: args.key.tenantId,
          rangeId: args.rangeId,
          fromNumber: args.fromNumber,
          toNumber: args.toNumber,
          reason: args.reason,
          outcome: args.outcome,
          reasonCode: args.reasonCode,
          providerReason: args.providerReason,
          providerReference: args.providerReference,
          rangeStatus: args.rangeStatus,
        },
      });
    },

    async readRangeVoids({ key, rangeId }) {
      return client.fiscalRangeVoid.findMany({
        where: { tenantId: key.tenantId, rangeId },
        orderBy: { createdAt: "desc" },
      });
    },
  };
}
