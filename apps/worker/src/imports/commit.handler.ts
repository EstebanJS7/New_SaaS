import { Inject, Injectable } from "@nestjs/common";
import { appendAuditLog, PrismaService, type AuditAppendTx } from "@newsaas/database";
import {
  IMPORT_AUDIT_ACTION,
  IMPORT_AUDIT_TARGET_TYPE,
  createCustomerCommitWriter,
  runCustomerCommit,
  type CommitCounts,
  type CommitPersistence,
  type CommitWriter,
  type CustomerAuditAppender,
  type CustomerCreateTransaction,
  type ImportCommitJob,
  type StoredOutcome,
} from "@newsaas/imports";
import { STORAGE_PORT, type StoragePort } from "@newsaas/storage";

/**
 * The commit handler (EPIC-19 [[IMP-003]]): the half that WRITES business records.
 *
 * It is `preview.handler.ts`'s shape one phase over. It resolves the row, reads
 * the SAME stored artefact the preview read ([[DEC-072]]), supplies the two narrow
 * interfaces `runCustomerCommit` orchestrates over — persistence and writer — and
 * lets the package decide which rows to write and in what order. It contains no
 * decision of its own about a row: the verdicts are read from
 * `import_row_outcome`, and the only thing this file decides is how a row's
 * records are written.
 *
 * **THE TENANT COMES FROM THE ROW.** The payload carries the `import_job` id
 * alone; the row is loaded by that id, and every query and every write below is
 * scoped to `row.tenantId`. Nothing in the payload could re-scope it.
 *
 * **THE RECORDS ARE WRITTEN BY THE CUSTOMER DOMAIN, NOT BY THIS FILE.** Each
 * accepted row goes through `createCustomer` (`@newsaas/customers`, via the
 * package's `createCustomerCommitWriter`), which opens the one transaction the
 * customer, its contacts and their audit rows share. This file supplies the
 * client, the audit appender, the tenant and the actor — it never writes a
 * customer column itself, and it has no `customer.create` of its own to drift.
 *
 * **THE ROWS THE PREVIEW REFUSED ARE NOT LOOKED AT.** The commit reads the stored
 * outcomes and writes only `CREATE` ones ([[DEC-071]]); it does not re-validate a
 * refused row and it does not retry one.
 *
 * **A TRANSACTION PER ROW, SO A LATE FAILURE DOES NOT COST THE EARLIER ONES.** A
 * row whose `createCustomer` throws leaves its own transaction rolled back, is
 * recorded as failed through `failRow`, and the run continues.
 */

/**
 * Every value of schema enum `import_job_state`, in lifecycle order.
 *
 * A local mirror (the preview handler's convention) so this boundary names the
 * vocabulary without importing the generated client namespace. The machine and
 * its legal arrows are owned by `apps/api/src/imports/imports.repository.ts`; this
 * file names the three states it writes (`COMMITTING`, `COMMITTED`, `FAILED`) and
 * the one it starts from.
 */
type ImportJobState =
  "UPLOADED" | "PREVIEWING" | "PREVIEWED" | "COMMITTING" | "COMMITTED" | "FAILED" | "EXPIRED";

/** The state a commit job is enqueued for; anything else is a stale delivery. */
const COMMIT_SOURCE_STATE: ImportJobState = "PREVIEWED";

/** The entity this unit can commit. A `PATIENT` file has no column map yet. */
const COMMITTABLE_ENTITY = "CUSTOMER";

/** The stored failure reason's ceiling: `import_job.failure_reason` is VARCHAR(500). */
const FAILURE_REASON_MAX_LENGTH = 500;

interface ImportJobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly entity: "CUSTOMER" | "PATIENT";
  readonly state: ImportJobState;
  readonly storageKey: string;
  readonly createdByMembershipId: string;
}

/**
 * The one conditional write every transition is built from.
 *
 * `where` pins the state the transition LEAVES, so a replay or a lost race matches
 * zero rows — the same write the preview handler and the API's repository perform,
 * and the reason the three cannot disagree about what "claim" means.
 */
interface ImportJobWhere {
  readonly id: string;
  readonly tenantId: string;
  readonly state: ImportJobState;
}

interface ImportJobUpdateData {
  readonly state?: ImportJobState;
  readonly committedAt?: Date;
  readonly failedAt?: Date;
  readonly failureReason?: string;
  readonly createdCount?: number;
  readonly failedCount?: number;
  readonly suspectedDuplicateCount?: number;
}

