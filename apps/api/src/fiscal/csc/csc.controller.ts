import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../../rbac/require-permissions.decorator.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import { FiscalCscService } from "./csc.service.js";
import { cscIdSchema, loadCscBodySchema, retireCscBodySchema } from "./csc.zod.js";

@Controller("fiscal/csc")
export class FiscalCscController {
  constructor(private readonly service: FiscalCscService) {}

  @Get()
  @RequirePermissions(FISCAL_PERMISSIONS.signingMaterialManage)
  async list() {
    return { items: await this.service.list() };
  }

  @Post()
  @RequirePermissions(FISCAL_PERMISSIONS.signingMaterialManage)
  async load(@Body() body: unknown) {
    return this.service.load(parse(loadCscBodySchema, body));
  }

  @Post(":id/retire")
  @HttpCode(200)
  @RequirePermissions(FISCAL_PERMISSIONS.signingMaterialManage)
  async retire(@Param() params: unknown, @Body() body: unknown) {
    return this.service.retire({
      ...parse(cscIdSchema, params),
      ...parse(retireCscBodySchema, body),
    });
  }
}

function parse<T>(
  schema: { safeParse(value: unknown): SafeParseReturnType<unknown, T> },
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  // Do not expose validation details: they may contain taxpayer secrets.
  if (!parsed.success) throw new DomainError("VALIDATION_FAILED", "Invalid CSC request.");
  return parsed.data;
}
