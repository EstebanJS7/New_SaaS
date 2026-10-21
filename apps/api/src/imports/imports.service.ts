import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  createOpaqueStorageKey,
  STORAGE_KEY_PREFIXES,
  STORAGE_PORT,
  type StoragePort,
} from "@newsaas/storage";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { ParsedImportArtefact } from "./import-artefact.pipe.js";
import {
  toImportJobResponse,
  toImportUploadResponse,
  type ImportJobResponse,
  type ImportUploadResponse,
} from "./imports.dto.js";
import { IMPORTS_PERMISSIONS } from "./imports.permissions.js";
import {
  IMPORT_ARTEFACT_TTL_MS,
  IMPORT_TRANSITION_CONFLICT_MESSAGE,
  ImportRepository,
  isTerminal,
  type ImportCommitCounters,
  type ImportTx,
} from "./imports.repository.js";

/**
 * Everything the audited import closure needs from its transaction handle.
 * Declared structurally (not as `Prisma.TransactionClient`) so the real client
 * and the shared in-memory boundary both satisfy it: the job delegate reaches the
 * tenant-safe repository seam and `auditLog` the append-only {@link AuditWriter},
 * so a state change and its audit row commit atomically (the `CashWriteTx`
 * pattern).
 */
export type ImportsWriteTx = ImportTx & { auditLog: AuditAppendTx["auditLog"] };

