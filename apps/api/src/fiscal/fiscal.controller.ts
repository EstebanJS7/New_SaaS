import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import type { FiscalDocumentResponse } from "./fiscal.dto.js";
import { FISCAL_PERMISSIONS } from "./fiscal.permissions.js";
import { FiscalService } from "./fiscal.service.js";
import {
  cancelFiscalDocumentBody,
  createFiscalDocumentBody,
  fiscalDocumentIdParam,
} from "./fiscal.zod.js";

@Controller("fiscal-documents")
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

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
