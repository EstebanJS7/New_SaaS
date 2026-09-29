/**
 * Allowlisted cash read projections (EPIC-12 POS-002).
 *
 * Data classification (PRD §41): the register name, the session status and the
 * opening amount are INTERNAL. Prisma models are never returned; only the keys
 * declared here cross the HTTP boundary, and no CONFIDENTIAL or RESTRICTED
 * payload is read or written by this slice.
 *
 * Decimal fields are projected as FIXED-SCALE exact strings at their stored
 * column scale — `openingAmount` at `Decimal(14, 2)` — never as JavaScript
 * floats, following the documented "Decimal projections are fixed-scale" rule
 * (the sales/catalog/purchases DTOs are the sibling precedents). Padding to the
 * column scale is lossless because the request contract caps a submitted value
 * at the same scale.
 *
 * There is deliberately no `tenantId` key on either projection: the caller's
 * tenant is already the request's own identity, and neither projection is
 * addressed across a tenant boundary. No `branchId` exists anywhere (DEC-020).
 */

/** Lifecycle values pinned by the `cash_session_status` enum (PRD §20). */
export type CashSessionStatusDto = "OPEN" | "CLOSED";

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
