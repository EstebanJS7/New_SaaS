import { Body, Controller, Get, Headers, Post, Query, Res } from "@nestjs/common";
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
  cashSessionListQuery,
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
 * The surface is EXACTLY five routes: two reads, the minimal register create,
 * the session open and the EPIC-13 standalone movement command. There is
 * deliberately NO `PATCH`, NO `DELETE` and NO close route anywhere: session
 * close, the expected/counted difference, cash reversals and the full cash UI
 * belong to EPIC-13/EPIC-14 (DEC-020). The `SALE` movement kind is never
 * accepted here — POS-003 owns it inside the CompleteSale transaction.
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
    // The key is read here and REQUIRED by the service AFTER its entitlement,
    // permission and session guards, so a missing key can never mask a `403` or
    // the shared session `404` with a `400`. A fresh create is `201` and an
    // identical replay is `200` with the SAME movement body.
    const result = await this.cash.createMovement(input, readIdempotencyKey(headers));
    reply.status(result.replay ? 200 : 201);
    return result.movement;
  }
}

/**
 * Reads the `Idempotency-Key` header as the RAW value. Fastify lower-cases
 * incoming header names, so the lookup is on `idempotency-key`. The value is
 * validated and required by the service, after its guards, so a malformed or
 * absent key cannot turn a `403` or the shared session `404` into a `400`.
 */
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
