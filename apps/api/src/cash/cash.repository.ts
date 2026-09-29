import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): `PrismaService` is the DI token, and
// `Prisma` provides the exact `Decimal` type of the opening amount.
import { Prisma, PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Lifecycle values pinned by schema enum `cash_session_status` (PRD §20). Kept
 * as a local literal union so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only). `OPEN` is the default a new
 * session takes; `CLOSED` is reachable only through the EPIC-13 close command.
 */
export type CashSessionStatusValue = "OPEN" | "CLOSED";

/**
 * Persistence row for a tenant-scoped cash register as the read boundary sees
 * it. There is deliberately no balance column: the register's expected amount is
 * derived from the immutable movement ledger, never mutated directly (PRD §20),
 * and no `branchId` exists (DEC-020).
 */
export interface CashRegisterRow {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence row for a tenant-scoped cash session. `openingAmount` is an exact
 * `Decimal(14, 2)` — `Prisma.Decimal` at runtime, a plain exact string in the
 * in-memory fake — and is NEVER coerced to a JavaScript float.
 * `openedByMembershipId` is the opener resolved server-side from the
 * authenticated request context (DEC-020 subsequent-scope note of 2026-09-29).
 */
export interface CashSessionRow {
  id: string;
  tenantId: string;
  registerId: string;
  status: CashSessionStatusValue;
  openedAt: Date;
  openedByMembershipId: string;
  openingAmount: Prisma.Decimal | string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Write payload for {@link CashRepository.createRegister}. There is deliberately
 * NO `tenantId` field: tenant identity comes from the request context, so a
 * caller argument cannot re-scope the register. No `isActive` field exists
 * either: a new register is active by the schema default.
 */
export interface CashRegisterCreateData {
  readonly name: string;
}

/**
 * Write payload for {@link CashRepository.createSession}. There is deliberately
 * NO `tenantId` field (resolved from the request context) and NO `status` field
 * (a new session is `OPEN`). `openedByMembershipId` is the server-resolved
 * caller membership, never caller input, and the amount is an exact fixed-scale
 * string validated by the request contract before it reaches this seam.
 */
export interface CashSessionCreateData {
  readonly registerId: string;
  readonly openedByMembershipId: string;
  readonly openingAmount: string;
}

/** Supported read filters for {@link CashRepository.listSessions}. */
export interface CashSessionListFilters {
  status?: CashSessionStatusValue;
}

/** Predicate fields the tenant-scoped register queries are allowed to build. */
export interface CashRegisterWhere {
  id?: string;
  tenantId?: string;
}

/** Predicate fields the tenant-scoped session queries are allowed to build. */
export interface CashSessionWhere {
  id?: string;
  tenantId?: string;
  status?: CashSessionStatusValue;
}

/** Deterministic ordering clauses accepted by the cash list delegates. */
export interface CashOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/**
 * Structural contract for the register delegate. The generated client and the
 * in-memory test fake both satisfy it, keeping this repository independent of
 * the generated model namespace (the customer/catalog/inventory/supplier/sale
 * convention). There is deliberately NO delete affordance.
 */
export interface CashRegisterDelegate {
  findFirst: (args: { where: CashRegisterWhere }) => Promise<CashRegisterRow | null>;
  findMany: (args: {
    where: CashRegisterWhere;
    orderBy?: readonly CashOrderBy[];
  }) => Promise<CashRegisterRow[]>;
  create: (args: {
    data: CashRegisterCreateData & { tenantId: string };
  }) => Promise<CashRegisterRow>;
}

/**
 * Structural contract for the session delegate. The generated client and the
 * in-memory test fake both satisfy it. There is deliberately NO delete and NO
 * status update: a session is a confirmed record and close is EPIC-13 surface.
 */
export interface CashSessionDelegate {
  findFirst: (args: { where: CashSessionWhere }) => Promise<CashSessionRow | null>;
  findMany: (args: {
    where: CashSessionWhere;
    orderBy?: readonly CashOrderBy[];
  }) => Promise<CashSessionRow[]>;
  create: (args: {
    data: CashSessionCreateData & { tenantId: string; status: CashSessionStatusValue };
  }) => Promise<CashSessionRow>;
}

/**
 * Structural contract for resolving the CALLER'S OWN membership. Only the id is
 * needed: the session stores the membership reference the database's composite
 * `RESTRICT` foreign key guarantees belongs to the same tenant.
 */
export interface CashMembershipLookup {
  findFirst: (args: {
    where: { tenantId: string; userProfileId: string; status: "ACTIVE" };
    orderBy?: readonly { createdAt?: "asc" | "desc"; id?: "asc" | "desc" }[];
  }) => Promise<{ id: string } | null>;
}

/**
 * Cash movement kind values pinned by schema enum `cash_movement_type`. EPIC-12
 * POS-002 ships the standalone `SALE`; EPIC-13 appends the six remaining PRD §20
 * kinds additively (DEC-020). Kept as a local literal union so this boundary
 * stays decoupled from the generated client namespace.
 */
export type CashMovementTypeValue = "SALE";

/**
 * Immutable cash movement row (PRD §20, DEC-020). `amount` is an exact
 * `Decimal(14, 2)` — `Prisma.Decimal` at runtime, a plain exact string in the
 * in-memory fake — and is NEVER coerced to a JavaScript float. The `reason` is
 * optional free text; the `SALE` kind is self-describing and ships none.
 * Nothing in POS-002 writes one: POS-003 appends the `SALE` movement inside the
 * CompleteSale transaction. There is deliberately no `updatedAt` — the row is
 * append-only by design.
 */
export interface CashMovementRow {
  id: string;
  tenantId: string;
  registerId: string;
  sessionId: string;
  type: CashMovementTypeValue;
  amount: Prisma.Decimal | string;
  reason: string | null;
  createdAt: Date;
}

/**
 * Write payload for {@link CashRepository.createSaleMovement}. There is
 * deliberately NO `tenantId` and NO `type` field: tenant identity comes from the
 * request context and the kind is owned by the command (`SALE`), not by a
 * caller argument. The session and register are the server-resolved pair.
 */
export interface CashMovementCreateData {
  readonly registerId: string;
  readonly sessionId: string;
  readonly amount: Prisma.Decimal | string;
}

/**
 * Structural contract for the movement delegate. `create` is the ONLY mutation
 * this boundary exposes: a movement is append-only and immutable (no update, no
 * delete), matching the schema's immutability triggers. EPIC-12 writes no row
 * through it; POS-003 appends the `SALE` movement inside its transaction.
 */
export interface CashMovementDelegate {
  create: (args: {
    data: CashMovementCreateData & { tenantId: string; type: CashMovementTypeValue };
  }) => Promise<CashMovementRow>;
}

/**
 * The delegate set this repository touches. Doubles as the optional transaction
 * seam: the audited service passes its open transaction handle here so the cash
 * change and its audit row co-commit.
 */
export interface CashTx {
  cashRegister: CashRegisterDelegate;
  cashSession: CashSessionDelegate;
  cashMovement: CashMovementDelegate;
  tenantMembership: CashMembershipLookup;
}

/** Single stable message behind every cash-register 404 (byte-equivalence by construction). */
export const CASH_REGISTER_NOT_FOUND_MESSAGE = "Cash register was not found.";

/** Single stable message behind every cash-session 404. */
export const CASH_SESSION_NOT_FOUND_MESSAGE = "Cash session was not found.";

/**
 * Stable `409 CONFLICT` message for a CASH payment with NO open session: the
 * request is well formed, but the tenant has nowhere to attribute the cash, so
 * completion persists nothing (DEC-020, resolution 4 of 2026-09-29).
 */
export const CASH_SESSION_REQUIRED_MESSAGE = "A cash payment requires an open cash session.";

/**
 * Stable `409 CONFLICT` message for a CASH payment with MORE THAN ONE open
 * session: the sale carries no register reference, so there is no correct
 * drawer to attribute the cash to and completion persists nothing (DEC-020,
 * resolution 4 of 2026-09-29). A distinct message from
 * {@link CASH_SESSION_REQUIRED_MESSAGE} so the two outcomes are separable.
 */
export const CASH_SESSIONS_AMBIGUOUS_MESSAGE =
  "More than one cash session is open for this tenant.";

/**
 * Stable `403 FORBIDDEN` message for a request whose own ACTIVE membership
 * cannot be resolved for the active tenant. The opener of a session is
 * server-owned identity, so a missing membership is an authorization failure
 * rather than a `404` about an addressed resource.
 */
export const CASH_MEMBERSHIP_NOT_RESOLVED_MESSAGE =
  "The caller's active tenant membership could not be resolved.";

/**
 * Tenant-safe data access for the tenant-scoped `CashRegister` and `CashSession`
 * aggregates (EPIC-12 POS-002).
 *
 * Contract: every query carries the tenant predicate IMPLICITLY via
 * `requestContext.requireTenantId()`. Call sites never hand-write tenant filters
 * and cannot forget them; when no tenant authority was resolved server-side,
 * `requireTenantId()` throws FORBIDDEN before any database call happens. Zero
 * matching rows ⇒ `DomainError("NOT_FOUND")` with ONE shared message per
 * resource, so a foreign record is indistinguishable from a missing one and the
 * service renders a byte-equivalent 404.
 *
 * The opener is resolved through {@link resolveActiveMembershipId}: it reads the
 * ACTIVE `tenant_membership` row of `(tenantId, userProfileId)` straight from
 * the request context, so `opened_by_membership_id` can never be supplied by a
 * caller.
 *
 * There is deliberately NO delete method and no status update anywhere on this
 * repository: a session close is EPIC-13 surface. The one movement write is
 * {@link createSaleMovement}, the append-only `SALE` row POS-003 co-commits
 * inside the CompleteSale transaction; EPIC-13 owns the six remaining kinds.
 * No method takes a caller-supplied tenant id.
 */
@Injectable()
export class CashRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: CashTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Creates one cash register in the CALLER'S active tenant. `tenantId` is
   * resolved from the request context and placed LAST in the payload, so even a
   * rogue property on `data` cannot re-scope the insert. `isActive` is left to
   * the schema default: nothing in this slice can create an inactive register.
   */
  async createRegister(data: CashRegisterCreateData, tx?: CashTx): Promise<CashRegisterRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.cashRegister.create({ data: { name: data.name, tenantId } });
  }