/** One stored verdict, as this handler reads it back for the runner. */
interface ImportRowOutcomeRecord {
  readonly tenantId: string;
  readonly importId: string;
  readonly rowNumber: number;
  readonly status: "CREATE" | "FAILED";
  readonly reasonCode: string | null;
  readonly message: string | null;
  readonly suspectedDuplicate: boolean;
}

interface ImportRowOutcomeOrderBy {
  readonly rowNumber?: "asc" | "desc";
}

interface ImportRowOutcomeUpdateData {
  readonly status?: "CREATE" | "FAILED";
  readonly reasonCode?: string | null;
  readonly message?: string | null;
}

/**
 * What a settle and its audit row share: the delegates the transaction writes,
 * plus the customer and contact delegates `createCustomer` joins. The transaction
 * is the point — a state change without its trail cannot happen, and a customer
 * without its contacts cannot either.
 */
export interface ImportCommitTx extends AuditAppendTx, CustomerCreateTransaction {
  importJob: {
    updateMany(args: {
      where: ImportJobWhere;
      data: ImportJobUpdateData;
    }): Promise<{ count: number }>;
  };
  importRowOutcome: {
    findMany(args: {
      where: { tenantId: string; importId: string };
      orderBy: readonly ImportRowOutcomeOrderBy[];
    }): Promise<ImportRowOutcomeRecord[]>;
    updateMany(args: {
      where: { tenantId: string; importId: string; rowNumber: number };
      data: ImportRowOutcomeUpdateData;
    }): Promise<{ count: number }>;
  };
}

/**
 * The delegate set this handler touches.
 *
 * `importJob.findFirst` is the ONLY read in this file without a tenant predicate,
 * and that is deliberate: the row is what the tenant is read FROM. Everything after
 * it carries `row.tenantId` explicitly.
 *
 * `tenantMembership.findFirst` resolves the profile behind the row's uploader,
 * because a `customer.created` audit row is attributed to a PERSON: the import is
 * the job, but the human who uploaded the file is the actor, and `SYSTEM` would
 * lose that attribution for a record a person asked for.
 */
export interface ImportCommitPrisma extends ImportCommitTx {
  importJob: ImportCommitTx["importJob"] & {
    findFirst(args: { where: { id: string } }): Promise<ImportJobRecord | null>;
  };
  tenantMembership: {
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: { userProfileId: true };
    }): Promise<{ userProfileId: string } | null>;
  };
  $transaction<T>(work: (tx: ImportCommitTx) => Promise<T>): Promise<T>;
}

/** A job this handler refuses to run, and why. Logged, never written to the row. */
interface RefusalLog {
  readonly importJobId: string;
  readonly reason: "ROW_MISSING" | "STATE_MOVED" | "ENTITY_UNSUPPORTED" | "CLAIM_LOST";
  readonly state?: ImportJobState;
}

@Injectable()
export class ImportCommitHandler {
  constructor(
    @Inject(PrismaService) private readonly prisma: ImportCommitPrisma,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort
  ) {}

  /**
   * Runs one commit pass for one import.
   *
   * ORDER, and each step's reason:
   *
   * 1. Load the row — no tenant predicate, no request context; the row is where the
   *    tenant comes from.
   * 2. Refuse a missing row, a row that is not `PREVIEWED`, and an entity this unit
   *    cannot commit. Nothing is written for any of them: a `PATIENT` commit is not
   *    implemented, and moving such a row to `FAILED` would be a terminal state an
   *    operator could never get out of once the patient map lands.
   * 3. Resolve the ACTOR from the row's uploader. A missing membership is a
   *    consistency error (the row's `RESTRICT` foreign key makes it unreachable),
   *    and it propagates BEFORE the claim, so the row stays `PREVIEWED` and the
   *    queue's retry is honest.
   * 4. Run. The artefact is read LAZILY, by the runner's own `read()` — unlike the
   *    preview, which had to read it up front because its duplicate lookup is a
   *    synchronous prefetch. So a file with no accepted row never costs an
   *    object-store call, and a read error is settled by the runner's `fail(...)`
   *    path rather than by a second, parallel one here.
   */
  async handle(job: ImportCommitJob): Promise<void> {
    const row = await this.prisma.importJob.findFirst({ where: { id: job.importJobId } });

    if (!row) {
      this.refuse({ importJobId: job.importJobId, reason: "ROW_MISSING" });
      return;
    }
    if (row.state !== COMMIT_SOURCE_STATE) {
      this.refuse({ importJobId: row.id, reason: "STATE_MOVED", state: row.state });
      return;
    }
    if (row.entity !== COMMITTABLE_ENTITY) {
      this.refuse({ importJobId: row.id, reason: "ENTITY_UNSUPPORTED" });
      return;
    }

    const actorUserProfileId = await this.resolveActor(row);

    const outcome = await runCustomerCommit({
      persistence: this.persistence(row),
      artefact: { read: () => this.readArtefact(row) },
      writer: this.writer(row, actorUserProfileId),
    });

    if (outcome === "SKIPPED") {
      this.refuse({ importJobId: row.id, reason: "CLAIM_LOST", state: row.state });
    }
  }

