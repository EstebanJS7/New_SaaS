import { Body, Controller, Get, Headers, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type {
  CashMovementResponse,
  CashRegisterResponse,
  CashSessionResponse,
} from "./cash.dto.js";
import { CASH_PERMISSIONS } from "./cash.permissions.js";
import { CashService } from "./cash.service.js";
import {
  cashSessionIdParam,
  cashSessionListQuery,
  closeCashSessionBody,
  createCashMovementBody,
  createCashRegisterBody,
  openCashSessionBody,
} from "./cash.zod.js";

/**
 * Private tenant-scoped cash surface (EPIC-12 POS-002).
 *
 * Routes are unprefixed (`/cash`, not `/api/v1/cash`) per DEC-002. Every route
 * declares the granular `cash.*` permission it needs, and the service
 * re-asserts the `cash` entitlement first and the permission second as defense
 * in depth. Input is Zod-validated and responses are allowlisted INTERNAL DTOs —
 * no Prisma model crosses the boundary.
 *
 * The surface is EXACTLY six routes: two reads, the minimal register create,
 * the session open, the EPIC-13 standalone movement command and the EPIC-13
 * close command. There is deliberately NO `PATCH` and NO `DELETE`, and no
 * reopen: session close is a one-way command whose `CLOSED` state is terminal
 * (DEC-036). Cash reversals and the full cash UI belong to EPIC-14. The `SALE`
 * movement kind is never accepted here — POS-003 owns it inside the CompleteSale
 * transaction.
 */
@Controller("cash")
export class CashController {
  constructor(private readonly cash: CashService) {}

  /** Lists the caller tenant's registers, newest first. */
  @Get("registers")
  @RequirePermissions(CASH_PERMISSIONS.read)
  async listRegisters(): Promise<CashRegisterResponse[]> {
    return this.cash.listRegisters();
  }

  /** Creates an in-tenant register; the mutation and its audit row co-commit. */
  @Post("registers")
  @RequirePermissions(CASH_PERMISSIONS.createRegister)
  async createRegister(@Body() body: unknown): Promise<CashRegisterResponse> {
    const input = parseInput(createCashRegisterBody, body, "Invalid cash register create body.");
    return this.cash.createRegister(input);
  }

  /**
   * Lists the caller tenant's sessions, newest first. The optional `status`
   * filter has NO implicit default.
   */
  @Get("sessions")
  @RequirePermissions(CASH_PERMISSIONS.read)
  async listSessions(@Query() query: unknown): Promise<CashSessionResponse[]> {
    const filters = parseInput(cashSessionListQuery, query, "Invalid cash session filters.");
    return this.cash.listSessions(filters);
  }

  /**
   * Opens one session for an in-tenant register with the required opening float;
   * the mutation and its audit row co-commit. A second open for the same
   * register is the stable `409` produced by the partial unique index.
   */
  @Post("sessions")
  @RequirePermissions(CASH_PERMISSIONS.openSession)
  async openSession(@Body() body: unknown): Promise<CashSessionResponse> {
    const input = parseInput(openCashSessionBody, body, "Invalid cash session open body.");
    return this.cash.openSession(input);
  }

  /**
   * Creates one immutable standalone cash movement against an in-tenant `OPEN`
   * session; the movement and its audit row co-commit. The `registerId` is
   * derived server-side from the resolved session, the amount is stored
   * positive and the move is limited to the six non-sale kinds (DEC-020/030/032).
   */
  @Post("movements")
  @RequirePermissions(CASH_PERMISSIONS.createMovement)
  async createMovement(
    @Body() body: unknown,
    @Headers() headers: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<CashMovementResponse> {
    const input = parseInput(createCashMovementBody, body, "Invalid cash movement create body.");
    const result = await this.cash.createMovement(input, readIdempotencyKey(headers));
    reply.status(result.replay ? 200 : 201);
    return result.movement;
  }

  /**
   * Closes one in-tenant `OPEN` session: the server computes the expected
   * amount, compares it with the counted amount, stores the three close amounts
   * and writes one audit row (DEC-031/035/036). A session that is not `OPEN` is
   * the stable `409`; `CLOSED` is terminal, so there is no reopen route and a
   * second close is never replayed.
   */
  @Post("sessions/:id/close")
  @RequirePermissions(CASH_PERMISSIONS.closeSession)
  async closeSession(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<CashSessionResponse> {
    const { id } = parseInput(cashSessionIdParam, params, "Invalid cash session id.");
    const input = parseInput(closeCashSessionBody, body, "Invalid cash session close body.");
    return this.cash.closeSession(id, input);
  }
}

/** The RAW `Idempotency-Key` header; the service validates it after its guards. */
function readIdempotencyKey(headers: unknown): unknown {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }
  return (headers as Record<string, unknown>)["idempotency-key"];
}

/** Rejects the whole request with 400 `VALIDATION_FAILED` when invalid. */
function parseInput<T>(
  schema: { safeParse: (value: unknown) => SafeParseReturnType<unknown, T> },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", message);
  }
  return parsed.data;
}