export interface ImportsPrisma {
  $transaction: <T>(work: (tx: ImportsWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action codes for the import lifecycle. The repository's established
 * shape is `<domain>.<past_verb>`, and `targetType` matches the table the row was
 * written for.
 *
 * WHY THERE ARE SEVEN AND NOT FIVE: the story names five
 * (`uploaded`, `previewed`, `committed`, `failed`, `expired`) and requires EVERY
 * transition to be audited. The machine has two further transitions that enter a
 * work phase (`UPLOADED → PREVIEWING`, `PREVIEWED → COMMITTING`) and the five
 * names do not cover them: recording `previewed` before the preview ran would be
 * a lie, and not recording it at all would make a crash inside a phase leave no
 * trace. `import.previewing` and `import.committing` fill exactly that gap and
 * follow the same convention.
 *
 * Reads are never audited.
 */
export const IMPORT_UPLOADED_ACTION = "import.uploaded";
export const IMPORT_PREVIEWING_ACTION = "import.previewing";
export const IMPORT_PREVIEWED_ACTION = "import.previewed";
export const IMPORT_COMMITTING_ACTION = "import.committing";
export const IMPORT_COMMITTED_ACTION = "import.committed";
export const IMPORT_FAILED_ACTION = "import.failed";
export const IMPORT_EXPIRED_ACTION = "import.expired";

/** `targetType` recorded on every import audit row. */
export const IMPORT_TARGET_TYPE = "import_job";

/**
 * Stable `403` for a missing `imports.*` grant, re-asserted in the service behind
 * `@RequirePermissions` so a denial reaches no query and no storage call.
 */
export const IMPORT_PERMISSION_DENIED_MESSAGE = "The required import permission is missing.";

/**
 * The TTL sweep's batch size. The sweep is a maintenance job, not a request: a
 * bounded batch keeps one run's memory and lock footprint flat and lets the next
 * run drain the rest ([[TD-026]]'s discipline applied to a job instead of a page).
 */
export const IMPORT_SWEEP_BATCH_SIZE = 100;

/** What one sweep pass did, so a caller can log it instead of guessing. */
export interface ImportSweepResult {
  /** Jobs that were still non-terminal and are now `EXPIRED`. */
  readonly expired: number;
  /** Artefacts actually deleted (a stamp that already existed counts for none). */
  readonly deleted: number;
  /** Rows whose deletion failed and will be retried by the next pass. */
  readonly failed: number;
}

/** The conditional transition the service wraps in a transaction and an audit row. */
type ImportTransition = (id: string, tx: ImportTx) => Promise<boolean>;

/**
 * The import application boundary (EPIC-19 IMP-001).
 *
 * WHAT THIS SLICE DOES. It uploads an artefact, creates the job, moves the job
 * through its closed state machine and deletes the artefact when the job is
 * finished. WHAT IT DELIBERATELY DOES NOT DO: parse the file, evaluate rows or
 * commit records — [[IMP-002]] onwards own that, and the machine's
 * `PREVIEWING`/`COMMITTING` phases exist here with no work behind them.
 *
 * THREE PROPERTIES ARE THIS FILE'S JOB:
 *
 * 1. **The storage key never leaves the server.** It is generated here, written
 *    straight to `import_job.storage_key`, used to delete the object, and appears
 *    in no response, no error message and no audit metadata ([[DEC-072]]).
 * 2. **Every transition is audited and every illegal one is the same `409`.** The
 *    transition itself is the repository's conditional `updateMany`; this layer
 *    reads first so an unknown or foreign import is a `404`, then co-commits the
 *    state change with its audit row, so a change without its trail is
 *    structurally impossible.
 * 3. **The artefact's lifetime is stated once.** It is deleted the moment the job
 *    reaches a terminal state, and the sweep covers the job that never does
 *    ([[DEC-072]], [[TD-058]]). Deletion is idempotent: the object delete is, and
 *    the `artefact_deleted_at` stamp is a compare-and-set.
 *
 * There is NO entitlement gate ([[DEC-072]]): `imports.*` is the whole guard.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: ImportsPrisma,
    private readonly repository: ImportRepository,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort
  ) {}

  /**
   * Stores the artefact and creates the job in `UPLOADED`.
   *
   * ORDER MATTERS AND IS NOT ARBITRARY. The permission is asserted FIRST, before
   * the opaque key is generated and before a single byte is written, so a caller
   * without `imports.run` cannot cause a storage write (the test asserts exactly
   * that, because "the guard rejected it" and "nothing was written" are different
   * claims). The bytes are then written OUTSIDE the database transaction: an
   * object-store call is external, and holding a transaction open across it is
   * how a slow provider becomes a stalled database (engineering rules: External
   * calls). If the insert then fails, the orphaned object is deleted, so a failed
   * upload does not leak storage.
   *
   * The TTL is stamped from the same instant as the write: `now + 72 hours`.
   * Generous on purpose — an operator may upload a file, preview it, leave for the
   * day and come back to commit it, and a TTL that expires under a working
   * session would turn a business flow into a support ticket.
   */
  async upload(artefact: ParsedImportArtefact): Promise<ImportUploadResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requirePermission(IMPORTS_PERMISSIONS.run);
    const actorUserProfileId = this.requestContext.requireUserProfileId();
    const createdByMembershipId = await this.repository.resolveActiveMembershipId();

    // The key is generated HERE, from an opaque factory, so a caller cannot
    // choose it and cannot predict another tenant's.
    const storageKey = createOpaqueStorageKey(STORAGE_KEY_PREFIXES.importArtefact);

    await this.storage.put({
      key: storageKey,
      body: artefact.buffer,
      contentType: artefact.contentType,
      // No personal data and no key: the entity kind and the tenant it belongs to.
      metadata: { tenantId, entity: artefact.entity },
    });

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await this.repository.create(
          {
            entity: artefact.entity,
            storageKey,
            contentType: artefact.contentType,
            byteSize: artefact.byteSize,
            createdByMembershipId,
            artefactExpiresAt: new Date(Date.now() + IMPORT_ARTEFACT_TTL_MS),
          },
          tx
        );

        await this.audit.append(
          {
            action: IMPORT_UPLOADED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: IMPORT_TARGET_TYPE,
            targetId: created.id,
            metadata: {
              schemaVersion: 1,
              entity: created.entity,
              contentType: created.contentType,
              byteSize: created.byteSize,
            },
          },
          tx
        );

        return created;
      });

