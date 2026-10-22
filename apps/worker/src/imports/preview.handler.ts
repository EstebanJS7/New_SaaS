import { Inject, Injectable } from "@nestjs/common";
import { appendAuditLog, PrismaService, type AuditAppendTx } from "@newsaas/database";
import {
  IMPORT_AUDIT_ACTION,
  IMPORT_AUDIT_TARGET_TYPE,
  parseCsv,
  planCustomerPreview,
  planPatientPreview,
  resolveCustomerColumns,
  runImportPreview,
  type DuplicateLookup,
  type ImportPlanner,
  type ImportPreviewJob,
  type ImportPreviewRow,
  type PreviewPersistence,
} from "@newsaas/imports";
import {
  loadGuardians,
  loadPatientCatalog,
  REFERENCE_LOOKUP_CHUNK_SIZE,
  type ImportPatientReferencePrisma,
} from "./patient-references.js";
import { STORAGE_PORT, type StoragePort } from "@newsaas/storage";

/**
 * The preview handler (EPIC-19 [[IMP-002]]): the worker's half of the pipeline.
 *
 * It resolves the row, reads the stored artefact through the storage port, supplies
 * the three narrow interfaces `runImportPreview` orchestrates over — persistence,
 * artefact and THE ENTITY'S PLANNER — and lets the package decide every verdict. It
 * contains no parsing rule, no validation rule and no count arithmetic of its own;
 * `createdCount` here is a filter over `ImportPreviewRow`, not a second opinion about
 * what a row means.
 *
 * **THE ENTITY DECIDES THE PLANNER, AND NOTHING ELSE.** Since [[IMP-004]] the pass is
 * shared: `row.entity` selects the planner ({{@link planner}}), and the prefetch that
 * planner needs — the tenant's duplicate candidates for a customer file, the GLOBAL
 * taxonomy plus the tenant's guardian references for a patient file — is what this
 * file adds. The claim, the settle, the counters and the file-refusal path are the
 * package's one implementation for both entities.
 *
 * **THE TENANT COMES FROM THE ROW.** The worker has no request context, so this is
 * the ONE place in the import path where the tenant is not derived from an
 * authenticated request: the job payload carries the `import_job` id alone, the row
 * is loaded by that id, and every query and every write below is scoped to
 * `row.tenantId`. Nothing in the payload could re-scope it, because nothing in the
 * payload says which tenant it is — and a job whose payload DID carry a tenant would
 * be a second source of truth for the one fact the row already owns.
 *
 * WHAT IT REFUSES, AND WHY IT WRITES NOTHING WHEN IT DOES. A job whose row is gone,
 * or whose row is no longer `UPLOADED`, is a duplicate delivery or work somebody
 * else already did: it is logged and returned from, never re-driven. The claim in
 * the runner is what makes that true under concurrency — it is a conditional
 * `updateMany` pinned on `UPLOADED`, so a lost race writes no second set of
 * outcomes.
 */

/**
 * Every value of schema enum `import_job_state`, in lifecycle order.
 *
 * A local mirror (the fiscal handler's and `imports.repository.ts`'s convention) so
 * this boundary names the vocabulary without importing the generated client
 * namespace. The machine and its legal arrows are owned by
 * `apps/api/src/imports/imports.repository.ts`; this file only ever names three
 * states it writes (`PREVIEWING`, `PREVIEWED`, `FAILED`) and the one it starts from.
 */
type ImportJobState =
  "UPLOADED" | "PREVIEWING" | "PREVIEWED" | "COMMITTING" | "COMMITTED" | "FAILED" | "EXPIRED";

/** The state a preview job is enqueued for; anything else is a stale delivery. */
const PREVIEW_SOURCE_STATE: ImportJobState = "UPLOADED";

/**
 * The entity a job names. Both have a column map since [[IMP-004]]; the LOCAL mirror
 * is deliberate (the state enum's convention) so this boundary names the vocabulary
 * without importing the generated client namespace, and so a third entity becomes a
 * compile error rather than a job nobody plans.
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
}

/**
 * The one conditional write every transition is built from.
 *
 * `where` pins the state the transition LEAVES, so a replay or a lost race matches
 * zero rows — the same write the API's repository performs, and the reason the two
 * cannot disagree about what "claim" means.
 */
