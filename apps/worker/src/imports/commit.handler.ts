import { Inject, Injectable } from "@nestjs/common";
import { appendAuditLog, PrismaService, type AuditAppendTx } from "@newsaas/database";
import {
  IMPORT_AUDIT_ACTION,
  IMPORT_AUDIT_TARGET_TYPE,
  createCustomerCommitWriter,
  createPatientCommitWriter,
  planCustomerCommit,
  planPatientCommit,
  runImportCommit,
  type CommitCounts,
  type CommitPersistence,
  type CommitRunOutcome,
  type CustomerAuditAppender,
  type CustomerCreateTransaction,
  type CustomerContactCreateDelegate,
  type CustomerCreateDelegate,
  type CustomerRowReady,
  type PatientCustomerDelegate,
  type GuardianLookup,
  type ImportCommitJob,
  type PatientCatalog,
  type PatientCatalogLookup,
  type PatientCreateTransaction,
  type PatientRowReady,
  type StoredOutcome,
} from "@newsaas/imports";
import {
  loadGuardians,
  loadPatientCatalog,
  type ImportPatientReferencePrisma,
} from "./patient-references.js";
import { STORAGE_PORT, type StoragePort } from "@newsaas/storage";

/**
 * The commit handler (EPIC-19 [[IMP-003]]): the half that WRITES business records.
 *
 * It is `preview.handler.ts`'s shape one phase over. It resolves the row, reads
 * the SAME stored artefact the preview read ([[DEC-072]]), supplies the two narrow
 * interfaces `runImportCommit` orchestrates over — persistence, the entity's payload
 * PLANNER and the entity's WRITER — and lets the package decide which rows to write
 * and in what order. It contains no decision of its own about a row: the verdicts are
 * read from `import_row_outcome`, and the only things this file decides are how a
 * row's records are written and, since [[IMP-004]], WHO writes them.
 *
 * **THE ENTITY DECIDES THE WRITER, AND NOTHING ELSE.** `row.entity` selects the
 * payload planner and the writer ({{@link commitCustomer}}, {{@link commitPatient}});
 * the claim, the authoritative outcomes, the per-row partial success and the settle
 * are the package's one implementation for both entities.
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

/**
 * The entity a job names. Both have a writer since [[IMP-004]]; the LOCAL mirror is
 * deliberate (the state enum's convention) so a third entity becomes a compile error
 * rather than a job nobody writes.
 */
type ImportJobEntity = "CUSTOMER" | "PATIENT";

/** The stored failure reason's ceiling: `import_job.failure_reason` is VARCHAR(500). */
const FAILURE_REASON_MAX_LENGTH = 500;

interface ImportJobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly entity: ImportJobEntity;
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
 * plus the delegates `createCustomer` and `createPatient` join. The transaction is
 * the point — a state change without its trail cannot happen, a customer without its
 * contacts cannot either, and a patient without its primary guardian cannot either
 * (`patient_exactly_one_primary_guardian` is a DEFERRED constraint trigger, checked at
 * COMMIT of this very transaction).
 *
 * ONE transaction type carries BOTH domains' delegates because the handler serves both
 * entities and a row writes exactly one of them: widening the handle is how the writer
 * factories take `db` without the worker declaring a dependency on the owning package.
 */
