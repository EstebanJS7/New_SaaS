import { Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { BrandingService } from "./branding.service.js";
import type { BrandingResponse } from "./dto.js";

const reasonField = z.string().min(1).max(256).optional();

const updateBrandingBody = z.object({
  overrides: z.unknown(),
  reason: reasonField,
});

const resetBrandingBody = z.object({
  reason: reasonField,
});

/**
 * Private tenant branding management surface.
 *
 * All routes resolve the tenant exclusively server-side from the active
 * request context. Mutations are gated by `branding.settings.manage` and the
 * `custom_branding` entitlement; reads require only authentication and active
 * membership.
 */
@Controller("branding")
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Returns the resolved brand for the current tenant. */
  @Get("current")
  @RequirePermissions()
  async get(): Promise<BrandingResponse> {
    return this.branding.get();
  }

  /** Upserts v1 tenant overrides and co-commits an audit row. */
  @Put("current")
  @RequirePermissions("branding.settings.manage")
  async update(@Body() body: unknown): Promise<BrandingResponse> {
    const parsed = updateBrandingBody.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid branding update body.");
    }
    return this.branding.update({ overrides: parsed.data.overrides, reason: parsed.data.reason });
  }

  /** Idempotently removes tenant overrides and co-commits an audit row. */
  @Post("reset")
  @HttpCode(200)
  @RequirePermissions("branding.settings.manage")
  async reset(@Body() body: unknown): Promise<BrandingResponse> {
    const parsed = resetBrandingBody.safeParse(body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid branding reset body.");
    }
    return this.branding.reset({ reason: parsed.data.reason });
  }
}