interface ImportJobWhere {
  readonly id: string;
  readonly tenantId: string;
  readonly state: ImportJobState;
}

interface ImportJobUpdateData {
  readonly state?: ImportJobState;
  readonly previewedAt?: Date;
  readonly failedAt?: Date;
  readonly failureReason?: string;
  readonly createdCount?: number;
  readonly failedCount?: number;
  readonly suspectedDuplicateCount?: number;
}

interface ImportRowOutcomeCreate {
  readonly tenantId: string;
  readonly importId: string;
  readonly rowNumber: number;
  readonly status: "CREATE" | "FAILED";
  readonly reasonCode: string | null;
  readonly message: string | null;
  readonly suspectedDuplicate: boolean;
}

/**
 * What a settle and its audit row share: the three delegates the transaction
 * writes. The transaction is the point — a state change without its trail cannot
 * happen, which is the API service's rule applied to the worker's writes.
 */
export interface ImportPreviewTx extends AuditAppendTx {
  importJob: {
    updateMany(args: {
      where: ImportJobWhere;
      data: ImportJobUpdateData;
    }): Promise<{ count: number }>;
  };
  importRowOutcome: {
    deleteMany(args: { where: { tenantId: string; importId: string } }): Promise<{ count: number }>;
    createMany(args: { data: readonly ImportRowOutcomeCreate[] }): Promise<{ count: number }>;
  };
}

/**
 * The delegate set this handler touches.
 *
 * `importJob.findFirst` is the ONLY read in this file without a tenant predicate,
 * and that is deliberate: the row is what the tenant is read FROM. Everything after
 * it — including the duplicate lookups — carries `row.tenantId` explicitly.
 */
export interface ImportPreviewPrisma extends ImportPreviewTx, ImportPatientReferencePrisma {
  importJob: ImportPreviewTx["importJob"] & {
    findFirst(args: { where: { id: string } }): Promise<ImportJobRecord | null>;
  };
  $transaction<T>(work: (tx: ImportPreviewTx) => Promise<T>): Promise<T>;
}

/** A `claim` that matched no row did not happen; `complete`/`fail` therefore no-op. */
interface RefusalLog {
  readonly importJobId: string;
  readonly reason: "ROW_MISSING" | "STATE_MOVED" | "CLAIM_LOST";
  readonly state?: ImportJobState;
}

@Injectable()
export class ImportPreviewHandler {
  constructor(
    @Inject(PrismaService) private readonly prisma: ImportPreviewPrisma,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort
  ) {}

  /**
   * Runs one preview pass for one import.
   *
   * ORDER, and each step's reason:
   *
   * 1. Load the row — no tenant predicate, no request context; the row is where the
   *    tenant comes from.
   * 2. Refuse a missing row and a row that is not `UPLOADED`. Nothing is written for
   *    either: a stale delivery is not work anybody asked for, and `FAILED` is
   *    terminal.
   * 3. Read the artefact ONCE — outside the runner, because BOTH entities' prefetches
   *    need the text and the lookups they feed are synchronous. A read error is
   *    captured and re-thrown by the `PreviewArtefact` the runner consumes, so the
   *    failure is settled by the runner's own `fail(...)` path rather than by a
   *    second, parallel one here.
   * 4. Build the entity's planner ({{@link planner}}) — which is where the prefetch
   *    happens — and run. The pass itself is the package's single implementation.
   *
   * A prefetch or storage error that is NOT a read failure (an unreachable
   * database while asking about documents) propagates: nothing was claimed yet, so
   * the row is still `UPLOADED` and the queue's retry is honest.
   */
  async handle(job: ImportPreviewJob): Promise<void> {
    const row = await this.prisma.importJob.findFirst({ where: { id: job.importJobId } });

    if (!row) {
      this.refuse({ importJobId: job.importJobId, reason: "ROW_MISSING" });
      return;
    }
    if (row.state !== PREVIEW_SOURCE_STATE) {
      this.refuse({ importJobId: row.id, reason: "STATE_MOVED", state: row.state });
      return;
    }

    const read = await this.readArtefact(row);

    const outcome = await runImportPreview({
      persistence: this.persistence(row),
      artefact: {
        read: () => (read.ok ? Promise.resolve(read.text) : Promise.reject(read.error)),
      },
      plan: read.ok ? await this.planner(row, read.text) : UNREADABLE_ARTEFACT_PLANNER,
    });

    if (outcome === "SKIPPED") {
      this.refuse({ importJobId: row.id, reason: "CLAIM_LOST", state: row.state });
    }
  }

