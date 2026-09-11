import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService, appendAuditLog } from "@newsaas/database";
import type {
  AuditActorType,
  AuditAppendInput,
  AuditAppendedRow,
  AuditAppendTx,
  AuditLogDelegate,
} from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";

// Re-exported so existing API callers keep importing the audit contract from
// this boundary; the implementation now lives in `@newsaas/database` so the
// worker can append SYSTEM rows without a second writer.
export type { AuditActorType, AuditAppendInput, AuditAppendedRow, AuditAppendTx, AuditLogDelegate };

/**
 * The ONLY sanctioned request-scoped writer for `audit_log` (design D9).
 *
 * Append-only by construction: this class exposes `append()` and NOTHING
 * else — no update, no delete, no list. Immutability is a service-contract
 * property, proven by tests that enumerate the public surface and pin
 * append-then-read integrity. Rows are written exactly once; corrections are
 * new compensating events, never edits (engineering rules: Reversals).
 *
 * The append primitive itself is `@newsaas/database`'s `appendAuditLog`; this
 * façade supplies server-owned request correlation so callers cannot spoof it.
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
    return appendAuditLog(tx ?? this.prisma, input, this.requestContext.getRequestId());
  }
}
