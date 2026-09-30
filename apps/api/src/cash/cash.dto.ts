/**
 * Allowlisted cash read projections (EPIC-12 POS-002).
 *
 * Data classification (PRD §41): the register name, the session status, the
 * opening amount, the movement type/amount/reason and the adjustment direction
 * are INTERNAL. Prisma models are never returned; only the keys declared here
 * cross the HTTP boundary, and no CONFIDENTIAL or RESTRICTED payload is read or
 * written by this slice.
 *
 * Decimal fields are projected as FIXED-SCALE exact strings at their stored
 * column scale — `openingAmount` and `amount` at `Decimal(14, 2)` — never as
 * JavaScript floats, following the documented "Decimal projections are
 * fixed-scale" rule (the sales/catalog/purchases DTOs are the sibling
 * precedents). Padding to the column scale is lossless because the request
 * contract caps a submitted value at the same scale.
 *
 * There is deliberately no `tenantId` key on any projection: the caller's
 * tenant is already the request's own identity, and no projection is addressed
 * across a tenant boundary. No `branchId` exists anywhere (DEC-020).
 */

/** Lifecycle values pinned by the `cash_session_status` enum (PRD §20). */
export type CashSessionStatusDto = "OPEN" | "CLOSED";

/**
 * Movement kinds an EPIC-13 standalone command may create (PRD §20). `SALE` is
 * deliberately absent: it is written only by sale completion, so the command
 * DTO never projects one. Mirrors the `cash_movement_type` enum minus `SALE`.
 */
export type CashMovementTypeDto =
  "REFUND" | "INCOME" | "EXPENSE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT";

/** Explicit `ADJUSTMENT` sign (DEC-030); `null` for every type-owned kind. */
export type CashMovementDirectionDto = "INCREASE" | "DECREASE";

/**
 * One allowlisted cash register: the drawer a session is opened against. There
 * is no balance column — the register's expected amount is derived from the
 * immutable movement ledger, never mutated directly (PRD §20).
 */
export interface CashRegisterResponse {
  readonly id: string;
  /** Operator-facing drawer name, non-empty and bounded to 1..200 characters. */
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One allowlisted cash session. `openedByMembershipId` is the opener resolved
 * server-side from the authenticated request context, never caller input
 * (DEC-020 subsequent-scope note of 2026-09-29). `openingAmount` is the required
 * opening float, exact fixed-scale (2 decimals).
 */
export interface CashSessionResponse {
  readonly id: string;
  readonly registerId: string;
  readonly status: CashSessionStatusDto;
  readonly openedAt: string;
  readonly openedByMembershipId: string;
  /** Exact fixed-scale (2 decimals) non-negative literal, e.g. `"0.00"`. */
  readonly openingAmount: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One allowlisted immutable cash movement (EPIC-13 CASH-002). The `amount` is
 * always POSITIVE and exact fixed-scale (2 decimals) — the type owns the sign
 * (DEC-030) — and `direction` is non-null EXACTLY for an `ADJUSTMENT`. The
 * `reason` is the operator's own text (INTERNAL) or `null` for the kinds whose
 * reason is optional. There is deliberately NO `tenantId` key: the caller's
 * tenant is already the request's own identity and this row is never addressed
 * across a tenant boundary. The ledger entry is immutable, so there is no
 * `updatedAt`.
 */
export interface CashMovementResponse {
  readonly id: string;
  readonly registerId: string;
  readonly sessionId: string;
  readonly type: CashMovementTypeDto;
  readonly direction: CashMovementDirectionDto | null;
  /** Exact fixed-scale (2 decimals) POSITIVE literal, e.g. `"1500.00"`. */
  readonly amount: string;
  readonly reason: string | null;
  readonly createdAt: string;
}
