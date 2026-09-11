import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService, appendAuditLog, type AuditAppendTx } from "@newsaas/database";
import { STORAGE_PORT, type StoragePort } from "@newsaas/storage";
import { resolveMaxAttempts } from "./cleanup.constants.js";

/** Durable cleanup status values (mirrors the Prisma enum). */
export type BrandingResetCleanupStatus = "PENDING" | "COMPLETED" | "DEAD_LETTER";

/** Intent row shape the handler reads. */
export interface CleanupIntentRecord {
  id: string;
  tenantId: string;
  storageKeys: string[];
  status: BrandingResetCleanupStatus;
  attempts: number;
}

/**
 * Narrow, tenant-safe intent delegate. `findFirst` is scoped by id and,
 * optionally, by an expected tenant; every mutating call is guarded by the
 * loaded row's own `tenantId` and `PENDING` status so a replay or a foreign
 * row can never be mutated.
 */
export interface CleanupIntentDelegate {
  findFirst(args: {
    where: { id: string; tenantId?: string };
  }): Promise<CleanupIntentRecord | null>;
  updateMany(args: {
    where: { id: string; tenantId: string; status: BrandingResetCleanupStatus };
    data: {
      status?: BrandingResetCleanupStatus;
      attempts?: { increment: number };
      lastError?: string | null;
      completedAt?: Date | null;
    };
  }): Promise<{ count: number }>;
}

/** Transaction-scoped client: the same delegates are reachable inside `tx`. */
export interface CleanupTransactionClient extends AuditAppendTx {
  brandingResetCleanupIntent: CleanupIntentDelegate;
}

/** Prisma surface the handler depends on (intent delegate + audit append). */
export interface CleanupHandlerPrisma extends CleanupTransactionClient {
  /**
   * Interactive transaction runner. Every terminal status transition and the
   * SYSTEM audit that documents it are committed together, so a crash or audit
   * failure can never leave a `COMPLETED`/`DEAD_LETTER` intent without its
   * audit row (or vice versa).
   */
  $transaction: <R>(work: (tx: CleanupTransactionClient) => Promise<R>) => Promise<R>;
}

export interface CleanupHandlerOptions {
  readonly maxAttempts: number;
}

export type CleanupOutcome = "completed" | "already_completed" | "not_found" | "skipped";

const MAX_LAST_ERROR_LENGTH = 300;

/** Collapses and truncates an error for `last_error` / audit metadata. */
export function sanitizeCleanupError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const singleLine = message.replace(/\s+/g, " ").trim();
  return singleLine.length > 0 ? singleLine.slice(0, MAX_LAST_ERROR_LENGTH) : "cleanup failed";
}

/**
 * Durable, idempotent, tenant-safe retirer of reset-disconnected storage
 * objects.
 *
 * - Loads the intent by id (and, when supplied, by tenant) and never trusts
 *   keys from the queue payload — only the captured `storageKeys` are deleted.
 * - `StoragePort.delete` is idempotent, so a replayed job is harmless.
 * - Completion is a guarded `PENDING -> COMPLETED` transition; the winning
 *   transition writes exactly one SYSTEM success audit.
 * - A storage failure increments `attempts` and records a sanitized
 *   `lastError`; reaching the bound moves the intent to `DEAD_LETTER` and
 *   writes one SYSTEM failure audit. The error is rethrown so BullMQ retries
 *   within its own bounded attempts. Failures are never silently swallowed.
 */
@Injectable()
export class BrandingResetCleanupHandler {
  private readonly maxAttempts: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: CleanupHandlerPrisma,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Optional() options?: CleanupHandlerOptions
  ) {
    this.maxAttempts = options?.maxAttempts ?? resolveMaxAttempts();
  }

  async handle(intentId: string, tenantId?: string): Promise<CleanupOutcome> {
    const intent = await this.prisma.brandingResetCleanupIntent.findFirst({
      where: tenantId === undefined ? { id: intentId } : { id: intentId, tenantId },
    });

    if (intent === null) {
      // Unknown or foreign intent: nothing to do, nothing deleted.
      return "not_found";
    }
    if (intent.status !== "PENDING") {
      // COMPLETED replay or terminal DEAD_LETTER: terminal states are final.
      return "skipped";
    }

    try {
      for (const key of intent.storageKeys) {
        await this.storage.delete({ key });
      }
    } catch (error) {
      await this.recordFailure(intent, error);
      throw error;
    }

    // Terminal transition + SYSTEM audit commit atomically: either the intent
    // becomes COMPLETED with exactly one `storage_retired` audit, or neither
    // happens and the PENDING intent is retried.
    return this.prisma.$transaction(async (tx) => {
      const completion = await tx.brandingResetCleanupIntent.updateMany({
        where: { id: intent.id, tenantId: intent.tenantId, status: "PENDING" },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });

      if (completion.count !== 1) {
        // A concurrent worker/retry already completed the guarded transition:
        // do NOT write a second success audit.
        return "already_completed";
      }

      await appendAuditLog(tx, {
        action: "branding.reset.storage_retired",
        actorType: "SYSTEM",
        tenantId: intent.tenantId,
        targetType: "branding_reset_cleanup_intent",
        targetId: intent.id,
        metadata: {
          storageKeyCount: intent.storageKeys.length,
          attempts: intent.attempts + 1,
        },
      });
      return "completed";
    });
  }

  private async recordFailure(intent: CleanupIntentRecord, error: unknown): Promise<void> {
    const attempts = intent.attempts + 1;
    const terminal = attempts >= this.maxAttempts;
    const lastError = sanitizeCleanupError(error);

    // The attempt increment (and, at the bound, the DEAD_LETTER transition)
    // commits together with its terminal failure audit. A non-terminal attempt
    // increment writes no audit and needs no transaction boundary beyond the
    // guarded update itself.
    await this.prisma.$transaction(async (tx) => {
      const failure = await tx.brandingResetCleanupIntent.updateMany({
        where: { id: intent.id, tenantId: intent.tenantId, status: "PENDING" },
        data: {
          attempts: { increment: 1 },
          lastError,
          ...(terminal ? { status: "DEAD_LETTER" } : {}),
        },
      });

      if (terminal && failure.count === 1) {
        await appendAuditLog(tx, {
          action: "branding.reset.storage_cleanup_failed",
          actorType: "SYSTEM",
          tenantId: intent.tenantId,
          targetType: "branding_reset_cleanup_intent",
          targetId: intent.id,
          metadata: { attempts, lastError },
        });
      }
    });
  }
}
