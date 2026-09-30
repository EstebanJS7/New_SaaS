import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
// Value imports (not `import type`): `PrismaService` is the DI token and
// `Prisma` provides the exact `Decimal` used to render the fixed-scale
// projection.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type {
  CashMovementResponse,
  CashRegisterResponse,
  CashSessionResponse,
} from "./cash.dto.js";
import { CASH_PERMISSIONS, type CashPermission } from "./cash.permissions.js";
import {
  CashRepository,
  type CashMovementDirectionValue,
  type CashMovementRow,
  type CashMovementTypeValue,
  type CashRegisterRow,
  type CashSessionListFilters,
  type CashSessionRow,
  type CashTx,
} from "./cash.repository.js";
import {
  CASH_DTO_SCHEMA_VERSION,
  CASH_MOVEMENT_REASON_REQUIRED_TYPES,
  cashMovementIdempotencyKey,
  type CreateCashMovementInput,
  type CreateCashRegisterInput,
  type OpenCashSessionInput,
} from "./cash.zod.js";

/**
 * Everything the audited cash mutation closure needs from its transaction
 * handle. Declared structurally (not as `Prisma.TransactionClient`) so the real
 * client and the shared in-memory boundary both satisfy it: the register,
 * session and movement delegates reach the tenant-safe repository seam and
 * `auditLog` the append-only {@link AuditWriter}, so the cash change and its
 * audit row commit atomically.
 */
export type CashWriteTx = CashTx & { auditLog: AuditAppendTx["auditLog"] };

