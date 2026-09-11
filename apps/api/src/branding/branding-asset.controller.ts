import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { BrandingAssetDeliveryService } from "./branding-asset-delivery.service.js";
import { BrandingAssetPipe } from "./branding-asset.pipe.js";
import { BrandingAssetService } from "./branding-asset.service.js";

/**
 * Private tenant branding asset management surface.
 *
 * All routes resolve the tenant exclusively from the active request context.
 * Mutations require `branding.settings.manage` and the `custom_branding`
 * entitlement; reads require authentication and active membership.
 */
@Controller("branding/assets")
export class BrandingAssetController {
  constructor(
    private readonly assetService: BrandingAssetService,
    private readonly assetPipe: BrandingAssetPipe,
    private readonly delivery: BrandingAssetDeliveryService
  ) {}

  /** Uploads/replaces a logo or favicon and returns an API-local signed URL. */
  @Post(":kind")
  @HttpCode(201)
  @RequirePermissions("branding.settings.manage")
  async upload(@Param("kind") kind: string, @Req() request: FastifyRequest) {
    const validatedKind = this.assetPipe.assertKind(kind);
    const file = await this.assetPipe.parse(request, validatedKind);
    return this.assetService.upload(validatedKind, file);
  }

  /** Returns an API-local signed URL for the current tenant's asset. */
  @Get(":kind")
  @RequirePermissions("branding.settings.manage")
  async getSignedUrl(@Param("kind") kind: string) {
    const validatedKind = this.assetPipe.assertKind(kind);
    const url = await this.assetService.getClientDeliveryUrl(validatedKind);
    if (!url) {
      throw new DomainError("NOT_FOUND", "Branding asset not found.");
    }
    return { kind: validatedKind, url };
  }

  /** Proxies the asset bytes without exposing storage keys, buckets, or paths. */
  @Get(":kind/content")
  @RequirePermissions("branding.settings.manage")
  async getContent(
    @Param("kind") kind: string,
    @Query("token") token: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<void> {
    const validatedKind = this.assetPipe.assertKind(kind);
    if (typeof token !== "string" || token.length === 0) {
      throw new DomainError("VALIDATION_FAILED", "Missing asset URL token.");
    }
    await this.delivery.stream({ kind: validatedKind, token }, reply);
  }

  /** Removes a logo or favicon from the tenant brand. */
  @Delete(":kind")
  @RequirePermissions("branding.settings.manage")
  async remove(@Param("kind") kind: string) {
    const validatedKind = this.assetPipe.assertKind(kind);
    return this.assetService.remove(validatedKind);
  }
}