  /**
   * Builds the planner for this row's entity, prefetching what it needs.
   *
   * THE PREFETCH LIVES HERE, NOT IN THE PACKAGE, and that is what keeps the planner a
   * PURE function of the file's text: the lookup it closes over is already answered by
   * the time planning starts. Each branch prefetches from the SAME text the runner will
   * hand the planner, which is the text this handler read a moment earlier.
   *
   * Every query in the patient branch carries the ROW's tenant except the taxonomy,
   * which is global by decision (Decision #2211): a guardian reference that belongs to
   * another tenant therefore resolves to NOTHING, which is the row error [[DEC-070]]
   * requires and never a cross-tenant link.
   */
  private async planner(row: ImportJobRecord, csvText: string): Promise<ImportPlanner> {
    switch (row.entity) {
      case "CUSTOMER": {
        const duplicates = await this.loadDuplicates(row.tenantId, csvText);
        return (text) => planCustomerPreview({ csvText: text, duplicates });
      }
      case "PATIENT": {
        // The taxonomy is global and read whole; the references are the tenant's.
        const catalog = await loadPatientCatalog(this.prisma);
        const guardians = await loadGuardians(this.prisma, row.tenantId, csvText);
        return (text) => planPatientPreview({ csvText: text, catalog: catalog.lookup, guardians });
      }
    }
  }

  /** The persistence the runner orchestrates over, bound to one row and its tenant. */
  private persistence(row: ImportJobRecord): PreviewPersistence {
    return {
      claim: () => this.claim(row),
      complete: (rows) => this.complete(row, rows),
      fail: (reason) => this.fail(row, reason),
    };
  }

  /**
   * `UPLOADED → PREVIEWING`, with the audit row in the same transaction.
   *
   * `false` — the concurrency contract's "somebody else owns this" — is the answer
   * of a conditional write that matched nothing. It is NOT an error: a replayed job
   * and a lost race are normal.
   */
  private async claim(row: ImportJobRecord): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.importJob.updateMany({
        where: { id: row.id, tenantId: row.tenantId, state: PREVIEW_SOURCE_STATE },
        data: { state: "PREVIEWING" },
      });
      if (claimed.count !== 1) return false;

