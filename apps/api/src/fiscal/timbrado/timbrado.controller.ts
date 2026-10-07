import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { SafeParseReturnType } from "zod";
import { RequirePermissions } from "../../rbac/require-permissions.decorator.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import {
  toEmitterProfileResponse,
  toEstablishmentResponse,
  toTimbradoRangeResponse,
  type EmitterProfileResponse,
  type EstablishmentListResponse,
  type EstablishmentResponse,
  type TimbradoRangeListResponse,
  type TimbradoRangeResponse,
} from "./timbrado.dto.js";
import { FiscalProfileService } from "./timbrado.service.js";
import {
  createRangeBodySchema,
  fiscalIdParamSchema,
  retireRangeBodySchema,
  saveEstablishmentBodySchema,
  saveProfileBodySchema,
} from "./timbrado.zod.js";

/**
 * The emitter profile, its establishments and its numbering ranges.
 *
 * Every route carries `fiscal.profile.manage`. There is deliberately **no route
 * that allocates a number**: the allocation is an internal call, and exposing it
 * would let a caller burn numbers without issuing anything.
 *
 * A cross-tenant resource id reaches the service as a scoped read that finds
 * nothing, so it answers `404` rather than confirming the row exists elsewhere.
 */
@Controller("fiscal")
export class FiscalProfileController {
  constructor(private readonly service: FiscalProfileService) {}

  @Put("emitter-profile")
  @HttpCode(200)
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async saveProfile(@Body() body: unknown): Promise<EmitterProfileResponse> {
    const parsed = parseInput(saveProfileBodySchema, body, "Invalid emitter fiscal profile body.");
    return toEmitterProfileResponse(
      await this.service.saveProfile({
        ruc: parsed.ruc,
        checkDigit: parsed.checkDigit,
        taxpayerType: parsed.taxpayerType,
        regimeCode: parsed.regimeCode,
        legalName: parsed.legalName,
        tradeName: parsed.tradeName,
        responsibleIssuerType: parsed.responsibleIssuer?.type ?? null,
        responsibleIssuerTypeName: parsed.responsibleIssuer?.typeName ?? null,
        responsibleIssuerId: parsed.responsibleIssuer?.id ?? null,
        responsibleIssuerName: parsed.responsibleIssuer?.name ?? null,
        responsibleIssuerRole: parsed.responsibleIssuer?.role ?? null,
        transactionType: parsed.transactionType,
        taxType: parsed.taxType,
        emissionType: parsed.emissionType,
        activities: parsed.activities,
      })
    );
  }

  @Get("emitter-profile")
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async getProfile(): Promise<EmitterProfileResponse> {
    return toEmitterProfileResponse(await this.service.getProfile());
  }

  @Get("establishments")
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async listEstablishments(): Promise<EstablishmentListResponse> {
    return { items: (await this.service.listEstablishments()).map(toEstablishmentResponse) };
  }

  @Post("establishments")
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async createEstablishment(@Body() body: unknown): Promise<EstablishmentResponse> {
    return toEstablishmentResponse(
      await this.service.createEstablishment(establishmentInput(body))
    );
  }

  @Put("establishments/:id")
  @HttpCode(200)
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async updateEstablishment(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<EstablishmentResponse> {
    const { id } = parseInput(fiscalIdParamSchema, params, "Invalid establishment id.");
    return toEstablishmentResponse(
      await this.service.updateEstablishment(id, establishmentInput(body))
    );
  }

  @Get("timbrado-ranges")
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async listRanges(): Promise<TimbradoRangeListResponse> {
    return { items: (await this.service.listRanges()).map(toTimbradoRangeResponse) };
  }

  @Post("timbrado-ranges")
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async createRange(@Body() body: unknown): Promise<TimbradoRangeResponse> {
    const parsed = parseInput(createRangeBodySchema, body, "Invalid timbrado range body.");
    return toTimbradoRangeResponse(
      await this.service.createRange({
        establishmentId: parsed.establishmentId,
        expeditionPoint: parsed.expeditionPoint,
        documentType: parsed.documentType,
        series: parsed.series,
        timbradoNumber: parsed.timbradoNumber,
        rangeFrom: parsed.rangeFrom,
        rangeTo: parsed.rangeTo,
        // Parsed as a date at midnight UTC, which is the anchor the column
        // enforces: `tdFeIniT` is a date and the DE emits the date part.
        validityStart: new Date(`${parsed.validityStart}T00:00:00Z`),
      })
    );
  }

  @Post("timbrado-ranges/:id/retire")
  @HttpCode(200)
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  async retireRange(
    @Param() params: unknown,
    @Body() body: unknown
  ): Promise<TimbradoRangeResponse> {
    const { id } = parseInput(fiscalIdParamSchema, params, "Invalid timbrado range id.");
    const { reason } = parseInput(retireRangeBodySchema, body, "Invalid retirement body.");
    return toTimbradoRangeResponse(await this.service.retireRange(id, reason));
  }
}

/** The establishment body, with its optional district pair flattened. */
function establishmentInput(body: unknown) {
  const parsed = parseInput(saveEstablishmentBodySchema, body, "Invalid establishment body.");
  return {
    code: parsed.code,
    addressLine: parsed.addressLine,
    houseNumber: parsed.houseNumber,
    addressComplement1: parsed.addressComplement1,
    addressComplement2: parsed.addressComplement2,
    departmentCode: parsed.departmentCode,
    districtCode: parsed.district?.code ?? null,
    districtName: parsed.district?.name ?? null,
    cityCode: parsed.cityCode,
    cityName: parsed.cityName,
    phone: parsed.phone,
    email: parsed.email,
    branchName: parsed.branchName,
  };
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