  /** The persistence the runner orchestrates over, bound to one row and its tenant. */
  private persistence(row: ImportJobRecord): CommitPersistence {
    return {
      claim: () => this.claim(row),
      readOutcomes: () => this.readOutcomes(row),
      failRow: (rowNumber, code, message) => this.failRow(row, rowNumber, code, message),
      complete: (counts) => this.complete(row, counts),
      fail: (reason) => this.fail(row, reason),
    };
  }

  /** The writer the runner hands one accepted row at a time. */
  private writer(row: ImportJobRecord, actorUserProfileId: string): CommitWriter {
    return createCustomerCommitWriter({
      db: this.prisma,
      audit: this.auditAppender(),
      tenantId: row.tenantId,
      actorUserProfileId,
    });
  }

  /** `appendAuditLog` as the interface `createCustomer` takes, on its transaction. */
  private auditAppender(): CustomerAuditAppender {
    return {
      // Out of a request: no session, no request id. The transaction is the
      // caller's, always — a `customer.created` row that could commit apart from
      // its customer is the failure this interface exists to prevent.
      append: (input, tx) => appendAuditLog(tx ?? this.prisma, input),
    };
  }

  /**
   * `PREVIEWED → COMMITTING`, with the audit row in the same transaction.
   *
   * `false` — the concurrency contract's "somebody else owns this" — is the answer
   * of a conditional write that matched nothing. It is NOT an error: a replayed job
   * and a lost race are normal, and they are what makes a second commit of the same
   * import impossible rather than merely unlikely.
   */
  private async claim(row: ImportJobRecord): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.importJob.updateMany({
        where: { id: row.id, tenantId: row.tenantId, state: COMMIT_SOURCE_STATE },
        data: { state: "COMMITTING" },
      });
      if (claimed.count !== 1) return false;

