import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { FastifyReply } from "fastify";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { FiscalDocumentResponse } from "./fiscal.dto.js";
import {
  FISCAL_KUDE_CONTENT_SECURITY_POLICY,
  FISCAL_KUDE_CONTENT_TYPE,
  FiscalKudeService,
} from "./fiscal-kude.service.js";
import { FISCAL_PERMISSIONS } from "./fiscal.permissions.js";
import { FiscalService } from "./fiscal.service.js";
import {
  cancelFiscalDocumentBody,
  createFiscalDocumentBody,
  fiscalDocumentListQuery,
  fiscalDocumentIdParam,
} from "./fiscal.zod.js";

@Controller("fiscal-documents")
export class FiscalController {
  constructor(
    private readonly fiscal: FiscalService,
    private readonly kude: FiscalKudeService
  ) {}

  @Get()
  @RequirePermissions(FISCAL_PERMISSIONS.read)
  async list(@Query() query: unknown): Promise<FiscalDocumentResponse[]> {
    return this.fiscal.list(
      parseInput(fiscalDocumentListQuery, query, "Invalid fiscal document filters.")
    );
  }

  @Get(":id")
  @RequirePermissions(FISCAL_PERMISSIONS.read)
  async get(@Param() params: unknown): Promise<FiscalDocumentResponse> {
    const { id } = parseInput(fiscalDocumentIdParam, params, "Invalid fiscal document id.");
    return this.fiscal.get(id);
  }

  /**
   * FISC-021 / DEC-098 — the stored KuDE as printable HTML, opened inline so the
   * browser prints it or saves it as PDF. Not JSON: the headers are set on the
   * Fastify reply only after the read succeeded, so a refusal still reaches the
   * client as the JSON error envelope (the `ReportExportController` precedent).
   */
  @Get(":id/kude")
  @RequirePermissions(FISCAL_PERMISSIONS.read)
  async getKude(
    @Param() params: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Buffer> {
    const { id } = parseInput(fiscalDocumentIdParam, params, "Invalid fiscal document id.");
    const kude = await this.kude.read(id);
    reply.header("Content-Type", FISCAL_KUDE_CONTENT_TYPE);
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", FISCAL_KUDE_CONTENT_SECURITY_POLICY);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", `inline; filename="${kude.filename}"`);
    return kude.body;
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions(FISCAL_PERMISSIONS.issue)
  async cancel(@Param() params: unknown, @Body() body: unknown): Promise<FiscalDocumentResponse> {
    const { id } = parseInput(fiscalDocumentIdParam, params, "Invalid fiscal document id.");
    const { reason } = parseInput(
      cancelFiscalDocumentBody,
      body,
      "Invalid fiscal document cancel body."
    );
    return this.fiscal.cancel(id, reason);
  }

  @Post()
  @RequirePermissions(FISCAL_PERMISSIONS.issue)
  async issue(@Body() body: unknown): Promise<FiscalDocumentResponse> {
    return this.fiscal.issue(
      parseInput(createFiscalDocumentBody, body, "Invalid fiscal document issue body.")
    );
  }
}

function parseInput<T>(
  schema: { safeParse: (value: unknown) => SafeParseReturnType<unknown, T> },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_FAILED", message);
  return parsed.data;
}
