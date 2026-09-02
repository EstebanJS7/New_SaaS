import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/** Actor taxonomy pinned by design D9 / schema enum audit_actor_type. */
export type AuditActorType = "STAFF" | "SYSTEM";

/**
 * Append payload. `action` MUST be "domain.event" shaped (e.g. "auth.login");
 * metadata is caller-sanitized — CONFIDENTIAL/RESTRICTED material never
 * enters this object (engineering rules: Data Classification).
 */
export interface AuditAppendInput {
  readonly action: string;
  readonly actorType?: AuditActorType;
  /** Owning tenant for tenant-scoped events; null/omitted for system-wide. */
  readonly tenantId?: string;
  /** Acting staff profile; omitted for SYSTEM rows. */
  readonly actorUserProfileId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Sanitized event payload; defaults to the empty object. */
  readonly metadata?: Record<string, unknown>;
}

export interface AuditAppendedRow {
  id: string;
  action: string;
  actorType: AuditActorType;
}

const appendInputSchema = z.object({
  // domain.event form: lowercase/underscored domain and event.
  action: z.string().regex(/^[a-z_]+\.[a-z_]+$/, 'action must be "domain.event" shaped'),
  actorType: z.enum(["STAFF", "SYSTEM"]).optional(),
  tenantId: z.string().uuid().optional(),
  actorUserProfileId: z.string().uuid().optional(),
  targetType: z.string().min(1).max(128).optional(),
  targetId: z.string().min(1).max(256).optional(),
  // JSON-safe object: jsonb storage rejects anything that cannot survive
  // serialization, so it is rejected HERE rather than at write time.
  metadata: z
    .record(z.unknown())
    .optional()
    .refine((value) => value === undefined || isJsonSafe(value), {
      message: "metadata must be JSON-encodable",
    }),
});

/** Recursive JSON-value check (functions, undefined, cycles ⇒ rejected). */
function isJsonSafe(value: unknown, seen = new Set<unknown>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false; // circular reference
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.values(value);
  return values.every((entry) => isJsonSafe(entry, seen));
}

/** Structural delegate contract (generated client and test fakes alike). */
export interface AuditLogDelegate {
  create: (args: {
    data: {
      action: string;
      actorType: AuditActorType;
      metadata: Record<string, unknown>;
      tenantId?: string;
      actorUserProfileId?: string;
      targetType?: string;
      targetId?: string;
      requestId?: string;
    };
  }) => Promise<{ id: string }>;
}

/**
 * Transactional append target — anything exposing an auditLog writer that can
 * accept our row payload (the generated `Prisma.TransactionClient` and the
 * in-memory test fake alike).
 *
 * `create` is declared with METHOD syntax deliberately: TypeScript compares
 * method parameters BIVARIANTLY, so the generated client's overloaded generic
 * create stays assignable here without casts, while property-syntax function
 * types (strictFunctionTypes contravariance) would reject it over jsonb
 * metadata input types.
 */
export interface AuditAppendTx {
  auditLog: {
    create(args: {
      data: {
        action: string;
        actorType: AuditActorType;
        metadata: unknown;
        tenantId?: string;
        actorUserProfileId?: string;
        targetType?: string;
        targetId?: string;
        requestId?: string;
      };
    }): Promise<{ id: string }>;
  };
}

/**
 * The ONLY sanctioned writer for `audit_log` (design D9).
 *
 * Append-only by construction: this class exposes `append()` and NOTHING
 * else — no update, no delete, no list. Immutability is a service-contract
 * property, proven by tests that enumerate the public surface and pin
 * append-then-read integrity. Rows are written exactly once; corrections are
 * new compensating events, never edits (engineering rules: Reversals).
 *
 * Fail-closed semantics: append errors PROPAGATE. Callers that must not
 * complete an operation without its audit trail (auth events) therefore get
 * audit-or-nothing behavior instead of silent gaps.
 */
@Injectable()
export class AuditWriter {
  constructor(
    // Explicit @Inject tokens keep DI resolution token-based while the PARAM
    // TYPE stays the narrow append-only contract the service actually needs
    // (update/delete surfaces are unreachable here by construction).
    @Inject(PrismaService) private readonly prisma: { auditLog: AuditAppendTx["auditLog"] },
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Writes one immutable audit row. The request id is filled server-side from
   * RequestContextService — callers cannot spoof correlation, and outside a
   * request scope (bootstrap/jobs) a generated UUID keeps rows traceable.
   *
   * `tx` joins the append to the CALLER'S transaction (review WARNING-1):
   * mutation flows pass their open `$transaction` handle so the audit row
   * commits atomically with — or rolls back together with — the mutation it
   * describes. A mutation without its trail becomes structurally impossible:
   * an append failure aborts the whole transaction instead of leaving a
   * committed write unaudited.
   */
  async append(input: AuditAppendInput, tx?: AuditAppendTx): Promise<AuditAppendedRow> {
    const parsed = appendInputSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path?.join(".") ?? "input";
      throw new DomainError(
        "VALIDATION_FAILED",
        `Audit append rejected: ${where}: ${first?.message ?? "invalid input"}.`
      );
    }

    const actorType: AuditActorType =
      parsed.data.actorType ??
      // Default derivation: attributed staff events vs unattributed system
      // events mirror the schema's column comments (design D9).
      (parsed.data.actorUserProfileId !== undefined ? "STAFF" : "SYSTEM");

    const writer = tx ?? this.prisma;
    const row = await writer.auditLog.create({
      data: {
        action: parsed.data.action,
        actorType,
        metadata: parsed.data.metadata ?? {},
        ...(parsed.data.tenantId !== undefined && { tenantId: parsed.data.tenantId }),
        ...(parsed.data.actorUserProfileId !== undefined && {
          actorUserProfileId: parsed.data.actorUserProfileId,
        }),
        ...(parsed.data.targetType !== undefined && { targetType: parsed.data.targetType }),
        ...(parsed.data.targetId !== undefined && { targetId: parsed.data.targetId }),
        requestId: this.requestContext.getRequestId(),
      },
    });

    return { id: row.id, action: parsed.data.action, actorType };
  }
}