      await this.appendAudit(tx, row, IMPORT_AUDIT_ACTION.committing, {
        schemaVersion: 1,
        fromState: row.state,
        entity: row.entity,
      });
      return true;
    });
  }

  /**
   * The verdicts the PREVIEW persisted, in row order.
   *
   * Ordered because the row number is the summary's coordinate: the commit writes
   * in the file's own order, so a partial failure leaves a contiguous prefix per
   * row number rather than an arbitrary subset.
   */
  private async readOutcomes(row: ImportJobRecord): Promise<readonly StoredOutcome[]> {
    const rows = await this.prisma.importRowOutcome.findMany({
      where: { tenantId: row.tenantId, importId: row.id },
      orderBy: [{ rowNumber: "asc" }],
    });

    return rows.map((entry) => ({
      rowNumber: entry.rowNumber,
      status: entry.status,
      reasonCode: entry.reasonCode,
      message: entry.message,
      suspectedDuplicate: entry.suspectedDuplicate,
    }));
  }

  /**
   * Records ONE row as failed at commit time.
   *
   * The `suspectedDuplicate` flag is deliberately not in the `data`: the warning
   * was the preview's observation, it stays true on the row, and a commit failure
   * does not un-observe it. No audit row is written per row — the summary is the
   * record of a row's outcome, and one audit row per failed row would duplicate it.
   *
   * The code and message come from the runner's constants, so this method stores a
   * bounded sentence it did not compose: nothing here can quote a row's values.
   */
  private async failRow(
    row: ImportJobRecord,
    rowNumber: number,
    code: string,
    message: string
  ): Promise<void> {
    await this.prisma.importRowOutcome.updateMany({
      where: { tenantId: row.tenantId, importId: row.id, rowNumber },
      data: { status: "FAILED", reasonCode: code, message },
    });
  }

  /**
   * `COMMITTING → COMMITTED`: the three counters, the instant, and the audit row.
   *
   * `committed_at` and the counters are written in the SAME statement as the state,
   * so a `COMMITTED` import always knows when it finished and what it produced, and
   * a replay can never rewrite either (the `where` pins `COMMITTING`).
   *
   * `failed_at` is absent — the `import_job_failed_at_check` biconditional admits a
   * failure instant exactly on `FAILED`, and writing it here would abort the
   * transaction rather than just this row.
   */
  private async complete(row: ImportJobRecord, counts: CommitCounts): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const completed = await tx.importJob.updateMany({
        where: { id: row.id, tenantId: row.tenantId, state: "COMMITTING" },
        data: {
          state: "COMMITTED",
          committedAt: new Date(),
          createdCount: counts.created,
          failedCount: counts.failed,
          suspectedDuplicateCount: counts.suspectedDuplicate,
        },
      });
      // The phase was taken from us — an operator expired the import while this
      // pass ran — so the counters describe an import that already moved on. The
      // records stay (they were written row by row and are not undone here), but no
      // second terminal state is claimed.
      if (completed.count !== 1) return;

      await this.appendAudit(tx, row, IMPORT_AUDIT_ACTION.committed, {
        schemaVersion: 1,
        fromState: "COMMITTING",
        entity: row.entity,
        createdCount: counts.created,
        failedCount: counts.failed,
        suspectedDuplicateCount: counts.suspectedDuplicate,
      });
    });
  }

  /**
   * `COMMITTING → FAILED`, with a bounded reason and the instant.
   *
   * Used for a whole-file refusal (an artefact that cannot be read, zero accepted
   * rows) and for a persistence error that leaves the partial result undescribable.
   * It never rolls back a committed row: [[DEC-071]] has no rollback, and the
   * rows that exist are the rows the summary reports.
   */
  private async fail(row: ImportJobRecord, reason: string): Promise<void> {
    const bounded = truncateFailureReason(reason);

    await this.prisma.$transaction(async (tx) => {
      const failed = await tx.importJob.updateMany({
        where: { id: row.id, tenantId: row.tenantId, state: "COMMITTING" },
        data: { state: "FAILED", failedAt: new Date(), failureReason: bounded },
      });
      if (failed.count !== 1) return;

      await this.appendAudit(tx, row, IMPORT_AUDIT_ACTION.failed, {
        schemaVersion: 1,
        fromState: "COMMITTING",
        entity: row.entity,
        reason: bounded,
      });
    });
  }

  /**
   * The profile behind the row's uploader — the ACTOR of every record this pass
   * creates, and the only reason a commit needs the membership at all.
   *
   * Scoped by the row's tenant AND the row's membership id, so a row cannot be made
   * to attribute its records to another tenant's user. The composite `RESTRICT`
   * foreign key means the membership cannot be gone while the job exists, so a miss
   * is a consistency error rather than an operator problem: it throws, before the
   * claim, and the queue's retry is honest.
   */
  private async resolveActor(row: ImportJobRecord): Promise<string> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: row.createdByMembershipId, tenantId: row.tenantId },
      select: { userProfileId: true },
    });

    if (!membership) {
      throw new Error("The import's uploading membership could not be resolved.");
    }

    return membership.userProfileId;
  }

  /**
   * The artefact's text, read through the storage port from the row's own key.
   *
   * The key never leaves the row and this call frame ([[DEC-072]]): it is not
   * logged, it is not in any audit row, and it is not in a failure reason. The
   * driver's own error is REPLACED rather than propagated, because it is the text
   * most likely to quote what it was reading; the runner settles the job with its
   * own fixed sentence, and this message is never stored.
   */
  private async readArtefact(row: ImportJobRecord): Promise<string> {
    const stored = await this.storage.get({ key: row.storageKey });
    return stored.body.toString("utf8");
  }

  /** One audit row, in the caller's transaction (DEC-059's SYSTEM-actor path). */
  private async appendAudit(
    tx: ImportCommitTx,
    row: ImportJobRecord,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await appendAuditLog(tx, {
      action,
      // Out of a request: there is no session, and the job is the actor of the
      // import's own state machine. The customer and contact rows it writes are
      // attributed to the human who uploaded the file, not to the job.
      actorType: "SYSTEM",
      tenantId: row.tenantId,
      targetType: IMPORT_AUDIT_TARGET_TYPE,
      targetId: row.id,
      metadata,
    });
  }

  /**
   * Logs a refusal. Ids and a stable reason only — never a row's content, never the
   * storage key.
   */
  private refuse(log: RefusalLog): void {
    console.warn("Import commit refused", {
      importJobId: log.importJobId,
      reason: log.reason,
      ...(log.state === undefined ? {} : { state: log.state }),
    });
  }
}

/** Newline-flattened and bounded: a reason is a coordinate, not a payload. */
function truncateFailureReason(reason: string): string {
  return reason.replace(/[\r\n\t]+/g, " ").slice(0, FAILURE_REASON_MAX_LENGTH);
}