      await this.appendAudit(tx, row, IMPORT_AUDIT_ACTION.previewing, {
        schemaVersion: 1,
        fromState: row.state,
        entity: row.entity,
      });
      return true;
    });
  }

  /**
   * `PREVIEWING → PREVIEWED`: the outcomes REPLACED, the counters, and the instant.
   *
   * `previewed_at` and the three counters are written in the SAME statement as the
   * state, so a `PREVIEWED` import always knows when it got there and what it saw,
   * and a replay can never rewrite either (the `where` pins `PREVIEWING`).
   *
   * The `deleteMany` is not defensive noise: "replaces this job's outcomes" is the
   * contract, `(tenant_id, import_id, row_number)` is unique, and a write that
   * assumed an empty table would turn a second pass into a constraint violation
   * instead of the same preview.
   *
   * `failed_at` is deliberately absent — the `import_job_failed_at_check`
   * biconditional admits a failure instant exactly on `FAILED`, and nothing else may
   * carry it. Writing it here would abort the transaction, not just this row.
   */
  private async complete(row: ImportJobRecord, rows: readonly ImportPreviewRow[]): Promise<void> {
    const createdCount = rows.filter((entry) => entry.status === "CREATE").length;
    const failedCount = rows.filter((entry) => entry.status === "FAILED").length;
    const suspectedDuplicateCount = rows.filter((entry) => entry.suspectedDuplicate).length;

    await this.prisma.$transaction(async (tx) => {
      const completed = await tx.importJob.updateMany({
        where: { id: row.id, tenantId: row.tenantId, state: "PREVIEWING" },
        data: {
          state: "PREVIEWED",
          previewedAt: new Date(),
          createdCount,
          failedCount,
          suspectedDuplicateCount,
        },
      });
      // The phase was taken from us — an operator expired the import while this
      // pass ran — so the outcomes it produced belong to nothing and are not
      // written. Returning inside the transaction leaves no partial state.
      if (completed.count !== 1) return;

      await tx.importRowOutcome.deleteMany({
        where: { tenantId: row.tenantId, importId: row.id },
      });

      if (rows.length > 0) {
        await tx.importRowOutcome.createMany({
          data: rows.map((entry) => ({
            tenantId: row.tenantId,
            importId: row.id,
            rowNumber: entry.rowNumber,
            status: entry.status,
            // Present exactly when the row FAILED, which is the planner's contract.
            reasonCode: entry.code ?? null,
            message: entry.message ?? null,
            suspectedDuplicate: entry.suspectedDuplicate,
          })),
        });
      }

      await this.appendAudit(tx, row, IMPORT_AUDIT_ACTION.previewed, {
        schemaVersion: 1,
        fromState: "PREVIEWING",
        entity: row.entity,
        rowCount: rows.length,
        createdCount,
        failedCount,
        suspectedDuplicateCount,
      });
    });
  }

  /**
   * `PREVIEWING → FAILED`, with a bounded reason and the instant.
   *
   * `failed_at` is written HERE and nowhere else: the
   * `import_job_failed_at_check` biconditional requires it on `FAILED` and forbids
   * it everywhere else, so a `FAILED` import always knows when it failed and a
   * successful one can never claim it did.
   */
  private async fail(row: ImportJobRecord, reason: string): Promise<void> {
    const bounded = truncateFailureReason(reason);

    await this.prisma.$transaction(async (tx) => {
      const failed = await tx.importJob.updateMany({
        where: { id: row.id, tenantId: row.tenantId, state: "PREVIEWING" },
        data: { state: "FAILED", failedAt: new Date(), failureReason: bounded },
      });
      if (failed.count !== 1) return;

      await this.appendAudit(tx, row, IMPORT_AUDIT_ACTION.failed, {
        schemaVersion: 1,
        fromState: "PREVIEWING",
        entity: row.entity,
        reason: bounded,
      });
    });
  }

  /**
   * The artefact, read through the storage port from the row's own key.
   *
   * The key never leaves the row and this call frame ([[DEC-072]]): it is not
   * logged, it is not in any audit row, and it is not in a failure reason. The
   * error is captured rather than thrown so the failure is settled by the runner's
   * single `fail(...)` path; the driver's own message is NOT kept, because it is the
   * text most likely to quote what it was reading.
   */
  private async readArtefact(row: ImportJobRecord): Promise<ArtefactRead> {
    try {
      const stored = await this.storage.get({ key: row.storageKey });
      return { ok: true, text: stored.body.toString("utf8") };
    } catch {
      return { ok: false, error: new Error("The stored artefact could not be read.") };
    }
  }

  /**
   * The `DuplicateLookup`, implemented over Prisma and scoped to the ROW's tenant.
   *
   * WHY THIS IS A PREFETCH. `DuplicateLookup` ([[IMP-002]] part 1) answers
   * SYNCHRONOUSLY — the planner is a pure function and `detectSuspectedDuplicate`
   * cannot await — so a database-backed lookup must already hold its answers by the
   * time planning starts. So the candidate values are read out of the file, asked
   * about in bounded batches, and answered from two sets.
   *
   * It is exact rather than approximate: the planner only ever asks about a
   * document number or a contact value that came FROM the file, and every value the
   * file carries is asked about here. The candidate extraction reuses the package's
   * own reader and header contract — no column name is written down in this file —
   * and trims cells exactly as the row contract does.
   *
   * THE TENANT PREDICATE IS EXPLICIT ON BOTH QUERIES, and it is `row.tenantId`:
   * another tenant's customer with the same document number is not a duplicate of
   * this tenant's row, and a lookup that leaked across tenants would turn a warning
   * into a disclosure.
   */
  private async loadDuplicates(tenantId: string, csvText: string): Promise<DuplicateLookup> {
    const candidates = collectDuplicateCandidates(csvText);
    const documentNumbers = new Set<string>();
    const contactValues = new Set<string>();

    for (const chunk of chunked(candidates.documentNumbers, REFERENCE_LOOKUP_CHUNK_SIZE)) {
      const found = await this.prisma.customer.findMany({
        where: { tenantId, documentNumber: { in: chunk } },
        select: { id: true, documentNumber: true },
        orderBy: { createdAt: "asc" },
      });
      for (const row of found) {
        if (row.documentNumber !== null) documentNumbers.add(row.documentNumber);
      }
    }

    for (const chunk of chunked(candidates.contactValues, REFERENCE_LOOKUP_CHUNK_SIZE)) {
      // One query per batch, answered by `(kind, value)` below: the rows are read
      // by value and filtered to the exact pair, so a phone number and an e-mail
      // that happen to share a string are still different contacts.
      const found = await this.prisma.customerContact.findMany({
        where: { tenantId, value: { in: chunk } },
        select: { customerId: true, kind: true, value: true },
        orderBy: { createdAt: "asc" },
      });
      for (const row of found) {
        contactValues.add(contactKey(row.kind, row.value));
      }
    }

    return {
      existsByDocumentNumber: (value) => documentNumbers.has(value),
      existsByContactValue: (kind, value) => contactValues.has(contactKey(kind, value)),
    };
  }

  /** One audit row, in the caller's transaction (DEC-059's SYSTEM-actor path). */
  private async appendAudit(
    tx: ImportPreviewTx,
    row: ImportJobRecord,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await appendAuditLog(tx, {
      action,
      // Out of a request: there is no session, and the job is the actor.
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
    console.warn("Import preview refused", {
      importJobId: log.importJobId,
      reason: log.reason,
      ...(log.state === undefined ? {} : { state: log.state }),
    });
  }
}

/**
 * What a read of the artefact produced: the text, or a replacement error.
 *
 * The driver's own message is never kept (see {@link ImportPreviewHandler.readArtefact}),
 * so the failure side carries a sentence this file wrote.
 */
type ArtefactRead =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: Error };