      return toImportUploadResponse(row);
    } catch (error) {
      // The transaction rolled back, so the bytes are now unreferenced. Removing
      // them keeps a failed upload from leaking storage; a failed cleanup is not
      // worth failing the request twice over.
      await this.storage.delete({ key: storageKey }).catch(() => {
        // Unreferenced object; a background reconciler may collect it.
      });
      throw error;
    }
  }

  /**
   * The caller tenant's imports, newest first, as a bounded page.
   *
   * The bound was validated at the request contract ([[TD-026]]), so this method
   * never truncates silently: a caller asking for more than the ceiling is
   * refused there, not given a shorter list here.
   */
  async list(limit: number): Promise<ImportJobResponse[]> {
    await this.requirePermission(IMPORTS_PERMISSIONS.read);
    const rows = await this.repository.list(limit);
    return rows.map(toImportJobResponse);
  }

  /** One import of the caller's tenant. A foreign or unknown id is the shared `404`. */
  async getById(id: string): Promise<ImportJobResponse> {
    await this.requirePermission(IMPORTS_PERMISSIONS.read);
    return toImportJobResponse(await this.repository.findById(id));
  }

  /**
   * `UPLOADED → PREVIEWING`. The work behind the phase belongs to [[IMP-002]]:
   * this command records that it started, and refuses — with the stable `409` —
   * if the import is anywhere else.
   */
  async startPreview(id: string): Promise<ImportJobResponse> {
    return this.transitionOrConflict(id, IMPORT_PREVIEWING_ACTION, (target, tx) =>
      this.repository.startPreview(target, tx)
    );
  }

  /** `PREVIEWING → PREVIEWED`, stamping the instant the preview finished. */
  async completePreview(id: string): Promise<ImportJobResponse> {
    return this.transitionOrConflict(id, IMPORT_PREVIEWED_ACTION, (target, tx) =>
      this.repository.completePreview(target, tx)
    );
  }

  /** `PREVIEWED → COMMITTING`. The work behind the phase belongs to [[IMP-003]]. */
  async startCommit(id: string): Promise<ImportJobResponse> {
    return this.transitionOrConflict(id, IMPORT_COMMITTING_ACTION, (target, tx) =>
      this.repository.startCommit(target, tx)
    );
  }

  /**
   * `COMMITTING → COMMITTED` with the three counters, then the artefact is
   * deleted: a finished import needs neither its file nor a way back to it.
   */
  async completeCommit(id: string, counters: ImportCommitCounters): Promise<ImportJobResponse> {
    return this.transitionOrConflict(
      id,
      IMPORT_COMMITTED_ACTION,
      (target, tx) => this.repository.completeCommit(target, counters, tx),
      { deleteArtefact: true }
    );
  }

  /**
   * → `FAILED` from either work phase, with a bounded reason, then the artefact
   * is deleted: the rows a failed import did not commit cannot be re-driven from
   * it, and keeping a tenant's customer list past the failure serves nobody.
   */
  async fail(id: string, failureReason: string): Promise<ImportJobResponse> {
    return this.transitionOrConflict(
      id,
      IMPORT_FAILED_ACTION,
      (target, tx) => this.repository.fail(target, failureReason, tx),
      { deleteArtefact: true }
    );
  }

  /**
   * → `EXPIRED` from any non-terminal state, then the artefact is deleted. This is
   * the addressed form of the TTL sweep; {@link sweepOverdueArtefacts} is the
   * batch form.
   */
  async expire(id: string): Promise<ImportJobResponse> {
    return this.transitionOrConflict(
      id,
      IMPORT_EXPIRED_ACTION,
      (target, tx) => this.repository.expire(target, tx),
      { deleteArtefact: true }
    );
  }

  /**
   * Deletes the stored artefact and stamps `artefactDeletedAt`. IDEMPOTENT.
   *
   * Two mechanisms make that true rather than hoped for: the storage port's
   * `delete` is idempotent by contract, and the stamp is a compare-and-set on
   * `artefact_deleted_at IS NULL`. So a second call — a replay, a sweep that
   * overlaps a commit, an operator retry — deletes nothing twice and reports
   * `{ deleted: false }`, which is the honest answer to "was there anything left
   * to do". The key is read from the row and used here and nowhere else.
   */
  async deleteArtefact(importId: string): Promise<{ deleted: boolean }> {
    const row = await this.repository.findById(importId);

    if (row.artefactDeletedAt !== null) {
      return { deleted: false };
    }

    await this.storage.delete({ key: row.storageKey });
    return { deleted: await this.repository.markArtefactDeleted(importId) };
  }

  /**
   * The TTL sweep: one bounded pass over the caller tenant's overdue artefacts.
   *
   * A row is due when its deadline has passed AND the object has not been
   * deleted, whatever its state — which covers BOTH cases the acceptance
   * criterion names: the import that never reached a terminal state (it is
   * expired here) and the finished import whose deletion failed earlier (only the
   * delete is retried). Each row is handled independently: one unreachable object
   * is counted as `failed` and retried by the next pass instead of aborting the
   * batch.
   *
   * It is TENANT-scoped like every other query in this module, because the
   * repository's whole contract is an implicit tenant predicate. A platform-wide
   * sweep is therefore the worker's job (iterate tenants, or use its own
   * cross-tenant seam); IMP-001 ships the mechanism, not a scheduler.
   */
  async sweepOverdueArtefacts(now: Date = new Date()): Promise<ImportSweepResult> {
    const due = await this.repository.findOverdue(now, IMPORT_SWEEP_BATCH_SIZE);

    let expired = 0;
    let deleted = 0;
    let failed = 0;

    for (const row of due) {
      try {
        if (!isTerminal(row.state)) {
          const changed = await this.applyTransition(row.id, IMPORT_EXPIRED_ACTION, (target, tx) =>
            this.repository.expire(target, tx)
          );
          if (changed) {
            expired += 1;
          }
        }
        const removal = await this.deleteArtefact(row.id);
        if (removal.deleted) {
          deleted += 1;
        }
      } catch {
        // A single unreachable object must not abort the batch: the stamp is not
        // written, so the next pass sees the row again and retries it.
        failed += 1;
      }
    }

    return { expired, deleted, failed };
  }

  /**
   * Reads first, then transitions, then co-commits the audit row, then deletes the
   * artefact when the new state is terminal.
   *
   * The pre-read is what separates the two refusals a caller can deserve: an
   * unknown or FOREIGN import is the shared `404` (the tenant predicate rides in
   * the same WHERE clause), while a well-known import in the wrong state is the
   * stable `409`. The conditional write behind it is what makes the `409` true
   * under concurrency — a replay or a lost race matches zero rows.
   */
  private async transitionOrConflict(
    id: string,
    action: string,
    transition: ImportTransition,
    options: { deleteArtefact?: boolean } = {}
  ): Promise<ImportJobResponse> {
    const changed = await this.applyTransition(id, action, transition);

    if (!changed) {
      throw new DomainError("CONFLICT", IMPORT_TRANSITION_CONFLICT_MESSAGE);
    }

    if (options.deleteArtefact === true) {
      // After the state is committed, never inside it: the object delete is an
      // external call and the terminal state is already the authoritative fact.
      await this.deleteArtefact(id);
    }

    return this.getById(id);
  }

  /**
   * The transaction every command shares: the conditional transition and its
   * audit row commit together, so a state change without its trail cannot happen.
   * `metadata.fromState` records the state the command OBSERVED — the conditional
   * write is the authority, and the observation is there because "failed from
   * PREVIEWING" is the question an operator asks.
   */
  private async applyTransition(
    id: string,
    action: string,
    transition: ImportTransition
  ): Promise<boolean> {
    const tenantId = this.requestContext.requireTenantId();
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    return this.prisma.$transaction(async (tx) => {
      const current = await this.repository.findById(id, tx);
      const changed = await transition(current.id, tx);

      if (!changed) {
        return false;
      }

      await this.audit.append(
        {
          action,
          tenantId,
          actorUserProfileId,
          targetType: IMPORT_TARGET_TYPE,
          targetId: current.id,
          metadata: { schemaVersion: 1, fromState: current.state, entity: current.entity },
        },
        tx
      );

      return true;
    });
  }

  /** Defense in depth behind `@RequirePermissions`: a denial reaches no query. */
  private async requirePermission(key: string): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(key)) {
      throw new DomainError("FORBIDDEN", IMPORT_PERMISSION_DENIED_MESSAGE);
    }
  }
}