export interface ImportCommitTx
  extends
    AuditAppendTx,
    Omit<CustomerCreateTransaction, "customer" | "customerContact">,
    Omit<PatientCreateTransaction, "customer"> {
  /**
   * ONE customer delegate, carrying both domains' shapes: `createCustomer` WRITES a
   * customer through it and `createPatient`'s guardian link READS one (and the guardian
   * prefetch reads a page of them). Intersecting the two transactions is not enough —
   * both declare `customer` and the members do not match — so the merged delegates are
   * stated here, once.
   */
  customer: CustomerCreateDelegate &
    PatientCustomerDelegate &
    ImportPatientReferencePrisma["customer"];
  /** The contacts `createCustomer` writes, and the ones the guardian prefetch reads. */
  customerContact: CustomerContactCreateDelegate & ImportPatientReferencePrisma["customerContact"];
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
  /**
   * The GLOBAL taxonomy read, which carries NO tenant predicate (Decision #2211).
   *
   * Declared through the shared prefetch module's own delegate type rather than by
   * re-extending `ImportPatientReferencePrisma`: the customer and contact delegates are
   * already merged into {@link ImportCommitTx}, and an interface cannot inherit the same
   * property twice.
   */
  species: ImportPatientReferencePrisma["species"];
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
  readonly reason: "ROW_MISSING" | "STATE_MOVED" | "CLAIM_LOST";
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
   * 2. Refuse a missing row and a row that is not `PREVIEWED`. Nothing is written for
   *    either: a stale delivery is not work anybody asked for, and `FAILED` is
   *    terminal.
   * 3. Resolve the ACTOR from the row's uploader. A missing membership is a
   *    consistency error (the row's `RESTRICT` foreign key makes it unreachable),
   *    and it propagates BEFORE the claim, so the row stays `PREVIEWED` and the
   *    queue's retry is honest.
   * 4. Run the entity's pass ({{@link commitCustomer}} / {{@link commitPatient}}).
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

    const actorUserProfileId = await this.resolveActor(row);

    switch (row.entity) {
      case "CUSTOMER":
        this.refuseSkipped(row, await this.commitCustomer(row, actorUserProfileId));
        return;
      case "PATIENT":
        this.refuseSkipped(row, await this.commitPatient(row, actorUserProfileId));
        return;
    }
  }

  /**
   * The customer pass: `runImportCommit` over the customer planner and writer.
   *
   * The artefact is read LAZILY, by the runner's own `read()`: a customer file with no
   * accepted row never costs an object-store call, and a read error is settled by the
   * runner's `fail(...)` path rather than by a second, parallel one here.
   */
  private async commitCustomer(
    row: ImportJobRecord,
    actorUserProfileId: string
  ): Promise<CommitRunOutcome> {
    return runImportCommit<CustomerRowReady>({
      persistence: this.persistence(row),
      artefact: { read: () => this.readArtefact(row) },
      plan: (csvText) => planCustomerCommit({ csvText }),
      writer: createCustomerCommitWriter({
        db: this.prisma,
        audit: this.auditAppender(),
        tenantId: row.tenantId,
        actorUserProfileId,
      }),
    });
  }

  /**
   * The patient pass: `runImportCommit` over the patient planner and writer.
   *
   * ONE DIFFERENCE FROM THE CUSTOMER PASS, stated rather than hidden: the artefact is
   * read UP FRONT. The patient planner needs the file's guardian references to resolve
   * them ([[DEC-070]]) and `ImportPayloadPlanner` is a SYNCHRONOUS function of the
   * text, so the prefetch has to be complete before the runner calls it — which means
   * the read happens before the runner's "no accepted row" check. A patient import
   * whose preview accepted nothing therefore costs one object-store read before it
   * fails; the outcome is identical (`IMPORT_COMMIT_NO_VALID_ROWS`), because the
   * runner still owns that decision.
   *
   * The read's error is CAPTURED and re-thrown by the `PreviewArtefact`, exactly as the
   * preview handler does, so an unreadable object is still settled by the runner's own
   * single `fail(...)` path (`IMPORT_COMMIT_FAILED`) and not by a second one here.
   */
  private async commitPatient(
    row: ImportJobRecord,
    actorUserProfileId: string
  ): Promise<CommitRunOutcome> {
    const read = await this.readArtefactResult(row);

    // The taxonomy is global and read whole; the references are the row's tenant's.
    // Neither is asked for when the artefact could not be read: the pass will settle as
    // failed before it plans, and the empty lookups below are what that pass is built
    // with (see {@link NO_PATIENT_CATALOG}).
    const catalog = read.ok ? await loadPatientCatalog(this.prisma) : undefined;
    const guardians = read.ok
      ? await loadGuardians(this.prisma, row.tenantId, read.text)
      : NO_GUARDIANS;

    return runImportCommit<PatientRowReady>({
      persistence: this.persistence(row),
      artefact: {
        read: () => (read.ok ? Promise.resolve(read.text) : Promise.reject(read.error)),
      },
      plan: (csvText) =>
        planPatientCommit({
          csvText,
          catalog: catalog?.lookup ?? NO_PATIENT_CATALOG_LOOKUP,
          guardians,
        }),
      writer: createPatientCommitWriter({
        db: this.prisma,
        audit: this.auditAppender(),
        catalog: catalog?.catalog ?? NO_PATIENT_CATALOG,
        tenantId: row.tenantId,
        actorUserProfileId,
      }),
    });
  }

  /** Logs a claim this pass lost. Ids and a stable reason only. */
  private refuseSkipped(row: ImportJobRecord, outcome: CommitRunOutcome): void {
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

  /**
   * `appendAuditLog` as the interface `createCustomer` and `createPatient` take, on
   * their transaction.
   *
   * ONE appender for both domains: the two interfaces are structurally identical (the
   * primitive's own input and transaction types), which is what lets a caller outside a
   * request supply the same thin writer to either owning service.
   */
  private auditAppender(): CustomerAuditAppender {
    return {
      // Out of a request: no session, no request id. The transaction is the
      // caller's, always — a `customer.created` or `patient.created` row that could
      // commit apart from its record is the failure this interface exists to prevent.
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

  /**
   * The same read, with its failure CAPTURED instead of thrown.
   *
   * The patient planner needs the file's guardian references before it can be built, so
   * the patient pass reads the artefact itself; capturing keeps that read's error
   * flowing through the runner's single `fail(...)` path (the rejecting
   * `PreviewArtefact`) rather than through a second one here.
   */
  private async readArtefactResult(row: ImportJobRecord): Promise<ArtefactRead> {
    try {
      return { ok: true, text: await this.readArtefact(row) };
    } catch {
      return { ok: false, error: new Error("The stored artefact could not be read.") };
    }
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

/**
 * What a read of the artefact produced: the text, or a replacement error.
 *
 * The driver's own message is never kept (see
 * {@link ImportCommitHandler.readArtefactResult}), so the failure side carries a
 * sentence this file wrote.
 */
type ArtefactRead =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: Error };

/**
 * The lookups a patient pass is built with when its artefact could not be read.
 *
 * They are NEVER USED: the runner reads the artefact BEFORE it plans, that read
 * rejects, and the runner's own `fail(...)` path settles the job — the same single
 * failure path a readable pass uses. They exist because `plan` and `writer` are
 * required arguments, and they are chosen to FAIL CLOSED rather than to shrug: the
 * empty catalog refuses every species and breed, so a writer that somehow ran would
 * refuse a patient instead of writing one whose taxonomy was never validated.
 */
const NO_PATIENT_CATALOG_LOOKUP: PatientCatalogLookup = {
  speciesByValue: () => null,
  breedByValue: () => null,
};

const NO_PATIENT_CATALOG: PatientCatalog = {
  species: { findFirst: () => Promise.resolve(null) },
  breed: { findFirst: () => Promise.resolve(null) },
};

const NO_GUARDIANS: GuardianLookup = {
  byDocumentNumber: () => null,
  byContactValue: () => null,
};

/** Newline-flattened and bounded: a reason is a coordinate, not a payload. */
function truncateFailureReason(reason: string): string {
  return reason.replace(/[\r\n\t]+/g, " ").slice(0, FAILURE_REASON_MAX_LENGTH);
}