  /**
   * The caller's active-tenant registers.
   *
   * DETERMINISTIC ORDER: newest first by `createdAt`, with `id` ascending as the
   * tiebreaker for rows created in the same millisecond. There is no filter: the
   * register list is deliberately unfiltered (the session list carries the
   * optional status filter).
   */
  async listRegisters(tx?: CashTx): Promise<CashRegisterRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.cashRegister.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  /**
   * One register of the caller's active tenant by id. The tenant predicate rides
   * along in the same WHERE clause, so a foreign id falls through to the shared
   * NOT_FOUND path instead of leaking existence. Session open resolves its
   * register through this method, which is why a foreign or unknown register is
   * the same `404`.
   */
  async findRegisterById(id: string, tx?: CashTx): Promise<CashRegisterRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.cashRegister.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", CASH_REGISTER_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * Opens one session against an in-tenant register. `tenantId` is resolved from
   * the request context, `status` is server-owned (`OPEN`) and the opener is the
   * server-resolved caller membership, so neither can be re-scoped by an
   * argument.
   *
   * The "one OPEN session per register" rule is a DATABASE property, expressed
   * by the partial unique index `cash_session_one_open_per_register_key`; this
   * method performs NO pre-check, so the rule is enforced by the index rather
   * than by application convention. The resulting `P2002` is translated by the
   * service into the stable `409 CONFLICT`.
   */
  async createSession(data: CashSessionCreateData, tx?: CashTx): Promise<CashSessionRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.cashSession.create({
      data: {
        registerId: data.registerId,
        openedByMembershipId: data.openedByMembershipId,
        openingAmount: data.openingAmount,
        status: "OPEN",
        tenantId,
      },
    });
  }

  /**
   * One session of the caller's active tenant by id. Same tenant-predicate
   * contract as {@link findRegisterById}: a foreign UUID is the shared `404`.
   */
  async findSessionById(id: string, tx?: CashTx): Promise<CashSessionRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.cashSession.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", CASH_SESSION_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * The caller's active-tenant sessions, newest first with the same `id`
   * tiebreaker as the register list. The optional `status` filter is applied on
   * top of the implicit tenant predicate; an omitted filter adds NO predicate,
   * so this layer owns no default visibility policy.
   */
  async listSessions(filters: CashSessionListFilters = {}, tx?: CashTx): Promise<CashSessionRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.cashSession.findMany({
      where: {
        tenantId,
        ...(filters.status !== undefined ? { status: filters.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  /**
   * Resolves the CALLER'S OWN active-tenant membership id for
   * `opened_by_membership_id`. Both the tenant and the profile come from the
   * request context — never from the body — and the lookup requires the
   * membership to be `ACTIVE` and scoped to the active tenant, so the composite
   * `RESTRICT` foreign key's same-tenant guarantee is satisfied by an identity
   * the caller could not choose.
   *
   * The ordering mirrors `TenantActiveGuard`'s ACTIVE-membership resolution
   * `(createdAt, id)`, so with more than one ACTIVE membership the same
   * deterministic row the guard adopted is the one recorded.
   */
  async resolveActiveMembershipId(tx?: CashTx): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    const userProfileId = this.requestContext.requireUserProfileId();
    const client = tx ?? this.prisma;
    const membership = await client.tenantMembership.findFirst({
      where: { tenantId, userProfileId, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!membership) {
      throw new DomainError("FORBIDDEN", CASH_MEMBERSHIP_NOT_RESOLVED_MESSAGE);
    }
    return membership.id;
  }

  /**
   * Resolves the caller tenant's SINGLE open cash session for a completion that
   * needs somewhere to attribute its CASH movements (DEC-020, resolution 4 of
   * 2026-09-29). The sale carries no register reference and a tenant may hold
   * several registers, so the rule is EXACTLY one `OPEN` session in the tenant:
   * zero rows is {@link CASH_SESSION_REQUIRED_MESSAGE} and more than one is
   * {@link CASH_SESSIONS_AMBIGUOUS_MESSAGE}, both stable `409 CONFLICT`. The
   * session is resolved server-side from the tenant context — never from the
   * body — and the deterministic `(createdAt, id)` ordering keeps the lookup
   * stable, though the result is rejected when it is not unique.
   */
  async resolveSingleOpenSession(tx?: CashTx): Promise<CashSessionRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const sessions = await client.cashSession.findMany({
      where: { tenantId, status: "OPEN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (sessions.length === 0) {
      throw new DomainError("CONFLICT", CASH_SESSION_REQUIRED_MESSAGE);
    }
    if (sessions.length > 1) {
      throw new DomainError("CONFLICT", CASH_SESSIONS_AMBIGUOUS_MESSAGE);
    }
    return sessions[0];
  }

  /**
   * Appends one immutable `SALE` cash movement in the CALLER'S active tenant
   * (DEC-020). `tenantId` is resolved from the request context and the kind is
   * fixed to `SALE`, so neither can be re-scoped or re-typed by an argument.
   * The register and session are the server-resolved pair the caller already
   * proved is in-tenant, and the amount is the exact CASH payment amount. This
   * is the only movement write in EPIC-12; POS-003 performs it inside its
   * CompleteSale transaction.
   */
  async createSaleMovement(data: CashMovementCreateData, tx?: CashTx): Promise<CashMovementRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.cashMovement.create({
      data: {
        registerId: data.registerId,
        sessionId: data.sessionId,
        type: "SALE",
        amount: data.amount,
        tenantId,
      },
    });
  }
}
