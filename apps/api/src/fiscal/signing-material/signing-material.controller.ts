import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../../rbac/require-permissions.decorator.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import { SigningMaterialPipe } from "./signing-material.pipe.js";
import { FiscalSigningMaterialService } from "./signing-material.service.js";
import {
  toSigningMaterialResponse,
  type SigningMaterialListResponse,
  type SigningMaterialResponse,
} from "./signing-material.dto.js";
import {
  retireSigningMaterialBodySchema,
  signingMaterialIdParamSchema,
} from "./signing-material.zod.js";

@Controller("fiscal/signing-material")
export class SigningMaterialController {
  constructor(
    private readonly service: FiscalSigningMaterialService,
    private readonly uploadPipe: SigningMaterialPipe
  ) {}

  @Post()
  @RequirePermissions(FISCAL_PERMISSIONS.signingMaterialManage)
  async upload(@Req() request: FastifyRequest): Promise<SigningMaterialResponse> {
    const upload = await this.uploadPipe.parse(request);
    return toSigningMaterialResponse(await this.service.upload(upload));
  }

  @Get()
  @RequirePermissions(FISCAL_PERMISSIONS.signingMaterialManage)
  async list(): Promise<SigningMaterialListResponse> {
    return { items: (await this.service.list()).map(toSigningMaterialResponse) };
  }

  @Post(":id/retire")
  @HttpCode(200)
  @RequirePermissions(FISCAL_PERMISSIONS.signingMaterialManage)
  async retire(@Param() params: unknown, @Body() body: unknown): Promise<SigningMaterialResponse> {
    const { id } = parseInput(signingMaterialIdParamSchema, params, "Invalid signing material id.");
    const { reason } = parseInput(
      retireSigningMaterialBodySchema,
      body,
      "Invalid signing material retirement body."
    );
    return toSigningMaterialResponse(await this.service.retire({ id, reason }));
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