export interface CashPrisma {
  $transaction: <T>(work: (tx: CashWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Audit action codes for the three cash mutations. The repository's established
 * shape is `<singular_entity_snake>.<past_verb>`, so `targetType` matches the
 * entity the row was written for. Reads are never audited.
 */
export const CASH_REGISTER_CREATED_ACTION = "cash.register.created";
export const CASH_SESSION_OPENED_ACTION = "cash.session.opened";
export const CASH_REGISTER_TARGET_TYPE = "cash_register";
export const CASH_SESSION_TARGET_TYPE = "cash_session";

/**
 * Stable `403 FEATURE_NOT_ENTITLED` message for a tenant without the `cash`
 * capability (DEC-026 subsequent-scope note of 2026-09-29). The entitlement is
 * asserted BEFORE the granular permission, over the whole surface including
 * reads, exactly as the clinical, patients and sales modules do.
 */
export const CASH_FEATURE_NOT_ENTITLED_MESSAGE = "Cash features are not enabled for this tenant.";

/**
 * Stable `409 CONFLICT` message for a register create whose tenant-scoped name
 * already exists. Value-free by design: the name is INTERNAL and the response
 * never echoes it back.
 */
export const CASH_REGISTER_NAME_CONFLICT_MESSAGE =
  "A cash register with this name already exists in this tenant.";

/**
 * Stable `409 CONFLICT` message for a session open against a register that
 * already has an `OPEN` session. Produced by translating the partial unique
 * index violation `cash_session_one_open_per_register_key`; there is NO
 * service-level pre-check, so the rule is enforced by the database rather than
 * by application convention.
 */
export const CASH_SESSION_ALREADY_OPEN_MESSAGE = "This cash register already has an open session.";

/**
 * Stable `409 CONFLICT` message for a standalone movement targeting a session
 * that is not `OPEN`. The request is well formed and the session exists IN the
 * caller's tenant — its own lifecycle forbids the command, so this is `409` (the
 * scheduling/appointment illegal-state convention), never a `404` (which would
 * mask a real session) and never a `400` malformed input.
 */
export const CASH_SESSION_NOT_OPEN_MESSAGE = "This cash session is not open.";

/** Stable `409` when a reused key carried a DIFFERENT request (DEC-024). */
export const CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE =
  "The Idempotency-Key was already used for a different request.";

/** Stable `400` when the required `Idempotency-Key` is missing or unusable. */
export const CASH_IDEMPOTENCY_KEY_REQUIRED_MESSAGE = "An Idempotency-Key header is required.";

/** Namespace separating this id derivation from every other UUID source. */
const CASH_MOVEMENT_ID_NAMESPACE = "cash-movement-idempotency";

/** Deterministic movement UUID from `(tenant, key)`: the movement's PRIMARY KEY
 * is the idempotency guarantee, and the RFC 4122 nibbles keep it a valid `UUID`. */
function movementIdempotencyId(tenantId: string, idempotencyKey: string): string {
  const hex = createHash("sha256")
    .update(`${tenantId}:${CASH_MOVEMENT_ID_NAMESPACE}:${idempotencyKey}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** True for the movement PRIMARY KEY collision of a concurrent retry. */
function isMovementIdConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Audit action code for the standalone movement command. The repository's
 * established shape is `<singular_entity_snake>.<past_verb>`, so `targetType`
 * matches the ledger entity the row was written for.
 */
export const CASH_MOVEMENT_CREATED_ACTION = "cash.movement.created";
export const CASH_MOVEMENT_TARGET_TYPE = "cash_movement";

/**
 * Exact trigger function/constraint behind the closed-session INSERT guard:
 * `cash_movement_no_insert_into_closed_session` in the
 * `20260930000001_cash_data_foundation` migration. It raises SQLSTATE
 * `restrict_violation` (`23001`) with the message below.
 */
const CASH_MOVEMENT_CLOSED_SESSION_FUNCTION = "cash_movement_no_insert_into_closed_session";
const CASH_MOVEMENT_CLOSED_SESSION_SQLSTATE = "23001";
const CASH_MOVEMENT_CLOSED_SESSION_DETAIL =
  "a cash movement cannot be inserted into a closed session";

/**
 * Strings Prisma can surface for a server-side rejection, checked shape-agnostically:
 * the client-wrapped `code`, the wrapper `message`, and the server's SQLSTATE
 * and message carried in `meta`. Mirrors the unique-target matcher's tolerance
 * for provider/engine-dependent error shapes.
 */
function closedSessionTriggerSignals(error: unknown): string[] {
  if (typeof error !== "object" || error === null) {
    return [];
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  return [candidate.code, candidate.message, candidate.meta?.code, candidate.meta?.message].filter(
    (signal): signal is string => typeof signal === "string"
  );
}

/**
 * True only for the closed-session INSERT trigger rejection, so the stable `409`
 * is surfaced instead of leaking the raw database error as an INTERNAL `500`.
 * The service pre-checks the session status inside the transaction; this
 * translation is the CONCURRENCY backstop for a session that closes between the
 * read and the insert, when only PostgreSQL can refuse the row.
 */
function isCashMovementIntoClosedSession(error: unknown): boolean {
  return closedSessionTriggerSignals(error).some(
    (signal) =>
      signal.includes(CASH_MOVEMENT_CLOSED_SESSION_FUNCTION) ||
      signal.includes(CASH_MOVEMENT_CLOSED_SESSION_SQLSTATE) ||
      signal.includes(CASH_MOVEMENT_CLOSED_SESSION_DETAIL)
  );
}

/**
 * Exact unique index behind the per-tenant register name rule:
 * `CREATE UNIQUE INDEX "cash_register_tenant_id_name_key" ON
 * "cash_register"("tenant_id", "name")` in the `20260927000002_cash_foundation`
 * migration.
 */
const CASH_REGISTER_NAME_CONSTRAINT = "cash_register_tenant_id_name_key";

/** The register-name index columns/fields, normalized once for shape-agnostic matching. */
const CASH_REGISTER_NAME_FIELDS: readonly string[] = ["tenantid", "name"];

/**
 * Exact partial unique index behind the one-OPEN-session rule:
 * `CREATE UNIQUE INDEX "cash_session_one_open_per_register_key" ON
 * "cash_session"("tenant_id", "register_id") WHERE "status" = 'OPEN'`. The
 * `WHERE` predicate is why the index cannot be expressed in the Prisma schema
 * and lives as raw SQL in the same migration.
 */
const CASH_SESSION_ONE_OPEN_CONSTRAINT = "cash_session_one_open_per_register_key";

/** The one-OPEN index columns/fields, normalized once for shape-agnostic matching. */
const CASH_SESSION_ONE_OPEN_FIELDS: readonly string[] = ["tenantid", "registerid"];

function normalizeUniqueTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True only for a `P2002` raised by the exact index named by `constraint`, with
 * the exact column/field set `fields` — never for an unrelated `P2002` such as a
 * `(tenant_id, id)` ownership key, which must propagate untouched.
 *
 * Prisma reports `meta.target` in provider/engine-dependent shapes: the violated
 * index name (as a string or single-element array) or the violated column names
 * (mapped or field names). Both shapes are recognized; anything else is not this
 * boundary's index. The supplier tax-id matcher is the precedent.
 */
function matchesUniqueTarget(
  target: unknown,
  constraint: string,
  fields: readonly string[]
): boolean {
  const expectedConstraint = normalizeUniqueTargetToken(constraint);

  if (typeof target === "string") {
    return normalizeUniqueTargetToken(target) === expectedConstraint;
  }
  if (!Array.isArray(target)) {
    return false;
  }

  const tokens = target.filter((entry): entry is string => typeof entry === "string");
  if (tokens.length === 0) {
    return false;
  }

  // Index/constraint-name shape, e.g. `["cash_register_tenant_id_name_key"]`.
  if (tokens.length === 1 && normalizeUniqueTargetToken(tokens[0]) === expectedConstraint) {
    return true;
  }

  // Column/field shape (order is not guaranteed), e.g. `["tenant_id", "name"]`
  // or `["tenantId", "name"]`.
  const normalized = tokens.map(normalizeUniqueTargetToken);
  return normalized.length === fields.length && fields.every((field) => normalized.includes(field));
}

/** True only for a `P2002` raised by the register-name index. */
function isCashRegisterNameConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return (
    candidate.code === "P2002" &&
    matchesUniqueTarget(
      candidate.meta?.target,
      CASH_REGISTER_NAME_CONSTRAINT,
      CASH_REGISTER_NAME_FIELDS
    )
  );
}

/** True only for a `P2002` raised by the partial one-OPEN-session index. */
function isCashSessionAlreadyOpen(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return (
    candidate.code === "P2002" &&
    matchesUniqueTarget(
      candidate.meta?.target,
      CASH_SESSION_ONE_OPEN_CONSTRAINT,
      CASH_SESSION_ONE_OPEN_FIELDS
    )
  );
}

/**
 * Audit field NAMES for a register create. `changedFields` carries NAMES only:
 * the register name is INTERNAL, so no stored value is copied into the trail.
 * `isActive` is deliberately absent because it is a server-owned schema default,
 * not a supplied field (the sale create omits its `status` default the same way).
 */
const CASH_REGISTER_CREATE_CHANGED_FIELDS: readonly string[] = ["name"];

/**
 * Audit field NAMES for a session open, in payload order. Only fields the
 * accepted payload actually supplied are named: `status` and `openedAt` are
 * server defaults and the opener is already the audit row's
 * `actorUserProfileId`, so neither `status` nor `openedByMembershipId` names a
 * caller-supplied field.
 */
const CASH_SESSION_OPEN_CHANGED_FIELDS: readonly string[] = ["registerId", "openingAmount"];

/** Fixed scale of the opening amount in digits after the point (`Decimal(14, 2)`). */
const CASH_MONEY_SCALE = 2;

/** Exact `Decimal` → fixed-scale string projection (never a JavaScript float). */
function decimalToScaleString(value: Prisma.Decimal | string, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}

/** Maps one register row to its allowlisted INTERNAL response DTO. */
function toCashRegisterResponse(row: CashRegisterRow): CashRegisterResponse {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps one session row to its allowlisted INTERNAL response DTO. */
function toCashSessionResponse(row: CashSessionRow): CashSessionResponse {
  return {
    id: row.id,
    registerId: row.registerId,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    openedByMembershipId: row.openedByMembershipId,
    openingAmount: decimalToScaleString(row.openingAmount, CASH_MONEY_SCALE),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Maps one immutable movement row to its allowlisted INTERNAL DTO. The `amount`
 * is projected at the column scale and keeps its POSITIVE sign (the type owns
 * the sign, DEC-030); `direction` is `null` for every type-owned kind.
 */
function toCashMovementResponse(row: CashMovementRow): CashMovementResponse {
  return {
    id: row.id,
    registerId: row.registerId,
    sessionId: row.sessionId,
    type: row.type as CashMovementResponse["type"],
    direction: row.direction,
    amount: decimalToScaleString(row.amount, CASH_MONEY_SCALE),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Audit field NAMES for a movement create, in payload order. `changedFields`
 * carries NAMES only: the session id, the amount and the operator's reason text
 * are INTERNAL and never enter the trail. `registerId` is absent because it is
 * derived server-side from the resolved session, not a supplied field.
 */
function cashMovementChangedFields(input: CreateCashMovementInput): string[] {
  const fields = ["sessionId", "type", "amount"];
  if (input.reason !== undefined) {
    fields.push("reason");
  }
  if (input.direction !== undefined) {
    fields.push("direction");
  }
  return fields;
}

/**
 * The command's reason rule, re-asserted in the service (DEC-032): every kind
 * but `INCOME` requires a non-blank reason. The request contract and the
 * database CHECK already enforce it; this guard keeps a direct service caller
 * from bypassing both.
 */
function assertMovementReason(type: CashMovementTypeValue, reason: string | null): void {
  const required = (CASH_MOVEMENT_REASON_REQUIRED_TYPES as readonly string[]).includes(type);
  if (required && (reason === null || reason.trim().length === 0)) {
    throw new DomainError("VALIDATION_FAILED", "A cash movement reason is required.");
  }
}

/**
 * The command's direction rule, re-asserted in the service (DEC-030): a
 * direction is required EXACTLY for `ADJUSTMENT` and forbidden for every other
 * kind. The request contract and the exclusive database CHECK already enforce
 * it; this guard keeps a direct service caller from bypassing both.
 */
function assertMovementDirection(
  type: CashMovementTypeValue,
  direction: CashMovementDirectionValue | null
): void {
  if (type === "ADJUSTMENT" && direction === null) {
    throw new DomainError("VALIDATION_FAILED", "An adjustment direction is required.");
  }
  if (type !== "ADJUSTMENT" && direction !== null) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "A direction is only allowed for an ADJUSTMENT movement."
    );
  }
}

/**
 * Cash application boundary (EPIC-12 POS-002, extended by EPIC-13 CASH-002): the
 * tenant-scoped read surface and the three audited mutations (register create,
 * session open, standalone movement create).
 *
 * - The `cash` entitlement is asserted FIRST (`403 FEATURE_NOT_ENTITLED`) and
 *   the route-level permission is RE-ASSERTED SECOND (`403 FORBIDDEN`), on EVERY
 *   method including reads (DEC-026). A denial reaches no data access, so nothing
 *   is persisted and no audit row is appended.
 * - Tenant identity comes exclusively from `RequestContextService`; every write
 *   goes through the tenant-safe {@link CashRepository}, so a foreign or unknown
 *   register or session is a byte-equivalent `404` through ONE shared message per
 *   resource.
 * - The session opener is the CALLER'S ACTIVE membership, resolved server-side
 *   from `(tenantId, userProfileId)` — never accepted from the body — so the
 *   composite `RESTRICT` foreign key's same-tenant guarantee is satisfied by an
 *   identity the caller could not choose.
 * - "Only one OPEN session per register" is a DATABASE property: the service
 *   performs NO pre-check and translates the partial unique index violation
 *   `cash_session_one_open_per_register_key` into the stable `409 CONFLICT`.
 *   Any unrelated `P2002` is rethrown untouched.
 * - Every mutation appends exactly ONE audit row through {@link AuditWriter},
 *   INSIDE the same transaction as the cash change, carrying stable ids and field
 *   NAMES only. Reads are never audited. No cash event is emitted.
 * - This boundary is INERT with respect to the rest of the system: a movement
 *   create writes exactly one `cash_movement` row and one audit row, and nothing
 *   else — no session close, no sale, no payment, no stock movement, no balance
 *   change and no invoice (POS-003 owns the sale-generated `SALE` movement,
 *   CASH-003 owns close).
 * - There is NO delete operation, NO `PATCH` and NO status transition anywhere on
 *   this boundary.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly cash: CashRepository,
    @Inject(PrismaService) private readonly prisma: CashPrisma,
    private readonly entitlements: EntitlementsService,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver,
    private readonly audit: AuditWriter
  ) {}

  /** The caller tenant's registers, newest first. */
  async listRegisters(): Promise<CashRegisterResponse[]> {
    await this.assertCashEnabled();
    await this.requirePermission(CASH_PERMISSIONS.read);
    const rows = await this.cash.listRegisters();
    return rows.map(toCashRegisterResponse);
  }

  /**
   * The caller tenant's sessions, newest first, optionally narrowed by status.
   * An omitted filter applies NO implicit default.
   */
  async listSessions(filters: CashSessionListFilters = {}): Promise<CashSessionResponse[]> {
    await this.assertCashEnabled();
    await this.requirePermission(CASH_PERMISSIONS.read);
    const rows = await this.cash.listSessions(filters);
    return rows.map(toCashSessionResponse);
  }

  /**
   * Creates one in-tenant cash register and co-commits its single audit row.
   *
   * The per-tenant name uniqueness is the migration's unique index, not a
   * service convention, so no pre-read is needed: a duplicate name makes the
   * index reject the write and that `P2002` becomes the stable `409 CONFLICT`,
   * while any other `P2002` is rethrown. The name bound is enforced by the
   * request contract before any write.
   */
  async createRegister(input: CreateCashRegisterInput): Promise<CashRegisterResponse> {
    const tenantId = await this.assertCashEnabled();
    await this.requirePermission(CASH_PERMISSIONS.createRegister);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await this.cash.createRegister({ name: input.name }, tx);

        await this.audit.append(
          {
            action: CASH_REGISTER_CREATED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: CASH_REGISTER_TARGET_TYPE,
            targetId: created.id,
            metadata: {
              schemaVersion: CASH_DTO_SCHEMA_VERSION,
              changedFields: [...CASH_REGISTER_CREATE_CHANGED_FIELDS],
            },
          },
          tx
        );

        return created;
      });

      return toCashRegisterResponse(row);
    } catch (error) {
      // The register-name unique index rejected a duplicate name for this
      // tenant: surface the stable 409 instead of leaking the raw P2002 as an
      // INTERNAL 500. Anything else (an unrelated P2002, the shared 404, an
      // audit failure) propagates unchanged.
      if (isCashRegisterNameConflict(error)) {
        throw new DomainError("CONFLICT", CASH_REGISTER_NAME_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Opens one session against an in-tenant register with the required opening
   * float and co-commits its single audit row.
   *
   * The register is resolved IN-TENANT inside the transaction BEFORE any write,
   * so a foreign or unknown register collapses to the shared register `404` and
   * the rollback leaves no session and no audit row behind. The opener is the
   * caller's own ACTIVE membership; the status is server-owned (`OPEN`); the
   * opening amount is already exact at scale 2, and a negative value was
   * rejected by the request contract before this method ran.
   *
   * A register that already has an `OPEN` session violates the partial unique
   * index and produces the stable `409 CONFLICT`. There is no service-level
   * pre-check, so a concurrent second open is rejected by PostgreSQL rather than
   * by application convention (PRD §20, DEC-020).
   */
  async openSession(input: OpenCashSessionInput): Promise<CashSessionResponse> {
    const tenantId = await this.assertCashEnabled();
    await this.requirePermission(CASH_PERMISSIONS.openSession);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Tenant-safe resolution: a foreign or unknown register is the shared 404.
        await this.cash.findRegisterById(input.registerId, tx);
        const openedByMembershipId = await this.cash.resolveActiveMembershipId(tx);

        const created = await this.cash.createSession(
          {
            registerId: input.registerId,
            openedByMembershipId,
            openingAmount: input.openingAmount,
          },
          tx
        );

        await this.audit.append(
          {
            action: CASH_SESSION_OPENED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: CASH_SESSION_TARGET_TYPE,
            targetId: created.id,
            metadata: {
              schemaVersion: CASH_DTO_SCHEMA_VERSION,
              changedFields: [...CASH_SESSION_OPEN_CHANGED_FIELDS],
            },
          },
          tx
        );

        return created;
      });

      return toCashSessionResponse(row);
    } catch (error) {
      // The partial one-OPEN-session index rejected a second open for this
      // register: surface the stable 409 instead of leaking the raw P2002 as an
      // INTERNAL 500. Anything else (an unrelated P2002, the shared 404, an
      // audit failure) propagates unchanged, and the transaction rollback leaves
      // the state untouched.
      if (isCashSessionAlreadyOpen(error)) {
        throw new DomainError("CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Creates one immutable standalone cash movement (EPIC-13 CASH-002) and
   * co-commits its single audit row.
   *
   * The session is resolved IN-TENANT inside the transaction BEFORE any write,
   * so a foreign or unknown `sessionId` collapses to the shared session `404`
   * and the rollback leaves no movement and no audit row behind — the same
   * byte-equivalent masking the sibling session-open route applies to a missing
   * register. The `registerId` is derived from the resolved session row and is
   * NEVER read from the request, so the caller cannot attribute cash to a
   * different drawer.
   *
   * The reason rule (DEC-032) and the `ADJUSTMENT`-only direction rule
   * (DEC-030) are re-asserted here as defense in depth because the in-memory
   * test boundary cannot enforce the database CHECKs that back them. A session
   * that is not `OPEN` is the stable `409 CONFLICT`, and the database's
   * closed-session INSERT trigger is translated to the same `409` so a session
   * that closes mid-command cannot leak a raw database error as a `500`.
   *
   * The movement is created POSITIVE — the type owns the sign — and the whole
   * operation is INERT with respect to Sales, stock and payments: it writes
   * exactly one `cash_movement` row and one audit row, and nothing else.
   */
  async createMovement(
    input: CreateCashMovementInput,
    idempotencyKeyHeader: unknown
  ): Promise<{ movement: CashMovementResponse; replay: boolean }> {
    const tenantId = await this.assertCashEnabled();
    await this.requirePermission(CASH_PERMISSIONS.createMovement);
    const actorUserProfileId = this.requestContext.requireUserProfileId();

    const reason = input.reason ?? null;
    const direction = input.direction ?? null;
    assertMovementReason(input.type, reason);
    assertMovementDirection(input.type, direction);

    const amount = decimalToScaleString(input.amount, CASH_MONEY_SCALE);
    let movementId: string | null = null;
    /** Replay the stored movement, or refuse a reused key with another request. */
    const replayOf = (prior: CashMovementRow) => {
      const sameRequest =
        prior.type === input.type &&
        decimalToScaleString(prior.amount, CASH_MONEY_SCALE) === amount &&
        prior.reason === (input.reason ?? null) &&
        prior.direction === (input.direction ?? null) &&
        prior.sessionId === input.sessionId;
      if (!sameRequest) {
        throw new DomainError("CONFLICT", CASH_IDEMPOTENCY_KEY_CONFLICT_MESSAGE);
      }
      return { movement: toCashMovementResponse(prior), replay: true };
    };

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Tenant-safe resolution: a foreign or unknown session is the shared 404.
        const session = await this.cash.findSessionById(input.sessionId, tx);

        // Mandatory (DEC-024), validated after the resource resolved.
        const parsedKey = cashMovementIdempotencyKey.safeParse(idempotencyKeyHeader);
        if (!parsedKey.success) {
          throw new DomainError("VALIDATION_FAILED", CASH_IDEMPOTENCY_KEY_REQUIRED_MESSAGE);
        }
        movementId = movementIdempotencyId(tenantId, parsedKey.data);

        // Recognized BEFORE the state gate: a replay outranks it.
        const prior = await this.cash.findMovementById(movementId, tx);
        if (prior !== null) {
          return replayOf(prior);
        }

        if (session.status !== "OPEN") {
          throw new DomainError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE);
        }

        const created = await this.cash.createMovement(
          {
            id: movementId,
            registerId: session.registerId,
            sessionId: session.id,
            type: input.type,
            amount,
            reason,
            direction,
          },
          tx
        );

        await this.audit.append(
          {
            action: CASH_MOVEMENT_CREATED_ACTION,
            tenantId,
            actorUserProfileId,
            targetType: CASH_MOVEMENT_TARGET_TYPE,
            targetId: created.id,
            metadata: {
              schemaVersion: CASH_DTO_SCHEMA_VERSION,
              changedFields: cashMovementChangedFields(input),
            },
          },
          tx
        );

        return { movement: toCashMovementResponse(created), replay: false };
      });

      return row;
    } catch (error) {
      // A concurrent retry lost the PRIMARY KEY race: the winner's row IS this
      // request's movement, so replay it rather than surface a database error.
      if (movementId !== null && isMovementIdConflict(error)) {
        const prior = await this.cash.findMovementById(movementId);
        if (prior !== null) {
          return replayOf(prior);
        }
      }
      // The closed-session INSERT trigger refused the row (a session closed
      // between the read and the insert): the same stable `409`, not a `500`.
      if (isCashMovementIntoClosedSession(error)) {
        throw new DomainError("CONFLICT", CASH_SESSION_NOT_OPEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Resolves the server-owned tenant and asserts the `cash` entitlement FIRST
   * (DEC-026). `FEATURE_NOT_ENTITLED` (403) is the only rejection path; no
   * generic feature guard is introduced, matching the clinical/branding/sales
   * copy.
   */
  private async assertCashEnabled(): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "cash"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", CASH_FEATURE_NOT_ENTITLED_MESSAGE);
    }
    return tenantId;
  }

  /**
   * Defense-in-depth permission gate applied AFTER the entitlement, for every
   * operation including reads. A missing permission is `403 FORBIDDEN` and
   * reaches no data access.
   */
  private async requirePermission(permission: CashPermission): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(permission)) {
      throw new DomainError("FORBIDDEN", "The required cash permission is missing.");
    }
  }
}