/**
 * The planner a preview whose artefact could not be read is given.
 *
 * It is NEVER CALLED: the runner reads the artefact BEFORE it plans, that read
 * rejects, and the runner's own `fail(...)` path settles the job — which is the same
 * single failure path a customer or patient preview uses. It exists because `plan` is
 * a required argument and because a planner that threw would be a second failure path
 * beside the one the runner already owns.
 */
const UNREADABLE_ARTEFACT_PLANNER: ImportPlanner = () => ({ rows: [] });

/** A contact's identity is the PAIR: two kinds may carry the same string. */
function contactKey(kind: "PHONE" | "EMAIL", value: string): string {
  return `${kind}\u0000${value}`;
}

/**
 * The document numbers and contact values one file asks about.
 *
 * It reuses the package's reader and header contract, so this file names no column:
 * a file the reader refuses, or one whose headers do not match the contract, yields
 * no candidates — its preview will refuse it before asking about a single value.
 */
function collectDuplicateCandidates(csvText: string): {
  readonly documentNumbers: string[];
  readonly contactValues: string[];
} {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { documentNumbers: [], contactValues: [] };

  const columns = resolveCustomerColumns(parsed.headers);
  if (!columns.ok) return { documentNumbers: [], contactValues: [] };

  const documentColumn = columns.layout.index.documentNumber;
  const phoneColumn = columns.layout.index.phone;
  const emailColumn = columns.layout.index.email;

  const documentNumbers = new Set<string>();
  const contactValues = new Set<string>();

  for (const cells of parsed.rows) {
    for (const [column, target] of [
      [documentColumn, documentNumbers],
      [phoneColumn, contactValues],
      [emailColumn, contactValues],
    ] as const) {
      if (column === undefined) continue;
      // Trimmed exactly as the row contract trims, so the value asked about is the
      // value the planner will ask about.
      const cell = (cells[column] ?? "").trim();
      if (cell !== "") target.add(cell);
    }
  }

  return { documentNumbers: [...documentNumbers], contactValues: [...contactValues] };
}

/** Bounds the batch, not the answers: every candidate is still asked about. */
function chunked(values: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/** Newline-flattened and bounded: a reason is a coordinate, not a payload. */
function truncateFailureReason(reason: string): string {
  return reason.replace(/[\r\n\t]+/g, " ").slice(0, FAILURE_REASON_MAX_LENGTH);
}
